// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom, ReplayForkControl } from "@yugidraft/shared/duels";
import { resetCoinTossState } from "@/components/duel/coin-toss-lock";
import { frame, replayV2, session } from "./replay-fixtures";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const swr = vi.hoisted(() => ({ data: null as unknown, error: undefined as unknown, keys: [] as unknown[], mutate: vi.fn() }));
vi.mock("swr", () => ({
  default: (key: unknown) => { swr.keys.push(key); return { data: swr.data, error: swr.error, isLoading: false, mutate: swr.mutate }; },
  useSWRConfig: () => ({ mutate: swr.mutate }),
}));
const ws = vi.hoisted(() => ({ seats: [] as unknown[] }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: (_slug: string, seat: unknown) => {
    ws.seats.push(seat);
    return { syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() };
  },
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/field", () => ({
  DuelField: (props: { mySeat: number | null; bottomSeat?: number | null; onInspect?: (target: { type: "pile"; title: string; cards: [] }) => void }) => (
    <div data-testid="field" data-my-seat={props.mySeat ?? ""} data-bottom-seat={props.bottomSeat ?? ""}>
      <button type="button" onClick={() => props.onInspect?.({ type: "pile", title: "Private hand", cards: [] })}>Inspect fixture hand</button>
    </div>
  ),
  DeckMasterRail: () => null,
}));
// The live shells of Tag and the FFA tables: the room test reads what the room hands them.
const shells = vi.hoisted(() => ({ props: [] as Array<{ kind: "table" | "tag"; props: Record<string, any> }> }));
vi.mock("@/components/duel/table/table-shell", () => ({
  TableShell: (props: Record<string, any>) => { shells.props.push({ kind: "table", props }); return <div data-testid="table-shell">{props.headerTools}</div>; },
}));
vi.mock("@/components/duel/tag/tag-shell", () => ({
  TagShell: (props: Record<string, any>) => { shells.props.push({ kind: "tag", props }); return <div data-testid="tag-shell">{props.headerTools}</div>; },
}));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));

import {
  askAllState, followSeat, forkRoomState, forkViewSettled, livingSeats,
} from "@/components/duel/replay-fork-control";
import { ReplayForkBar, sourceReplayHref } from "@/components/duel/replay-fork-bar";
import { canOfferFork, forkDisabledReason } from "@/components/duel/replay-fork-button";
import {
  DuelRequestError, duelRoomKey, getDuelRoom, getOwnerReplayFrames, searchDuelCards, sendDuelAction, setChainResponseMode,
} from "@/components/duel/api";
import { DuelReplayView } from "@/components/duel/replay";
import { DuelRoomView } from "@/components/duel/room";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const control = (over: Partial<ReplayForkControl> = {}): ReplayForkControl => ({
  identitySeat: 0, actingSeat: 0, manualSeats: [0, 1], revealHands: true, chainModes: { 0: "auto", 1: "auto" },
  origin: { sourceSlug: "game-1", sourceFrameId: "f2", sourceStep: 2, sourceSeats: [{ seat: 0, displayName: "Ada" }, { seat: 1, displayName: "Bo" }] },
  ...over,
});

function forkRoom(over: Partial<DuelRoom> = {}, fork: ReplayForkControl | null = control()): DuelRoom {
  const view = frame({ step: 2 }).view;
  return {
    session: session("1v1", { slug: "fork-1", kind: "replay-fork", status: "active", endedAt: null }),
    role: "player", mySeat: 0, myDeck: null,
    engine: { ...view, prioritySeat: 1 },
    clock: null, metadataOnly: false,
    ...(fork ? { fork } : {}),
    ...over,
  };
}

beforeEach(() => {
  resetCoinTossState();
  nav.push.mockReset();
  nav.replace.mockReset();
  swr.keys = [];
  swr.error = undefined;
  swr.mutate.mockClear();
  shells.props = [];
  ws.seats = [];
  window.localStorage.clear();
  window.history.replaceState(null, "", "/duels/game-1/replay");
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetCoinTossState(); });

