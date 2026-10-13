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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
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
    expect(ownStartBlockedText(OWN, true)).toBe("Cards: Fixture Trap.");
    expect(ownStartBlockedText({ reason: "Move Fixture Spell.", cardNames: ["Fixture Spell"] }, true)).toBe("");
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
    const data = lobbyRoom();
    data.startBlockedByOther = true;
    const view = render(<RoomLobby {...lobbyProps(data)} />);
    const note = screen.getByTestId("start-blocked");
    expect(note).toHaveTextContent(NEUTRAL);
    expect(note.textContent).not.toMatch(/Fixture|cannot start/);
    expect(screen.queryByRole("button", { name: "Edit your deck" })).toBeNull();
    // The line follows the room field: it goes when the field goes.
    view.rerender(<RoomLobby {...lobbyProps(lobbyRoom())} />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("");
  });

  it("shows the owner's own note and not the neutral line when both are present", () => {
    const data = lobbyRoom();
    data.startBlocked = OWN;
    data.startBlockedByOther = true;
    render(<RoomLobby {...lobbyProps(data)} />);
    expect(screen.getAllByTestId("start-blocked")).toHaveLength(1);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("Your deck cannot start.");
  });

  it("keeps an empty status region on the page when no deck blocks the start", () => {
    render(<RoomLobby {...lobbyProps(lobbyRoom())} />);
    const note = screen.getByTestId("start-blocked");
    expect(note).toHaveAttribute("role", "status");
    expect(note).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: "Edit your deck" })).toBeNull();
  });

  it("tells a tournament player the registered deck is locked, with no edit link", () => {
    const data = lobbyRoom();
    data.series = makeSeries({ tournamentId: 4 });
    data.startBlocked = OWN;
    render(<RoomLobby {...lobbyProps(data)} />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("Your registered deck is locked. Ask the tournament organizer.");
    expect(screen.queryByRole("link", { name: "Edit your deck" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit your deck" })).toBeNull();
  });

  it("does not say the reason twice when the error line already shows it", () => {
    const data = lobbyRoom();
    data.startBlocked = OWN;
    render(<RoomLobby {...lobbyProps(data, { actionError: OWN.reason })} />);
    expect(screen.getByRole("alert")).toHaveTextContent(OWN.reason);
    const note = screen.getByTestId("start-blocked");
    expect(note.textContent).not.toContain(OWN.reason);
    expect(note).toHaveTextContent("Cards: Fixture Trap.");
    expect(screen.getByRole("button", { name: "Edit your deck" })).toBeInTheDocument();
  });
});

describe("BetweenGamesScreen: start blocked", () => {
  const base = makeDeck();
  const nextGameAt = new Date(Date.now() + 60_000).toISOString();
  const between = (overrides: Parameters<typeof makeSeries>[0] = {}) => makeSeries({
    status: "between_games", nextGameAt, hasSide: [true, true], ...overrides,
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

  it("sends the player on with nextSlug and keeps no line of its own; a lobby with the room field shows the line (two renders, the UI half only)", async () => {
    // The real host pair: the last Ready starts the next game, the start fails on the other deck, and the answer
    // carries the neutral text with the new game's slug.
    api.readySeries.mockResolvedValue({ series: between({ sideReady: [true, true], currentDuelSlug: "game-2", gameNumber: 2 }), nextSlug: "game-2", startBlocked: NEUTRAL });
    const onNavigate = vi.fn();
    render(<BetweenGamesScreen slug="game-1" room={roomFor()} onChanged={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ready" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith("game-2"));
    // This screen keeps no neutral state of its own.
    expect(screen.getByTestId("start-blocked")).toHaveTextContent("");
    cleanup();

    const lobby = lobbyRoom();
    lobby.startBlockedByOther = true;
    render(<RoomLobby {...lobbyProps(lobby)} />);
    expect(screen.getByTestId("start-blocked")).toHaveTextContent(NEUTRAL);
  });
});
