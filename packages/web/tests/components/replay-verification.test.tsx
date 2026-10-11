// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
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
import { replayFailure, useReplayData, UNCHECKED_BANNER_COPY } from "@/components/duel/replay-controller";
import { DuelRequestError } from "@/components/duel/api";
import { rememberHistorySearch, savedHistoryHref } from "@/components/duel/history-filters";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MISMATCH = "This replay no longer matches the saved duel, because card data changed after it was played.";
const NO_BOARD = "This duel has no saved final board, so its replay cannot be checked.";
const ALSO_FAILED = "The unchecked replay also failed: the saved moves no longer fit the current card data.";
const PARTIAL = "This replay cannot be checked, because part of the saved final board is missing.";
const BANNER = "Unchecked replay — this replay was not checked against the saved final board. Moves can be wrong if card data changed.";

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
  it.each([["board_mismatch", MISMATCH], ["command_mismatch", MISMATCH]])(
    "says the right thing for %s", (reason, text) => {
      const failure = replayFailure(new DuelRequestError("server text", 409, "REPLAY_UNVERIFIED", "available", { reason: reason as "board_mismatch" }));
      expect(failure.message).toBe(text);
    });

  it.each([["none", NO_BOARD], ["available", PARTIAL]] as const)("picks the no_saved_board copy by finalBoard (%s)", (finalBoard, text) => {
    const failure = replayFailure(new DuelRequestError("x", 409, "REPLAY_UNVERIFIED", finalBoard, { reason: "no_saved_board" }));
    expect(failure.message).toBe(text);
    expect(failure.noFinalBoard).toBe(false);
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

  it("says the final board is missing, once, when finalBoard is none", async () => {
    server(() => json(unverifiedBody({ reason: "no_saved_board", finalBoard: "none" }), 409));
    render(<DuelReplayView slug="game-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(NO_BOARD);
    expect(screen.queryByText("No saved final board for this duel.")).toBeNull();
    expect(screen.queryByRole("link", { name: "Final board" })).toBeNull();
    expect(screen.getByRole("link", { name: "Match history" })).toBeTruthy();
  });

  it("says part of the board is missing, with the Final board link, when finalBoard is available", async () => {
    server(() => json(unverifiedBody({ reason: "no_saved_board", finalBoard: "available" }), 409));
    render(<DuelReplayView slug="game-1" />);
    expect((await screen.findByRole("alert")).textContent).toBe(PARTIAL);
    expect(screen.getByRole("link", { name: "Final board" }).getAttribute("href")).toBe("/duels/game-1");
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

  it("shows no button for a command mismatch, even when the server says the owner may open it", async () => {
    server(() => json(unverifiedBody({ canOpenUnchecked: true, reason: "command_mismatch" }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    expect((await screen.findByRole("alert")).textContent).toBe(MISMATCH);
    expect(screen.queryByRole("button", { name: "Open unchecked replay" })).toBeNull();
  });

  it("shows no button again when the unchecked request itself failed", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server(() => json(unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Open unchecked replay" })).toBeNull();
  });

  it("moves focus to the replay controls once the unchecked replay is there", async () => {
    server((url) => url.searchParams.get("unchecked") === "1"
      ? json({ ...replayV2(), verification: "unverified" })
      : json(unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    fireEvent.click(await screen.findByRole("button", { name: "Open unchecked replay" }));
    const group = await screen.findByRole("group", { name: "Replay controls" });
    await waitFor(() => expect(document.activeElement).toBe(group));
  });

  it("moves focus to the failure when the unchecked request is refused", async () => {
    server((url) => json(url.searchParams.get("unchecked") === "1"
      ? unverifiedBody({ reason: "command_mismatch", canOpenUnchecked: false })
      : unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    fireEvent.click(await screen.findByRole("button", { name: "Open unchecked replay" }));
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector("[data-replay-failure]")));
  });

  it("moves focus to the empty page when the unchecked answer has no moves", async () => {
    server((url) => url.searchParams.get("unchecked") === "1"
      ? json({ ...replayV2({ frames: [] }), verification: "unverified" })
      : json(unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    fireEvent.click(await screen.findByRole("button", { name: "Open unchecked replay" }));
    const empty = await waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-replay-empty]");
      expect(el).toBeTruthy();
      return el!;
    });
    await waitFor(() => expect(document.activeElement).toBe(empty));
  });

  it("says that the unchecked replay also failed, when the unchecked request is refused", async () => {
    server((url) => json(url.searchParams.get("unchecked") === "1"
      ? unverifiedBody({ reason: "command_mismatch", canOpenUnchecked: false })
      : unverifiedBody({ canOpenUnchecked: true }), 409));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    expect((await screen.findByRole("alert")).textContent).toBe(MISMATCH);
    fireEvent.click(screen.getByRole("button", { name: "Open unchecked replay" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe(ALSO_FAILED));
    expect(screen.queryByRole("button", { name: "Open unchecked replay" })).toBeNull();
  });

  it("keeps unchecked when the card view changes", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server(() => json({ ...replayV2(), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    fireEvent.click(screen.getByRole("button", { name: "Public" }));
    await waitFor(() => expect(calls.some((call) => call.url.searchParams.get("visibility") === "public")).toBe(true));
    for (const call of calls) expect(call.url.searchParams.get("unchecked")).toBe("1");
  });

  it("keeps unchecked when the owner changes seat or reveal", async () => {
    server(() => json({ ...replayV2(), verification: "unverified" }));
    const { rerender } = renderHook((props: { seat: number | null; reveal: boolean }) =>
      useReplayData("game-1", "mine", { enabled: true, ...props }, true), { initialProps: { seat: null as number | null, reveal: false } });
    await waitFor(() => expect(calls).toHaveLength(1));
    rerender({ seat: 1, reveal: true });
    await waitFor(() => expect(calls).toHaveLength(2));
    const last = calls[1]!.url;
    expect(last.pathname).toBe("/api/admin/duels/game-1/replay");
    expect(last.searchParams.get("seat")).toBe("1");
    expect(last.searchParams.get("reveal")).toBe("1");
    for (const call of calls) expect(call.url.searchParams.get("unchecked")).toBe("1");
  });

  it("does not send unchecked in the ordinary fallback after ACCESS_DENIED", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server((url) => url.pathname.startsWith("/api/admin/")
      ? json({ error: "Not allowed", code: "ACCESS_DENIED" }, 403)
      : json(replayV2()));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(calls.map((call) => call.url.pathname)).toEqual(["/api/admin/duels/game-1/replay", "/api/duels/game-1/replay"]);
    expect(calls[0]!.url.searchParams.get("unchecked")).toBe("1");
    expect(calls[1]!.url.searchParams.has("unchecked")).toBe(false);
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
    expect(document.querySelector("[data-replay-unchecked]")?.textContent).toContain(BANNER);
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

  it("shows in the Tag layout", async () => {
    server(() => json({ ...replayV2({ format: "tag" }), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" />);
    await screen.findByTestId("tag-shell");
    expect(screen.getByTestId("tag-shell").querySelector("[data-replay-unchecked]")).toBeTruthy();
  });

  it("is a static note with a name, not a live region, and does not repeat its text as a title", () => {
    render(<ReplayVerificationNote verification="unverified" />);
    expect(screen.queryByRole("status")).toBeNull();
    const note = screen.getByRole("note", { name: "Unchecked replay" });
    expect(note.getAttribute("title")).toBeNull();
    expect(note.querySelector("[title]")).toBeNull();
  });

  it("keeps the full text as the title of the cut text in the strip form", () => {
    render(<ReplayVerificationNote verification="unverified" strip />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("note", { name: "Unchecked replay" }).textContent).toContain(BANNER);
    expect(screen.getByTitle(BANNER)).toBeTruthy();
  });

  describe("free-for-all transport", () => {
    const props = {
      slug: "g", seatCount: 3, playerName: (seat: number) => `P${seat}`, caption: "c", newLines: [], result: null, visibility: "mine" as const,
      hiddenNote: false, canSwitchCards: false, onVisibility: vi.fn(), onCamera: vi.fn(), notice: null,
      controller: { index: 0, last: 1, playing: false, speed: 1, camera: 0, seek: vi.fn(), stepBack: vi.fn(), stepForward: vi.fn(), togglePlay: vi.fn(), setSpeed: vi.fn() },
    };

    it("shows the banner when unverified", () => {
      render(<ReplayTableTransport {...props} controller={props.controller as never} verification="unverified" />);
      expect(document.querySelector("[data-replay-unchecked]")).toBeTruthy();
    });

    it("shows none when exact", () => {
      render(<ReplayTableTransport {...props} controller={props.controller as never} verification="exact" />);
      expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
    });
  });
});

describe("Back to checked view", () => {
  it("is a link to the same address without ?unchecked=1 (other parameters stay)", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?frame=step-2&unchecked=1");
    server(() => json({ ...replayV2(), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    const link = await screen.findByRole("link", { name: "Back to checked view" });
    expect(link.getAttribute("href")).toBe("/duels/game-1/replay?frame=step-2");
  });
});

describe("an unchecked request answered exact", () => {
  it("shows no banner and no back link, and Jump in sends no unchecked flag", async () => {
    window.history.replaceState(null, "", "/duels/game-1/replay?unchecked=1");
    server((url, init) => url.pathname.endsWith("/replay/fork") && init?.method === "POST"
      ? json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: {} })
      : json({ ...replayV2(), capabilities: { canFork: true, privateSeats: [0, 1] }, verification: "exact" }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByRole("group", { name: "Replay controls" });
    expect(calls[0]!.url.searchParams.get("unchecked")).toBe("1");
    expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
    expect(screen.queryByRole("link", { name: "Back to checked view" })).toBeNull();
    expect(document.querySelector("[data-replay-verified]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
    const body = JSON.parse(String(calls.find((call) => call.init?.method === "POST")!.init!.body)) as Record<string, unknown>;
    expect("unchecked" in body).toBe(false);
    expect(document.querySelector("[data-fork-unchecked-mark]")).toBeNull();
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

describe("saved final board fallback", () => {
  /** What the web route sends when it cannot run the moves: one result frame, no cursor, "unverified" and a replayError. */
  function savedBoard(version: 1 | 2, over: Record<string, unknown> = {}) {
    const full = replayV2();
    const result = full.frames[full.frames.length - 1]!;
    const replayError = { code: "ENGINE_UNAVAILABLE_FOR_SOURCE", error: "No replay. Showing the saved final board." };
    return version === 2
      ? { ...full, verification: "unverified", sourceVersion: "saved-board-1", frames: [{ ...result, frameId: "saved-final-board", cursor: null }], replayError, ...over }
      : { verification: "unverified", session: full.session, role: full.role, mySeat: full.mySeat,
          frames: [{ step: 0, actorSeat: null, view: result.view }], replayError, ...over };
  }

  it.each([1, 2] as const)("shows no unchecked banner for the v%s saved board, only the not-a-replay note", async (version) => {
    server(() => json(savedBoard(version)));
    render(<DuelReplayView slug="game-1" />);
    await waitFor(() => expect(document.querySelector("[data-replay-saved-board]")).toBeTruthy());
    expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(screen.getByText("Saved final board — this is not a move replay.")).toBeTruthy();
  });

  it("offers no Jump in warning mark for the saved board", async () => {
    server(() => json(savedBoard(2, { capabilities: { canFork: false, privateSeats: [] } })));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await waitFor(() => expect(document.querySelector("[data-replay-saved-board]")).toBeTruthy());
    expect(document.querySelector("[data-fork-unchecked-mark]")).toBeNull();
  });

  it("still shows the banner for a real unchecked replay (no replayError)", async () => {
    server(() => json({ ...replayV2(), verification: "unverified" }));
    render(<DuelReplayView slug="game-1" canInspectSource />);
    await screen.findByText(BANNER);
    expect(document.querySelector("[data-replay-saved-board]")).toBeNull();
  });

  it("shows the note, not the banner, in the strip form", () => {
    render(<ReplayVerificationNote verification="saved-board" strip />);
    expect(document.querySelector("[data-replay-saved-board]")).toBeTruthy();
    expect(document.querySelector("[data-replay-unchecked]")).toBeNull();
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
