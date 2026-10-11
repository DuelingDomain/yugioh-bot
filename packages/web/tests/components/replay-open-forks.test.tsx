// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { parseUtcStamp, relativeAgo, useOpenForks } from "@/components/duel/replay-open-forks";
import { ReplayOwnerTools, useForkStart } from "@/components/duel/replay-fork-button";
import { normalizeReplay } from "@/components/duel/replay-controller";
import { DuelReplayView } from "@/components/duel/replay";
import { replayV2 } from "./replay-fixtures";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/duel/field", () => ({
  DuelField: () => <div data-testid="field" />,
  DeckMasterRail: () => null,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const utc = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace("T", " ");
const MIN = 60_000;

describe("relative times from a UTC stamp", () => {
  it("reads the stamp as UTC, not local time", () => {
    expect(parseUtcStamp("2026-10-10 12:00:00")).toBe(Date.UTC(2026, 9, 10, 12, 0, 0));
    expect(parseUtcStamp("not a time")).toBeNull();
  });
  it("says just now, minutes, hours and days", () => {
    const now = Date.UTC(2026, 9, 10, 12, 0, 0);
    expect(relativeAgo("2026-10-10 11:59:40", now)).toBe("just now");
    expect(relativeAgo("2026-10-10 11:55:00", now)).toBe("5 min ago");
    expect(relativeAgo("2026-10-10 09:00:00", now)).toBe("3 h ago");
    expect(relativeAgo("2026-10-07 12:00:00", now)).toBe("3 d ago");
    expect(relativeAgo("garbage", now)).toBe("");
  });
});

