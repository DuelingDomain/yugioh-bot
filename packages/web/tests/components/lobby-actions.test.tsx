// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DraftLobbyResponse, LobbyPlayer, LobbySnapshot } from "@yugidraft/shared/types";
import {
  LobbyActions,
  LobbyAutoStart,
  useLobbyController,
} from "../../src/components/draft/lobby/lobby-actions";
import { InviteModal } from "../../src/components/draft/lobby/invite-modal";
import { SeatMeter, SeatSlots } from "../../src/components/draft/lobby/lobby-seats";
import { LobbyRequestError, type LobbyApi } from "../../src/components/draft/lobby/lobby-model";

const NOW = Date.parse("2026-10-07T12:00:00.000Z");

function player(id: number, name: string, over: Partial<LobbyPlayer> = {}): LobbyPlayer {
  return {
    playerId: id,
    displayName: name,
    pickCount: 0,
    joinedAt: "2026-10-07T11:00:00.000Z",
    isHost: false,
    isYou: false,
    isBot: false,
    ready: false,
    readyAt: null,
    cubeId: null,
    ...over,
  };
}

function lobby(over: Partial<LobbySnapshot> = {}): LobbySnapshot {
  return {
    revision: 5,
    serverNow: new Date(NOW).toISOString(),
    targetSeats: 4,
    joined: 3,
    ready: 0,
    allReady: false,
    autoStart: { enabled: false, held: false, eligible: false },
    start: null,
    errors: [],
    warnings: [],
    lastStartError: null,
    ...over,
  };
}

const HOST = player(1, "Imran", { isHost: true, isYou: true, ready: true });
const ANA = player(2, "Ana");
const BOB = player(3, "Bob", { ready: true });

function answer(over: Partial<LobbySnapshot>, players: LobbyPlayer[]): DraftLobbyResponse {
  return { lobby: lobby({ joined: players.length, ready: players.filter((p) => p.ready).length, ...over }), players };
}

function makeApi(over: Partial<LobbyApi> = {}): LobbyApi {
  const ok = vi.fn(async () => answer({ revision: 6 }, [HOST, ANA, BOB]));
  return {
    ready: vi.fn(ok),
    leave: vi.fn(ok),
    removePlayer: vi.fn(ok),
    start: vi.fn(ok),
    stop: vi.fn(ok),
    autoStart: vi.fn(ok),
    nudge: vi.fn(async () => ({ ok: true as const, channelId: "c", nextAllowedAt: new Date(Date.now() + 60_000).toISOString() })),
    ...over,
  };
}

interface HarnessProps {
  players: LobbyPlayer[];
  lobby?: LobbySnapshot;
  isHost?: boolean;
  isMember?: boolean;
  api?: LobbyApi;
  onRefetch?: () => void;
  onExpire?: () => void;
  onJoin?: () => Promise<void>;
  onAddBot?: () => Promise<void>;
  botsEnabled?: boolean;
  discordEnabled?: boolean;
}

function Harness({ players, lobby: snapshot = lobby(), isHost = false, isMember = true, api, onRefetch, onExpire, onJoin, onAddBot, botsEnabled, discordEnabled }: HarnessProps) {
  const [view, setView] = React.useState<DraftLobbyResponse>({ lobby: snapshot, players });
  const controller = useLobbyController({ slug: "demo", lobby: view.lobby, onResponse: setView, onRefetch, api });
  return (
    <>
      <SeatSlots players={view.players} lobby={view.lobby} controller={controller} isHost={isHost} isMember={isMember} botsEnabled={botsEnabled} onAddBot={onAddBot} onInvite={() => {}} discordEnabled={discordEnabled} />
      <SeatMeter lobby={view.lobby} />
      <LobbyAutoStart lobby={view.lobby} controller={controller} isHost={isHost} />
      <LobbyActions lobby={view.lobby} players={view.players} controller={controller} isHost={isHost} isMember={isMember} onJoin={onJoin} onExpire={onExpire} />
    </>
  );
}

