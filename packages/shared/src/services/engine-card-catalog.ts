import Database from "better-sqlite3";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { CARD_ATTRIBUTES, CARD_RACES, CARD_TYPE_BITS as T } from "../duels/card-query.js";
import { remapTargetMetadata } from "../db/engine-card-metadata.js";

export interface EngineCatalogCard {
  id: number;
  name: string;
  metadata: Record<string, string | number | null>;
  prerelease: boolean;
}
const cache = new Map<string, { stamp: string; cards: ReadonlyMap<number, EngineCatalogCard> }>();

/** Read-only bundled CDB fallback. Never infer release status from a temporary passcode. */
export function loadEngineCatalog(directory: string): ReadonlyMap<number, EngineCatalogCard> {
  const path = join(directory, "cards.cdb"), stringsPath = join(directory, "strings.conf");
  if (!existsSync(path)) return new Map();
  const stamp = [path, stringsPath].map(file => existsSync(file) ? `${statSync(file).mtimeMs}:${statSync(file).size}` : "").join(":");
  const previous = cache.get(path);
  if (previous?.stamp === stamp) return previous.cards;
  const engine = new Database(path, { readonly: true, fileMustExist: true });
  try {
    // Tiny identity-only CDBs are also used by older deployments and tests.
    const columns = new Set((engine.prepare("pragma table_info(datas)").all() as { name: string }[]).map(row => row.name));
    if (!["ot", "race", "setcode", "level", "atk", "def", "attribute"].every(column => columns.has(column))) return new Map();
    const setnames = new Map<number, string>();
    if (existsSync(stringsPath)) for (const line of readFileSync(stringsPath, "utf8").split(/\r?\n/)) {
      const match = /^!setname\s+(\S+)\s+(.*)$/.exec(line);
      if (match) setnames.set(Number(match[1]), match[2].trim());
    }
    // Include official OCG/TCG and previews; exclude tokens, Rush and anime-only cards.
    const rows = engine.prepare(`select d.*,t.name from datas d join texts t using(id)
      where (d.ot & 259) != 0 and (d.type & ${T.token}) = 0`).safeIntegers().all() as Array<{
        id: bigint; type: bigint; ot: bigint; name: string; race: bigint; setcode: bigint; attribute: bigint;
      }>;
    const metadata = remapTargetMetadata(engine, rows.map(row => Number(row.id)));
    const cards = new Map<number, EngineCatalogCard>();
    for (const row of rows) {
      if (!row.name?.trim()) continue;
      const id = Number(row.id), data = metadata.get(id);
      if (!data) continue;
      const codes: number[] = [];
      for (let shift = 0n; shift < 64n; shift += 16n) {
        const code = Number((row.setcode >> shift) & 0xffffn);
        if (code) codes.push(code);
      }
      const type = Number(row.type);
      const subtype = type & T.quickPlay ? "Quick-Play" : type & T.continuous ? "Continuous" : type & T.equip ? "Equip"
        : type & T.field ? "Field" : type & T.counter ? "Counter" : type & T.ritual ? "Ritual" : "Normal";
      data.race = type & T.monster ? CARD_RACES.filter(race => (row.race & BigInt(race.bit)) !== 0n).map(race => race.label).join("/") || null : subtype;
      data.attribute = CARD_ATTRIBUTES.find(attr => attr.bit === Number(row.attribute))?.label ?? null;
      data.setcodes_json = JSON.stringify(codes);
      data.archetype = codes.map(code => setnames.get(code) ?? setnames.get(code & 0xfff)).find(Boolean) ?? null;
      data.is_extra_deck = Number(!!(type & (T.fusion | T.synchro | T.xyz | T.link)));
      if (!(type & T.monster)) { data.atk = null; data.def = null; data.level = null; }
      cards.set(id, { id, name: row.name, metadata: data, prerelease: (Number(row.ot) & 0x100) !== 0 });
    }
    cache.set(path, { stamp, cards });
    return cards;
  } finally { engine.close(); }
}
