import Database from "better-sqlite3";
import { createPrereleaseDateLookup } from "./card-release-dates.js";
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
  id: number; alias: number; type: number; name: string; desc?: string; ot?: number;
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
type EngineTuple = [id: number, alias: number, type: number, name: string, desc: string, setcode: string,
  atk: number, def: number, level: number, race: number, attribute: number, ot?: number];
type SuggestionTuple = [passcode: number, cachedId: number | null, name: string | null, type: string | null, frame: string | null,
  text: string | null, attribute: string | null, level: number | null, atk: number | null, def: number | null,
  archetype: string | null, points: number | null, revision: string | null, tags: string | null, popularity: number | null,
  tcgDate: string | null, ocgDate: string | null, artworkParent: number | null];
const engineObject = (row: EngineTuple): EngineRow => ({ id: row[0], alias: row[1], type: row[2], name: row[3], desc: row[4], setcode: row[5],
  atk: row[6], def: row[7], level: row[8], race: row[9], attribute: row[10], ot: row[11] });
const suggestionObject = (row: SuggestionTuple): SuggestionRow => ({ passcode: row[0], ygoprodeck_id: row[1]!, name: row[2]!, type: row[3]!, frame_type: row[4]!,
  effect_text: row[5], attribute: row[6], level: row[7], atk: row[8], def: row[9], archetype: row[10], genesys_points: row[11], genesys_revision: row[12],
  tags_json: row[13], popularity: row[14], tcg_date: row[15], ocg_date: row[16], artwork_parent: row[17] });

type JoinedSuggestionTuple = [id: number, alias: number | null, type: number | null, name: string, text: string, setcode: string | null,
  atk: number | null, def: number | null, level: number | null, race: number | null, attribute: number | null,
  cachedId: number | null, cachedType: string | null, cachedFrame: string | null, archetype: string | null,
  points: number | null, revision: string | null, tags: string | null, popularity: number | null,
  tcgDate: string | null, ocgDate: string | null, artworkParent: number | null, engineName: string | null, ot: number | null];
const codeValid = (value: number) => Number.isInteger(value) && value > 0 && value <= 0xffffffff;
const raceNames = new Map<number, string>(CARD_RACES.map(({ bit, label }) => [bit, label]));
const attributeNames = new Map<number, Card["attribute"]>(CARD_ATTRIBUTES.map(({ bit, label }) => [bit, label]));