describe("fork view helpers", () => {
  it("tells a fork, an ordinary room and an unusable fork row apart", () => {
    expect(forkRoomState(null)).toEqual({ kind: "ordinary" });
    expect(forkRoomState(forkRoom())).toEqual({ kind: "fork", control: control() });
    // A control on an ordinary duel is no fork. A fork row without its control fails closed.
    expect(forkRoomState({ session: session("1v1"), fork: control() }).kind).toBe("ordinary");
    expect(forkRoomState(forkRoom({}, null)).kind).toBe("unusable");
  });

  it("settles only when the room shows what the view asked for", () => {
    expect(forkViewSettled(control(), null)).toBe(true);
    expect(forkViewSettled(control({ revealHands: false }), null)).toBe(false);
    expect(forkViewSettled(control({ revealHands: false }), { as: null, reveal: false })).toBe(true);
    expect(forkViewSettled(control({ actingSeat: 0 }), { as: 1, reveal: true })).toBe(false);
    expect(forkViewSettled(control({ actingSeat: 1 }), { as: 1, reveal: true })).toBe(true);
  });

  it("finds living seats, the ask-all state and the seat to follow", () => {
    const engine = { seats: [{ seat: 0 }, { seat: 1, eliminated: true }, { seat: 2 }] } as never;
    expect(livingSeats(engine, [0, 1, 2])).toEqual([0, 2]);
    expect(livingSeats(null, [0, 1])).toEqual([0, 1]);
    expect(askAllState({ 0: "always", 1: "always" }, [0, 1])).toBe("all");
    expect(askAllState({ 0: "always", 1: "off" }, [0, 1])).toBe("mixed");
    expect(askAllState({ 0: "always" }, [0, 1])).toBe("unknown");
    expect(askAllState(undefined, [0])).toBe("unknown");
    // An eliminated seat does not count against "all".
    expect(askAllState({ 0: "always", 1: "off" }, [0])).toBe("all");
    expect(followSeat({ prioritySeat: 1, result: null }, 0)).toBe(1);
    expect(followSeat({ prioritySeat: 0, result: null }, 0)).toBeNull();
    expect(followSeat({ prioritySeat: null, result: null }, 0)).toBeNull();
    expect(followSeat({ prioritySeat: 1, result: { winnerSeat: 0, reason: "x" } }, 0)).toBeNull();
  });

  it("builds the room key, and links back to the source replay at the start frame", () => {
    expect(duelRoomKey("fork-1")).toBe("/api/duels/fork-1");
    expect(duelRoomKey("fork-1", false, null)).toBe("/api/duels/fork-1");
    expect(duelRoomKey("fork-1", false, { as: 2, reveal: true })).toBe("/api/duels/fork-1?as=2");
    expect(duelRoomKey("fork-1", false, { as: null, reveal: false })).toBe("/api/duels/fork-1?reveal=0");
    expect(duelRoomKey("fork-1", false, { as: 1, reveal: false })).toBe("/api/duels/fork-1?as=1&reveal=0");
    expect(sourceReplayHref(control().origin)).toBe("/duels/game-1/replay?frame=f2");
  });

  it("offers a fork only when the server said so, and never for a frame without a cursor", () => {
    const model = { version: 2, sourceVersion: "src-1", capabilities: { canFork: true, privateSeats: [0] } } as never;
    expect(canOfferFork(model)).toBe(true);
    expect(canOfferFork({ version: 2, sourceVersion: "src-1" } as never)).toBe(false);
    expect(canOfferFork({ version: 2, sourceVersion: "", capabilities: { canFork: true, privateSeats: [] } } as never)).toBe(false);
    expect(canOfferFork({ version: 1, sourceVersion: "src-1", capabilities: { canFork: true, privateSeats: [] } } as never)).toBe(false);
    expect(forkDisabledReason({ cursor: "c1", kind: "engine" })).toBeNull();
    expect(forkDisabledReason({ cursor: null, kind: "opening" })).toMatch(/not a start point/);
    expect(forkDisabledReason({ cursor: null, kind: "result" })).toMatch(/final result/);
  });
});

