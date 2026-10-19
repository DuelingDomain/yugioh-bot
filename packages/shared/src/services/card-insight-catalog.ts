import Database from "better-sqlite3";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deckEngineDataDirectory } from "./card-artworks.js";
import { loadCardPasscodeRemaps } from "../db/card-passcode-remaps.js";
import { CARD_ATTRIBUTES, CARD_RACES, inArchetype } from "../duels/card-query.js";
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
interface SuggestionRow extends CatalogRow {
  passcode: number;
  artwork_parent: number | null;
  tcg_date: string | null;
  ocg_date: string | null;
}

const codeValid = (value: number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;

/** One operation owns this read-only engine handle. No catalog or tag snapshot is materialized. */
export function createInsightCatalog(db: Database.Database, dataDirectory = deckEngineDataDirectory(db.name)) {
  const artwork = db.prepare<[number], { card_id: number }>("SELECT card_id FROM card_artworks WHERE artwork_id=?");
  const metadata = db.prepare<[number], CatalogRow>("SELECT * FROM card_catalog WHERE ygoprodeck_id=?");
  const release = db.prepare<[number], { tcg_date: string | null; ocg_date: string | null }>("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=?");
  const tags = db.prepare<[number], { tags_json: string; popularity: number }>("SELECT tags_json,popularity FROM card_tags WHERE passcode=?");
  const revision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
  const remaps = loadCardPasscodeRemaps(dataDirectory);
  // Printed type shapes repeat across the catalog. Keep these small shapes for
  // this read, rather than rebuilding dozens of regular expressions per card.
  const printedTypes = new Map<string, Pick<Card, "kind" | "subtypes" | "monsterType">>();
  const engineTypes = new Map<string, Pick<Card, "kind" | "subtypes" | "monsterType" | "attribute">>();
  const memberships = new Map<string, string | undefined>();
  const enginePath = join(dataDirectory, "cards.cdb");
  const engine = existsSync(enginePath) ? new Database(enginePath, { readonly: true, fileMustExist: true }) : undefined;
  let engineFind: Database.Statement<[number], EngineRow> | undefined;
  let engineStream: Database.Statement<[], EngineRow> | undefined;
  let engineIdentities: Database.Statement<[], EngineRow> | undefined;
  let engineAliases: Database.Statement<[], EngineRow> | undefined;
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
      if (columns.has("type") && texts.has("name")) {
        const select = `SELECT d.id,${columns.has("alias") ? "d.alias" : "0 AS alias"},d.type,t.name${texts.has("desc") ? ",t.desc" : ""}${columns.has("setcode") ? ",CAST(d.setcode AS TEXT) AS setcode" : ""}${["atk", "def", "level", "race", "attribute"].filter(field => columns.has(field)).map(field => `,d.${field}`).join("")} FROM datas d JOIN texts t USING(id)`;
        engineFind = engine.prepare(`${select} WHERE d.id=?`);
        engineStream = engine.prepare(`${select} ORDER BY d.id`);
        engineIdentities = engine.prepare(`SELECT d.id,${columns.has("alias") ? "d.alias" : "0 AS alias"},d.type,t.name FROM datas d JOIN texts t USING(id) ORDER BY d.id`);
        if (columns.has("alias")) engineAliases = engine.prepare(`${select} WHERE d.alias<>0 ORDER BY d.id`);
      }
    } catch (error) { engine.close(); throw error; }
  }
  const canonical = (raw: number, initialEngine?: EngineRow): number => {
    const seen = new Set<number>();
    let code = raw;
    while (codeValid(code) && !seen.has(code)) {
      seen.add(code);
      const known = artwork.get(code)?.card_id;
      if (known !== undefined && known !== code) { code = known; continue; }
      const remapped = remaps.get(code);
      if (remapped !== undefined) { code = remapped; continue; }
      const row = code === raw && initialEngine ? initialEngine : engineFind?.get(code);
      const parent = row?.alias ? engineFind?.get(row.alias) : undefined;
      if (row && parent && row.type === parent.type && row.name.trim().toLowerCase() === parent.name.trim().toLowerCase()) {
        code = row.alias; continue;
      }
      return code;
    }
    return raw;
  };
  const normalize = (row: CatalogRow, canonicalCode = canonical(row.ygoprodeck_id), initialEngine?: EngineRow, joined = false): Candidate => {
    // A canonical row wins over alternate metadata and receives canonical tags.
    const source = canonicalCode === row.ygoprodeck_id ? row : metadata.get(canonicalCode) ?? row;
    const tagged = canonicalCode === row.ygoprodeck_id && row.tags_json !== undefined ? row : tags.get(canonicalCode);
    const views = tagged?.popularity ?? 0;
    const engineCard = initialEngine?.id === canonicalCode ? initialEngine : joined ? undefined : engineFind?.get(canonicalCode);
    const typeKey = `${source.type}:${source.frame_type}`;
    let shape = printedTypes.get(typeKey);
    if (!shape) {
      const type = `${source.type} ${source.frame_type}`.toLowerCase().replaceAll("-", "_");
      const subtypes = SUBTYPES.filter(subtype => subtype === "quick_play" ? /quick[_ ]play/.test(type) : new RegExp(`(?:^|[ /_])${subtype}(?:$|[ /_])`).test(type)) as Subtype[];
      const kind = /\bspell\b/.test(type) ? "spell" : /\btrap\b/.test(type) ? "trap" : "monster";
      if (kind !== "monster" && !subtypes.length) subtypes.push("normal");
      shape = { kind, subtypes, monsterType: MONSTER_TYPES.find(race => new RegExp(`(?:^| / )${race.replaceAll("-", "[_ -]")}(?: / |$)`, "i").test(source.type)) };
      printedTypes.set(typeKey, shape);
    }
    const { subtypes, kind } = shape;
    let card: Card = {
      id: canonicalCode, name: source.name, kind, typeLine: source.type, subtypes,
      monsterType: shape.monsterType,
      attribute: ATTRIBUTES.find(attribute => attribute === source.attribute?.toUpperCase()),
      ...(subtypes.includes("xyz") ? { rank: source.level ?? undefined } : subtypes.includes("link") ? { linkRating: source.level ?? undefined } : { level: source.level ?? undefined }),
      atk: source.atk, def: source.def, text: source.effect_text ?? "", archetype: source.archetype ?? undefined,
      formats: [], genesysPoints: revision && source.genesys_revision === revision ? source.genesys_points ?? undefined : undefined,
      views, url: "",
    };
    if (engineCard) {
      const shapeKey = `${engineCard.type}:${engineCard.race ?? shape.monsterType}:${engineCard.attribute ?? card.attribute}`;
      let engineShape = engineTypes.get(shapeKey);
      const adapted = engineShape ? undefined : engineInsightCard({
        code: canonicalCode, canonicalPasscode: canonicalCode, name: source.name,
        type: engineCard.type,
        race: engineCard.race === undefined ? card.monsterType ?? "" : CARD_RACES.find(race => race.bit === engineCard.race)?.label ?? "",
        attribute: engineCard.attribute === undefined ? CARD_ATTRIBUTES.find(attribute => attribute.label === card.attribute)?.bit ?? 0 : engineCard.attribute,
        level: (engineCard.level ?? source.level ?? 0) & 0xff,
        attack: engineCard.atk ?? source.atk ?? -1, defense: engineCard.def ?? source.def ?? -1,
        description: source.effect_text || engineCard.desc || "", setcodes: [], alias: engineCard.alias,
        lscale: ((engineCard.level ?? 0) >>> 24) & 0xff, rscale: ((engineCard.level ?? 0) >>> 16) & 0xff,
        arrows: 0, ot: 0,
      }, undefined, views);
      if (!engineShape) {
        engineShape = { kind: adapted!.kind, subtypes: adapted!.subtypes, monsterType: adapted!.monsterType, attribute: adapted!.attribute };
        engineTypes.set(shapeKey, engineShape);
      }
      const level = (engineCard.level ?? source.level ?? 0) & 0xff;
      const membershipKey = engineCard.setcode ?? "";
      if (!memberships.has(membershipKey)) {
        const membership = setcodes(engineCard);
        let name: string | undefined;
        if (membership.length) for (const [code, label] of archetypes()) if (inArchetype(membership, code)) { name = label; break; }
        memberships.set(membershipKey, name);
      }
      const archetype = card.archetype ?? memberships.get(membershipKey);
      Object.assign(card, engineShape, {
        level: engineCard.type & (0x800000 | 0x4000000) ? undefined : level,
        rank: engineCard.type & 0x800000 ? level : undefined, linkRating: engineCard.type & 0x4000000 ? level : undefined,
        atk: (engineCard.atk ?? source.atk ?? -1) >= 0 ? engineCard.atk ?? source.atk : null,
        def: (engineCard.def ?? source.def ?? -1) >= 0 ? engineCard.def ?? source.def : null,
        text: source.effect_text || engineCard.desc || "", archetype, typeLine: source.type, genesysPoints: card.genesysPoints });
      if (engineCard.level === undefined && source.level == null) {
        card.level = undefined; card.rank = undefined; card.linkRating = undefined;
      }
    }
    const dates = joined ? row as SuggestionRow : release.get(canonicalCode);
    if (dates?.tcg_date) card.tcgDate = dates.tcg_date;
    if (dates?.ocg_date) card.ocgDate = dates.ocg_date;
    return { card, ...(tagged?.tags_json ? { tags: JSON.parse(tagged.tags_json) as CardTags } : {}) };
  };
  let suggestionRows: Database.Statement<[], SuggestionRow> | undefined;
  const suggestionStream = () => {
    if (suggestionRows) return suggestionRows;
    const fields = `c.ygoprodeck_id,c.name,c.type,c.frame_type,c.effect_text,c.attribute,c.level,c.atk,c.def,c.archetype,c.genesys_points,c.genesys_revision,
      t.tags_json,t.popularity,r.tcg_date,r.ocg_date,a.card_id AS artwork_parent`;
    // Disjoint indexed branches let SQLite merge by passcode without a full candidate snapshot.
    // Date-only rows are needed for engine cards absent from both display cache and tags.
    // Artwork IDs already have display rows through the card_artworks foreign key.
    suggestionRows = db.prepare(`
      SELECT t.passcode AS passcode,${fields} FROM card_tags t
        LEFT JOIN card_catalog c ON c.ygoprodeck_id=t.passcode
        LEFT JOIN card_release r ON r.passcode=t.passcode
        LEFT JOIN card_artworks a ON a.artwork_id=t.passcode
      UNION ALL
      SELECT c.ygoprodeck_id AS passcode,${fields} FROM card_catalog c
        LEFT JOIN card_tags t ON t.passcode=c.ygoprodeck_id
        LEFT JOIN card_release r ON r.passcode=c.ygoprodeck_id
        LEFT JOIN card_artworks a ON a.artwork_id=c.ygoprodeck_id
        WHERE t.passcode IS NULL
      UNION ALL
      SELECT r.passcode AS passcode,${fields} FROM card_release r
        LEFT JOIN card_catalog c ON c.ygoprodeck_id=r.passcode
        LEFT JOIN card_tags t ON t.passcode=r.passcode
        LEFT JOIN card_artworks a ON a.artwork_id=r.passcode
        WHERE c.ygoprodeck_id IS NULL AND t.passcode IS NULL AND a.artwork_id IS NULL
      ORDER BY passcode`);
    return suggestionRows;
  };
  const cachedAliasSources = () => {
    const sources = new Map<number, number>();
    const consider = (code: number, initialEngine?: EngineRow) => {
      const canonicalCode = canonical(code, initialEngine);
      if (canonicalCode === code || metadata.get(canonicalCode) || !metadata.get(code)) return;
      // The original cached-card scan excludes known artwork children entirely.
      const parent = artwork.get(code)?.card_id;
      if (parent !== undefined && parent !== code) return;
      sources.set(canonicalCode, Math.min(code, sources.get(canonicalCode) ?? code));
    };
    // Only exceptional identities need reverse lookup. Keep passcodes, never candidate/tag records.
    if (engineAliases) for (const row of engineAliases.iterate()) consider(row.id, row);
    for (const code of remaps.keys()) consider(code);
    return sources;
  };
  return {
    canonical: (raw: number): number => canonical(raw),
    /** Startup readers can fold uncached engine artworks and legacy remaps too. */
    *identityPasscodes(): Generator<number> {
      yield* remaps.keys();
      if (engineFind) for (const row of engine!.prepare<[], { id: number }>("SELECT id FROM datas").iterate()) yield row.id;
    },
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
        const engineCard = engineFind?.get(row.ygoprodeck_id);
        const candidate = normalize(row, canonical(row.ygoprodeck_id, engineCard), engineCard);
        if (!seen.has(candidate.card.id)) { seen.add(candidate.card.id); yield candidate; }
      }
    },
    /** Suggestions must also see public engine cards absent from the lazy display cache. */
    *suggestionCandidates(pool?: readonly number[]): Generator<Candidate> {
      if (pool !== undefined) { yield* this.candidates(pool); return; }
      const cachedSources = cachedAliasSources();
      const application = suggestionStream().iterate();
      const engineRows = engineStream?.iterate();
      let app = application.next(), current = engineRows?.next();
      // Only dangling artwork/remap targets need deduplication; ordinary catalog IDs stream once.
      const exceptional = new Set<number>();
      try {
        while (!app.done || current && !current.done) {
          const code = Math.min(app.done ? Infinity : app.value.passcode, current?.done === false ? current.value.id : Infinity);
          const row = !app.done && app.value.passcode === code ? app.value : undefined;
          const engineCard = current?.done === false && current.value.id === code ? current.value : undefined;
          if (row) app = application.next();
          if (engineCard) current = engineRows!.next();
          if (exceptional.has(code) || (!engineCard && row?.ygoprodeck_id == null)) continue;
          const canonicalCode = row?.artwork_parent != null && row.artwork_parent !== code || remaps.has(code) || engineCard?.alias
            ? canonical(code, engineCard) : code;
          if (canonicalCode !== code) {
            // A real canonical row appears in one of these streams, so let it supply the metadata.
            if (metadata.get(canonicalCode) || engineFind?.get(canonicalCode)) continue;
            if (row?.ygoprodeck_id == null || exceptional.has(canonicalCode)) continue;
            exceptional.add(canonicalCode);
            yield normalize(row, canonicalCode, engineCard);
            continue;
          }
          const cachedSource = cachedSources.get(code);
          if (cachedSource !== undefined) {
            const source = metadata.get(cachedSource);
            if (source) { yield normalize(source, code, engineCard); continue; }
          }
          const source = row?.ygoprodeck_id != null ? row : {
            ygoprodeck_id: code, name: engineCard!.name, type: "", frame_type: "",
            effect_text: engineCard!.desc ?? "", attribute: null, level: null, atk: null, def: null,
            archetype: null, genesys_points: null, genesys_revision: null,
            tags_json: row?.tags_json ?? null, popularity: row?.popularity ?? null,
            tcg_date: row?.tcg_date ?? null, ocg_date: row?.ocg_date ?? null,
          };
          yield normalize(source, code, engineCard, true);
        }
      } finally {
        application.return?.();
        engineRows?.return?.();
      }
    },
    /** Full canonical suggestion universe, including cards absent from the lazy display cache. */
    suggestionCount(): number {
      const application = db.prepare<[], { passcode: number; artwork_parent: number | null }>(`SELECT c.ygoprodeck_id AS passcode,a.card_id AS artwork_parent
        FROM card_catalog c LEFT JOIN card_artworks a ON a.artwork_id=c.ygoprodeck_id ORDER BY c.ygoprodeck_id`).iterate();
      const engineRows = engineIdentities?.iterate();
      let app = application.next(), current = engineRows?.next(), count = 0;
      const exceptional = new Set<number>();
      try {
        while (!app.done || current && !current.done) {
          const code = Math.min(app.done ? Infinity : app.value.passcode, current?.done === false ? current.value.id : Infinity);
          const row = !app.done && app.value.passcode === code ? app.value : undefined;
          const engineCard = current?.done === false && current.value.id === code ? current.value : undefined;
          if (row) app = application.next();
          if (engineCard) current = engineRows!.next();
          if (exceptional.has(code)) continue;
          const canonicalCode = row?.artwork_parent != null && row.artwork_parent !== code || remaps.has(code) || engineCard?.alias
            ? canonical(code, engineCard) : code;
          if (canonicalCode !== code) {
            if (metadata.get(canonicalCode) || engineFind?.get(canonicalCode) || !row || exceptional.has(canonicalCode)) continue;
            exceptional.add(canonicalCode);
          }
          count++;
        }
      } finally {
        application.return?.();
        engineRows?.return?.();
      }
      return count;
    },
    close() { engine?.close(); },
  };
}

export type InsightCatalog = ReturnType<typeof createInsightCatalog>;
