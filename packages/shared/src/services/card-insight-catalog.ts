import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckEngineDataDirectory } from "./card-artworks.js";
import { loadCardPasscodeRemaps } from "../db/card-passcode-remaps.js";
import { CARD_ATTRIBUTES, CARD_RACES } from "../duels/card-query.js";
import { engineInsightCard } from "../cards/effects/engine-card.js";
import { ATTRIBUTES, MONSTER_TYPES, SUBTYPES, type Card, type Subtype } from "../cards/effects/card.js";
import type { CardTags } from "../cards/effects/tags.js";
import type { Candidate } from "../cards/effects/synergy.js";

interface CatalogRow {
  ygoprodeck_id: number; name: string; type: string; frame_type: string;
  effect_text: string | null; attribute: string | null; level: number | null;
  atk: number | null; def: number | null; archetype: string | null;
  genesys_points: number | null; genesys_revision: string | null;
  tags_json?: string | null; popularity?: number | null;
}
interface EngineRow {
  id: number; alias: number; type: number; name: string; desc?: string;
  atk?: number; def?: number; level?: number; race?: number; attribute?: number;
  /** Cast to TEXT by SQLite so packed 64-bit setcodes are never rounded through a JS number. */
  setcode?: string;
}

const codeValid = (value: number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;

/** One operation owns this read-only engine handle. No catalog or tag snapshot is materialized. */
export function createInsightCatalog(db: Database.Database, dataDirectory = deckEngineDataDirectory(db.name)) {
  const artwork = db.prepare<[number], { card_id: number }>("SELECT card_id FROM card_artworks WHERE artwork_id=?");
  const metadata = db.prepare<[number], CatalogRow>("SELECT * FROM card_catalog WHERE ygoprodeck_id=?");
  const tags = db.prepare<[number], { tags_json: string; popularity: number }>("SELECT tags_json,popularity FROM card_tags WHERE passcode=?");
  const revision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
  const remaps = loadCardPasscodeRemaps(dataDirectory);
  const enginePath = join(dataDirectory, "cards.cdb");
  const engine = existsSync(enginePath) ? new Database(enginePath, { readonly: true, fileMustExist: true }) : undefined;
  let engineFind: Database.Statement<[number], EngineRow> | undefined;
  let setnames: ReadonlyMap<number, string> | undefined;
  const archetypes = () => {
    if (setnames) return setnames;
    const names = new Map<number, string>(), path = join(dataDirectory, "strings.conf");
    if (existsSync(path)) for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = /^!setname\s+(0x[0-9a-fA-F]+)\s+(.+)$/.exec(line);
      if (!match) continue;
      const code = Number.parseInt(match[1]!, 16), name = match[2]!.split("|")[0]!.trim();
      if (code > 0 && code <= 0xffff && name) names.set(code, name);
    }
    setnames = names;
    return names;
  };
  const setcodes = (row: EngineRow): number[] => {
    if (!row.setcode) return [];
    const packed = BigInt(row.setcode), codes: number[] = [];
    for (let shift = 0n; shift < 64n; shift += 16n) {
      const code = Number((packed >> shift) & 0xffffn);
      if (code) codes.push(code);
    }
    return codes;
  };
  if (engine) {
    try {
      const columns = new Set((engine.prepare("PRAGMA table_info(datas)").all() as { name: string }[]).map(row => row.name));
      const texts = new Set((engine.prepare("PRAGMA table_info(texts)").all() as { name: string }[]).map(row => row.name));
      if (columns.has("type") && texts.has("name")) engineFind = engine.prepare(`SELECT d.id,${columns.has("alias") ? "d.alias" : "0 AS alias"},d.type,t.name${texts.has("desc") ? ",t.desc" : ""}${columns.has("setcode") ? ",CAST(d.setcode AS TEXT) AS setcode" : ""}${["atk", "def", "level", "race", "attribute"].filter(field => columns.has(field)).map(field => `,d.${field}`).join("")} FROM datas d JOIN texts t USING(id) WHERE d.id=?`);
    } catch (error) { engine.close(); throw error; }
  }
  const canonical = (raw: number): number => {
    const seen = new Set<number>();
    let code = raw;
    while (codeValid(code) && !seen.has(code)) {
      seen.add(code);
      const known = artwork.get(code)?.card_id;
      if (known !== undefined && known !== code) { code = known; continue; }
      const remapped = remaps.get(code);
      if (remapped !== undefined) { code = remapped; continue; }
      const row = engineFind?.get(code);
      const parent = row?.alias ? engineFind?.get(row.alias) : undefined;
      if (row && parent && row.type === parent.type && row.name.trim().toLowerCase() === parent.name.trim().toLowerCase()) {
        code = row.alias; continue;
      }
      return code;
    }
    return raw;
  };
  const normalize = (row: CatalogRow, canonicalCode = canonical(row.ygoprodeck_id)): Candidate => {
    // A canonical row wins over alternate metadata and receives canonical tags.
    const source = canonicalCode === row.ygoprodeck_id ? row : metadata.get(canonicalCode) ?? row;
    const tagged = canonicalCode === row.ygoprodeck_id && row.tags_json !== undefined ? row : tags.get(canonicalCode);
    const views = tagged?.popularity ?? 0;
    const engineCard = engineFind?.get(canonicalCode);
    const type = `${source.type} ${source.frame_type}`.toLowerCase().replaceAll("-", "_");
    const subtypes = SUBTYPES.filter(subtype => subtype === "quick_play" ? /quick[_ ]play/.test(type) : new RegExp(`(?:^|[ /_])${subtype}(?:$|[ /_])`).test(type)) as Subtype[];
    const kind = /\bspell\b/.test(type) ? "spell" : /\btrap\b/.test(type) ? "trap" : "monster";
    if (kind !== "monster" && !subtypes.length) subtypes.push("normal");
    let card: Card = {
      id: canonicalCode, name: source.name, kind, typeLine: source.type, subtypes,
      monsterType: MONSTER_TYPES.find(race => new RegExp(`(?:^| / )${race.replaceAll("-", "[_ -]")}(?: / |$)`, "i").test(source.type)),
      attribute: ATTRIBUTES.find(attribute => attribute === source.attribute?.toUpperCase()),
      ...(subtypes.includes("xyz") ? { rank: source.level ?? undefined } : subtypes.includes("link") ? { linkRating: source.level ?? undefined } : { level: source.level ?? undefined }),
      atk: source.atk, def: source.def, text: source.effect_text ?? "", archetype: source.archetype ?? undefined,
      formats: [], genesysPoints: revision && source.genesys_revision === revision ? source.genesys_points ?? undefined : undefined,
      views, url: "",
    };
    if (engineCard) {
      const membership = setcodes(engineCard);
      const adapted = engineInsightCard({
        code: canonicalCode, canonicalPasscode: canonicalCode, name: source.name,
        type: engineCard.type,
        race: engineCard.race === undefined ? card.monsterType ?? "" : CARD_RACES.find(race => race.bit === engineCard.race)?.label ?? "",
        attribute: engineCard.attribute === undefined ? CARD_ATTRIBUTES.find(attribute => attribute.label === card.attribute)?.bit ?? 0 : engineCard.attribute,
        level: (engineCard.level ?? source.level ?? 0) & 0xff,
        attack: engineCard.atk ?? source.atk ?? -1, defense: engineCard.def ?? source.def ?? -1,
        description: source.effect_text || engineCard.desc || "", setcodes: membership, alias: engineCard.alias,
        lscale: ((engineCard.level ?? 0) >>> 24) & 0xff, rscale: ((engineCard.level ?? 0) >>> 16) & 0xff,
        arrows: 0, ot: 0,
      }, membership.length && !card.archetype ? archetypes() : new Map(), views);
      card = { ...card, ...adapted, typeLine: source.type, archetype: card.archetype ?? adapted.archetype, genesysPoints: card.genesysPoints };
      if (engineCard.level === undefined && source.level == null) {
        card.level = undefined; card.rank = undefined; card.linkRating = undefined;
      }
    }
    return { card, ...(tagged?.tags_json ? { tags: JSON.parse(tagged.tags_json) as CardTags } : {}) };
  };
  return {
    canonical,
    candidate(code: number): Candidate | undefined {
      const canonicalCode = canonical(code);
      const row = metadata.get(canonicalCode) ?? metadata.get(code);
      if (row) return normalize(row, canonicalCode);
      // An explicit public engine passcode is usable before the lazy image/API
      // cache has seen it. This fallback never inserts a cache row or guesses cost.
      const engineCard = engineFind?.get(canonicalCode);
      return engineCard ? normalize({
        ygoprodeck_id: canonicalCode, name: engineCard.name, type: "", frame_type: "",
        effect_text: engineCard.desc ?? "", attribute: null, level: null, atk: null, def: null,
        archetype: null, genesys_points: null, genesys_revision: null,
      }, canonicalCode) : undefined;
    },
    *candidates(pool?: readonly number[]): Generator<Candidate> {
      if (pool !== undefined) {
        const seen = new Set<number>();
        for (const code of pool) {
          const candidate = this.candidate(code);
          if (candidate && !seen.has(candidate.card.id)) { seen.add(candidate.card.id); yield candidate; }
        }
        return;
      }
      const seen = new Set<number>();
      const rows = db.prepare<[], CatalogRow>(`SELECT c.*,t.tags_json,t.popularity FROM card_catalog c
        LEFT JOIN card_tags t ON t.passcode=c.ygoprodeck_id
        WHERE NOT EXISTS(SELECT 1 FROM card_artworks a WHERE a.artwork_id=c.ygoprodeck_id AND a.card_id<>a.artwork_id)`);
      for (const row of rows.iterate()) {
        const candidate = normalize(row);
        if (!seen.has(candidate.card.id)) { seen.add(candidate.card.id); yield candidate; }
      }
    },
    close() { engine?.close(); },
  };
}

export type InsightCatalog = ReturnType<typeof createInsightCatalog>;
