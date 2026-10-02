// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelRoom, type DuelListItem } from "@yugidraft/shared/duels";
import { makeSeries, makeSeriesRoom } from "../helpers/duel-series";

const { listSavedDecks, listData } = vi.hoisted(() => ({ listSavedDecks: vi.fn(), listData: { duels: [] as DuelListItem[] } }));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("swr", () => ({ default: () => ({ data: listData, mutate: vi.fn() }) }));
vi.mock("../../src/components/decks/api", () => ({ listSavedDecks }));
vi.mock("../../src/components/duel/api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/components/duel/api")>(),
  validateDuelDeck: vi.fn(async () => ({ issues: [] })),
  searchDuelCards: vi.fn(async () => ({ cards: [] })),
}));

import { RoomLobby } from "../../src/components/duel/room-lobby";
import { DuelLobby } from "../../src/components/duel/lobby";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function room(mySeat: number | null = null, full = false): DuelRoom {
  const data = makeSeriesRoom({ series: null, status: "lobby", mySeat });
  data.session.settings = defaultDuelSettings("normal");
  data.session.seriesId = null;
  data.session.seats = data.session.seats.slice(0, full ? 2 : 1).map((seat) => ({ ...seat, ready: false }));
  data.myDeck = null;
  return data;
}

function props(data: DuelRoom, busy = false) {
  return {
    room: data, slug: "game-1", busy, actionError: null,
    onTakeSeat: vi.fn(), onAddBot: vi.fn(), onRemoveBot: vi.fn(), onReady: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onLeave: vi.fn(),
  };
}

describe("choosing a lobby seat", () => {
  it.each(["normal", "domain"] as const)("offers a spectator an explicit seat action in a %s lobby without showing a deck editor", (mode) => {
    const data = room();
    data.session.mode = mode;
    const handlers = props(data);
    render(<RoomLobby {...handlers} />);
    expect(screen.getByText(/You are watching/)).toBeInTheDocument();
    const seats = screen.getByRole("region", { name: "Seats" });
    fireEvent.click(within(seats).getByRole("button", { name: "Take seat 2" }));
    expect(handlers.onTakeSeat).toHaveBeenCalledWith(1);
    expect(screen.queryByRole("region", { name: "Deck import" })).toBeNull();
  });

  it("shows a full-table spectator state without a take-seat action", () => {
    render(<RoomLobby {...props(room(null, true))} />);
    expect(screen.getByText(/table is full.*watching/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Take seat|Join table/ })).toBeNull();
  });

  it("shows an open seat as soon as live room data releases it", () => {
    const handlers = props(room(null, true));
    const view = render(<RoomLobby {...handlers} />);
    expect(screen.queryByRole("button", { name: /Take seat/ })).toBeNull();
    view.rerender(<RoomLobby {...handlers} room={room()} />);
    expect(screen.getByRole("button", { name: "Take seat 2" })).toBeInTheDocument();
    view.rerender(<RoomLobby {...handlers} room={room(null, true)} />);
    expect(screen.queryByRole("button", { name: /Take seat/ })).toBeNull();
  });

  it("lets a seated guest watch instead, then removes the deck flow when their seat is released", () => {
    listSavedDecks.mockResolvedValue([]);
    const handlers = props(room(1, true));
    const view = render(<RoomLobby {...handlers} />);
    fireEvent.click(screen.getByRole("button", { name: "Watch instead" }));
    expect(handlers.onLeave).toHaveBeenCalledTimes(1);
    view.rerender(<RoomLobby {...handlers} room={room()} />);
    expect(screen.queryByRole("region", { name: "Deck import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Watch instead" })).toBeNull();
    expect(screen.getByRole("button", { name: "Take seat 2" })).toBeInTheDocument();
  });

  it("keeps the host seated and offers Cancel table", () => {
    listSavedDecks.mockResolvedValue([]);
    render(<RoomLobby {...props(room(0))} />);
    expect(screen.queryByRole("button", { name: "Watch instead" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel table" })).toBeInTheDocument();
  });

  it("preserves saved-deck selection and Ready after taking a seat", async () => {
    const deck = { main: new Array(40).fill(123), extra: [], side: [] };
    listSavedDecks.mockResolvedValue([{ id: 1, name: "Saved deck", mode: "normal", deck, createdAt: "", updatedAt: "" }]);
    const handlers = props(room(1, true));
    render(<RoomLobby {...handlers} />);
    const select = screen.getByLabelText("Use a saved deck");
    await waitFor(() => expect(select).not.toBeDisabled());
    fireEvent.change(select, { target: { value: "1" } });
    const ready = screen.getByRole("button", { name: "Ready with this deck" });
    await waitFor(() => expect(ready).not.toBeDisabled());
    fireEvent.click(ready);
    expect(handlers.onReady).toHaveBeenCalledWith(deck);
  });

  it("disables seat changes while an action is running and surfaces race errors", () => {
    render(<RoomLobby {...props(room(), true)} actionError="That seat is already taken. You are still watching." />);
    expect(screen.getByRole("button", { name: "Take seat 2" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/already taken/);
  });

  it.each(["opening", "series", "active"])("hides seat actions when locked by %s", (reason) => {
    const data = room(1, true);
    listSavedDecks.mockResolvedValue([]);
    if (reason === "opening") data.opening = { phase: "rps" } as DuelRoom["opening"];
    if (reason === "series") { data.series = makeSeries({ gameNumber: 2 }); data.session.seriesId = data.series.id; }
    if (reason === "active") data.session.status = "active";
    const handlers = props(data);
    const view = render(<RoomLobby {...handlers} />);
    expect(screen.queryByRole("button", { name: "Watch instead" })).toBeNull();
    view.rerender(<RoomLobby {...handlers} room={{ ...data, mySeat: null, session: { ...data.session, seats: data.session.seats.slice(0, 1) } }} />);
    expect(screen.queryByRole("button", { name: /Take seat|Join table/ })).toBeNull();
  });

  it("keeps a bot seat unavailable to human spectators", () => {
    const data = room(null, true);
    data.session.seats[1] = { seat: 1, playerId: null, displayName: "Practice Bot", isBot: true, ready: true };
    render(<RoomLobby {...props(data)} />);
    expect(screen.queryByRole("button", { name: /Take seat/ })).toBeNull();
  });
});

describe("table list entry", () => {
  function table(full = false) {
    const data = room(null, full);
    listData.duels = [{ ...data.session, mySeat: null, lastActivityAt: "", series: null }];
    render(<DuelLobby />);
  }

  it("offers both Join and Watch for an open lobby", () => {
    table();
    expect(screen.getByRole("link", { name: /Join/ })).toHaveAttribute("href", "/duels/game-1");
    expect(screen.getByRole("link", { name: "Watch" })).toHaveAttribute("href", "/duels/game-1");
  });

  it("labels a full lobby Full — watch and has no Join action", () => {
    table(true);
    expect(screen.getByRole("link", { name: /Full — watch/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join/ })).toBeNull();
  });
});
