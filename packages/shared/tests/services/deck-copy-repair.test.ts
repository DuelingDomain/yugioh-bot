import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDeckCopyRepairService } from "../../src/services/deck-copy-repair.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { createTournamentDuelService } from "../../src/services/tournament-duels.js";
import { seedIdentity } from "../helpers/identity.js";

const databases: Database.Database[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const db of databases.splice(0)) db.close(); });
const engine = new Map([
  [901, { name: "Fixture Spell", type: 2 }], [902, { name: "Fixture Trap", type: 4 }],
  [903, { name: "Fixture Fusion", type: 0x41 }],
]);
const legacy = { main: [907], extra: [901, 903, 999, 902, 901], side: [902], deckMaster: 907, metadata: "keep" };
const repaired = { ...legacy, main: [907, 901, 902, 901], extra: [903, 999] };
const columns = ["base_deck0_json", "base_deck1_json", "deck0_json", "deck1_json"] as const;

function setup() {
  const db = new Database(":memory:"); databases.push(db); migrate(db);
  const owner = seedIdentity(db, { guildId: "fixture", name: "Fixture owner" }).playerId;
  const opponent = seedIdentity(db, { guildId: "fixture", name: "Fixture opponent" }).playerId;
  const { series, duel } = createDuelSeriesService(db, engine).createChallenge({
    guildId: "fixture", challengerPlayerId: owner, opponentPlayerId: opponent,
    bestOf: 3, ranked: false, mode: "normal",
  });
  for (const column of columns) db.prepare(`update duel_series set ${column}=? where id=?`).run(JSON.stringify(legacy), series.id);
  db.prepare("update duel_seats set deck_json=?, ready=1 where duel_id=?").run(JSON.stringify(legacy), duel.id);
  return { db, series, duel, repair: createDeckCopyRepairService(db, engine) };
}

it.each(["series", "tournament"] as const)("defers repair statement preparation until the %s service needs it", kind => {
  const { db, series } = setup();
  const prepare = vi.spyOn(db, "prepare");
  const service = kind === "series" ? createDuelSeriesService(db, engine) : createTournamentDuelService(db, engine);
  const repairUpdates = () => prepare.mock.calls.filter(([sql]) => /update .* set .* where rowid=\? and /i.test(sql));
  expect(repairUpdates()).toHaveLength(0);
  if ("registration" in service) service.registration(999, 999);
  else service.createNextGame(series.id, "fixture");
  expect(repairUpdates()).toHaveLength(6);
});

it("repairs every future copy once while preserving unknowns, order, metadata and readiness", () => {
  const { db, series, duel, repair } = setup();
  repair.series(series.id);
  for (const column of columns) {
    const row = db.prepare(`select ${column} as json from duel_series where id=?`).get(series.id) as { json: string };
    expect(JSON.parse(row.json)).toEqual(repaired);
  }
  const seats = db.prepare("select deck_json, ready from duel_seats where duel_id=? order by seat").all(duel.id) as { deck_json: string; ready: number }[];
  expect(seats.map(row => ({ deck: JSON.parse(row.deck_json), ready: row.ready }))).toEqual(Array(2).fill({ deck: repaired, ready: 1 }));
  const transaction = vi.spyOn(db, "transaction");
  repair.series(series.id);
  expect(transaction).not.toHaveBeenCalled();
});

it.each(["active", "completed", "cancelled"])("preserves %s games and their series snapshots", status => {
  const { db, series, duel, repair } = setup();
  db.prepare("update duels set status=? where id=?").run(status, duel.id);
  if (status !== "active") db.prepare("update duel_series set status=? where id=?").run(status, series.id);
  const before = db.prepare("select * from duel_series where id=?").get(series.id);
  const seats = db.prepare("select * from duel_seats where duel_id=?").all(duel.id);
  const transaction = vi.spyOn(db, "transaction");
  repair.series(series.id);
  expect(db.prepare("select * from duel_series where id=?").get(series.id)).toEqual(before);
  expect(db.prepare("select * from duel_seats where duel_id=?").all(duel.id)).toEqual(seats);
  expect(transaction).not.toHaveBeenCalled();
});

it("never writes or locks unknown-only copies when engine and catalog data are absent", () => {
  const { db, series, duel } = setup();
  const raw = JSON.stringify(legacy);
  const repair = createDeckCopyRepairService(db, new Map());
  const transaction = vi.spyOn(db, "transaction");
  repair.series(series.id);
  for (const column of columns) expect(db.prepare(`select ${column} as json from duel_series where id=?`).get(series.id)).toEqual({ json: raw });
  expect(db.prepare("select deck_json from duel_seats where duel_id=?").all(duel.id)).toEqual(Array(2).fill({ deck_json: raw }));
  expect(transaction).not.toHaveBeenCalled();
});

it("rechecks running status after acquiring the write lock", () => {
  const { db, series, duel, repair } = setup();
  const transaction = db.transaction.bind(db);
  vi.spyOn(db, "transaction").mockImplementation(fn => {
    db.prepare("update duels set status='active' where id=?").run(duel.id);
    return transaction(fn);
  });
  repair.series(series.id);
  expect(db.prepare("select deck0_json from duel_series where id=?").get(series.id)).toEqual({ deck0_json: JSON.stringify(legacy) });
  expect(db.prepare("select deck_json from duel_seats where duel_id=?").all(duel.id)).toEqual(Array(2).fill({ deck_json: JSON.stringify(legacy) }));
});
