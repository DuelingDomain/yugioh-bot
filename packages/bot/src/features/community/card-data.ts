import Database from "better-sqlite3";
import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CARD_ATTRIBUTES, CARD_RACES, CARD_TYPE_BITS as T, canonicalCardCode } from "@yugidraft/shared/duels";

export interface CardRecord {
  id: number; name: string; type: string; race: string | null; attribute: string | null;
  text: string; atk: number | null; def: number | null; level: number | null; prerelease: boolean; canonicalId: number;
}
type EngineRow = { id: bigint; name: string; desc: string; ot: bigint; alias: bigint; type: bigint;
  atk: bigint; def: bigint; level: bigint; race: bigint; attribute: bigint };
type CatalogRow = { ygoprodeck_id: number; name: string; type: string; race: string | null; attribute: string | null;
  effect_text: string | null; atk: number | null; def: number | null; level: number | null; is_prerelease: number };

/** Read only the card database, not the duel server or its engine dependencies. */
export function cardReader() {
  let cache: { path: string; stamp: string; cards: Map<number, CardRecord> } | undefined;
  const engineCards = (db: Database.Database): Map<number, CardRecord> => {
    const directory = process.env.DUEL_DATA_DIR || (db.name !== ":memory:"
      ? resolve(dirname(db.name), "duel-engine") : resolve("data/duel-engine"));
    const path = resolve(directory, "cards.cdb");
    if (!existsSync(path)) return new Map();
    const stat = statSync(path), stamp = `${stat.ino}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    if (cache?.path === path && cache.stamp === stamp) return cache.cards;
    const engine = new Database(path, { readonly: true, fileMustExist: true });
    try {
      const columns = new Set((engine.prepare("pragma table_info(datas)").all() as { name: string }[]).map(row => row.name));
      if (!["id", "ot", "alias", "type", "atk", "def", "level", "race", "attribute"].every(key => columns.has(key))) return new Map();
      const cards = new Map<number, CardRecord>();
      const rows = engine.prepare(`select d.id,d.ot,d.alias,d.type,d.atk,d.def,d.level,d.race,d.attribute,t.name,t.desc
        from datas d join texts t using(id) where (d.ot & 259) != 0 and (d.type & ${T.token}) = 0`).safeIntegers().all() as EngineRow[];
      for (const row of rows) {
        if (!row.name?.trim()) continue;
        const type = Number(row.type), monster = !!(type & T.monster), link = !!(type & T.link);
        const base = link ? "Link" : type & T.xyz ? "Xyz" : type & T.synchro ? "Synchro" : type & T.fusion ? "Fusion" : type & T.ritual ? "Ritual" : undefined;
        const subtype = type & T.quickPlay ? "Quick-Play" : type & T.continuous ? "Continuous" : type & T.equip ? "Equip"
          : type & T.field ? "Field" : type & T.counter ? "Counter" : type & T.ritual ? "Ritual" : "Normal";
        const id = Number(row.id);
        cards.set(id, { id, name: row.name, canonicalId: id, text: row.desc ?? "",
          type: monster ? [base, type & T.pendulum ? "Pendulum" : undefined, type & T.tuner ? "Tuner" : undefined,
            type & T.effect ? "Effect" : !base ? "Normal" : undefined, "Monster"].filter(Boolean).join(" ") : type & T.spell ? "Spell Card" : "Trap Card",
          race: monster ? CARD_RACES.filter(race => (row.race & BigInt(race.bit)) !== 0n).map(race => race.label).join("/") || null : subtype,
          attribute: monster ? CARD_ATTRIBUTES.find(attribute => attribute.bit === Number(row.attribute))?.label ?? null : null,
          atk: monster ? Number(row.atk) : null, def: monster && !link ? Number(row.def) : null,
          level: monster ? Number(row.level) & 0xff : null, prerelease: (Number(row.ot) & 0x100) !== 0,
        });
      }
      const identity = new Map(rows.map(row => [Number(row.id), { name: row.name, type: Number(row.type), alias: Number(row.alias) }]));
      for (const card of cards.values()) card.canonicalId = canonicalCardCode(card.id, identity);
      cache = { path, stamp, cards };
      return cards;
    } finally { engine.close(); }
  };
  const search = (db: Database.Database, input: string): CardRecord[] => {
    const query = input.trim().slice(0, 100), folded = query.toLowerCase();
    const rows = db.prepare(`select ygoprodeck_id,name,type,race,attribute,effect_text,atk,def,level,is_prerelease
      from card_catalog where ygoprodeck_id = ? or instr(lower(name),lower(?)) > 0
      order by lower(name) = lower(?) desc, instr(lower(name),lower(?)) = 1 desc, name, ygoprodeck_id limit 100`)
      .all(/^\d+$/.test(query) ? Number(query) : -1, query, query, query) as CatalogRow[];
    const cards = new Map<number, CardRecord>(rows.map(row => [row.ygoprodeck_id, {
      id: row.ygoprodeck_id, name: row.name, type: row.type, race: row.race, attribute: row.attribute, text: row.effect_text ?? "",
      atk: row.atk, def: row.def, level: row.level, prerelease: row.is_prerelease === 1, canonicalId: row.ygoprodeck_id,
    }]));
    for (const card of engineCards(db).values()) {
      if (cards.has(card.id) || card.name.toLowerCase().includes(folded) || String(card.id) === query) cards.set(card.id, card);
    }
    const rank = (card: CardRecord) => String(card.id) === query || card.name.toLowerCase() === folded ? 0 : card.name.toLowerCase().startsWith(folded) ? 1 : 2;
    return [...cards.values()].sort((a,b) => rank(a)-rank(b) || a.name.localeCompare(b.name) || a.id-b.id);
  };
  const canonicalId = (db: Database.Database, card: CardRecord): number => {
    if (card.canonicalId !== card.id) return card.canonicalId;
    const artwork = db.prepare("select card_id from card_artworks where artwork_id=?").get(card.id) as { card_id: number } | undefined;
    return artwork?.card_id ?? card.id;
  };
  return { search, canonicalId, clear: () => { cache = undefined; } };
}
