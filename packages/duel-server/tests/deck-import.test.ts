import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { DeckLegalityError, validateDeck } from "../src/deck-legality.js";
import { normalizeImportedDeck } from "../src/deck-import.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const BARREL_CANONICAL = 81480460;
const BARREL_EXTERNAL = 81480461;
const DARK_MAGICIAN = 46986414;

const TYPE_SPELL = 0x2;
const TYPE_MONSTER = 0x1;
const TYPE_TOKEN = 0x4000;

const OT_OCG_TCG = 0x1 | 0x2;
const TYPE_EFFECT_MONSTER = TYPE_MONSTER | 0x20;

type FetchLike = (
  input: string | URL | globalThis.Request,
  init?: globalThis.RequestInit,
) => Promise<Pick<Response, "ok" | "json">>;

type YgoprodeckCard = {
  id: number;
  name: string;
  type: string;
  frameType: string;
  card_images: Array<{ image_url: string; image_url_small: string }>;
};

function ygoproCard(id: number, name: string): YgoprodeckCard {
  return {
    id,
    name,
    type: "Effect Monster",
    frameType: "effect",
    card_images: [{ image_url: "https://example.test/i.jpg", image_url_small: "https://example.test/s.jpg" }],
  };
}

function catalogFixture(cardsById: Record<string, YgoprodeckCard[]> = {}) {
  const db = new Database(":memory:");
  migrate(db);
  const fetchCalls: string[] = [];
  const fetch: FetchLike = async (input) => {
    const url = new URL(String(input));
    fetchCalls.push(url.toString());
    const cardId = url.searchParams.get("id");
    const data = cardId ? (cardsById[cardId] ?? []) : [];
    return { ok: true, async json() { return { data }; } };
  };
  return { db, fetch, fetchCalls };
}