describe("fork requests", () => {
  let calls: Array<{ url: string; init?: RequestInit }>;
  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return json(forkRoom()); }));
  });

  it("sends the acting seat and reveal choice only for a fork view", async () => {
    await getDuelRoom("fork-1", false, { as: 1, reveal: false });
    await getDuelRoom("fork-1");
    expect(calls.map((call) => call.url)).toEqual(["/api/duels/fork-1?as=1&reveal=0", "/api/duels/fork-1"]);
  });

  it("sends actions and chain-mode changes for the acting seat with the revision they were made on", async () => {
    await sendDuelAction("fork-1", { promptId: "p1", revision: 4, answer: { choice: "a" } }, 1);
    await sendDuelAction("fork-1", { promptId: "p1", revision: 4, answer: { choice: "a" } });
    await setChainResponseMode("fork-1", "always", { as: 1, revision: 4, promptId: "p1" });
    await setChainResponseMode("fork-1", "always", { as: 1, revision: 4 });
    await setChainResponseMode("game-9", "off");
    expect(calls.map((call) => call.url)).toEqual([
      "/api/duels/fork-1/actions?as=1", "/api/duels/fork-1/actions",
      "/api/duels/fork-1/chain-mode?as=1", "/api/duels/fork-1/chain-mode?as=1", "/api/duels/game-9/chain-mode",
    ]);
    expect(JSON.parse(String(calls[2]!.init!.body))).toEqual({ mode: "always", revision: 4, promptId: "p1" });
    expect(JSON.parse(String(calls[3]!.init!.body))).toEqual({ mode: "always", revision: 4 });
    expect(JSON.parse(String(calls[4]!.init!.body))).toEqual({ mode: "off" });
  });

  it("binds the announce-card search to the fork seat, prompt and revision", async () => {
    await searchDuelCards("dark", "fork-1", { as: 1, promptId: "p9", revision: 7 });
    await searchDuelCards("dark", "game-9", null);
    expect(calls[0]!.url).toBe("/api/duels/cards?q=dark&slug=fork-1&as=1&promptId=p9&revision=7");
    expect(calls[1]!.url).toBe("/api/duels/cards?q=dark&slug=game-9");
  });

  it("asks the owner route for one data seat and the reveal choice", async () => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push({ url }); return json(replayV2()); }));
    await getOwnerReplayFrames("game-1", { visibility: "mine", seat: 1, reveal: true });
    await getOwnerReplayFrames("game-1", { visibility: "public", seat: null, reveal: false });
    expect(calls.map((call) => call.url)).toEqual([
      "/api/admin/duels/game-1/replay?version=2&visibility=mine&seat=1&reveal=1",
      "/api/admin/duels/game-1/replay?version=2&visibility=public",
    ]);
  });
});

describe("ReplayForkBar", () => {
  const props = () => ({
    fork: control(), seatName: (seat: number) => ["Ada", "Bo", "Cy"][seat]!, living: [0, 1], waitingSeat: 1 as number | null,
    follow: true, reveal: true, disabled: false,
    onPickSeat: vi.fn(), onFollow: vi.fn(), onReveal: vi.fn(), onAskAll: vi.fn(), onRestart: vi.fn(), onEnd: vi.fn(),
  });

  it("shows a seat button for each seat, marks the one that waits and picks a seat", () => {
    const p = props();
    render(<ReplayForkBar {...p} />);
    const group = screen.getByRole("group", { name: "Acting seat" });
    const [ada, bo] = within(group).getAllByRole("button");
    expect(ada!.getAttribute("aria-pressed")).toBe("true");
    expect(bo!.getAttribute("aria-pressed")).toBe("false");
    expect(bo!.getAttribute("data-prompt")).toBe("true");
    fireEvent.click(bo!);
    expect(p.onPickSeat).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("blocks seat changes while busy and for a seat that is out", () => {
    const p = { ...props(), living: [0] };
    const { rerender } = render(<ReplayForkBar {...p} />);
    expect((within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ReplayForkBar {...p} living={[0, 1]} disabled />);
    for (const button of within(screen.getByRole("group", { name: "Acting seat" })).getAllByRole("button")) expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps Follow prompt, Reveal hands and ask-all in the controls sheet", () => {
    const p = props();
    render(<ReplayForkBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText("Follow prompt") as HTMLInputElement).checked).toBe(true);
    expect((within(dialog).getByLabelText("Reveal hands") as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("Follow prompt"));
    expect(p.onFollow).toHaveBeenCalledWith(false);
    fireEvent.click(within(dialog).getByLabelText("Reveal hands"));
    expect(p.onReveal).toHaveBeenCalledWith(false);
    expect(within(dialog).getByRole("status").textContent).toMatch(/Some seats skip|not known|Every seat/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask at all response windows" }));
    expect(p.onAskAll).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("link", { name: "Open the source replay" }).getAttribute("href")).toBe("/duels/game-1/replay?frame=f2");
  });

  it("says when every seat already asks at every window", () => {
    render(<ReplayForkBar {...props()} fork={control({ chainModes: { 0: "always", 1: "always" } })} />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    expect(within(screen.getByRole("dialog")).getByRole("status").textContent).toBe("Every seat asks at every response window.");
  });

  it("asks twice before restart or end, and Keep playing backs out", () => {
    const p = props();
    render(<ReplayForkBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Restart from start point" }));
    expect(p.onRestart).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Keep playing" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "End fork" }));
    expect(p.onEnd).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "End fork" }));
    expect(p.onEnd).toHaveBeenCalledTimes(1);
    expect(p.onRestart).not.toHaveBeenCalled();
  });

  it("restarts after the second click", () => {
    const p = props();
    render(<ReplayForkBar {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Restart from start point" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirm" })).getByRole("button", { name: "Restart" }));
    expect(p.onRestart).toHaveBeenCalledTimes(1);
  });
});

