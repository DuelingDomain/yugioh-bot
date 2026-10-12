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
const withSeats = (room: DuelRoom, edit: (seats: DuelRoom["session"]["seats"]) => void): DuelRoom => {
  const next = structuredClone(room);
  edit(next.session.seats);
  return next;
};

describe("DuelRoomView: neutral start-blocked line", () => {
  it("shows the line after Ready, reads the room again, and drops the line when another seat changes", async () => {
    const lobby = tournamentLobby();
    swr.data = lobby;
    api.markDuelReady.mockResolvedValue({ session: lobby.session, startBlocked: NEUTRAL });
    const view = render(<DuelRoomView slug="game-1" />);
    // Nothing blocks yet: the status region is there, with no text.
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("");

    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    await waitFor(() => expect(screen.getByTestId("start-blocked")).toHaveTextContent(NEUTRAL));
    expect(api.markDuelReady).toHaveBeenCalledWith("game-1");
    // The answer is not a room, and the room is read again (the own note may be there).
    expect(swr.mutate).toHaveBeenCalled();

    // The player's own Ready arrives in the room: the line stays.
    swr.data = withSeats(lobby, (seats) => { seats[0].ready = true; });
    view.rerender(<DuelRoomView slug="game-1" />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent(NEUTRAL);

    // The other seat changes (the blocked player fixed the deck and readied, or left): the line goes.
    swr.data = withSeats(lobby, (seats) => { seats[0].ready = true; seats[1].ready = true; });
    view.rerender(<DuelRoomView slug="game-1" />);
    await waitFor(() => expect(screen.getByTestId("start-blocked")).toHaveTextContent(""));
    expect(screen.getByTestId("start-blocked").textContent).not.toContain(NEUTRAL);
  });

  it("drops the line when the player takes Ready back", async () => {
    const lobby = tournamentLobby();
    swr.data = lobby;
    api.markDuelReady.mockResolvedValue({ session: lobby.session, startBlocked: NEUTRAL });
    api.markDuelUnready.mockResolvedValue({ session: lobby.session });
    const view = render(<DuelRoomView slug="game-1" />);
    fireEvent.click(screen.getByRole("button", { name: /^Ready/ }));
    await waitFor(() => expect(screen.getByTestId("start-blocked")).toHaveTextContent(NEUTRAL));
    swr.data = withSeats(lobby, (seats) => { seats[0].ready = true; });
    view.rerender(<DuelRoomView slug="game-1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Not ready" }));
    await waitFor(() => expect(api.markDuelUnready).toHaveBeenCalledWith("game-1"));
    await waitFor(() => expect(screen.getByTestId("start-blocked")).toHaveTextContent(""));
  });
});