beforeEach(() => {
  // jsdom has no matchMedia or layout; the seat list's FLIP animation reads neither when nothing moves.
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lobby actions by role", () => {
  it("shows a guest Join, which calls the page's join", async () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(<Harness players={[HOST, ANA]} isMember={false} onJoin={onJoin} />);
    expect(screen.queryByRole("button", { name: /^start draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ready/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /join draft/i }));
    await waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
  });

  it("disables Join when every seat is taken", () => {
    render(<Harness players={[HOST, ANA, BOB, player(4, "Cy")]} lobby={lobby({ joined: 4 })} isMember={false} onJoin={vi.fn()} />);
    expect(screen.getByRole("button", { name: /join draft/i })).toBeDisabled();
    expect(screen.getByText("Every seat is taken.")).toBeInTheDocument();
  });

  it("gives a player the Ready toggle and sends the new mark", async () => {
    const api = makeApi({ ready: vi.fn(async () => answer({ revision: 6 }, [HOST, { ...ANA, isYou: true, ready: true }, BOB])) });
    render(<Harness players={[HOST, { ...ANA, isHost: false, isYou: true }, BOB].map((p) => (p.playerId === 1 ? { ...p, isYou: false } : p))} api={api} />);
    expect(screen.queryByRole("button", { name: /start draft/i })).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /i'm ready/i });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(api.ready).toHaveBeenCalledWith(true));
    await waitFor(() => expect(screen.getByRole("button", { name: /i'm ready/i })).toHaveAttribute("aria-pressed", "true"));
  });

  it("gives the host Start, a compact ready toggle, and no Leave on other seats", () => {
    render(<Harness players={[HOST, ANA, BOB]} isHost />);
    expect(screen.getByRole("button", { name: /^start draft/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /i'm ready/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^leave$/i })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Remove Ana" })).toBeInTheDocument();
  });

  it("keeps Start off with fewer than 2 players and says why", () => {
    render(<Harness players={[HOST]} lobby={lobby({ joined: 1 })} isHost />);
    expect(screen.getByRole("button", { name: /^start draft/i })).toBeDisabled();
    expect(screen.getByText("Need 1 more player to start.")).toBeInTheDocument();
  });

  it("shows Add bot only to the host and only when the server allows bots", () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2 })} isHost botsEnabled onAddBot={onAddBot} />);
    expect(screen.getByRole("button", { name: /add bot/i })).toBeInTheDocument();
    rerender(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2 })} isHost botsEnabled={false} onAddBot={onAddBot} />);
    expect(screen.queryByRole("button", { name: /add bot/i })).not.toBeInTheDocument();
    rerender(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2 })} isHost={false} botsEnabled onAddBot={onAddBot} />);
    expect(screen.queryByRole("button", { name: /add bot/i })).not.toBeInTheDocument();
  });

  it("runs Add bot through the one-request rule", async () => {
    const onAddBot = vi.fn().mockResolvedValue(undefined);
    render(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2 })} isHost botsEnabled onAddBot={onAddBot} />);
    fireEvent.click(screen.getByRole("button", { name: /add bot/i }));
    await waitFor(() => expect(onAddBot).toHaveBeenCalledTimes(1));
  });

  it("offers a host who left a way back to a seat", async () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    render(<Harness players={[ANA, BOB]} lobby={lobby({ joined: 2 })} isHost isMember={false} onJoin={onJoin} />);
    fireEvent.click(screen.getByRole("button", { name: /take a seat/i }));
    await waitFor(() => expect(onJoin).toHaveBeenCalledTimes(1));
  });
});

