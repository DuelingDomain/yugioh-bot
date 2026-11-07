import type { RemoteEvidenceRow, RemoteResult } from "./remote-result-model";

/** Fixtures for the dispute view. Used by the dev preview only. */
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

/** The stored evidence row, as `GET .../remote-evidence` sends it (snake_case columns, JSON strings). */
export const FIXTURE_EVIDENCE_ROW: RemoteEvidenceRow = {
  table_slug: "table-slug", player_one_user_id: 7, player_two_user_id: 8,
  players_json: JSON.stringify([{ userId: 7, seat: 0 }, { userId: 8, seat: 1 }]),
  table_started_at: NOW - 2_400_000, table_ended_at: NOW, end_reason: "game",
  games_json: JSON.stringify([
    { n: 1, winnerSeat: 0, reason: "concede", endedAt: NOW - 1_700_000 },
    { n: 2, winnerSeat: 1, reason: "declared", endedAt: NOW - 900_000 },
    { n: 3, winnerSeat: 0, reason: "lp", endedAt: NOW },
  ]),
  final_lp_json: JSON.stringify([
    { n: 1, seats: [{ seat: 0, lp: 3600 }, { seat: 1, lp: 1200 }] },
    { n: 2, seats: [{ seat: 0, lp: 0 }, { seat: 1, lp: 2100 }] },
    { n: 3, seats: [{ seat: 0, lp: 4400 }, { seat: 1, lp: 0 }] },
  ]),
  result_events_json: JSON.stringify([
    { seq: 412, at: NOW - 95_000, seat: 0, userId: 7, action: { type: "lp.change", seat: 1, delta: -2600, reason: "Dark Hole" } },
    { seq: 418, at: NOW - 60_000, seat: 0, userId: 7, action: { type: "lp.change", seat: 1, delta: -1400, reason: "attack" } },
    { seq: 419, at: NOW - 59_000, seat: 1, userId: 8, action: { type: "match.confirm", declarationSeq: null, accept: false } },
    { seq: 421, at: NOW - 20_000, seat: 0, userId: 7, action: { type: "match.declare", winnerSeat: 0 } },
  ]),
  public_board_json: JSON.stringify([
    { seat: 0, cards: [
      { zone: "monster", cardId: 89631139, name: "Blue-Eyes White Dragon", position: "attack" }, { zone: "monster", cardId: 46986414, name: "Dark Magician", position: "defense" },
      { zone: "graveyard", name: "Pot of Greed", position: "attack" }, { zone: "graveyard", name: "Raigeki", position: "attack" }] },
    { seat: 1, cards: [
      { zone: "monster", name: "Summoned Skull", position: "attack" }, { zone: "graveyard", name: "Mystical Space Typhoon", position: "attack" },
      { zone: "banished", name: "Change of Heart", position: "attack" }] },
  ]),
  detection_summary_json: JSON.stringify([
    { seat: 0, autoSeconds: 2400, tapSeconds: 0, manualSeconds: 0, identifiedByClick: 0, identifiedByTyped: 0, manualCorrections: 3, unknownAtGameEnd: [{ n: 3, count: 0 }] },
    { seat: 1, autoSeconds: 700, tapSeconds: 1700, manualSeconds: 0, identifiedByClick: 11, identifiedByTyped: 2, manualCorrections: 6, unknownAtGameEnd: [{ n: 3, count: 2 }] },
  ]),
  captured_at: NOW, hard_delete_at: NOW + 14 * 86_400_000,
};
