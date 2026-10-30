import type Database from "better-sqlite3";

/** Bridge evidence/reviews and deck detection inputs, shared across SQLite connections. */
export function bridgeRevision(db: Database.Database): string {
  const row = db.prepare(`SELECT b.revision AS bridges,c.revision AS catalog,s.revision AS decks
    FROM bridge_revision b,card_catalog_revision c,card_staple_source_revision s
    WHERE b.id=1 AND c.id=1 AND s.id=1`).get() as { bridges: number; catalog: number; decks: number };
  return `${row.bridges}:${row.catalog}:${row.decks}`;
}