describe("start, confirm and force", () => {
  it("starts at once when everyone is ready, with the lobby revision and no force", async () => {
    const everyone = [HOST, { ...ANA, ready: true }, BOB];
    const api = makeApi({ start: vi.fn(async () => answer({ revision: 6, start: { token: "t1", kind: "manual", startsAt: new Date(NOW + 5000).toISOString() } }, everyone)) });
    render(<Harness players={everyone} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(1));
    expect(api.start).toHaveBeenCalledWith({ revision: 5 });
    expect(await screen.findByRole("dialog", { name: /draft starting/i })).toBeInTheDocument();
  });

  it("asks before it starts with players who are not ready, and Wait for them sends no force", async () => {
    const api = makeApi({ start: vi.fn(async () => {
      throw new LobbyRequestError(409, { code: "NOT_READY", error: "Not ready", notReadyPlayerIds: [2] }, "x");
    }) });
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    const dialog = await screen.findByRole("dialog", { name: /not everyone is ready/i });
    expect(within(dialog).getByText(/Ana is not ready/)).toBeInTheDocument();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /wait for them/i })).toHaveFocus());
    fireEvent.click(within(dialog).getByRole("button", { name: /wait for them/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.start).toHaveBeenCalledExactlyOnceWith({ revision: 5 });
  });

  it("sends force only after Start anyway", async () => {
    const api = makeApi({ start: vi.fn()
      .mockRejectedValueOnce(new LobbyRequestError(409, { code: "NOT_READY", error: "Not ready", notReadyPlayerIds: [2] }, "x"))
      .mockResolvedValueOnce(answer({ revision: 6 }, [HOST, ANA, BOB])) });
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    const force = await screen.findByRole("button", { name: /start anyway/i });
    expect(api.start).toHaveBeenCalledExactlyOnceWith({ revision: 5 });
    fireEvent.click(force);
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
    expect(api.start).toHaveBeenLastCalledWith({ revision: 5, force: true });
  });

  it("uses server NOT_READY details even when a guest is locally unready, and names the unclaimed seats", async () => {
    const api = makeApi({
      start: vi.fn(async () => {
        throw new LobbyRequestError(409, { code: "NOT_READY", error: "Not ready", notReadyPlayerIds: [2], unclaimedPlayerIds: [3] }, "x");
      }),
    });
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    const dialog = await screen.findByRole("dialog", { name: /not everyone is ready/i });
    expect(within(dialog).getByText(/Ana is not ready/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Bob has not claimed a theme/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.start).toHaveBeenCalledWith({ revision: 5 });
  });

  it("schedules without force when only the host is not Ready", async () => {
    const players = [{ ...HOST, ready: false, readyAt: null }, { ...ANA, ready: true }, BOB];
    const api = makeApi({ start: vi.fn(async () => answer({ revision: 6,
      start: { token: "host-start", kind: "manual", startsAt: new Date(NOW + 5000).toISOString() } }, players)) });
    render(<Harness players={players} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    expect(await screen.findByRole("dialog", { name: /draft starting/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /not everyone is ready/i })).not.toBeInTheDocument();
    expect(api.start).toHaveBeenCalledExactlyOnceWith({ revision: 5 });
    expect(api.ready).not.toHaveBeenCalled();
  });

  it("refetches and says so on a stale lobby", async () => {
    const onRefetch = vi.fn();
    const everyone = [HOST, { ...ANA, ready: true }, BOB];
    const api = makeApi({
      start: vi.fn(async () => {
        throw new LobbyRequestError(409, { code: "STALE_LOBBY", error: "stale" }, "x");
      }),
    });
    render(<Harness players={everyone} isHost api={api} onRefetch={onRefetch} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/lobby changed/i);
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("shows another error from the server as an alert and keeps Start usable", async () => {
    const everyone = [HOST, { ...ANA, ready: true }, BOB];
    const api = makeApi({
      start: vi.fn(async () => {
        throw new LobbyRequestError(500, { error: "The pool is empty" }, "x");
      }),
    });
    render(<Harness players={everyone} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The pool is empty");
    expect(screen.getByRole("button", { name: /^start draft/i })).toBeEnabled();
  });

  it("marks the button busy and ignores a second press while a start is in flight", async () => {
    let finish: (value: DraftLobbyResponse) => void = () => {};
    const everyone = [HOST, { ...ANA, ready: true }, BOB];
    const api = makeApi({ start: vi.fn(() => new Promise<DraftLobbyResponse>((resolve) => { finish = resolve; })) });
    render(<Harness players={everyone} isHost api={api} />);
    const button = screen.getByRole("button", { name: /^start draft/i });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /^start draft/i })).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(screen.getByRole("button", { name: /^start draft/i }));
    expect(api.start).toHaveBeenCalledTimes(1);
    await act(async () => finish(answer({ revision: 6 }, everyone)));
  });

  it("shows the last start error from the server", () => {
    render(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2, lastStartError: "Engine is busy" })} isHost />);
    expect(screen.getByText(/last start failed: Engine is busy/i)).toBeInTheDocument();
  });

  it("shows a setup error as the Start blocker", () => {
    render(<Harness players={[HOST, ANA, BOB]} lobby={lobby({ errors: ["The pool is too small."] })} isHost />);
    expect(screen.getByRole("button", { name: /^start draft/i })).toBeDisabled();
  });
});

