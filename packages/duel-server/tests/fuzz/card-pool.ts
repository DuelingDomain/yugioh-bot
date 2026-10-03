import Database from "better-sqlite3";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import type { Rng } from "./rng.js";

/** Card type bit flags used here. */
const T = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  FUSION: 0x40,
  RITUAL: 0x80,
  TOKEN: 0x4000,
  SYNCHRO: 0x2000,
  PENDULUM: 0x1000000,
  XYZ: 0x800000,
  LINK: 0x4000000,
  SKILL: 0x8000000,
  ACTION: 0x10000000,
};
const EXTRA_MASK = T.FUSION | T.SYNCHRO | T.XYZ | T.LINK;

export interface CatalogCard {
  id: number;
  type: number;
  level: number;
  atk: number;
  setcodes: number[];
  name: string;
}

export interface Catalog {
  byId: Map<number, CatalogCard>;
  /** Main-deck legal cards that have a script or need none. */
  main: CatalogCard[];
  mainMonsters: CatalogCard[];
  mainSpellTrap: CatalogCard[];
  extra: CatalogCard[];
  bySetcode: Map<number, CatalogCard[]>;
  /** Generic Extra Deck packages found by scanning scripts. */
  xyz: Map<number, { card: CatalogCard; count: number }[]>;
  link: { card: CatalogCard; min: number; max: number }[];
  synchro: CatalogCard[];
  curated: { hand: number[]; spells: number[]; traps: number[]; monsters: number[] };
}

/** Passcodes are verified against cards.cdb at load time. Missing ones are dropped. */
const CURATED = {
  hand: [14558127, 23434538, 97268402, 59438930, 73642296, 94145021, 27204311, 42141493, 60643553, 14957440],
  spells: [
    55144522, 12580477, 53129443, 83764718, 5318639, 19613556, 18144506, 72302403, 14087893, 81439173, 32807846, 73628505,
    24224830, 8267140, 14532163, 35261759, 70368879, 49238328, 24094653, 1845204, 46052429, 55761792, 73915051, 43711255,
    4031928, 17375316, 75500286, 12071500, 54631665, 86318356,
  ],
  traps: [
    44095762, 53582587, 41420027, 84749824, 40605147, 29401950, 4206964, 94192409, 97077563, 10045474, 83326048, 15800838,
    62279055, 77538567, 60082869, 98239899,
  ],
  monsters: [
    26202165, 78010363, 8131171, 83011277, 34124316, 54652250, 71413901, 77585513, 31786629, 44330098, 34853266, 40640057,
    37742478, 60800381, 35809262, 5405694, 72426662, 10000020, 73640163, 68535320, 95929069, 17393207, 38033121, 25955164,
    40044918, 23995346, 63845230, 16226786, 12014404, 46772449, 89631139, 46986414, 70781052, 21844576, 58932615,
  ],
};

const catalogs = new Map<string, Catalog>();

function walkScripts(dir: string, out: Map<number, string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkScripts(path, out);
    else {
      const match = /^c(\d+)\.lua$/.exec(entry.name);
      if (match) out.set(Number(match[1]), path);
    }
  }
}

function setcodesOf(value: bigint): number[] {
  const out: number[] = [];
  for (let shift = 0n; shift < 64n; shift += 16n) {
    const code = Number((value >> shift) & 0xffffn);
    if (code) out.push(code);
  }
  return out;
}