/** One operation owns this read-only engine handle. No catalog or tag snapshot is materialized. */
export function createInsightCatalog(db: Database.Database, dataDirectory = deckEngineDataDirectory(db.name)) {
  const artwork = db.prepare<[number], { card_id: number }>("SELECT card_id FROM card_artworks WHERE artwork_id=?");
  const metadata = db.prepare<[number], CatalogRow>("SELECT * FROM card_catalog WHERE ygoprodeck_id=?");
  const prereleaseDate = createPrereleaseDateLookup(db);
  const namedMetadata = db.prepare<[string], { ygoprodeck_id: number }>("SELECT ygoprodeck_id FROM card_catalog WHERE lower(trim(name))=? ORDER BY ygoprodeck_id LIMIT 1");
  const release = db.prepare<[number], { tcg_date: string | null; ocg_date: string | null }>("SELECT tcg_date,ocg_date FROM card_release WHERE passcode=?");
  const tags = db.prepare<[number], { tags_json: string; popularity: number }>("SELECT tags_json,popularity FROM card_tags WHERE passcode=?");
  const readers = { artwork, metadata, release, tags };
  type Readers = typeof readers;
  const revision = (db.prepare("SELECT revision FROM genesys_points_meta WHERE id=1").get() as { revision: string } | undefined)?.revision;
  const remaps = loadCardPasscodeRemaps(dataDirectory);
  // Printed type shapes repeat across the catalog. Keep these small shapes for
  // this read, rather than rebuilding dozens of regular expressions per card.
  const printedTypes = new Map<string, Pick<Card, "kind" | "subtypes" | "monsterType">>();
  const engineTypes = new Map<string, Pick<Card, "kind" | "subtypes" | "monsterType" | "attribute">>();
  const memberships = new Map<string, string[]>();
  const printedLevelKeys = new Map<string, "rank" | "linkRating" | "level">();
  const fastTypes = new Map<number, Pick<Card, "kind" | "subtypes">>();
  const enginePath = join(dataDirectory, "cards.cdb");
  const engine = existsSync(enginePath) ? new Database(enginePath, { readonly: true, fileMustExist: true }) : undefined;
  // This handle lives for one operation and scans forward. The driver's 16 MiB
  // default would retain most of the engine database after every full scan.
  engine?.pragma("cache_size=-256");
  let engineHasPool = false;
  let engineFind: Database.Statement<[number], EngineRow> | undefined;
  let engineNamed: Database.Statement<[string], { id: number }> | undefined;
  let engineStream: Database.Statement<[], EngineRow> | undefined;
  let engineIdentities: Database.Statement<[], EngineRow> | undefined;
  let engineAliases: Database.Statement<[], EngineRow> | undefined;
  let engineTuples: Database.Statement<[], EngineTuple> | undefined;
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
  const memberNames = (setcode: string | undefined): string[] => {
    const key = setcode ?? "";
    let names = memberships.get(key);
    if (!names) {
      const membership = setcodes({ setcode } as EngineRow);
      names = membership.length ? [...archetypes()].filter(([code]) => inArchetype(membership, code)).map(([, label]) => label) : [];
      memberships.set(key, names);
    }
    return names;
  };
  if (engine) {
    try {
      const columns = new Set((engine.prepare("PRAGMA table_info(datas)").all() as { name: string }[]).map(row => row.name));
      engineHasPool = columns.has("ot");
      const texts = new Set((engine.prepare("PRAGMA table_info(texts)").all() as { name: string }[]).map(row => row.name));
      if (columns.has("type") && texts.has("name")) {
        const select = `SELECT d.id,${columns.has("alias") ? "d.alias" : "0 AS alias"},d.type,t.name${texts.has("desc") ? ",t.desc" : ""}${columns.has("setcode") ? ",CAST(d.setcode AS TEXT) AS setcode" : ""}${["atk", "def", "level", "race", "attribute"].filter(field => columns.has(field)).map(field => `,d.${field}`).join("")},${engineHasPool ? "d.ot" : "0 AS ot"} FROM datas d JOIN texts t USING(id)`;
        engineFind = engine.prepare(`${select} WHERE d.id=?`);
        engineNamed = engine.prepare(`SELECT d.id FROM datas d JOIN texts t USING(id) WHERE lower(trim(t.name))=? ORDER BY d.id LIMIT 1`);
        engineStream = engine.prepare(`${select} ORDER BY d.id`);
        engineIdentities = engine.prepare(`SELECT d.id,${columns.has("alias") ? "d.alias" : "0 AS alias"},d.type,t.name FROM datas d JOIN texts t USING(id) ORDER BY d.id`);
        if (columns.has("alias")) engineAliases = engine.prepare(`${select} WHERE d.alias<>0 ORDER BY d.id`);
        if (texts.has("desc") && ["alias", "setcode", "atk", "def", "level", "race", "attribute"].every(field => columns.has(field))) {
          engineTuples = engine.prepare<[], EngineTuple>(`${select} ORDER BY d.id`).raw();
        }
      }
    } catch (error) { engine.close(); throw error; }
  }
  const canonical = (raw: number, initialEngine?: EngineRow, sourceReaders = readers): number => {
    const seen = new Set<number>();
    let code = raw;
    while (codeValid(code) && !seen.has(code)) {
      seen.add(code);
      const known = sourceReaders.artwork.get(code)?.card_id;
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
  const normalize = (row: CatalogRow, canonicalCode = canonical(row.ygoprodeck_id), initialEngine?: EngineRow, joined = false, sourceReaders = readers): Candidate => {
    // A canonical row wins over alternate metadata and receives canonical tags.
    const source = canonicalCode === row.ygoprodeck_id ? row : sourceReaders.metadata.get(canonicalCode) ?? row;
    const tagged = canonicalCode === row.ygoprodeck_id && row.tags_json !== undefined ? row : sourceReaders.tags.get(canonicalCode);
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
        arrows: 0, ot: engineCard.ot ?? 0, prerelease: !!((engineCard.ot ?? 0) & 0x100),
      }, undefined, views);
      if (!engineShape) {
        engineShape = { kind: adapted!.kind, subtypes: adapted!.subtypes, monsterType: adapted!.monsterType, attribute: adapted!.attribute };
        engineTypes.set(shapeKey, engineShape);
      }
      const level = (engineCard.level ?? source.level ?? 0) & 0xff;
      const names = memberNames(engineCard.setcode);
      const archetype = card.archetype ?? names[0];
      Object.assign(card, engineShape, {
        level: engineCard.type & (0x800000 | 0x4000000) ? undefined : level,
        rank: engineCard.type & 0x800000 ? level : undefined, linkRating: engineCard.type & 0x4000000 ? level : undefined,
        atk: (engineCard.atk ?? source.atk ?? -1) >= 0 ? engineCard.atk ?? source.atk : null,
        def: (engineCard.def ?? source.def ?? -1) >= 0 ? engineCard.def ?? source.def : null,
        text: source.effect_text || engineCard.desc || "", archetype, archetypes: names, typeLine: source.type, genesysPoints: card.genesysPoints });
      if ((engineCard.ot ?? 0) & 0x100) card.prerelease = true;
      if (engineCard.level === undefined && source.level == null) {
        card.level = undefined; card.rank = undefined; card.linkRating = undefined;
      }
    }
    if (engineCard && engineHasPool) card.dateSearchEligible = (engineCard.ot! & 3) !== 0 && (engineCard.ot! & 0x600) === 0;
    const dates = joined ? row as SuggestionRow : sourceReaders.release.get(canonicalCode);
    if (dates?.tcg_date) card.tcgDate = dates.tcg_date;
    if (dates?.ocg_date) card.ocgDate = dates.ocg_date;
    Object.assign(card, prereleaseDate(canonicalCode, card, card.prerelease));
    return { card, ...(tagged?.tags_json ? { tags: JSON.parse(tagged.tags_json) as CardTags } : {}) };
  };
  const normalizeEngine = (row: SuggestionTuple | undefined, engineCard: EngineTuple): Candidate => {
    const cached = row?.[1] != null;
    const type = engineCard[2];
    let shape = fastTypes.get(type);
    if (!shape) {
      const adapted = engineInsightCard({ code: engineCard[0], name: "", type, race: "", attribute: 0,
        level: 0, attack: 0, defense: 0, description: "", setcodes: [], alias: 0, lscale: 0, rscale: 0, arrows: 0, ot: 0 });
      shape = { kind: adapted.kind, subtypes: adapted.subtypes };
      fastTypes.set(type, shape);
    }
    const names = memberNames(engineCard[5]);
    const level = engineCard[8] & 0xff;
    const card: Card = {
      id: engineCard[0], name: cached ? row![2]! : engineCard[3], kind: shape.kind, typeLine: cached ? row![3]! : "", subtypes: shape.subtypes,
      monsterType: raceNames.get(engineCard[9]), attribute: attributeNames.get(engineCard[10]),
      level: type & (0x800000 | 0x4000000) ? undefined : level,
      atk: engineCard[6] >= 0 ? engineCard[6] : null, def: engineCard[7] >= 0 ? engineCard[7] : null,
      text: (cached && row![5]) || engineCard[4] || "", archetype: cached && row![10] != null ? row![10]! : names[0], archetypes: names,
      formats: [], genesysPoints: revision && cached && row![12] === revision ? row![11] ?? undefined : undefined,
      views: row?.[14] ?? 0, url: "",
      rank: type & 0x800000 ? level : undefined, linkRating: type & 0x4000000 ? level : undefined,
    };
    if (row?.[15]) card.tcgDate = row[15];
    if (row?.[16]) card.ocgDate = row[16];
    if (engineHasPool) card.dateSearchEligible = (engineCard[11]! & 3) !== 0 && (engineCard[11]! & 0x600) === 0;
    if ((engineCard[11] ?? 0) & 0x100) card.prerelease = true;
    Object.assign(card, prereleaseDate(card.id, card, card.prerelease));
    return row?.[13] ? { card, tags: JSON.parse(row[13]) as CardTags } : { card };
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
  const cachedAliasSources = (sourceReaders = readers) => {
    const sources = new Map<number, number>();
    const consider = (code: number, initialEngine?: EngineRow) => {
      const canonicalCode = canonical(code, initialEngine, sourceReaders);
      if (canonicalCode === code || sourceReaders.metadata.get(canonicalCode) || !sourceReaders.metadata.get(code)) return;
      // The original cached-card scan excludes known artwork children entirely.
      const parent = sourceReaders.artwork.get(code)?.card_id;
      if (parent !== undefined && parent !== code) return;
      sources.set(canonicalCode, Math.min(code, sources.get(canonicalCode) ?? code));
    };
    // Only exceptional identities need reverse lookup. Keep passcodes, never candidate/tag records.
    if (engineAliases) for (const row of engineAliases.iterate()) consider(row.id, row);
    for (const code of remaps.keys()) consider(code);
    return sources;
  };
  let suggestionTuples: Database.Statement<[], SuggestionTuple> | undefined;
  function* completeSuggestionCandidates(): Generator<Candidate> {
    const cachedSources = cachedAliasSources();
    suggestionTuples ??= db.prepare<[], SuggestionTuple>(suggestionStream().source).raw();
    const application = suggestionTuples.iterate(), engineRows = engineTuples!.iterate();
    let app = application.next(), current = engineRows.next();
    const exceptional = new Set<number>();
    try {
      while (!app.done || !current.done) {
        const code = Math.min(app.done ? Infinity : app.value[0], current.done ? Infinity : current.value[0]);
        const row = !app.done && app.value[0] === code ? app.value : undefined;
        const engineCard = !current.done && current.value[0] === code ? current.value : undefined;
        if (row) app = application.next();
        if (engineCard) current = engineRows.next();
        if (exceptional.has(code) || (!engineCard && row?.[1] == null)) continue;
        const canonicalCode = row?.[17] != null && row[17] !== code || remaps.has(code) || engineCard?.[1]
          ? canonical(code, engineCard && engineObject(engineCard)) : code;
        if (canonicalCode !== code) {
          if (metadata.get(canonicalCode) || engineFind?.get(canonicalCode) || row?.[1] == null || exceptional.has(canonicalCode)) continue;
          exceptional.add(canonicalCode);
          yield normalize(suggestionObject(row), canonicalCode, engineCard && engineObject(engineCard));
          continue;
        }
        const cachedSource = cachedSources.get(code);
        if (cachedSource !== undefined) {
          const source = metadata.get(cachedSource);
          if (source) { yield normalize(source, code, engineCard && engineObject(engineCard)); continue; }
        }
        if (engineCard && engineCard[6] != null && engineCard[7] != null && engineCard[8] != null && engineCard[9] != null && engineCard[10] != null
          && (!(row?.[3] || row?.[4]) || !/(?:^|[ /_])(?:xyz|link)(?:$|[ /_])/i.test(`${row[3]} ${row[4]}`.replaceAll("-", "_")))) {
          yield normalizeEngine(row, engineCard);
          continue;
        }
        const object = engineCard && engineObject(engineCard);
        const source = row?.[1] != null ? suggestionObject(row) : {
          ygoprodeck_id: code, name: object!.name, type: "", frame_type: "", effect_text: object!.desc ?? "",
          attribute: null, level: null, atk: null, def: null, archetype: null, genesys_points: null, genesys_revision: null,
          tags_json: row?.[13] ?? null, popularity: row?.[14] ?? null, tcg_date: row?.[15] ?? null, ocg_date: row?.[16] ?? null,
        };
        yield normalize(source, code, object, true);
      }
    } finally { application.return?.(); engineRows.return?.(); }
  }
  let joinedRows: Database.Statement<[], JoinedSuggestionTuple> | undefined;
  let attachedReaders: Readers | undefined;
  const attachedSuggestionStream = () => {
    if (joinedRows) return joinedRows;
    // The main handle is already SQLITE_OPEN_READONLY. Its attachments inherit
    // that mode; query_only additionally prevents writes through any schema.
    engine!.pragma("query_only=ON");
    engine!.prepare("ATTACH DATABASE ? AS insight_app").run(db.name);
    engine!.pragma("insight_app.cache_size=-128");
    attachedReaders = {
      artwork: engine!.prepare("SELECT card_id FROM insight_app.card_artworks WHERE artwork_id=?"),
      metadata: engine!.prepare("SELECT * FROM insight_app.card_catalog WHERE ygoprodeck_id=?"),
      release: engine!.prepare("SELECT tcg_date,ocg_date FROM insight_app.card_release WHERE passcode=?"),
      tags: engine!.prepare("SELECT tags_json,popularity FROM insight_app.card_tags WHERE passcode=?"),
    } as Readers;
    // Return effective printed fields once, avoiding duplicate engine/cache text
    // strings across the native boundary. Alias comparisons retain engine names.
    const applicationFields = `c.ygoprodeck_id,c.type,c.frame_type,c.archetype,c.genesys_points,c.genesys_revision,
      tag.tags_json,tag.popularity,r.tcg_date,r.ocg_date,a.card_id`;
    joinedRows = engine!.prepare<[], JoinedSuggestionTuple>(`
      SELECT d.id,d.alias,d.type,CASE WHEN c.ygoprodeck_id IS NULL THEN t.name ELSE c.name END,
        COALESCE(NULLIF(c.effect_text,''),t.desc,''),CAST(d.setcode AS TEXT),d.atk,d.def,d.level,d.race,d.attribute,
        ${applicationFields},CASE WHEN d.alias<>0 THEN t.name END,${engineHasPool ? "d.ot" : "0"}
      FROM datas d JOIN texts t USING(id)
        LEFT JOIN insight_app.card_catalog c ON c.ygoprodeck_id=d.id
        LEFT JOIN insight_app.card_tags tag ON tag.passcode=d.id
        LEFT JOIN insight_app.card_release r ON r.passcode=d.id
        LEFT JOIN insight_app.card_artworks a ON a.artwork_id=d.id
      UNION ALL
      SELECT c.ygoprodeck_id,NULL,NULL,c.name,COALESCE(c.effect_text,''),NULL,NULL,NULL,NULL,NULL,NULL,
        ${applicationFields},NULL,NULL
      FROM insight_app.card_catalog c
        LEFT JOIN insight_app.card_tags tag ON tag.passcode=c.ygoprodeck_id
        LEFT JOIN insight_app.card_release r ON r.passcode=c.ygoprodeck_id
        LEFT JOIN insight_app.card_artworks a ON a.artwork_id=c.ygoprodeck_id
      WHERE NOT EXISTS(SELECT 1 FROM datas d JOIN texts t USING(id) WHERE d.id=c.ygoprodeck_id)
      ORDER BY 1`).raw();
    return joinedRows;
  };
  const normalizeJoinedEngine = (row: JoinedSuggestionTuple): Candidate => {
    const type = row[2]!;
    let shape = fastTypes.get(type);
    if (!shape) {
      const adapted = engineInsightCard({ code: row[0], name: "", type, race: "", attribute: 0,
        level: 0, attack: 0, defense: 0, description: "", setcodes: [], alias: 0, lscale: 0, rscale: 0, arrows: 0, ot: 0 });
      shape = { kind: adapted.kind, subtypes: adapted.subtypes };
      fastTypes.set(type, shape);
    }
    const names = memberNames(row[5] ?? undefined);
    const level = row[8]! & 0xff;
    // Legacy normalization inserts its printed level key before applying engine
    // stats. Preserve that property order for serialized candidate parity too.
    const printedType = `${row[12] ?? ""}:${row[13] ?? ""}`;
    let printedLevelKey = printedLevelKeys.get(printedType);
    if (!printedLevelKey) {
      const printed = `${row[12] ?? ""} ${row[13] ?? ""}`.toLowerCase().replaceAll("-", "_");
      printedLevelKey = /(?:^|[ /_])xyz(?:$|[ /_])/.test(printed) ? "rank" : /(?:^|[ /_])link(?:$|[ /_])/.test(printed) ? "linkRating" : "level";
      printedLevelKeys.set(printedType, printedLevelKey);
    }
    const finalLevel = type & (0x800000 | 0x4000000) ? undefined : level;
    const rank = type & 0x800000 ? level : undefined, linkRating = type & 0x4000000 ? level : undefined;
    const card: Card = {
      id: row[0], name: row[3], kind: shape.kind, typeLine: row[12] ?? "", subtypes: shape.subtypes,
      monsterType: raceNames.get(row[9]!), attribute: attributeNames.get(row[10]!),
      ...(printedLevelKey === "rank" ? { rank } : printedLevelKey === "linkRating" ? { linkRating } : { level: finalLevel }),
      atk: row[6]! >= 0 ? row[6] : null, def: row[7]! >= 0 ? row[7] : null,
      text: row[4], archetype: row[14] ?? names[0], archetypes: names, formats: [],
      genesysPoints: revision && row[16] === revision ? row[15] ?? undefined : undefined,
      views: row[18] ?? 0, url: "",
    };
    card.level = finalLevel; card.rank = rank; card.linkRating = linkRating;
    if (row[19]) card.tcgDate = row[19];
    if (row[20]) card.ocgDate = row[20];
    if (engineHasPool) card.dateSearchEligible = (row[23]! & 3) !== 0 && (row[23]! & 0x600) === 0;
    if ((row[23] ?? 0) & 0x100) card.prerelease = true;
    Object.assign(card, prereleaseDate(card.id, card, card.prerelease));
    return row[17] ? { card, tags: JSON.parse(row[17]) as CardTags } : { card };
  };
  const joinedEngineObject = (row: JoinedSuggestionTuple): EngineRow => ({
    id: row[0], alias: row[1]!, type: row[2]!, name: row[22] ?? row[3], desc: row[4], setcode: row[5] ?? undefined,
    atk: row[6]!, def: row[7]!, level: row[8]!, race: row[9]!, attribute: row[10]!, ot: row[23] ?? undefined,
  });
  function* attachedSuggestionCandidates(): Generator<Candidate> {
    const stream = attachedSuggestionStream();
    engine!.exec("BEGIN");
    let rows: ReturnType<typeof stream.iterate> | undefined;
    try {
      const sourceReaders = attachedReaders!;
      const cachedSources = cachedAliasSources(sourceReaders);
      const exceptional = new Set<number>();
      rows = stream.iterate();
      for (const row of rows) {
        const code = row[0];
        if (exceptional.has(code)) continue;
        const hasEngine = row[2] != null;
        const canonicalCode = row[21] != null && row[21] !== code || remaps.has(code) || row[1]
          ? canonical(code, hasEngine ? joinedEngineObject(row) : undefined, sourceReaders) : code;
        if (canonicalCode !== code) {
          if (sourceReaders.metadata.get(canonicalCode) || engineFind?.get(canonicalCode) || row[11] == null || exceptional.has(canonicalCode)) continue;
          exceptional.add(canonicalCode);
          yield normalize(sourceReaders.metadata.get(code)!, canonicalCode, hasEngine ? joinedEngineObject(row) : undefined, false, sourceReaders);
          continue;
        }
        const cachedSource = cachedSources.get(code);
        if (cachedSource !== undefined) {
          const source = sourceReaders.metadata.get(cachedSource);
          if (source) { yield normalize(source, code, hasEngine ? joinedEngineObject(row) : undefined, false, sourceReaders); continue; }
        }
        if (hasEngine && row[6] != null && row[7] != null && row[8] != null && row[9] != null && row[10] != null) {
          yield normalizeJoinedEngine(row);
          continue;
        }
        const source = sourceReaders.metadata.get(code) ?? {
          ygoprodeck_id: code, name: row[3], type: "", frame_type: "", effect_text: row[4],
          attribute: null, level: null, atk: null, def: null, archetype: null, genesys_points: null, genesys_revision: null,
        };
        yield normalize(source, code, hasEngine ? joinedEngineObject(row) : undefined, false, sourceReaders);
      }
    } finally {
      rows?.return?.();
      engine!.exec("ROLLBACK");
    }
  }
  return {
    canonical: (raw: number): number => canonical(raw),
    /** A recommendation family is not a rules identity: retrains still have separate copy limits. */
    suggestionFamily(candidate: Candidate): number {
      const wrapped = /^(?:Spell|Trap|Monster) Card ["“](.+)["”]$/i.exec(candidate.card.name);
      if (!wrapped) return candidate.card.id;
      const name = wrapped[1]!.trim().toLowerCase();
      const code = engineNamed?.get(name)?.id ?? namedMetadata.get(name)?.ygoprodeck_id;
      if (code === undefined) return candidate.card.id;
      const original = this.candidate(code);
      return original?.card.kind === candidate.card.kind ? original.card.id : candidate.card.id;
    },
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
      if (engineTuples && !db.inTransaction && !engine!.inTransaction && db.name !== ":memory:" && db.name !== "" && existsSync(db.name)) {
        yield* attachedSuggestionCandidates(); return;
      }
      if (engineTuples) { yield* completeSuggestionCandidates(); return; }
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