describe("start box and countdown", () => {
  const starting = (kind: "manual" | "auto", seconds: number, token = "tok-1") =>
    lobby({ start: { token, kind, startsAt: new Date(NOW + seconds * 1000).toISOString() } });

  it("shows a clock to everyone and Stop only to the host", () => {
    const { unmount } = render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5)} isHost />);
    expect(screen.getByRole("dialog", { name: /draft starting/i })).toBeInTheDocument();
    expect(screen.getByText(/Starting in \d s/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^stop$/i })).toHaveFocus();
    unmount();
    render(<Harness players={[ANA, BOB]} lobby={starting("manual", 5)} isMember />);
    expect(screen.queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/only the host can stop it/i)).toBeInTheDocument();
  });

  it("gives a guest a banner, not a dialog, and gives the host the dialog", () => {
    const { unmount } = render(<Harness players={[ANA, BOB]} lobby={starting("manual", 5)} isMember />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    expect(document.querySelector("[data-start-banner]")).not.toBeNull();
    expect(screen.getByText("Starting in 5 s")).toBeInTheDocument();
    unmount();
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5)} isHost />);
    expect(screen.getByRole("dialog", { name: /draft starting/i })).toBeInTheDocument();
  });

  it("says it once, then only the last three seconds, in a polite live region", () => {
    vi.useFakeTimers({ now: NOW });
    render(<Harness players={[ANA, BOB]} lobby={starting("auto", 10)} isMember />);
    const live = () => document.querySelector('[aria-live="polite"][role="status"].sr-only')!;
    expect(live().textContent).toBe("Draft is starting.");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(live().textContent).toBe("Draft is starting.");
    act(() => { vi.advanceTimersByTime(4000); });
    expect(live().textContent).toBe("3");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(live().textContent).toBe("2");
  });

  it("stops with the token on the Stop button and on Esc", async () => {
    const api = makeApi();
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5, "abc")} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^stop$/i }));
    await waitFor(() => expect(api.stop).toHaveBeenCalledWith("abc"));
    cleanup();
    const api2 = makeApi();
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("auto", 8, "xyz")} isHost api={api2} />);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(api2.stop).toHaveBeenCalledWith("xyz"));
  });

  it("does not stop on Esc for a player who is not the host", () => {
    const api = makeApi();
    render(<Harness players={[ANA, BOB]} lobby={starting("manual", 5)} api={api} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(api.stop).not.toHaveBeenCalled();
  });

  it("locks the seat buttons while a start runs", () => {
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5)} isHost />);
    expect(screen.getByRole("button", { name: "Remove Ana", hidden: true })).toBeDisabled();
  });

  it("at zero calls only onExpire and never a start request", () => {
    vi.useFakeTimers({ now: NOW });
    const api = makeApi();
    const onExpire = vi.fn();
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 1)} isHost api={api} onExpire={onExpire} />);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/starting now/i)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(onExpire.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("counts from the server clock, not the browser clock", () => {
    vi.useFakeTimers({ now: NOW + 60_000 });
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5)} isHost />);
    // The browser is a minute ahead of the server. The server says 5 s are left.
    expect(screen.getByText("Starting in 5 s")).toBeInTheDocument();
  });

  it("traps Tab inside the start box", () => {
    render(<Harness players={[HOST, ANA, BOB]} lobby={starting("manual", 5)} isHost />);
    const dialog = screen.getByRole("dialog", { name: /draft starting/i });
    const stop = within(dialog).getByRole("button", { name: /^stop$/i });
    expect(stop).toHaveFocus();
    fireEvent.keyDown(stop, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(stop, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("auto-start", () => {
  it("shows no auto-start row for a lobby without a seat target", () => {
    render(<Harness players={[HOST, ANA]} lobby={lobby({ targetSeats: null, joined: 2 })} isHost />);
    expect(screen.queryByText("Auto-start")).not.toBeInTheDocument();
  });

  it("gives the host a switch, Hold and Resume, and tells a player only the state", async () => {
    const api = makeApi();
    const { unmount } = render(<Harness players={[HOST, ANA, BOB]} lobby={lobby({ autoStart: { enabled: true, held: false, eligible: true } })} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Hold" }));
    await waitFor(() => expect(api.autoStart).toHaveBeenCalledWith({ enabled: true, held: true, revision: 5 }));
    unmount();

    const api2 = makeApi();
    const held = render(<Harness players={[HOST, ANA, BOB]} lobby={lobby({ autoStart: { enabled: true, held: true, eligible: false } })} isHost api={api2} />);
    expect(screen.getByText(/held/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(api2.autoStart).toHaveBeenCalledWith({ enabled: true, held: false, revision: 5 }));
    held.unmount();

    const api3 = makeApi();
    render(<Harness players={[HOST, ANA, BOB]} lobby={lobby()} isHost api={api3} />);
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "false");
    fireEvent.click(sw);
    await waitFor(() => expect(api3.autoStart).toHaveBeenCalledWith({ enabled: true, revision: 5 }));
    cleanup();

    render(<Harness players={[ANA, BOB]} lobby={lobby({ autoStart: { enabled: true, held: false, eligible: true } })} />);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hold" })).not.toBeInTheDocument();
  });
});

describe("seat buttons", () => {
  it("removes a player on the second press only", async () => {
    const api = makeApi();
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove Ana" }));
    expect(api.removePlayer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove Ana" }));
    await waitFor(() => expect(api.removePlayer).toHaveBeenCalledWith(2));
  });

  it("leaves from your own seat", async () => {
    const api = makeApi();
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /^leave$/i }));
    await waitFor(() => expect(api.leave).toHaveBeenCalledTimes(1));
  });

  it("hides host buttons from a player", () => {
    render(<Harness players={[{ ...HOST, isYou: false }, { ...ANA, isYou: true }, BOB]} />);
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /nudge/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^leave$/i })).toBeInTheDocument();
  });

  it("nudges a player who is not ready, never a ready player or a bot", async () => {
    const api = makeApi();
    const bot = player(4, "Botty", { isBot: true });
    render(<Harness players={[HOST, ANA, BOB, bot]} lobby={lobby({ joined: 4 })} isHost api={api} discordEnabled />);
    expect(screen.queryByRole("button", { name: "Nudge Bob" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nudge Botty" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nudge Ana" }));
    await waitFor(() => expect(api.nudge).toHaveBeenCalledWith(2));
    expect(await screen.findByText(/reminder sent/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Nudge Ana \(wait \d+ s\)/ })).toBeDisabled();
  });

  it("shows the wait the server names when Nudge is cooling down", async () => {
    const api = makeApi({
      nudge: vi.fn(async () => {
        throw new LobbyRequestError(429, { code: "NUDGE_COOLDOWN", error: "wait", retryAfterSeconds: 42 }, "x");
      }),
    });
    render(<Harness players={[HOST, ANA, BOB]} isHost api={api} discordEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Nudge Ana" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/wait 42 s/i);
    expect(screen.getByRole("button", { name: /Nudge Ana \(wait \d+ s\)/ })).toBeDisabled();
  });
});