describe("Jump in on the replay viewer", () => {
  const caps = { canFork: true, privateSeats: [0, 1] };
  let calls: Array<{ url: URL; init?: RequestInit }>;

  function server(answer: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input, "http://localhost");
      calls.push({ url, init });
      return answer(url, init);
    }));
  }
  const ownerReplay = () => ({ ...replayV2({ visibility: "mine" }), capabilities: caps });

  async function open(canInspectSource: boolean) {
    render(<DuelReplayView slug="game-1" canInspectSource={canInspectSource} />);
    await screen.findByRole("group", { name: "Replay controls" });
  }

  it("never calls the owner route or shows the button for a user who is not the owner", async () => {
    server((url) => json(replayV2({ visibility: url.searchParams.get("visibility") === "public" ? "public" : "mine" })));
    await open(false);
    expect(calls.every((call) => !call.url.pathname.startsWith("/api/admin"))).toBe(true);
    expect(screen.queryByRole("button", { name: /Jump in/ })).toBeNull();
  });

  it("shows no button when the owner answer carries no fork capability", async () => {
    server(() => json(replayV2({ visibility: "mine" })));
    await open(true);
    expect(calls[0]!.url.pathname).toBe("/api/admin/duels/game-1/replay");
    expect(screen.queryByRole("button", { name: /Jump in/ })).toBeNull();
  });

  it("falls back to the ordinary route when the owner route refuses", async () => {
    server((url) => url.pathname.startsWith("/api/admin")
      ? json({ error: "No", code: "ACCESS_DENIED" }, 403)
      : json(replayV2({ visibility: "mine" })));
    await open(true);
    expect(calls.some((call) => call.url.pathname === "/api/duels/game-1/replay")).toBe(true);
    expect(screen.queryByRole("button", { name: /Jump in/ })).toBeNull();
  });

  it("removes owner controls and the private inspector when Jump in loses access", async () => {
    let revoked = false;
    server((url) => url.pathname.startsWith("/api/admin")
      ? revoked ? json({ error: "No access", code: "ACCESS_DENIED" }, 404) : json(ownerReplay())
      : json(replayV2({ visibility: "mine" })));
    await open(true);
    fireEvent.click(screen.getByRole("button", { name: "Inspect fixture hand" }));
    expect(screen.getByText("Private hand")).toBeTruthy();
    revoked = true;
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    await waitFor(() => expect(document.querySelector("[data-replay-owner-tools]")).toBeNull());
    await screen.findByRole("group", { name: "Replay controls" });
    expect(screen.queryByText("Private hand")).toBeNull();
    expect(document.querySelector("[data-replay-owner-tools]")).toBeNull();
  });

  it("disables Jump in on a frame without a cursor and starts a fork from one with a cursor", async () => {
    server((url, init) => url.pathname.endsWith("/replay/fork") && init?.method === "POST"
      ? json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: forkRoom() })
      : json(ownerReplay()));
    await open(true);
    const jump = screen.getByRole("button", { name: /Jump in/ }) as HTMLButtonElement;
    // Move 0 is the opening board: no cursor, no fork.
    expect(jump.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    expect(jump.disabled).toBe(false);
    fireEvent.click(jump);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
    const post = calls.find((call) => call.init?.method === "POST")!;
    expect(post.url.pathname).toBe("/api/admin/duels/game-1/replay/fork");
    const body = JSON.parse(String(post.init!.body)) as { cursor: string; sourceVersion: string; requestId: string };
    expect(body.cursor).toBe("c1");
    expect(body.sourceVersion).toBe("src-1");
    expect(body.requestId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    expect(body.requestId.length).toBeLessThanOrEqual(128);
  });

  it("makes one fork per click: Jump in stays shut after success while the page navigates", async () => {
    server((url, init) => url.pathname.endsWith("/replay/fork") && init?.method === "POST"
      ? json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: forkRoom() })
      : json(ownerReplay()));
    await open(true);
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    const jump = screen.getByRole("button", { name: /Jump in/ }) as HTMLButtonElement;
    fireEvent.click(jump);
    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    // The router has not left the page yet: the button is shut and a second click or a double-click does nothing.
    const shut = screen.getByRole("button", { name: /Starting/ }) as HTMLButtonElement;
    expect(shut.disabled).toBe(true);
    fireEvent.click(shut);
    fireEvent.click(shut);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(1);
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it("disables Jump in on the final result frame", async () => {
    server(() => json(ownerReplay()));
    await open(true);
    fireEvent.click(screen.getByRole("button", { name: "Last move" }));
    expect((screen.getByRole("button", { name: /Jump in/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps one request id for a retry of the same frame, and a new one for another frame", async () => {
    let attempt = 0;
    server((url, init) => {
      if (url.pathname.endsWith("/replay/fork") && init?.method === "POST") {
        attempt += 1;
        return attempt === 1 ? json({ error: "Busy", code: "ENGINE_BUSY" }, 503) : json({ slug: "fork-9", sourceFrameId: "f1", initialSeat: 0, room: forkRoom() });
      }
      return json(ownerReplay());
    });
    await open(true);
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    await screen.findByRole("alert");
    expect(nav.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/duels/fork-9"));
    const ids = calls.filter((call) => call.init?.method === "POST").map((call) => (JSON.parse(String(call.init!.body)) as { requestId: string }).requestId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("offers a reload when the source changed", async () => {
    server((url, init) => url.pathname.endsWith("/replay/fork") && init?.method === "POST"
      ? json({ error: "Changed", code: "SOURCE_CHANGED" }, 409)
      : json(ownerReplay()));
    await open(true);
    fireEvent.click(screen.getByRole("button", { name: "Next move" }));
    fireEvent.click(screen.getByRole("button", { name: /Jump in/ }));
    const alert = await screen.findByRole("alert");
    const before = calls.filter((call) => call.url.pathname === "/api/admin/duels/game-1/replay").length;
    fireEvent.click(within(alert).getByRole("button", { name: "Reload replay" }));
    await waitFor(() => expect(calls.filter((call) => call.url.pathname === "/api/admin/duels/game-1/replay").length).toBeGreaterThan(before));
  });
});

describe("the live room of a fork", () => {
  it.each([
    ["ACCESS_DENIED", 404], ["ACCESS_UNAVAILABLE", 503], [undefined, 401], [undefined, 403],
  ] as const)("clears a cached private fork on %s (HTTP %s)", (code, status) => {
    swr.data = forkRoom();
    const view = render(<DuelRoomView slug="fork-1" />);
    expect(screen.getByTestId("field")).toBeTruthy();
    swr.error = new DuelRequestError("Cannot access fork", status, code);
    view.rerender(<DuelRoomView slug="fork-1" />);
    expect(screen.queryByTestId("field")).toBeNull();
    expect(document.querySelector("[data-replay-fork-bar]")).toBeNull();
    expect(swr.mutate).toHaveBeenCalledWith(undefined, { revalidate: false });
  });

  it("keeps the websocket identity and the camera at seat 0 while seat 1 acts", () => {
    swr.data = forkRoom({}, control({ actingSeat: 1 }));
    render(<DuelRoomView slug="fork-1" />);
    // Seat 1 answers; the board still faces seat 0, so a seat switch never turns the table.
    expect(screen.getByTestId("field").getAttribute("data-my-seat")).toBe("1");
    expect(screen.getByTestId("field").getAttribute("data-bottom-seat")).toBe("0");
    expect(new Set(ws.seats)).toEqual(new Set([0]));
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1");
  });

  it("does not turn the 1v1 board when the creator picks another seat", () => {
    swr.data = forkRoom();
    const view = render(<DuelRoomView slug="fork-1" />);
    expect(screen.getByTestId("field").getAttribute("data-bottom-seat")).toBe("0");
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    swr.data = forkRoom({}, control({ actingSeat: 1 }));
    view.rerender(<DuelRoomView slug="fork-1" />);
    expect(screen.getByTestId("field").getAttribute("data-bottom-seat")).toBe("0");
    expect(screen.getByTestId("field").getAttribute("data-my-seat")).toBe("1");
  });

  it.each([["ffa3", "table", 3], ["ffa4", "table", 4], ["tag", "tag", 4]] as const)(
    "gives the %s shell a fixed camera seat and a carried camera while the acting seat changes",
    (format, kind, count) => {
      const manualSeats = Array.from({ length: count }, (_, seat) => seat);
      const multi = (acting: number) => {
        const room = forkRoom({
          session: session(format, { slug: "fork-1", kind: "replay-fork", status: "active", endedAt: null }),
          engine: frame({ step: 2, format }).view,
        }, control({ actingSeat: acting, manualSeats }));
        return room;
      };
      swr.data = multi(0);
      const view = render(<DuelRoomView slug="fork-1" />);
      expect(screen.getByTestId(kind === "tag" ? "tag-shell" : "table-shell")).toBeTruthy();
      const first = shells.props.at(-1)!.props;
      expect(first.controller.viewerSeat).toBe(0);
      expect(first.controller.cameraSeat).toBe(0);
      expect(first.replayCarry).toBeTruthy();
      swr.data = multi(1);
      view.rerender(<DuelRoomView slug="fork-1" />);
      const next = shells.props.at(-1)!.props;
      // Seat 1 answers and owns its hand; the camera stays on seat 0 and the carry (camera, open panel) is the same object.
      expect(next.controller.viewerSeat).toBe(1);
      expect(next.controller.cameraSeat).toBe(0);
      expect(next.replayCarry).toBe(first.replayCarry);
      expect(next.controller.room.mySeat).toBe(1);
    },
  );

  it("shows the fork bar and leaves out Surrender, Cancel, Report bug, Pop out and invites", () => {
    swr.data = forkRoom();
    render(<DuelRoomView slug="fork-1" />);
    expect(document.querySelector("[data-replay-fork-bar]")).not.toBeNull();
    expect(screen.getByText("Replay fork")).toBeTruthy();
    for (const name of [/Surrender/, /Cancel duel/, /Report bug/i, /Pop out/, /Archive/]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByText("Watch replay")).toBeNull();
  });

  it("asks for another seat or hidden hands through the room key", () => {
    swr.data = forkRoom();
    render(<DuelRoomView slug="fork-1" />);
    const group = screen.getByRole("group", { name: "Acting seat" });
    fireEvent.click(within(group).getByRole("button", { name: /Bo/ }));
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1?as=1");
    act(() => { swr.keys = []; });
  });

  it("clears an open private pile when another acting seat is requested", () => {
    swr.data = forkRoom();
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Inspect fixture hand" }));
    expect(screen.getByText("Private hand")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    expect(screen.queryByText("Private hand")).toBeNull();
  });

  it("holds response-mode commands until the requested fork seat arrives", async () => {
    const initial = forkRoom();
    initial.engine!.chainMode = "auto";
    swr.data = initial;
    const fetch = vi.fn(async () => json(initial));
    vi.stubGlobal("fetch", fetch);
    const view = render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).not.toHaveBeenCalled();
    swr.data = forkRoom({ engine: { ...initial.engine!, chainMode: "auto" } }, control({ actingSeat: 1 }));
    view.rerender(<DuelRoomView slug="fork-1" />);
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).toHaveBeenCalledWith("/api/duels/fork-1/chain-mode?as=1", expect.objectContaining({
      body: JSON.stringify({ mode: "off", revision: initial.engine!.revision }),
    }));
  });

  it("holds fork seat changes while a response-mode command is in flight", async () => {
    const initial = forkRoom();
    initial.engine!.chainMode = "auto";
    swr.data = initial;
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).toHaveBeenCalledTimes(1);
    const seat = within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ });
    expect(seat).toBeDisabled();
    fireEvent.click(seat);
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1");
    await act(async () => { resolve(json(initial)); });
    expect(seat).not.toBeDisabled();
  });

  it("never puts a reply that shows every hand on a table that hides them, and does not lock the table", async () => {
    const initial = forkRoom();
    initial.engine!.chainMode = "auto";
    swr.data = initial;
    // The host projects every reply with all hands shown, whatever the view asked for.
    const reply = forkRoom({}, control({ revealHands: true }));
    reply.engine!.chainMode = "off";
    const fetch = vi.fn(async () => json(reply));
    vi.stubGlobal("fetch", fetch);
    const view = render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    fireEvent.click(screen.getByLabelText("Reveal hands"));
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1?reveal=0");
    const hidden = forkRoom({ engine: { ...initial.engine!, chainMode: "auto" } }, control({ revealHands: false }));
    swr.data = hidden;
    view.rerender(<DuelRoomView slug="fork-1" />);
    swr.mutate.mockClear();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[role='dialog'][aria-modal='true']")).toBeNull());
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).toHaveBeenCalledWith("/api/duels/fork-1/chain-mode?as=0", expect.anything());
    const written = swr.mutate.mock.calls.filter(([value]) => value != null && typeof value === "object");
    expect(written).toHaveLength(0);
    // The current view is read again instead.
    expect(swr.mutate).toHaveBeenCalledWith();
  });

  it("drops the cached views when the seat changes, and holds answers until a room newer than the change arrives", async () => {
    const initial = forkRoom();
    initial.engine!.chainMode = "auto";
    swr.data = { ...initial, receivedAt: 100 };
    const fetch = vi.fn(async () => json(initial));
    vi.stubGlobal("fetch", fetch);
    const view = render(<DuelRoomView slug="fork-1" />);
    swr.mutate.mockClear();
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    // Every cached view of the table is purged before the key changes.
    const purge = swr.mutate.mock.calls.find(([filter]) => typeof filter === "function");
    expect(purge).toBeTruthy();
    const filter = purge![0] as (key: unknown) => boolean;
    expect([filter("/api/duels/fork-1"), filter("/api/duels/fork-1?as=1&reveal=0"), filter("/api/duels/fork-2"), filter("/api/duels/fork-10")])
      .toEqual([true, true, false, false]);
    // An old cache entry of the new key names seat 1 but came from before the change: it is not accepted.
    swr.data = { ...forkRoom({ engine: { ...initial.engine!, chainMode: "auto" } }, control({ actingSeat: 1 })), receivedAt: 100 };
    view.rerender(<DuelRoomView slug="fork-1" />);
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).not.toHaveBeenCalled();
    swr.data = { ...forkRoom({ engine: { ...initial.engine!, chainMode: "auto" } }, control({ actingSeat: 1 })), receivedAt: performance.now() + 5000 };
    view.rerender(<DuelRoomView slug="fork-1" />);
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  // A three-seat fork room; `out` seats are eliminated.
  const ffa3Fork = (acting: number, out: number[]) => {
    const room = forkRoom({
      session: session("ffa3", { slug: "fork-1", kind: "replay-fork", status: "active", endedAt: null }),
      engine: frame({ step: 2, format: "ffa3" }).view,
    }, control({ actingSeat: acting, manualSeats: [0, 1, 2], chainModes: { 0: "auto", 1: "auto", 2: "auto" } }));
    const engine = room.engine as unknown as { prioritySeat: number; seats: Array<{ seat: number; eliminated?: boolean }> };
    engine.prioritySeat = acting;
    for (const seat of engine.seats) if (out.includes(seat.seat)) seat.eliminated = true;
    return room;
  };

  it("follows the prompt to the seat that must answer once, and does not loop on the same revision", () => {
    // Seat 0 is on screen, the engine waits on seat 1.
    swr.data = forkRoom();
    const view = render(<DuelRoomView slug="fork-1" />);
    const reads = () => swr.mutate.mock.calls.filter(([value, options]) => typeof value === "function" && options !== undefined).length;
    expect(reads()).toBe(1);
    view.rerender(<DuelRoomView slug="fork-1" />);
    view.rerender(<DuelRoomView slug="fork-1" />);
    expect(reads()).toBe(1);
    // A later revision that waits on the other seat again is a new request.
    const next = forkRoom();
    next.engine = { ...next.engine!, revision: next.engine!.revision + 1 };
    swr.data = next;
    view.rerender(<DuelRoomView slug="fork-1" />);
    expect(reads()).toBe(2);
  });

  it("holds a seat picked by hand and offers a switch to the seat that must answer", () => {
    swr.data = forkRoom({}, control({ actingSeat: 1 }));
    swr.data = { ...(swr.data as DuelRoom), engine: { ...(swr.data as DuelRoom).engine!, prioritySeat: 0 } };
    render(<DuelRoomView slug="fork-1" />);
    // A read of the room (not the cache purge, which has no second argument).
    const reads = () => swr.mutate.mock.calls.filter(([value, options]) => typeof value === "function" && options !== undefined).length;
    // The seat on screen answers, and no hold: no notice.
    expect(document.querySelector("[data-replay-fork-waiting]")).toBeNull();
    swr.mutate.mockClear();
    fireEvent.click(within(screen.getByRole("group", { name: "Acting seat" })).getByRole("button", { name: /Bo/ }));
    const notice = document.querySelector("[data-replay-fork-waiting]") as HTMLElement;
    expect(notice.textContent).toContain("Ada must answer");
    // The hold stops Follow prompt from moving the seat by itself.
    expect(reads()).toBe(0);
    fireEvent.click(within(notice).getByRole("button", { name: "Switch" }));
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1?as=0");
  });

  it("asks every living seat in turn, the acting seat last, each with its own binding", async () => {
    const initial = ffa3Fork(0, [2]);
    swr.data = initial;
    const fetch = vi.fn(async () => json(initial));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask at all response windows" })); });
    const urls = fetch.mock.calls.map((call) => String((call as unknown[])[0]));
    // Seat 2 is out and is left out; seat 1 asks first, the acting seat 0 last (and only it names the prompt).
    expect(urls).toEqual(["/api/duels/fork-1/chain-mode?as=1", "/api/duels/fork-1/chain-mode?as=0"]);
    const bodies = fetch.mock.calls.map((call) => JSON.parse(String(((call as unknown[])[1] as { body: string }).body)));
    expect(bodies[0]).toEqual({ mode: "always", revision: initial.engine!.revision });
    expect(bodies[1]).toMatchObject({ mode: "always", revision: initial.engine!.revision });
  });

  it("leaves an eliminated acting seat out of ask-all, and asks the seats that live", async () => {
    const initial = ffa3Fork(1, [1]);
    swr.data = initial;
    const fetch = vi.fn(async () => json(initial));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ask at all response windows" })); });
    expect(fetch.mock.calls.map((call) => String((call as unknown[])[0])))
      .toEqual(["/api/duels/fork-1/chain-mode?as=0", "/api/duels/fork-1/chain-mode?as=2"]);
  });

  it("keeps the seat of the restart as a hold when Follow prompt is off", async () => {
    swr.data = forkRoom();
    const restarted = forkRoom({}, control({ actingSeat: 1 }));
    const fetch = vi.fn(async () => json(restarted));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    fireEvent.click(screen.getByLabelText("Follow prompt"));
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1?as=0");
    fireEvent.click(screen.getByRole("button", { name: "Restart from start point" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Restart" })); });
    expect(fetch).toHaveBeenCalledWith("/api/duels/fork-1/fork/restart", expect.objectContaining({ method: "POST" }));
    // The room did not fall back to the host default seat: it holds the seat the restart opened on.
    expect(swr.keys.at(-1)).toBe("/api/duels/fork-1?as=1");
  });

  it("offers Show result again in the live shells after Show board, and after a restart the next result is not hidden", async () => {
    const done = () => {
      const room = forkRoom({
        session: session("tag", { slug: "fork-1", kind: "replay-fork", status: "completed", endedAt: "2026-10-10T10:00:00Z" }),
        engine: { ...frame({ step: 2, format: "tag" }).view, result: { winnerSeat: 0, reason: "Life points" } as never },
      }, control({ manualSeats: [0, 1, 2, 3] }));
      return room;
    };
    swr.data = done();
    render(<DuelRoomView slug="fork-1" />);
    expect(document.querySelector("[data-replay-fork-result]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show board" }));
    expect(document.querySelector("[data-replay-fork-result]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show result" }));
    expect(document.querySelector("[data-replay-fork-result]")).not.toBeNull();
  });

  it("shows no clock and no timer rows copied from the source in a fork", () => {
    swr.data = forkRoom();
    render(<DuelRoomView slug="fork-1" />);
    expect(screen.queryByText("Turn timer")).toBeNull();
    expect(screen.queryByText("Lose on timeout")).toBeNull();
  });

  it("leaves a finished fork without a cancel call, and shows no End fork", async () => {
    const done = forkRoom({ session: session("1v1", { slug: "fork-1", kind: "replay-fork", status: "completed", endedAt: "2026-10-10T10:00:00Z" }) });
    done.engine = { ...done.engine!, result: { winnerSeat: 0, reason: "Life points" } as never, prompt: null };
    swr.data = done;
    const fetch = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    expect(screen.queryByRole("button", { name: "End fork" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Exit duel" }));
    expect(nav.replace).toHaveBeenCalledWith(sourceReplayHref(control().origin));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ends an open fork when the creator goes back to the source replay by a link", async () => {
    swr.data = forkRoom();
    const fetch = vi.fn(async () => json({ session: forkRoom().session }));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Open the source replay" })); });
    expect(fetch).toHaveBeenCalledWith("/api/duels/fork-1/fork/cancel", expect.objectContaining({ method: "POST" }));
  });

  it("does not cancel a fork that is already over when the creator uses the source replay link", async () => {
    const done = forkRoom({ session: session("1v1", { slug: "fork-1", kind: "replay-fork", status: "completed", endedAt: "2026-10-10T10:00:00Z" }) });
    swr.data = done;
    const fetch = vi.fn(async () => json({}));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Fork controls/ }));
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Open the source replay" })); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed on a fork row without its seat control", async () => {
    const unusable = forkRoom({}, null);
    unusable.engine!.chainMode = "auto";
    swr.data = unusable;
    const fetch = vi.fn(async () => json(unusable));
    vi.stubGlobal("fetch", fetch);
    render(<DuelRoomView slug="fork-1" />);
    expect(document.querySelector("[data-replay-fork-unusable]")).not.toBeNull();
    expect(screen.queryByTestId("field")).toBeNull();
    expect(screen.queryByText("Replay fork")).toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: "r" }); });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows no fork controls on an ordinary duel", () => {
    swr.data = forkRoom({ session: session("1v1", { slug: "game-1", kind: "play", status: "active", endedAt: null }) });
    render(<DuelRoomView slug="game-1" />);
    expect(document.querySelector("[data-replay-fork-bar]")).toBeNull();
    expect(screen.getByTestId("field").getAttribute("data-my-seat")).toBe("0");
  });
});
