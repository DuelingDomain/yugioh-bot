// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDuelSettings, type DuelRoom } from "@yugidraft/shared/duels";
import { TYPE_FUSION } from "../../src/components/duel/constants";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("../../src/components/duel/deck-editor", () => ({ DeckEditor: () => <div>Deck editor</div> }));
const api = vi.hoisted(() => ({
  readySeries: vi.fn(), unreadySeries: vi.fn(), saveSeriesSideDeck: vi.fn(),
  chooseSeriesFirst: vi.fn(), getDuelCards: vi.fn(), searchDuelCards: vi.fn(),
}));
vi.mock("../../src/components/duel/api", async (original) => ({
  ...(await original<typeof import("../../src/components/duel/api")>()), ...api,
}));

import { RoomLobby } from "../../src/components/duel/room-lobby";
import { BetweenGamesScreen } from "../../src/components/duel/between-games";
import { neutralStartBlocked, ownStartBlocked, ownStartBlockedText, withoutNeutralStartBlocked } from "../../src/components/duel/start-blocked";

const NEUTRAL = "Start blocked: another player's deck needs attention.";
const OWN = { reason: "Extra Deck can contain only Fusion, Synchro, Xyz, and Link monsters. Move Fixture Spell to Main Deck or Side Deck.", cardNames: ["Fixture Spell", "Fixture Trap"] };

afterEach(cleanup);

function lobbyRoom(): DuelRoom {
  const data = makeSeriesRoom({ series: null, status: "lobby", mySeat: 0 });
  data.session.settings = defaultDuelSettings("normal");
  data.session.seriesId = null;
  data.myDeck = null;
  return data;
}
function lobbyProps(data: DuelRoom, extra: Record<string, unknown> = {}) {
  return {
    room: data, slug: "game-1", busy: false, actionError: null,
    onTakeSeat: vi.fn(), onAddBot: vi.fn(), onRemoveBot: vi.fn(), onReady: vi.fn(), onStart: vi.fn(), onCancel: vi.fn(), onLeave: vi.fn(),
    ...extra,
  };
}

describe("start-blocked helpers", () => {
  it("reads the owner's object and ignores anything else", () => {
    expect(ownStartBlocked({ startBlocked: OWN })).toEqual(OWN);
    expect(ownStartBlocked({ startBlocked: NEUTRAL })).toBeNull();
    expect(ownStartBlocked({ startBlocked: { reason: "", cardNames: [] } })).toBeNull();
    expect(ownStartBlocked({})).toBeNull();
  });

  it("names the cards only when the reason does not", () => {
    expect(ownStartBlockedText(OWN)).toBe(`Your deck cannot start. ${OWN.reason} Cards: Fixture Trap.`);
    expect(ownStartBlockedText({ reason: "Move Fixture Spell.", cardNames: ["Fixture Spell"] })).toBe("Your deck cannot start. Move Fixture Spell.");
  });

  it("takes the neutral line only as a string and strips it from a room answer", () => {
    expect(neutralStartBlocked({ session: {}, startBlocked: NEUTRAL })).toBe(NEUTRAL);
    expect(neutralStartBlocked({ startBlocked: OWN })).toBeNull();
    expect(neutralStartBlocked(undefined)).toBeNull();
    const answer = { engine: {}, startBlocked: NEUTRAL, mySeat: 1 };
    expect(withoutNeutralStartBlocked(answer)).toEqual({ engine: {}, mySeat: 1 });
    const own = { engine: {}, startBlocked: OWN };
    expect(withoutNeutralStartBlocked(own)).toBe(own);
  });
});

describe("RoomLobby: start blocked", () => {
  it("tells the owner what blocks the start, with the card names, and moves to the deck editor", () => {
    const data = lobbyRoom();
    data.startBlocked = OWN;
    render(<RoomLobby {...lobbyProps(data)} />);
    const note = screen.getByTestId("start-blocked");
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("Your deck cannot start.");
    expect(note).toHaveTextContent("Fixture Trap");
    fireEvent.click(screen.getByRole("button", { name: "Edit your deck" }));
    expect(document.activeElement).toBe(screen.getByRole("region", { name: "Deck import" }));
  });

  it("shows the other player the neutral line and no card name", () => {
    render(<RoomLobby {...lobbyProps(lobbyRoom(), { startNotice: NEUTRAL })} />);
    const note = screen.getByTestId("start-blocked");
    expect(note).toHaveTextContent(NEUTRAL);
    expect(note.textContent).not.toMatch(/Fixture|cannot start/);
    expect(screen.queryByRole("button", { name: "Edit your deck" })).toBeNull();
  });

  it("shows the owner's own note and not the neutral line when both are present", () => {
    const data = lobbyRoom();
    data.startBlocked = OWN;
    render(<RoomLobby {...lobbyProps(data, { startNotice: NEUTRAL })} />);
    expect(screen.getAllByTestId("start-blocked")).toHaveLength(1);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("Your deck cannot start.");
  });

  it("shows nothing when no deck blocks the start", () => {
    render(<RoomLobby {...lobbyProps(lobbyRoom())} />);
    expect(screen.queryByTestId("start-blocked")).toBeNull();
  });

  it("links a tournament player to their decks, because the registered deck is locked here", () => {
    const data = lobbyRoom();
    data.series = makeSeries({ tournamentId: 4 });
    data.startBlocked = OWN;
    render(<RoomLobby {...lobbyProps(data)} />);
    expect(screen.getByRole("link", { name: "Edit your deck" })).toHaveAttribute("href", "/decks");
    expect(screen.queryByRole("button", { name: "Edit your deck" })).toBeNull();
  });
});

describe("BetweenGamesScreen: start blocked", () => {
  const base = makeDeck();
  const between = (overrides: Parameters<typeof makeSeries>[0] = {}) => makeSeries({
    status: "between_games", nextGameAt: new Date(Date.now() + 60_000).toISOString(), hasSide: [true, true], ...overrides,
  });
  beforeEach(() => {
    api.readySeries.mockReset();
    api.searchDuelCards.mockReset().mockResolvedValue({ cards: [] });
    api.getDuelCards.mockReset().mockImplementation(async (codes: number[]) => ({
      cards: codes.map((code) => ({ code, name: `Card ${code}`, type: code >= 100 ? TYPE_FUSION : 1 })), missing: [],
    }));
  });
  const roomFor = (startBlocked?: DuelRoom["startBlocked"]) => {
    const data = makeSeriesRoom({ series: between(), mySide: { baseDeck: base, currentDeck: base } });
    if (startBlocked) data.startBlocked = startBlocked;
    return data;
  };

  it("shows the owner the reason and the cards for the next game", async () => {
    render(<BetweenGamesScreen slug="game-1" room={roomFor(OWN)} onChanged={vi.fn()} onNavigate={vi.fn()} />);
    expect(await screen.findByTestId("start-blocked")).toHaveTextContent("Your deck cannot start.");
  });

  it("shows the other player the neutral line after Ready, without a card name", async () => {
    api.readySeries.mockResolvedValue({ series: between({ sideReady: [true, false] }), nextSlug: null, startBlocked: NEUTRAL });
    render(<BetweenGamesScreen slug="game-1" room={roomFor()} onChanged={vi.fn()} onNavigate={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
    const note = await screen.findByTestId("start-blocked");
    expect(note).toHaveTextContent(NEUTRAL);
    expect(note.textContent).not.toMatch(/Fixture/);
    await waitFor(() => expect(api.readySeries).toHaveBeenCalledOnce());
  });
});