describe("seat slots and meter", () => {
  it("draws a seat for each target and the numbers as text", () => {
    render(<Harness players={[HOST, ANA, BOB]} />);
    expect(screen.getAllByText("Open seat")).toHaveLength(1);
    expect(screen.getByRole("img", { name: /seats/i })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("/4")).toBeInTheDocument();
  });

  it("marks you, the host, and who is ready in words", () => {
    render(<Harness players={[HOST, ANA, BOB]} />);
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(screen.getByText("Not ready")).toBeInTheDocument();
    expect(screen.getByText("Host")).toBeInTheDocument();
  });

  it("puts Invite on the first open seat for a member only", () => {
    const { rerender } = render(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2, targetSeats: 4 })} />);
    expect(screen.getAllByRole("button", { name: "Invite" })).toHaveLength(1);
    rerender(<Harness players={[HOST, ANA]} lobby={lobby({ joined: 2, targetSeats: 4 })} isMember={false} />);
    expect(screen.queryByRole("button", { name: "Invite" })).not.toBeInTheDocument();
  });

  it("keeps the phone action column after the seats, so it can't cover the last one", () => {
    const { container } = render(<Harness players={[HOST, ANA, BOB]} isHost />);
    const slots = container.querySelector("ul");
    const go = screen.getByRole("button", { name: /^start draft/i }).closest("div");
    expect(slots && go && (slots.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  });
});

