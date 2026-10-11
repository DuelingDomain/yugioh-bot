// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { replayV2 } from "./replay-fixtures";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
// The board and the Tag shell are stubs: this file tests the words and requests of the replay page, not the tables.
vi.mock("@/components/duel/field", () => ({
  DuelField: () => <div data-testid="field" />,
  DeckMasterRail: () => null,
}));
vi.mock("@/components/duel/tag/tag-shell", () => ({
  TagShell: (props: { notices?: React.ReactNode; replay?: { transport?: React.ReactNode } }) => (
    <div data-testid="tag-shell">{props.notices}{props.replay?.transport}</div>
  ),
}));

import { DuelReplayView } from "@/components/duel/replay";
import { ReplayVerificationNote } from "@/components/duel/replay-verification";
import { ReplayTableTransport } from "@/components/duel/replay-ffa";
import { replayFailure, UNCHECKED_BANNER_COPY } from "@/components/duel/replay-controller";
import { DuelRequestError } from "@/components/duel/api";
import { rememberHistorySearch, savedHistoryHref } from "@/components/duel/history-filters";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MISMATCH = "This replay no longer matches the saved duel, because card data changed after it was played.";
const NO_BOARD = "This duel has no saved final board, so its replay cannot be checked.";
const BANNER = "Unchecked replay — card data changed after this duel. Moves after a changed card can be wrong.";

let calls: Array<{ url: URL; init?: RequestInit }>;
function server(answer: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    calls.push({ url, init });
    return answer(url, init);
  }));
}

const unverifiedBody = (over: Record<string, unknown> = {}) => ({
  error: "Replay is unverified.", code: "REPLAY_UNVERIFIED", finalBoard: "available", canOpenUnchecked: false, reason: "board_mismatch", ...over,
});