export function loadCatalog(dataDirectory: string): Catalog {
  const cached = catalogs.get(dataDirectory);
  if (cached) return cached;
  const scripts = new Map<number, string>();
  walkScripts(join(dataDirectory, "card-scripts"), scripts);
  const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
  db.defaultSafeIntegers(true);
  let rows: { id: bigint; type: bigint; level: bigint; atk: bigint; setcode: bigint; name: string }[];
  try {
    rows = db
      .prepare(
        "select d.id, d.type, d.level, d.atk, d.setcode, t.name from datas d join texts t on t.id = d.id where d.alias = 0 and (d.ot & 3) != 0",
      )
      .all() as typeof rows;
  } finally {
    db.close();
  }
  const byId = new Map<number, CatalogCard>();
  const main: CatalogCard[] = [];
  const mainMonsters: CatalogCard[] = [];
  const mainSpellTrap: CatalogCard[] = [];
  const extra: CatalogCard[] = [];
  const bySetcode = new Map<number, CatalogCard[]>();
  for (const row of rows) {
    const type = Number(row.type);
    if (type & (T.TOKEN | T.SKILL | T.ACTION)) continue;
    const card: CatalogCard = {
      id: Number(row.id),
      type,
      level: Number(row.level) & 0xff,
      atk: Number(row.atk),
      setcodes: setcodesOf(row.setcode),
      name: row.name,
    };
    const hasScript = scripts.has(card.id);
    // The engine tolerates a missing script only for plain Normal Monsters.
    const vanilla = (type & T.MONSTER) !== 0 && (type & T.NORMAL) !== 0 && !(type & (T.SPELL | T.TRAP | T.PENDULUM));
    if (!hasScript && !vanilla) continue;
    byId.set(card.id, card);
    if (type & EXTRA_MASK) {
      extra.push(card);
      continue;
    }
    main.push(card);
    if (type & T.MONSTER) mainMonsters.push(card);
    else mainSpellTrap.push(card);
    for (const code of card.setcodes) {
      const list = bySetcode.get(code) ?? [];
      list.push(card);
      bySetcode.set(code, list);
    }
  }

  const xyz = new Map<number, { card: CatalogCard; count: number }[]>();
  const link: Catalog["link"] = [];
  const synchro: CatalogCard[] = [];
  for (const card of extra) {
    const path = scripts.get(card.id);
    if (!path) continue;
    const text = readFileSync(path, "utf8");
    if (card.type & T.XYZ) {
      const m = /Xyz\.AddProcedure\(c,nil,(\d+),(\d+)(?:,|\))/.exec(text);
      if (m && Number(m[1]) === card.level) {
        const list = xyz.get(card.level) ?? [];
        list.push({ card, count: Number(m[2]) });
        xyz.set(card.level, list);
      }
    } else if (card.type & T.LINK) {
      const m = /Link\.AddProcedure\(c,nil,(\d+),(\d+)\)/.exec(text);
      if (m) link.push({ card, min: Number(m[1]), max: Number(m[2]) });
    } else if (card.type & T.SYNCHRO) {
      if (/Synchro\.AddProcedure\(c,nil,1,1,Synchro\.NonTuner\(nil\),1,99\)/.test(text)) synchro.push(card);
    }
  }

  const keep = (ids: number[]) => ids.filter((id, i) => byId.has(id) && ids.indexOf(id) === i);
  const catalog: Catalog = {
    byId,
    main,
    mainMonsters,
    mainSpellTrap,
    extra,
    bySetcode,
    xyz,
    link,
    synchro,
    curated: {
      hand: keep(CURATED.hand),
      spells: keep(CURATED.spells),
      traps: keep(CURATED.traps),
      monsters: keep(CURATED.monsters),
    },
  };
  catalogs.set(dataDirectory, catalog);
  return catalog;
}

const isMonster = (c: CatalogCard) => (c.type & T.MONSTER) !== 0;
const isTuner = (c: CatalogCard) => (c.type & 0x1000) !== 0;

function addCopies(list: number[], id: number, rng: Rng, limit: number): void {
  const copies = rng.chance(0.55) ? 1 : rng.chance(0.6) ? 2 : 3;
  for (let i = 0; i < copies && list.length < limit; i++) list.push(id);
}

export interface BuiltDeck {
  deck: DuelDeck;
  /** Human readable note for failure reports. */
  note: string;
}

/**
 * Build one deck from a seeded RNG. The mix is about 55 percent curated cards and 45 percent random
 * real cards, plus one Extra Deck package chosen from the generic-procedure scan.
 * `disallowed` holds passcodes the other seat already uses, so both decks can be code-disjoint.
 */
