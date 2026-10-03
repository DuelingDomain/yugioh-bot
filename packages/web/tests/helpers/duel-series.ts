import type { DuelDeck, DuelRoom, DuelSeriesSummary } from "@yugidraft/shared/duels";

export function makeSeries(overrides: Partial<DuelSeriesSummary> = {}): DuelSeriesSummary {
  return {
    id: 7,
    bestOf: 3,
    ranked: false,
    status: "active",
    playerIds: [1, 2],
    displayNames: ["Sulman", "Imran"],
    wins: [0, 0],
    gameNumber: 1,
    currentDuelSlug: "game-1",
    winnerPlayerId: null,
    tournamentId: null,
    tournamentSlug: null,
    tournamentMatchId: null,
    nextGameAt: null,
    sideReady: [false, false],
    hasSide: [false, false],
    firstChooser: null,
    firstChoice: null,
    vsBot: false,
    ...overrides,
  };
}

export function makeDeck(overrides: Partial<DuelDeck> = {}): DuelDeck {
  return { main: [1, 2, 3], extra: [100, 101], side: [10, 11], ...overrides };
}

/** A completed game of a series, viewed by player 1 (seat 0) unless `mySeat` says otherwise. */
export function makeSeriesRoom(options: {
  slug?: string;
  series?: DuelSeriesSummary | null;
  mySeat?: number | null;
  status?: DuelRoom["session"]["status"];
  mySide?: DuelRoom["mySide"];
  myDeck?: DuelDeck | null;
} = {}): DuelRoom {
  return {
    session: {
      id: 1,
      slug: options.slug ?? "game-1",
      name: "Table",
      guildId: "g",
      organizerPlayerId: 1,
      mode: "normal",
      masterRule: 5,
      status: options.status ?? "completed",
      settings: {} as DuelRoom["session"]["settings"],
      seats: [
        { seat: 0, playerId: 1, displayName: "Sulman", ready: true, isBot: false },
        { seat: 1, playerId: 2, displayName: "Imran", ready: true, isBot: false },
      ],
      createdAt: "",
      endedAt: null,
      archivedAt: null,
      winnerPlayerId: null,
      winnerSeat: 0,
      resultReason: "LP reached 0",
    },
    role: options.mySeat === null ? "spectator" : "player",
    mySeat: options.mySeat === undefined ? 0 : options.mySeat,
    myDeck: options.myDeck ?? null,
    clock: null,
    metadataOnly: false,
    engine: null,
    series: options.series === undefined ? makeSeries() : options.series,
    mySide: options.mySide ?? null,
  } as DuelRoom;
}
