import Database from "better-sqlite3";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";

export const GENESYS_MASTER = 10;
export const GENESYS_ART = 11;
export const GENESYS_LINK = 20;
export const GENESYS_PENDULUM = 21;
export const GENESYS_FUSION = 22;
export const GENESYS_FORBIDDEN = 55144522;
export const GENESYS_REVISION = "tcg-2026-10-05";

export function genesysFixture() {
  const directory = mkdtempSync(join(tmpdir(), "genesys-admission-"));
  writeFileSync(join(directory, "strings.conf"), "");
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ bundleVersion: "genesys-test", engineVersion: "test" }));
  mkdirSync(join(directory, "card-scripts"));
  const db = new Database(join(directory, "cards.cdb"));
  db.exec(`create table datas (id integer primary key, ot integer, alias integer, setcode integer,
    type integer, race integer, attribute integer, atk integer default 0, def integer default 0, level integer default 4);
    create table texts (id integer primary key, name text, desc text);`);
  const cards = [
    { id: GENESYS_MASTER, name: "Master", type: 17 },
    { id: GENESYS_ART, name: "Master", type: 17, alias: GENESYS_MASTER },
    { id: GENESYS_LINK, name: "Link", type: 0x4000001 },
    { id: GENESYS_PENDULUM, name: "Pendulum", type: 0x1000011 },
    { id: GENESYS_FUSION, name: "Fusion", type: 0x41 },
    { id: GENESYS_FORBIDDEN, name: "Pot of Greed", type: 2 },
    ...Array.from({ length: 60 }, (_, i) => ({ id: 1001 + i, name: `Filler ${i}`, type: 17 })),
  ];
  const insertData = db.prepare("insert into datas (id, ot, alias, setcode, type, race, attribute) values (?, 3, ?, 0, ?, 1, 1)");
  const insertText = db.prepare("insert into texts values (?, ?, '')");
  db.transaction(() => { for (const card of cards) {
    insertData.run(card.id, "alias" in card ? card.alias : 0, card.type);
    insertText.run(card.id, card.name);
    writeFileSync(join(directory, `card-scripts/c${card.id}.lua`), "-- fixture");
  } })();
  db.close();
  return { directory, points: new Map(cards.map(card => [card.id, 0])), cards };
}

export function genesysDeck(mode: DuelMode): DuelDeck {
  return {
    main: Array.from({ length: mode === "domain" ? 60 : 40 }, (_, i) => 1001 + i), extra: [], side: [],
    ...(mode === "domain" ? { deckMaster: GENESYS_MASTER } : {}),
  };
}

export function seedGenesysPoints(db: Database.Database, fixture: ReturnType<typeof genesysFixture>) {
  db.prepare("insert into genesys_points_meta values (1, ?, '2026-10-05', 'https://example.test/tcg', current_timestamp)")
    .run(GENESYS_REVISION);
  for (const card of fixture.cards) {
    db.prepare(`insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small,
      card_sets_json, cached_at, genesys_points, genesys_revision) values (?, ?, 'Normal Monster', 'normal', '', '', '[]', current_timestamp, ?, ?)`)
      .run(card.id, card.name, fixture.points.get(card.id), GENESYS_REVISION);
  }
}
