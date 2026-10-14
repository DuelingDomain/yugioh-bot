import type Database from "better-sqlite3";
import { isExtraDeckCard } from "../duels/extra-deck.js";
import { createDeckTypeLookup, hasKnownDeckCardType, type DeckTypeEngineSource } from "./deck-sections.js";

type Copy = { table: string; column: string; id: number; json: string };
type JsonRow = { id: number; json: string };
const seriesColumns = ["base_deck0_json", "base_deck1_json", "deck0_json", "deck1_json"] as const;

/** Repairs future-use deck copies, preserving unknown codes, metadata, locks and readiness. */
export function createDeckCopyRepairService(db: Database.Database, engine?: DeckTypeEngineSource) {
  const findCard = createDeckTypeLookup(db, engine);
  const registrationRows = db.prepare<[number, number], JsonRow>(
    "select rowid as id, deck_json as json from tournament_participants where tournament_id=? and player_id=? and deck_json is not null",
  );
  const seriesRow = db.prepare<[number], Record<string, unknown> & { id: number; tournament_id: number | null; player0_id: number; player1_id: number }>(`
    select s.*, tm.tournament_id from duel_series s
    left join tournament_matches tm on tm.id=s.tournament_match_id
    where s.id=? and s.status in ('active','between_games')
      and not exists (select 1 from duels d where d.series_id=s.id and d.status='active')
  `);
  const lobbyRows = db.prepare<[number], JsonRow>(`
    select ds.rowid as id, ds.deck_json as json from duel_seats ds
    join duels d on d.id=ds.duel_id
    where d.series_id=? and d.status='lobby' and ds.deck_json is not null
  `);
  const updates = new Map<string, Database.Statement>();
  for (const [table, columns] of [
    ["tournament_participants", ["deck_json"]], ["duel_seats", ["deck_json"]], ["duel_series", seriesColumns],
  ] as const) for (const column of columns) {
    updates.set(`${table}.${column}`, db.prepare(`update ${table} set ${column}=? where rowid=? and ${column}=?`));
  }

  const repairedJson = (raw: string, lookup: ReturnType<typeof findCard.snapshot>): string | undefined => {
    let deck: Record<string, unknown>;
    try { deck = JSON.parse(raw); } catch { return; }
    if (!deck || !Array.isArray(deck.main) || !Array.isArray(deck.extra)) return;
    const types = new Map([...new Set(deck.extra)].map(code => [code, typeof code === "number" ? lookup(code) : undefined]));
    const moved: number[] = [], extra: unknown[] = [];
    for (const code of deck.extra) {
      const card = types.get(code);
      if (typeof code === "number" && hasKnownDeckCardType(card) && !isExtraDeckCard(card)) moved.push(code);
      else extra.push(code);
    }
    if (!moved.length) return;
    // Locked copies are not library saves: preserve every card even if normal start limits still reject the deck.
    return JSON.stringify({ ...deck, main: [...deck.main, ...moved], extra });
  };
  const repair = (read: () => Copy[]) => {
    const copies = read();
    if (!copies.length) return;
    const lookup = findCard.snapshot();
    if (!copies.some(copy => repairedJson(copy.json, lookup) !== undefined)) return;
    const apply = () => {
      // Re-read under the write lock so a concurrently changed deck or started game is never overwritten.
      for (const copy of read()) {
        const next = repairedJson(copy.json, lookup);
        if (next !== undefined) updates.get(`${copy.table}.${copy.column}`)!.run(next, copy.id, copy.json);
      }
    };
    if (db.inTransaction) apply();
    else db.transaction(apply).immediate();
  };
  const registrations = (tournamentId: number, playerId: number): Copy[] =>
    registrationRows.all(tournamentId, playerId).map(row => ({ ...row, table: "tournament_participants", column: "deck_json" }));

  return {
    registration(tournamentId: number, playerId: number) {
      repair(() => registrations(tournamentId, playerId));
    },
    series(seriesId: number) {
      repair(() => {
        const row = seriesRow.get(seriesId);
        if (!row) return [];
        const copies: Copy[] = seriesColumns.flatMap(column => typeof row[column] === "string"
          ? [{ table: "duel_series", column, id: row.id, json: row[column] as string }] : []);
        copies.push(...lobbyRows.all(seriesId).map(copy => ({ ...copy, table: "duel_seats", column: "deck_json" })));
        if (row.tournament_id !== null) for (const playerId of [row.player0_id, row.player1_id]) {
          copies.push(...registrations(row.tournament_id, playerId));
        }
        return copies;
      });
    },
  };
}