describe("InviteModal", () => {
  function InviteHarness({ canPost = true, api, discordEnabled }: { canPost?: boolean; api: LobbyApi; discordEnabled?: boolean }) {
    const [open, setOpen] = React.useState(false);
    const [view, setView] = React.useState<DraftLobbyResponse>({ lobby: lobby(), players: [HOST, ANA] });
    const controller = useLobbyController({ slug: "demo", lobby: view.lobby, onResponse: setView, api });
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>Open invite</button>
        {open && <InviteModal slug="demo" onClose={() => setOpen(false)} controller={controller} canPost={canPost} discordEnabled={discordEnabled} />}
      </>
    );
  }

  it("copies the link, posts to Discord for the host, and gives focus back on Esc", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const api = makeApi();
    render(<InviteHarness api={api} discordEnabled />);
    const opener = screen.getByRole("button", { name: "Open invite" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog", { name: /invite players/i });
    expect(within(dialog).getByRole("button", { name: /^close$/i })).toHaveFocus();
    expect(within(dialog).getByDisplayValue(/\/draft\/demo$/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /copy/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/draft\/demo$/)));
    fireEvent.click(within(dialog).getByRole("button", { name: /post to discord/i }));
    await waitFor(() => expect(api.nudge).toHaveBeenCalledWith(undefined));
    expect(await within(dialog).findByText(/posted to the discord channel/i)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("hides Post to Discord from a player", async () => {
    render(<InviteHarness api={makeApi()} canPost={false} discordEnabled />);
    fireEvent.click(screen.getByRole("button", { name: "Open invite" }));
    const dialog = await screen.findByRole("dialog", { name: /invite players/i });
    expect(within(dialog).queryByRole("button", { name: /post to discord/i })).not.toBeInTheDocument();
  });

  it("closes on a backdrop press", async () => {
    render(<InviteHarness api={makeApi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Open invite" }));
    const dialog = await screen.findByRole("dialog", { name: /invite players/i });
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
