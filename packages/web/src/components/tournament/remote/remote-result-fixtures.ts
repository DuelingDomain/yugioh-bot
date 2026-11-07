import type { RemoteEvidence, RemoteResult } from "./remote-result-model";

/** Fixtures for the dispute view while the B3 and B4 routes are not merged. Used by the dev preview only. */
const NOW = 1794074400000;
export const FIXTURE_PLAYERS = { one: { id: 21, name: "Alice" }, two: { id: 22, name: "Bob" } } as const;

export const FIXTURE_RESULT: RemoteResult = {
  tournamentMatchId: 45, tableSlug: "table-slug", status: "disputed", winnerPlayerId: 21, score: { playerOne: 2, playerTwo: 1 }, source: "lp",
  proposedAt: NOW, confirmDeadlineAt: NOW + 7_200_000,
  reports: [
    { playerId: 21, choice: "confirm", note: null, at: NOW + 5_000 },
    { playerId: 22, choice: "dispute", note: "My LP was typed to 0 while I still had 1400. I rejected it and it went through anyway.", at: NOW + 340_000 },
  ],
  finalizedAt: null, finalizationReason: null, organizerDecision: null,
};

export const FIXTURE_EVIDENCE: RemoteEvidence = {
  tableSlug: "table-slug", tableStartedAt: NOW - 2_400_000, tableEndedAt: NOW, endReason: "lp",
  players: [{ seat: 0, playerId: 21, displayName: "Alice" }, { seat: 1, playerId: 22, displayName: "Bob" }],
  games: [
    { number: 1, winnerSeat: 0, reason: "concede", endedAt: NOW - 1_700_000 },
    { number: 2, winnerSeat: 1, reason: "declared", endedAt: NOW - 900_000 },
    { number: 3, winnerSeat: 0, reason: "lp", endedAt: NOW },
  ],
  finalLp: [
    { game: 1, lp: [{ seat: 0, lp: 3600 }, { seat: 1, lp: 1200 }] },
    { game: 2, lp: [{ seat: 0, lp: 0 }, { seat: 1, lp: 2100 }] },
    { game: 3, lp: [{ seat: 0, lp: 4400 }, { seat: 1, lp: 0 }] },
  ],
  resultEvents: [
    { seq: 412, at: NOW - 95_000, seat: 0, userId: 7, type: "lp.change", detail: "Seat 1 LP -2600 (Dark Hole)" },
    { seq: 418, at: NOW - 60_000, seat: 0, userId: 7, type: "lp.change", detail: "Seat 1 LP -1400, now 0" },
    { seq: 419, at: NOW - 59_000, seat: 1, userId: 8, type: "match.confirm", detail: "Rejected the game loss" },
    { seq: 421, at: NOW - 20_000, seat: 0, userId: 7, type: "match.declare", detail: "Alice won game 3" },
  ],
  publicBoard: [
    { seat: 0, monsters: ["Blue-Eyes White Dragon", "Dark Magician"], spellTraps: ["Mirror Force (set)"], graveyard: ["Pot of Greed", "Raigeki"], banished: [] },
    { seat: 1, monsters: ["Summoned Skull"], spellTraps: [], graveyard: ["Mystical Space Typhoon"], banished: ["Change of Heart"] },
  ],
  detectionSummary: [
    { seat: 0, autoSeconds: 2400, tapSeconds: 0, cardsByClick: 0, cardsTyped: 0, manualFixes: 3, unknownCards: 0 },
    { seat: 1, autoSeconds: 700, tapSeconds: 1700, cardsByClick: 11, cardsTyped: 2, manualFixes: 6, unknownCards: 2 },
  ],
  capturedAt: NOW, hardDeleteAt: NOW + 14 * 86_400_000,
};
