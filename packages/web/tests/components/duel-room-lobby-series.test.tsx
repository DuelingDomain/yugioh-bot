// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

import { RoomLobby } from "../../src/components/duel/room-lobby";

afterEach(cleanup);

function lobby(options: Parameters<typeof makeSeriesRoom>[0], mySeat: number | null = 0, ready: [boolean, boolean] = [false, false]) {
  const room = makeSeriesRoom({ ...options, status: "lobby", mySeat });
  room.session.settings = defaultDuelSettings("normal");
  room.session.seats[0].ready = ready[0];
  room.session.seats[1].ready = ready[1];
  const handlers = {
    onJoin: vi.fn(), onAddBot: vi.fn(), onRemoveBot: vi.fn(), onReady: vi.fn(), onMarkReady: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onLeave: vi.fn(),
  };
  render(<RoomLobby room={room} slug="game-1" busy={false} actionError={null} {...handlers} />);
  return handlers;
}

describe("RoomLobby for a tournament game", () => {
  const tournament = makeSeries({ bestOf: 3, tournamentId: 4, tournamentSlug: "cup" });

  it("shows the locked registered deck and no deck editor", () => {
    lobby({ series: tournament, myDeck: makeDeck({ main: new Array(40).fill(1), extra: [100], side: [10, 11, 12] }) });
    expect(screen.getByText("Registered deck (locked)")).toBeTruthy();
    const region = screen.getByRole("region", { name: "Registered deck" });
    expect(region.textContent).toMatch(/Main\s*40/);
    expect(region.textContent).toMatch(/Extra\s*1/);
    expect(region.textContent).toMatch(/Side\s*3/);
    expect(screen.queryByRole("region", { name: "Deck import" })).toBeNull();
    expect(screen.getByRole("link", { name: "Tournament" }).getAttribute("href")).toBe("/tournament/cup");
    expect(screen.getByText("Best of 3")).toBeTruthy();
  });

  it("marks the player ready with the Ready button", () => {
    const handlers = lobby({ series: tournament, myDeck: makeDeck() });
    fireEvent.click(screen.getByRole("button", { name: "Ready" }));
    expect(handlers.onMarkReady).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Start duel/ })).toBeNull();
  });

  it("disables Ready once the player is ready", () => {
    lobby({ series: tournament, myDeck: makeDeck() }, 0, [true, false]);
    expect((screen.getByRole("button", { name: "Ready" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("lets either player cancel the series", () => {
    const handlers = lobby({ series: tournament, myDeck: makeDeck() }, 1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel series" }));
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});

describe("RoomLobby for a casual series", () => {
  const casual = makeSeries({ bestOf: 3, ranked: true });

  it("keeps the deck flow, hides Start and says when the game starts", () => {
    lobby({ series: casual }, 0, [true, true]);
    expect(screen.getByRole("region", { name: "Deck import" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start duel/ })).toBeNull();
    expect(screen.getByText("Starts when both players are ready")).toBeTruthy();
    expect(screen.getByText("Ranked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel series" })).toBeTruthy();
  });

  it("keeps Start for a duel with no series", () => {
    lobby({ series: null }, 0, [true, true]);
    expect(screen.getByRole("button", { name: /Start duel/ })).toBeTruthy();
    expect(screen.queryByText("Starts when both players are ready")).toBeNull();
  });
});

describe("RoomLobby practice bot note", () => {
  const NOTE = "Games against the practice bot do not count. This table plays one game and records nothing.";
  const BEST_OF_3_NOTE = "Best of 3 works against the practice bot, with side decking between games. The match never counts.";

  function openTable(extra: { bestOf?: 1 | 3; ranked?: boolean; bot?: boolean; seats?: number }) {
    const room = makeSeriesRoom({ series: null, status: "lobby", mySeat: 0 });
    room.session.settings = defaultDuelSettings("normal");
    room.session.bestOf = extra.bestOf ?? 1;
    room.session.ranked = extra.ranked ?? false;
    room.session.seats = room.session.seats.slice(0, extra.seats ?? 1);
    if (extra.bot) room.session.seats.push({ seat: 1, playerId: null, displayName: "Practice Bot", ready: true, isBot: true } as never);
    const handlers = { onJoin: vi.fn(), onAddBot: vi.fn(), onRemoveBot: vi.fn(), onReady: vi.fn(), onMarkReady: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onLeave: vi.fn() };
    render(<RoomLobby room={room} slug="game-1" busy={false} actionError={null} {...handlers} />);
    return handlers;
  }

  it("says on a Best of 3 table that the match against the practice bot has side decking and never counts", () => {
    openTable({ bestOf: 3 });
    expect(screen.getByRole("button", { name: /Add practice bot/ })).toBeTruthy();
    expect(screen.getByText(BEST_OF_3_NOTE)).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("shows the note on a ranked table", () => {
    openTable({ ranked: true });
    expect(screen.getByText(NOTE)).toBeTruthy();
  });

  it("shows the note once the bot is seated", () => {
    openTable({ bestOf: 3, bot: true });
    expect(screen.queryByRole("button", { name: /Add practice bot/ })).toBeNull();
    expect(screen.getByText(BEST_OF_3_NOTE)).toBeTruthy();
  });

  it("stays quiet on a plain Best of 1 unranked table", () => {
    openTable({});
    expect(screen.getByRole("button", { name: /Add practice bot/ })).toBeTruthy();
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("stays quiet on a Best of 3 table with two human players", () => {
    openTable({ bestOf: 3, seats: 2 });
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByText(BEST_OF_3_NOTE)).toBeNull();
  });
});

describe("RoomLobby remove practice bot", () => {
  function table(options: { mySeat: number | null; bot?: boolean; status?: "lobby" }) {
    const room = makeSeriesRoom({ series: null, status: "lobby", mySeat: options.mySeat });
    room.session.settings = defaultDuelSettings("normal");
    room.session.seats = room.session.seats.slice(0, 1);
    if (options.bot !== false) room.session.seats.push({ seat: 1, playerId: null, displayName: "Practice Bot", ready: true, isBot: true } as never);
    const handlers = { onJoin: vi.fn(), onAddBot: vi.fn(), onRemoveBot: vi.fn(), onReady: vi.fn(), onMarkReady: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onLeave: vi.fn() };
    render(<RoomLobby room={room} slug="game-1" busy={false} actionError={null} {...handlers} />);
    return handlers;
  }

  it("lets the organizer remove the seated bot from its seat card", () => {
    const handlers = table({ mySeat: 0 });
    const button = screen.getByRole("button", { name: "Remove practice bot" });
    expect(button.getAttribute("title")).toBe("Remove practice bot");
    fireEvent.click(button);
    expect(handlers.onRemoveBot).toHaveBeenCalledTimes(1);
  });

  it("hides the control when no bot is seated", () => {
    table({ mySeat: 0, bot: false });
    expect(screen.queryByRole("button", { name: "Remove practice bot" })).toBeNull();
    expect(screen.getByRole("button", { name: /Add practice bot/ })).toBeTruthy();
  });

  it("hides the control from a viewer who is not the organizer", () => {
    table({ mySeat: null });
    expect(screen.queryByRole("button", { name: "Remove practice bot" })).toBeNull();
  });
});