beforeEach(() => {
  resetCoinTossState();
  nav.push.mockReset();
  window.history.replaceState(null, "", "/duels/game-1/replay");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

describe("REPLAY_UNVERIFIED copy", () => {
  it.each([["board_mismatch", MISMATCH], ["command_mismatch", MISMATCH], ["no_saved_board", NO_BOARD]])(
    "says the right thing for %s", (reason, text) => {
      const failure = replayFailure(new DuelRequestError("server text", 409, "REPLAY_UNVERIFIED", "available", { reason: reason as "board_mismatch" }));
      expect(failure.message).toBe(text);
    });

  it("uses the mismatch copy when the server sends no reason", () => {
    expect(replayFailure(new DuelRequestError("x", 409, "REPLAY_UNVERIFIED")).message).toBe(MISMATCH);
  });

  it("shows the copy and the saved final board link on the page", async () => {
    server(() => json(unverifiedBody(), 409));
    render(<DuelReplayView slug="game-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(MISMATCH);
    expect(screen.getByRole("link", { name: "Final board" }).getAttribute("href")).toBe("/duels/game-1");
    expect(screen.getByRole("link", { name: "Match history" })).toBeTruthy();
  });

  it("shows the no-board copy for no_saved_board", async () => {
    server(() => json(unverifiedBody({ reason: "no_saved_board", finalBoard: "none" }), 409));
    render(<DuelReplayView slug="game-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(NO_BOARD);
  });
});

describe("Open unchecked replay", () => {
  it("shows no button when canOpenUnchecked is false", async () => {
    server(() => json(unverifiedBody({ canOpenUnchecked: false }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Open unchecked replay" })).toBeNull();
  });

  it("shows no button when the server sends no canOpenUnchecked", async () => {
    server(() => json({ error: "x", code: "REPLAY_UNVERIFIED", finalBoard: "available", reason: "board_mismatch" }, 409));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Open unchecked replay" })).toBeNull();
  });

  it("reloads with ?unchecked=1 and shows the warning banner", async () => {
    server((url) => url.searchParams.get("unchecked") === "1"
      ? json({ ...replayV2(), verification: "unverified" })
      : json(unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    fireEvent.click(await screen.findByRole("button", { name: "Open unchecked replay" }));
    await screen.findByRole("group", { name: "Replay controls" });
    const last = calls[calls.length - 1]!.url;
    expect(last.pathname).toBe("/api/admin/duels/game-1/replay");
    expect(last.searchParams.get("unchecked")).toBe("1");
    // The address keeps it, so a browser reload comes back to the same replay.
    expect(window.location.search).toContain("unchecked=1");
    expect(screen.getByText(BANNER)).toBeTruthy();
  });

  it("asks for the unchecked replay at once when the address has ?unchecked=1 (owner page)", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server(() => json({ ...replayV2(), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(calls[0]!.url.searchParams.get("unchecked")).toBe("1");
  });

  it("ignores ?unchecked=1 on a page that is not the owner page", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server(() => json(replayV2()));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(calls[0]!.url.searchParams.has("unchecked")).toBe(false);
  });
});

describe("verification banner", () => {
  it("shows for unverified only", async () => {
    server(() => json({ ...replayV2(), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(document.querySelector("[data-replay-unchecked]")?.textContent).toBe(BANNER);
    expect(BANNER).toBe(UNCHECKED_BANNER_COPY);
  });

  it.each(["exact", "verified", undefined] as const)("shows no warning for %s", async (verification) => {
    server(() => json({ ...replayV2(), ...(verification ? { verification } : {}) }));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
    expect(screen.queryByText(/Unchecked replay/)).toBeNull();
    expect(Boolean(document.querySelector("[data-replay-verified]"))).toBe(verification === "verified");
  });

  it("shows in the Tag layout and the free-for-all strip too", async () => {
    server(() => json({ ...replayV2({ format: "tag" }), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByTestId("tag-shell");
    expect(screen.getByTestId("tag-shell").querySelector("[data-replay-unchecked]")).toBeTruthy();
    cleanup();
    render(<ReplayVerificationNote verification="unverified" strip />);
    expect(screen.getByRole("status").textContent).toBe(BANNER);
    cleanup();
    const props = {
      slug: "g", seatCount: 3, playerName: (seat: number) => `P${seat}`, caption: "c", newLines: [], result: null, visibility: "mine" as const,
      hiddenNote: false, canSwitchCards: false, onVisibility: vi.fn(), onCamera: vi.fn(), notice: null,
      controller: { index: 0, last: 1, playing: false, speed: 1, camera: 0, seek: vi.fn(), stepBack: vi.fn(), stepForward: vi.fn(), togglePlay: vi.fn(), setSpeed: vi.fn() },
    };
    render(<ReplayTableTransport {...props} controller={props.controller as never} verification="unverified" />);
    expect(document.querySelector("[data-replay-unchecked]")).toBeTruthy();
    cleanup();
    render(<ReplayTableTransport {...props} controller={props.controller as never} verification="exact" />);
    expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
  });
});

describe("Jump in from an unchecked replay", () => {
  const caps = { canFork: true, privateSeats: [0, 1] };

  async function jump(verification: "unverified" | "verified") {
    server((url, init) => url.pathname.endsWith("/replay/fork") && init?.method === "POST"
      ? json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: {} })
      : json({ ...replayV2(), capabilities: caps, verification }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    const button = screen.getByRole("button", { name: /Jump in/ });
    fireEvent.click(button);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
    return JSON.parse(String(calls.find((call) => call.init?.method === "POST")!.init!.body)) as Record<string, unknown>;
  }

  it("sends unchecked: true and marks the button", async () => {
    const body = await jump("unverified");
    expect(body.unchecked).toBe(true);
    expect(body.cursor).toBe("c1");
    expect(document.querySelector("[data-fork-unchecked-mark]")).toBeTruthy();
  });

  it("sends no unchecked flag from a verified replay and has no mark", async () => {
    const body = await jump("verified");
    expect("unchecked" in body).toBe(false);
    expect(document.querySelector("[data-fork-unchecked-mark]")).toBeNull();
  });
});

describe("no saved final board", () => {
  it.each([
    ["NOT_PLAYABLE", 409],
    ["REPLAY_TOO_LARGE", 413],
    ["REPLAY_UNVERIFIED", 409],
    [undefined, 404],
  ])("says so, keeps Match history and shows no Final board link (%s)", async (code, status) => {
    server(() => json({ error: "nope", ...(code ? { code } : {}), finalBoard: "none" }, status));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("alert");
    expect(screen.getByText("No saved final board for this duel.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Final board" })).toBeNull();
    expect(screen.getByRole("link", { name: "Match history" }).getAttribute("href")).toMatch(/^\/duels/);
  });

  it("does not say it when a final board exists", async () => {
    server(() => json({ error: "nope", code: "NOT_PLAYABLE", finalBoard: "available" }, 409));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByRole("alert");
    expect(screen.queryByText("No saved final board for this duel.")).toBeNull();
  });

  it("keeps the saved history filters in the Match history link on a failure page", async () => {
    window.sessionStorage.clear();
    rememberHistorySearch("view=history&scope=all", 7);
    server(() => json({ error: "nope", code: "REPLAY_UNVERIFIED", finalBoard: "none" }, 409));
    render(<DuelReplayView slug="game-1" viewerId={7} />);
    await screen.findByRole("alert");
    const href = await waitFor(() => {
      const value = screen.getByRole("link", { name: "Match history" }).getAttribute("href")!;
      expect(value).not.toBe("/duels?view=history");
      return value;
    });
    expect(href).toBe(savedHistoryHref(7));
    expect(href).toContain("scope=all");
  });
});
