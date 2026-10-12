// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelRoom } from "@yugidraft/shared/duels";
import { makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
const swr = vi.hoisted(() => ({ data: null as unknown, mutate: vi.fn() }));
vi.mock("swr", () => ({ default: () => ({ data: swr.data, error: undefined, isLoading: false, mutate: swr.mutate }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: () => ({ syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() }),
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
const api = vi.hoisted(() => ({ markDuelReady: vi.fn(), markDuelUnready: vi.fn() }));
vi.mock("@/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/duel/api")>()),
  ...api,
  getDuelCards: vi.fn(async () => ({ cards: [], missing: [] })),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
}));

import { DuelRoomView } from "@/components/duel/room";

const NEUTRAL = "Start blocked: another player's deck needs attention.";

beforeEach(() => {
  window.localStorage.clear();
  swr.mutate.mockReset().mockResolvedValue(undefined);
  api.markDuelReady.mockReset();
  api.markDuelUnready.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A tournament game lobby: the seated player readies with the registered deck. */
function tournamentLobby(): DuelRoom {
  const room = makeSeriesRoom({ series: makeSeries({ tournamentId: 4 }), slug: "game-1", status: "lobby", mySeat: 0 });
  room.session.settings = defaultDuelSettings("normal");
  room.session.seats = room.session.seats.map((seat) => ({ ...seat, ready: false }));
  return room;
}

describe("DuelRoomView: neutral start-blocked line", () => {
  it("shows the line from the room field and drops it when the field is gone", () => {
    const blocked = { ...tournamentLobby(), startBlockedByOther: true as const };
    swr.data = blocked;
    const view = render(<DuelRoomView slug="game-1" />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent(NEUTRAL);
    swr.data = tournamentLobby();
    view.rerender(<DuelRoomView slug="game-1" />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("");
  });

  it("reads the room once, not twice, after a Ready answer that is not a room", async () => {
    const lobby = tournamentLobby();
    swr.data = lobby;
    api.markDuelReady.mockResolvedValue({ session: lobby.session, startBlocked: NEUTRAL });
    render(<DuelRoomView slug="game-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    await waitFor(() => expect(api.markDuelReady).toHaveBeenCalledWith("game-1"));
    await waitFor(() => expect(swr.mutate).toHaveBeenCalled());
    expect(swr.mutate).toHaveBeenCalledTimes(1);
    expect(swr.mutate).toHaveBeenCalledWith();
    // The line is not kept in the view's own state: only the room field shows it.
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("");
  });

  it("puts a full-room answer in the cache without the neutral string, then reads the room once for the own note", async () => {
    const lobby = tournamentLobby();
    swr.data = lobby;
    api.markDuelReady.mockResolvedValue({ ...lobby, engine: {}, startBlocked: NEUTRAL });
    render(<DuelRoomView slug="game-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    await waitFor(() => expect(swr.mutate).toHaveBeenCalledTimes(2));
    const [cached, options] = swr.mutate.mock.calls[0];
    expect(cached).not.toHaveProperty("startBlocked");
    expect(options).toEqual({ revalidate: false });
    expect(swr.mutate.mock.calls[1]).toEqual([]);
  });
});