function seedCatalog(db: Database.Database, id: number, name: string) {
  db.prepare<[number, string, string, string, string, string, string, string]>(
    `insert into card_catalog (
      ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, "Effect Monster", "effect", "i", "s", "[]", "2020-01-01T00:00:00.000Z");
}

function fillerSpells(count: number, exclude: number[] = []): number[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
  try {
    const rows = db
      .prepare<[number, number, number], { id: number }>(
        `SELECT datas.id FROM datas JOIN texts USING (id)
         WHERE type & ? != 0 AND type & ? = 0 AND type & ? = 0
           AND (ot & 3) != 0 AND alias = 0
           AND desc NOT LIKE '%always treated as%'
         ORDER BY datas.id`,
      )
      .all(TYPE_SPELL, TYPE_MONSTER, TYPE_TOKEN);
    const skip = new Set(exclude);
    const ids: number[] = [];
    for (const row of rows) {
      if (skip.has(row.id)) continue;
      ids.push(row.id);
      if (ids.length === count) return ids;
    }
    throw new Error(`Need ${count} filler spells, found ${ids.length}`);
  } finally {
    db.close();
  }
}

function isolatedEngine(
  cards: Array<{ id: number; name: string; alias?: number; ot?: number; type?: number }>,
): string {
  const dir = mkdtempSync(join(tmpdir(), "import-engine-"));
  const cdb = new Database(join(dir, "cards.cdb"));
  cdb.exec(`
    CREATE TABLE datas (
      id INTEGER PRIMARY KEY,
      ot INTEGER,
      alias INTEGER,
      setcode INTEGER,
      type INTEGER,
      atk INTEGER,
      def INTEGER,
      level INTEGER,
      race INTEGER,
      attribute INTEGER,
      category INTEGER
    );
    CREATE TABLE texts (
      id INTEGER PRIMARY KEY,
      name TEXT,
      desc TEXT
    );
  `);
  const insertData = cdb.prepare<[number, number, number, number]>(
    "INSERT INTO datas (id, ot, alias, setcode, type, atk, def, level, race, attribute, category) VALUES (?, ?, ?, 0, ?, 0, 0, 1, 1, 1, 0)",
  );
  const insertText = cdb.prepare<[number, string]>("INSERT INTO texts (id, name, desc) VALUES (?, ?, '')");
  for (const card of cards) {
    insertData.run(card.id, card.ot ?? OT_OCG_TCG, card.alias ?? 0, card.type ?? TYPE_EFFECT_MONSTER);
    insertText.run(card.id, card.name);
  }
  cdb.close();
  return dir;
}

describe("normalizeImportedDeck shape", () => {
  it("rejects missing sections before any remote work", async () => {
    const { db, fetch, fetchCalls } = catalogFixture();
    const malformedDeck: unknown = { extra: [], side: [] };
    await expect(
      normalizeImportedDeck(malformedDeck as DuelDeck, DATA, db, { fetch }),
    ).rejects.toThrow(DeckLegalityError);
    await expect(
      normalizeImportedDeck(malformedDeck as DuelDeck, DATA, db, { fetch }),
    ).rejects.toThrow(/main, extra, and side/i);
    expect(fetchCalls).toEqual([]);
  });

  it("rejects out-of-bound ids before any remote work", async () => {
    const { db, fetch, fetchCalls } = catalogFixture();
    await expect(
      normalizeImportedDeck({ main: [0], extra: [], side: [] }, DATA, db, { fetch }),
    ).rejects.toThrow(/Unknown card 0/);
    await expect(
      normalizeImportedDeck({ main: [-81480461], extra: [], side: [] }, DATA, db, { fetch }),
    ).rejects.toThrow(/Unknown card -81480461/);
    await expect(
      normalizeImportedDeck({ main: [1.5], extra: [], side: [] }, DATA, db, { fetch }),
    ).rejects.toThrow(/Unknown card 1.5/);
    expect(fetchCalls).toEqual([]);
  });

  it("does not mutate the input deck", async () => {
    const { db, fetch } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const main = [BARREL_EXTERNAL, ...fillerSpells(2, [BARREL_EXTERNAL, BARREL_CANONICAL])];
    const deck: DuelDeck = { main, extra: [BARREL_EXTERNAL], side: [BARREL_EXTERNAL], deckMaster: BARREL_EXTERNAL };
    const snapshot = {
      main: [...deck.main],
      extra: [...deck.extra],
      side: [...deck.side],
      deckMaster: deck.deckMaster,
    };
    await normalizeImportedDeck(deck, DATA, db, { fetch });
    expect(deck).toEqual(snapshot);
  });

  it("keeps an explicit Deck Master and Side cards without Domain cardinality", async () => {
    const { db, fetch } = catalogFixture();
    const deck: DuelDeck = {
      main: fillerSpells(20, [DARK_MAGICIAN]),
      extra: [],
      side: fillerSpells(2, [DARK_MAGICIAN]),
      deckMaster: DARK_MAGICIAN,
    };
    const normalized = await normalizeImportedDeck(deck, DATA, db, { fetch });
    expect(normalized.deckMaster).toBe(DARK_MAGICIAN);
    expect(normalized.side).toEqual(deck.side);
    expect(normalized.main).toHaveLength(20);
  });
});

describe("normalizeImportedDeck reported passcodes", () => {
  it("rewrites the reported Barrel Dragon artwork id to the engine canonical without a hardcoded exception", async () => {
    const { db, fetch, fetchCalls } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const fillers = fillerSpells(39, [BARREL_EXTERNAL, BARREL_CANONICAL]);
    const deck: DuelDeck = { main: [BARREL_EXTERNAL, ...fillers], extra: [], side: [] };
    const normalized = await normalizeImportedDeck(deck, DATA, db, { fetch });
    expect(normalized.main[0]).toBe(BARREL_CANONICAL);
    expect(normalized.main).not.toContain(BARREL_EXTERNAL);
    expect(normalized.main.slice(1)).toEqual(fillers);
    expect(fetchCalls.some((url) => new URL(url).searchParams.get("id") === String(BARREL_EXTERNAL))).toBe(true);
    expect(() => validateDeck("normal", normalized, DATA)).not.toThrow();
  });

  it("uses a cached catalog name without fetching", async () => {
    const { db, fetch, fetchCalls } = catalogFixture();
    seedCatalog(db, BARREL_EXTERNAL, "  barrel dragon ");
    const normalized = await normalizeImportedDeck(
      { main: [BARREL_EXTERNAL], extra: [], side: [] },
      DATA,
      db,
      { fetch },
    );
    expect(normalized.main).toEqual([BARREL_CANONICAL]);
    expect(fetchCalls).toEqual([]);
  });

  it("maps using the fetched name even when YGOPRODeck returns a different id", async () => {
    const { db, fetch } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_CANONICAL, "Barrel Dragon")],
    });
    const normalized = await normalizeImportedDeck(
      { main: [BARREL_EXTERNAL], extra: [BARREL_EXTERNAL], side: [BARREL_EXTERNAL], deckMaster: BARREL_EXTERNAL },
      DATA,
      db,
      { fetch },
    );
    expect(normalized).toEqual({
      main: [BARREL_CANONICAL],
      extra: [BARREL_CANONICAL],
      side: [BARREL_CANONICAL],
      deckMaster: BARREL_CANONICAL,
    });
  });

  it("leaves engine-known ids unchanged and skips remote work", async () => {
    const { db, fetch, fetchCalls } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const deck: DuelDeck = { main: [BARREL_CANONICAL, DARK_MAGICIAN], extra: [], side: [] };
    const normalized = await normalizeImportedDeck(deck, DATA, db, { fetch });
    expect(normalized.main).toEqual([BARREL_CANONICAL, DARK_MAGICIAN]);
    expect(fetchCalls).toEqual([]);
  });
});

describe("normalizeImportedDeck unknown and aliases", () => {
  it("rejects an unknown missing id without dropping it", async () => {
    const { db, fetch } = catalogFixture();
    const unknown = 90000001;
    const deck: DuelDeck = { main: [unknown, 10], extra: [], side: [] };
    const dir = isolatedEngine([{ id: 10, name: "Known Cannon" }]);
    await expect(normalizeImportedDeck(deck, dir, db, { fetch })).rejects.toThrow(DeckLegalityError);
    await expect(normalizeImportedDeck(deck, dir, db, { fetch })).rejects.toThrow(/Unknown card 90000001/);
    expect(deck.main).toEqual([unknown, 10]);
  });

  it("rejects a catalog name that matches no playable engine card", async () => {
    const { db, fetch } = catalogFixture({
      "90000002": [ygoproCard(90000002, "Ghost Print")],
    });
    const dir = isolatedEngine([{ id: 10, name: "Known Cannon" }]);
    await expect(
      normalizeImportedDeck({ main: [90000002], extra: [], side: [] }, dir, db, { fetch }),
    ).rejects.toThrow(/Unknown card 90000002 \(Ghost Print\)/);
  });

  it("rejects conflicting canonical names instead of picking one", async () => {
    const { db, fetch } = catalogFixture({
      "99": [ygoproCard(99, "Twin Blade")],
    });
    const dir = isolatedEngine([
      { id: 10, name: "Twin Blade" },
      { id: 20, name: "Twin Blade" },
    ]);
    await expect(
      normalizeImportedDeck({ main: [99], extra: [], side: [] }, dir, db, { fetch }),
    ).rejects.toThrow(/Ambiguous card 99 \(Twin Blade\)/i);
  });

  it("maps a missing artwork id to the unique alias-0 card and ignores alt-art rows", async () => {
    const { db, fetch } = catalogFixture({
      "999": [ygoproCard(999, "Iron Knight")],
    });
    const dir = isolatedEngine([
      { id: 100, name: "Iron Knight", alias: 0 },
      { id: 101, name: "Iron Knight", alias: 100 },
    ]);
    const normalized = await normalizeImportedDeck(
      { main: [101, 999, 999], extra: [], side: [] },
      dir,
      db,
      { fetch },
    );
    expect(normalized.main).toEqual([101, 100, 100]);
  });

  it("treats the same name aliasing to different cards as ambiguous", async () => {
    const { db, fetch } = catalogFixture({
      "77": [ygoproCard(77, "Shared Face")],
    });
    const dir = isolatedEngine([
      { id: 1, name: "Alpha" },
      { id: 2, name: "Beta" },
      { id: 11, name: "Shared Face", alias: 1 },
      { id: 22, name: "Shared Face", alias: 2 },
    ]);
    await expect(
      normalizeImportedDeck({ main: [77], extra: [], side: [] }, dir, db, { fetch }),
    ).rejects.toThrow(/Ambiguous card 77 \(Shared Face\)/i);
  });
});

describe("normalizeImportedDeck then validateDeck", () => {
  it("allows three normalized copies and rejects a fourth across mixed artwork ids", async () => {
    const { db, fetch } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const three = [BARREL_EXTERNAL, BARREL_EXTERNAL, BARREL_EXTERNAL];
    const legal = await normalizeImportedDeck(
      { main: [...three, ...fillerSpells(37, [BARREL_EXTERNAL, BARREL_CANONICAL])], extra: [], side: [] },
      DATA,
      db,
      { fetch },
    );
    expect(legal.main.filter((id) => id === BARREL_CANONICAL)).toHaveLength(3);
    expect(() => validateDeck("normal", legal, DATA)).not.toThrow();

    const four = await normalizeImportedDeck(
      { main: [...three, BARREL_CANONICAL, ...fillerSpells(36, [BARREL_EXTERNAL, BARREL_CANONICAL])], extra: [], side: [] },
      DATA,
      db,
      { fetch },
    );
    expect(four.main.filter((id) => id === BARREL_CANONICAL)).toHaveLength(4);
    expect(() => validateDeck("normal", four, DATA)).toThrow(/More than 3 copies of barrel dragon/i);
  });

  it("lets Domain singleton rules see artwork ids that collapsed to the Deck Master", async () => {
    const { db, fetch } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const normalized = await normalizeImportedDeck(
      {
        main: [BARREL_EXTERNAL, ...fillerSpells(59, [BARREL_EXTERNAL, BARREL_CANONICAL])],
        extra: [],
        side: [],
        deckMaster: BARREL_CANONICAL,
      },
      DATA,
      db,
      { fetch },
    );
    expect(normalized.main[0]).toBe(BARREL_CANONICAL);
    expect(normalized.deckMaster).toBe(BARREL_CANONICAL);
    expect(() => validateDeck("domain", normalized, DATA)).toThrow(/cannot appear/);
  });
});

describe("normalizeImportedDeck keepUnresolved", () => {
  it("keeps unknown positive passcodes and remaps the rest in order", async () => {
    const { db, fetch } = catalogFixture({
      [String(BARREL_EXTERNAL)]: [ygoproCard(BARREL_EXTERNAL, "Barrel Dragon")],
    });
    const unknown = 90000001;
    const deck: DuelDeck = {
      main: [BARREL_EXTERNAL, unknown, BARREL_EXTERNAL],
      extra: [unknown],
      side: [BARREL_EXTERNAL],
      deckMaster: unknown,
    };
    const normalized = await normalizeImportedDeck(deck, DATA, db, { fetch, keepUnresolved: true });
    expect(normalized.main).toEqual([BARREL_CANONICAL, unknown, BARREL_CANONICAL]);
    expect(normalized.extra).toEqual([unknown]);
    expect(normalized.side).toEqual([BARREL_CANONICAL]);
    expect(normalized.deckMaster).toBe(unknown);
    expect(normalized.main).toHaveLength(deck.main.length);
    await expect(normalizeImportedDeck(deck, DATA, db, { fetch })).rejects.toThrow(/Unknown card 90000001/);
  });

  it("keeps catalog names that do not resolve to a playable engine card", async () => {
    const { db, fetch } = catalogFixture({
      "90000002": [ygoproCard(90000002, "Ghost Print")],
      "99": [ygoproCard(99, "Twin Blade")],
    });
    const dir = isolatedEngine([
      { id: 10, name: "Twin Blade" },
      { id: 20, name: "Twin Blade" },
    ]);
    const unknownNamed = await normalizeImportedDeck(
      { main: [90000002, 10], extra: [], side: [] },
      dir,
      db,
      { fetch, keepUnresolved: true },
    );
    expect(unknownNamed.main).toEqual([90000002, 10]);
    const ambiguous = await normalizeImportedDeck(
      { main: [99, 10], extra: [], side: [] },
      dir,
      db,
      { fetch, keepUnresolved: true },
    );
    expect(ambiguous.main).toEqual([99, 10]);
  });

  it("still rejects invalid card-id types and missing sections", async () => {
    const { db, fetch, fetchCalls } = catalogFixture();
    await expect(
      normalizeImportedDeck({ extra: [], side: [] } as unknown as DuelDeck, DATA, db, { fetch, keepUnresolved: true }),
    ).rejects.toThrow(/main, extra, and side/i);
    await expect(
      normalizeImportedDeck({ main: [0], extra: [], side: [] }, DATA, db, { fetch, keepUnresolved: true }),
    ).rejects.toThrow(/Unknown card 0/);
    await expect(
      normalizeImportedDeck({ main: [-81480461], extra: [], side: [] }, DATA, db, { fetch, keepUnresolved: true }),
    ).rejects.toThrow(/Unknown card -81480461/);
    await expect(
      normalizeImportedDeck({ main: [1.5], extra: [], side: [] }, DATA, db, { fetch, keepUnresolved: true }),
    ).rejects.toThrow(/Unknown card 1.5/);
    expect(fetchCalls).toEqual([]);
  });

  it("does not treat catalog or engine infrastructure failures as unresolved cards", async () => {
    const unreachable = catalogFixture();
    const failingFetch: FetchLike = async () => {
      throw new Error("socket hang up");
    };
    await expect(
      normalizeImportedDeck(
        { main: [90000001], extra: [], side: [] },
        DATA,
        unreachable.db,
        { fetch: failingFetch, keepUnresolved: true },
      ),
    ).rejects.toThrow(/Could not reach the card database/);

    const down = catalogFixture();
    const downFetch: FetchLike = async () => ({ ok: false, async json() { return {}; } });
    await expect(
      normalizeImportedDeck({ main: [90000001], extra: [], side: [] }, DATA, down.db, { fetch: downFetch, keepUnresolved: true }),
    ).rejects.toThrow(/Could not reach the card database \(request failed\)/);

    const { db, fetch, fetchCalls } = catalogFixture();
    const empty = mkdtempSync(join(tmpdir(), "import-empty-"));
    await expect(
      normalizeImportedDeck({ main: [DARK_MAGICIAN], extra: [], side: [] }, empty, db, { fetch, keepUnresolved: true }),
    ).rejects.toThrow(/Cannot read engine card database/);
    expect(fetchCalls).toEqual([]);
  });
});