export function buildDeck(catalog: Catalog, rng: Rng, mode: DuelMode, disallowed: Set<number>): BuiltDeck {
  const mainSize = mode === "domain" ? 60 : rng.range(40, 45);
  const main: number[] = [];
  const extra: number[] = [];
  const notes: string[] = [];
  const ok = (id: number) => !disallowed.has(id);
  const add = (id: number) => {
    if (ok(id)) addCopies(main, id, rng, mainSize);
  };

  // Extra Deck package (reserve its materials first).
  const package_ = rng.int(6);
  if (package_ === 0) {
    const levels = [...catalog.xyz.keys()].filter((level) => level >= 3 && level <= 8);
    const level = rng.pick(levels);
    const candidates = (catalog.xyz.get(level) ?? []).filter((x) => ok(x.card.id));
    for (const pick of rng.sample(candidates, rng.range(2, 4))) extra.push(pick.card.id);
    const materials = catalog.mainMonsters.filter((c) => c.level === level && ok(c.id) && !(c.type & T.PENDULUM));
    for (const material of rng.sample(materials, 6)) addCopies(main, material.id, rng, mainSize - 10);
    notes.push(`xyz${level}`);
  } else if (package_ === 1) {
    for (const pick of rng.sample(catalog.link.filter((l) => l.min <= 2 && ok(l.card.id)), rng.range(2, 4))) extra.push(pick.card.id);
    for (const monster of rng.sample(catalog.mainMonsters.filter((c) => ok(c.id) && c.level <= 4), 8)) {
      addCopies(main, monster.id, rng, mainSize - 10);
    }
    notes.push("link");
  } else if (package_ === 2) {
    for (const card of rng.sample(catalog.synchro.filter((c) => ok(c.id)), rng.range(2, 4))) extra.push(card.id);
    const tuners = catalog.mainMonsters.filter((c) => isTuner(c) && c.level <= 4 && ok(c.id));
    const others = catalog.mainMonsters.filter((c) => !isTuner(c) && c.level <= 5 && ok(c.id));
    for (const c of rng.sample(tuners, 4)) addCopies(main, c.id, rng, mainSize - 10);
    for (const c of rng.sample(others, 5)) addCopies(main, c.id, rng, mainSize - 10);
    notes.push("synchro");
  } else if (package_ === 3) {
    const fusions = [35809262, 23995346].filter((id) => catalog.byId.has(id) && ok(id));
    for (const id of fusions) extra.push(id);
    for (const id of [24094653, 21844576, 58932615, 89631139, 5405694, 55761792]) if (catalog.byId.has(id) && ok(id)) add(id);
    notes.push("fusion-ritual");
  } else if (package_ === 4) {
    // Archetype core.
    const sets = [...catalog.bySetcode.entries()].filter(([, cards]) => cards.length >= 12);
    const [code, cards] = rng.pick(sets);
    for (const card of rng.sample(cards.filter((c) => ok(c.id)), 14)) addCopies(main, card.id, rng, mainSize - 8);
    for (const card of catalog.extra.filter((c) => c.setcodes.includes(code) && ok(c.id)).slice(0, 4)) extra.push(card.id);
    notes.push(`archetype 0x${code.toString(16)}`);
  } else {
    notes.push("random-extra");
  }

  // Curated core.
  const cur = catalog.curated;
  for (const id of rng.sample(cur.hand, rng.range(2, 5))) add(id);
  for (const id of rng.sample(cur.spells, rng.range(6, 10))) add(id);
  for (const id of rng.sample(cur.traps, rng.range(3, 6))) add(id);
  for (const id of rng.sample(cur.monsters, rng.range(6, 10))) {
    const card = catalog.byId.get(id);
    if (card && !(card.type & EXTRA_MASK)) add(id);
    else if (card && ok(id) && extra.length < 15 && !extra.includes(id)) extra.push(id);
  }

  // Random real cards fill the rest (45 percent of slots at least).
  let guard = 0;
  while (main.length < mainSize && guard++ < 5000) {
    const pool = rng.chance(0.6) ? catalog.mainMonsters : catalog.mainSpellTrap;
    const card = rng.pick(pool);
    if (!ok(card.id)) continue;
    main.push(card.id);
  }
  // Random Extra Deck cards (most cannot be summoned; they still exercise the Extra Deck paths).
  const extraTarget = rng.range(0, 15);
  guard = 0;
  while (extra.length < extraTarget && guard++ < 200) {
    const card = rng.pick(catalog.extra);
    if (ok(card.id)) extra.push(card.id);
  }
  // Card limits: no more than three of a code.
  const counts = new Map<number, number>();
  const finalMain = main.filter((id) => {
    const n = (counts.get(id) ?? 0) + 1;
    counts.set(id, n);
    return n <= 3;
  });
  const extraCounts = new Map<number, number>();
  const finalExtra = extra.slice(0, 15).filter((id) => {
    const n = (extraCounts.get(id) ?? 0) + 1;
    extraCounts.set(id, n);
    return n <= 3;
  });
  // Top up after the limit filter.
  guard = 0;
  while (finalMain.length < mainSize && guard++ < 5000) {
    const card = rng.pick(catalog.mainMonsters);
    if (!ok(card.id) || (counts.get(card.id) ?? 0) >= 3) continue;
    counts.set(card.id, (counts.get(card.id) ?? 0) + 1);
    finalMain.push(card.id);
  }
  const deck: DuelDeck = { main: rng.shuffle(finalMain), extra: finalExtra, side: [] };
  if (mode === "domain") {
    const monsters = catalog.mainMonsters.filter(
      (c) => ok(c.id) && !(c.type & T.PENDULUM) && c.level <= 8 && isMonster(c) && !finalMain.includes(c.id),
    );
    const curatedMaster = cur.monsters.filter((id) => ok(id) && !finalMain.includes(id) && catalog.mainMonsters.some((c) => c.id === id));
    deck.deckMaster = rng.chance(0.5) && curatedMaster.length > 0 ? rng.pick(curatedMaster) : rng.pick(monsters).id;
  }
  return { deck, note: notes.join(",") };
}

/** Build both decks for a scenario. Half of the scenarios use code-disjoint decks. */
export function buildDecks(
  catalog: Catalog,
  rng: Rng,
  mode: DuelMode,
): { decks: [DuelDeck, DuelDeck]; disjoint: boolean; notes: [string, string] } {
  const first = buildDeck(catalog, rng, mode, new Set());
  const disjoint = rng.chance(0.5);
  const used = new Set<number>();
  if (disjoint) {
    for (const id of [...first.deck.main, ...first.deck.extra]) used.add(id);
    if (first.deck.deckMaster) used.add(first.deck.deckMaster);
  }
  const second = buildDeck(catalog, rng, mode, used);
  return { decks: [first.deck, second.deck], disjoint, notes: [first.note, second.note] };
}
