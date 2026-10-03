// @vitest-environment jsdom
import React from "react";
import { SWRConfig } from "swr";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelRoom } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";

const { server, getDuelRoom, takeDuelSeat, leaveDuel, replace, socket } = vi.hoisted(() => ({
  server: { room: null as DuelRoom | null },
  getDuelRoom: vi.fn(), takeDuelSeat: vi.fn(), leaveDuel: vi.fn(), replace: vi.fn(),
  socket: { onChange: null as (() => Promise<unknown>) | null, seats: [] as Array<number | null | undefined> },
}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/hooks/use-duel-websocket", () => ({
  useDuelWebsocket: (_slug: string, seat: number | null | undefined, onChange: () => Promise<unknown>) => {
    socket.onChange = onChange;
    socket.seats.push(seat);
    return { syncing: false, recovering: false, connected: true, presence: null, resync: vi.fn() };
  },
}));
vi.mock("@/lib/hooks/use-duel-leave-guard", () => ({ useDuelLeaveGuard: vi.fn() }));
vi.mock("@/components/duel/field", () => ({ DuelField: () => null, DeckMasterRail: () => null }));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: () => null }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: () => null }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: () => null }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: () => null }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: () => null }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: () => null }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: () => null }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: () => null }));
vi.mock("@/components/decks/api", () => ({ listSavedDecks: vi.fn(async () => []) }));
vi.mock("@/components/duel/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/components/duel/api")>(),
  getDuelRoom, takeDuelSeat, leaveDuel,
}));

import { DuelRoomView } from "@/components/duel/room";

function room(mySeat: number | null = null, full = false) {
  const data = makeSeriesRoom({ series: null, status: "lobby", mySeat });
  data.session.settings = defaultDuelSettings("normal");
  data.session.seriesId = null;
  data.session.seats = data.session.seats.slice(0, full ? 2 : 1).map((seat) => ({ ...seat, ready: false }));
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  socket.seats = [];
  server.room = room();
  getDuelRoom.mockImplementation(async () => server.room);
  takeDuelSeat.mockImplementation(async () => { server.room = room(1, true); return { session: server.room.session }; });
  leaveDuel.mockImplementation(async () => { server.room = room(); return { session: server.room.session }; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function open() {
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><DuelRoomView slug="game-1" /></SWRConfig>);
}

describe("room seat transitions", () => {
  it("enters watching, seats only on a click, and stays in the room after Watch instead", async () => {
    open();
    const take = await screen.findByRole("button", { name: "Take seat 2" });
    expect(takeDuelSeat).not.toHaveBeenCalled();
    fireEvent.click(take);
    const watch = await screen.findByRole("button", { name: "Watch instead" });
    expect(takeDuelSeat).toHaveBeenCalledWith("game-1", 1);
    expect(screen.getByRole("region", { name: "Deck import" })).toBeInTheDocument();
    expect(socket.seats).toContain(1);
    fireEvent.click(watch);
    expect(await screen.findByRole("button", { name: "Take seat 2" })).toBeInTheDocument();
    expect(leaveDuel).toHaveBeenCalledWith("game-1");
    expect(replace).not.toHaveBeenCalled();
    expect(socket.seats.at(-1)).toBeNull();
    expect(screen.queryByRole("region", { name: "Deck import" })).toBeNull();
  });

  it("refreshes a spectator's seat actions through the existing realtime callback", async () => {
    server.room = room(null, true);
    open();
    await screen.findByText(/table is full.*watching/i);
    server.room = room();
    await act(async () => { await socket.onChange?.(); });
    expect(screen.getByRole("button", { name: "Take seat 2" })).toBeInTheDocument();
    server.room = room(null, true);
    await act(async () => { await socket.onChange?.(); });
    expect(screen.queryByRole("button", { name: /Take seat/ })).toBeNull();
  });

  it("keeps a losing claimant watching and refreshes the filled seat", async () => {
    takeDuelSeat.mockImplementation(async () => {
      server.room = room(null, true);
      throw new Error("That seat is already taken. You are still watching.");
    });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Take seat 2" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/already taken.*watching/i));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Take seat/ })).toBeNull());
    expect(screen.queryByRole("region", { name: "Deck import" })).toBeNull();
  });
});