describe("open forks in the owner replay controls", () => {
  const caps = { canFork: true, privateSeats: [0, 1] };
  let calls: Array<{ url: URL; init?: RequestInit }>;
  let forks: Array<{ slug: string; sourceSlug: string; format: string; createdAt: string; lastActivityAt: string }>;
  let limitHit: boolean;
  let listStatus: number;

  beforeEach(() => {
    resetCoinTossState();
    window.localStorage.clear();
    nav.push.mockClear();
    limitHit = false;
    listStatus = 200;
    forks = [
      { slug: "fork-a", sourceSlug: "game-1", format: "1v1", createdAt: utc(125 * MIN), lastActivityAt: utc(5 * MIN) },
      { slug: "fork-b", sourceSlug: "game-7", format: "ffa4", createdAt: utc(30 * MIN), lastActivityAt: utc(30 * MIN) },
    ];
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      calls.push({ url, init });
      if (url.pathname === "/api/admin/duels/forks") {
        return listStatus === 200 ? json({ forks, limit: 4 }, 200) : json({ error: listStatus === 503 ? "Access check unavailable" : "No access", code: listStatus === 503 ? "ACCESS_UNAVAILABLE" : "ACCESS_DENIED" }, listStatus);
      }
      if (url.pathname.endsWith("/fork/cancel") && init?.method === "POST") {
        const slug = url.pathname.split("/")[3]!;
        forks = forks.filter((fork) => fork.slug !== slug);
        limitHit = false;
        return json({ session: { slug } });
      }
      if (url.pathname.endsWith("/replay/fork") && init?.method === "POST") {
        return limitHit
          ? json({ error: "Replay fork limit reached. Cancel a fork and try again.", code: "FORK_LIMIT", limit: 4, forksUrl: "/api/admin/duels/forks" }, 429)
          : json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: {} });
      }
      return url.pathname.startsWith("/api/admin") ? json({ ...replayV2({ visibility: "mine" }), capabilities: caps }) : json(replayV2({ visibility: "mine" }));
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

  async function open(canInspectSource = true) {
    render(<DuelReplayView slug="game-1" canInspectSource={canInspectSource} />);
    await screen.findByRole("group", { name: "Replay controls" });
  }
  const forkCalls = () => calls.filter((call) => call.url.pathname === "/api/admin/duels/forks");

  it("shows Open forks (N) and lists each fork with its format, source, local relative times, Open and Cancel", async () => {
    await open();
    const entry = await screen.findByRole("button", { name: "Open forks (2)" });
    fireEvent.click(entry);
    const dialog = await screen.findByRole("dialog");
    const rowA = dialog.querySelector("[data-open-fork='fork-a']") as HTMLElement;
    expect(within(rowA).getByText("1v1")).toBeTruthy();
    // fork-a came from the replay on screen: no link to the page that is already open.
    expect(within(rowA).getByText("From this replay (game-1)")).toBeTruthy();
    expect(within(rowA).queryByRole("link", { name: /^From/ })).toBeNull();
    expect(within(rowA).getByText(/Started 2 h ago · Active 5 min ago/)).toBeTruthy();
    expect(within(rowA).getByRole("link", { name: /Open the 1v1 fork/ }).getAttribute("href")).toBe("/duels/fork-a");
    const rowB = dialog.querySelector("[data-open-fork='fork-b']") as HTMLElement;
    expect(within(rowB).getByText("4-player FFA")).toBeTruthy();
    expect(within(rowB).getByText("From game-7").getAttribute("href")).toBe("/duels/game-7/replay");
  });

  it("cancels only after a confirm, then refreshes the list and the count", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Open forks (2)" }));
    const dialog = await screen.findByRole("dialog");
    const row = dialog.querySelector("[data-open-fork='fork-a']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Cancel the 1v1 fork/ }));
    expect(calls.some((call) => call.url.pathname.endsWith("/fork/cancel"))).toBe(false);
    fireEvent.click(within(row).getByRole("button", { name: "Keep" }));
    expect(calls.some((call) => call.url.pathname.endsWith("/fork/cancel"))).toBe(false);
    fireEvent.click(within(row).getByRole("button", { name: /Cancel the 1v1 fork/ }));
    fireEvent.click(within(row).getByRole("button", { name: "Cancel fork" }));
    await waitFor(() => expect(dialog.querySelector("[data-open-fork='fork-a']")).toBeNull());
    expect(calls.filter((call) => call.url.pathname === "/api/duels/fork-a/fork/cancel")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Open forks (1)", hidden: true })).toBeTruthy();
  });

  it("shows the list when Jump in hits the fork limit, and retries after a cancel", async () => {
    limitHit = true;
    forks = [1, 2, 3, 4].map((n) => ({ slug: `fork-${n}`, sourceSlug: "game-1", format: "1v1", createdAt: utc(n * MIN), lastActivityAt: utc(n * MIN) }));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/Cancel one to start another/)).toBeTruthy();
    const retry = within(dialog).getByRole("button", { name: "Jump in again" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    const row = dialog.querySelector("[data-open-fork='fork-4']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Cancel the 1v1 fork/ }));
    fireEvent.click(within(row).getByRole("button", { name: "Cancel fork" }));
    await waitFor(() => expect((within(dialog).getByRole("button", { name: "Jump in again" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(dialog).getByRole("button", { name: "Jump in again" }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
  });

  it("fails closed for a user who is not the owner: no entry, no list call", async () => {
    await open(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(forkCalls()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Open forks/ })).toBeNull();
  });

  it("fails closed when the page says owner but the server answer has no capabilities", async () => {
    // The owner replay route answered like a plain viewer: no list call, no controls.
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      calls.push({ url, init });
      return json(replayV2({ visibility: "mine" }));
    }));
    await open(true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(forkCalls()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Open forks|Jump in/ })).toBeNull();
    expect(document.querySelector("[data-replay-owner-tools]")).toBeNull();
  });

  it("hides the entry when the list route refuses, and does not ask again", async () => {
    listStatus = 403;
    await open();
    await waitFor(() => expect(forkCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("button", { name: /Open forks/ })).toBeNull();
    expect(document.querySelector("[data-open-forks-list]")).toBeNull();
  });

  it("treats a 503 as an error that can be retried, not as a refusal", async () => {
    listStatus = 503;
    await open();
    const entry = await screen.findByRole("button", { name: "Open forks (could not load)" });
    fireEvent.click(entry);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    // The access check is back: Try again loads the list.
    listStatus = 200;
    fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(document.querySelector("[data-open-fork='fork-a']")).not.toBeNull());
    expect(screen.getByRole("button", { name: "Open forks (2)", hidden: true })).toBeTruthy();
  });
});

// The inner owner checks, without the page around them.
describe("owner gates of the controls and the list", () => {
  beforeEach(() => {
    resetCoinTossState();
    vi.stubGlobal("fetch", vi.fn(async () => json({ forks: [], limit: 4 })));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

  function Harness({ enabled }: { enabled: boolean }) {
    const state = useOpenForks(enabled);
    return <span data-testid="state">{state.forks == null ? "empty" : `list ${state.forks.length}`}</span>;
  }

  it("useOpenForks(false) never calls the list route", async () => {
    render(<Harness enabled={false} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(screen.getByTestId("state").textContent).toBe("empty");
  });

  it("useOpenForks(true) calls it once", async () => {
    render(<Harness enabled />);
    await waitFor(() => expect(screen.getByTestId("state").textContent).toBe("list 0"));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  function Tools({ capabilities }: { capabilities?: { canFork: boolean; privateSeats: number[] } }) {
    const model = normalizeReplay({ ...replayV2({ visibility: "mine" }), ...(capabilities ? { capabilities } : {}) }, "game-1", "mine");
    const openForks = useOpenForks(true);
    const fork = useForkStart({ slug: "game-1", model, frame: model.frames[1], openForks });
    return <ReplayOwnerTools slug="game-1" model={model} frame={model.frames[1]} view={{ seat: null, reveal: false }} onViewChange={() => {}}
      openForks={openForks} fork={fork} />;
  }

  it("ReplayOwnerTools draws nothing for a model without capabilities", () => {
    const { container } = render(<Tools />);
    expect(container.querySelector("[data-replay-owner-tools]")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ReplayOwnerTools draws the cluster for a model with capabilities", async () => {
    const { container } = render(<Tools capabilities={{ canFork: true, privateSeats: [0] }} />);
    expect(container.querySelector("[data-replay-owner-tools]")).not.toBeNull();
    expect(await screen.findByRole("button", { name: /Jump in/ })).toBeTruthy();
  });
});
