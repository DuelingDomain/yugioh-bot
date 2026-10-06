import Database from "better-sqlite3";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { CardDataGapCard, CardDataGapStatus, CatalogSetStatus, EngineDataSource, LocalCardDataStatus } from "@yugidraft/shared/types";

export const ENGINE_SOURCE_REPOSITORIES: Record<EngineDataSource, string> = {
  database: "ProjectIgnis/BabelCDB", scripts: "ProjectIgnis/CardScripts", strings: "ProjectIgnis/Distribution",
};
interface EngineCard { id: number; alias: number; name: string; type: number }
interface CatalogCard { id: number; name: string; cardSets: Array<{ set_name: string; set_code?: string }> }
interface ArtworkFamily { cardId: number; artworkId: number }

/** One union/index pass over both pools; only the final missing list is sorted. */
export function computeCardDataGap(
  engine: readonly EngineCard[], catalog: readonly CatalogCard[],
  artworks: readonly ArtworkFamily[], sets: readonly CatalogSetStatus[],
): CardDataGapStatus {
  const parents = new Map<number, number>();
  const root = (id: number): number => {
    let current = id;
    while (parents.has(current) && parents.get(current) !== current) current = parents.get(current)!;
    let next = id;
    while (parents.has(next) && parents.get(next) !== current) {
      const previous = parents.get(next)!; parents.set(next, current); next = previous;
    }
    return current;
  };
  const union = (a: number, b: number) => {
    const left = root(a), right = root(b);
    if (left !== right) parents.set(Math.max(left, right), Math.min(left, right));
  };
  const engineIndex = new Map(engine.map(card => [card.id, card]));
  for (const card of engine) {
    const original = engineIndex.get(card.alias);
    // Match the engine/catalog artwork rule. Name-treatment aliases (for example
    // Harpie variants) and different card types remain separate playable cards.
    if (original && card.name && card.type === original.type
      && card.name.trim().toLowerCase() === original.name.trim().toLowerCase()) union(card.id, original.id);
  }
  for (const art of artworks) union(art.cardId, art.artworkId);
  const engineFamilies = new Set(engine.map(card => root(card.id)));
  const catalogFamilies = new Set<number>();
  const mains = new Set(artworks.map(art => art.cardId));
  const setIndex = new Map(sets.map(set => [set.name, set]));
  const missing = new Map<number, CardDataGapCard>();
  for (const card of catalog) {
    const family = root(card.id); catalogFamilies.add(family);
    if (engineFamilies.has(family)) continue;
    let newest: CardDataGapCard = { id: card.id, name: card.name, setCode: null, setReleaseDate: null };
    for (const printing of card.cardSets) {
      const set = setIndex.get(printing.set_name);
      const candidate = { setCode: printing.set_code ?? set?.code ?? null, setReleaseDate: set?.releaseDate ?? null };
      const newer = (candidate.setReleaseDate ?? "") > (newest.setReleaseDate ?? "");
      const sameDateWithCode = candidate.setReleaseDate === newest.setReleaseDate && newest.setCode === null && candidate.setCode !== null;
      if (newer || sameDateWithCode) newest = { ...newest, ...candidate };
    }
    const previous = missing.get(family);
    if (!previous) { missing.set(family, newest); continue; }
    const preferCard = !mains.has(previous.id) && (mains.has(card.id) || card.id < previous.id);
    const representative = preferCard ? newest : previous;
    const printing = (newest.setReleaseDate ?? "") > (previous.setReleaseDate ?? "") ? newest : previous;
    missing.set(family, { ...representative, setCode: printing.setCode, setReleaseDate: printing.setReleaseDate });
  }
  const cards = [...missing.values()].sort((a, b) => (b.setReleaseDate ?? "").localeCompare(a.setReleaseDate ?? "") || a.id - b.id);
  let reverse = 0;
  for (const family of engineFamilies) if (!catalogFamilies.has(family)) reverse++;
  return { catalogMissingFromEngineCount: cards.length, catalogMissingFromEngine: cards, engineMissingFromCatalogCount: reverse };
}

function cdbProvenance(manifest: unknown): string[] {
  const files = new Set<string>();
  // Accept both lists and filename-keyed integrity maps, including future release CDB provenance.
  const visit = (value: unknown) => {
    if (typeof value === "string" && /(?:^|\/)[^/]+\.cdb$/i.test(value)) files.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) { visit(key); visit(child); }
  };
  visit(manifest);
  if (!files.size) files.add("cards.cdb");
  return [...files].sort();
}

function cardSets(json: string): CatalogCard["cardSets"] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((set): set is CatalogCard["cardSets"][number] =>
      !!set && typeof set === "object" && typeof set.set_name === "string") : [];
  } catch { return []; }
}

/** Each host owns one snapshot, invalidated by the bundle identity and durable catalog revision. */
export function createLocalCardDataStatus(db: Database.Database, dataDirectory: string): () => LocalCardDataStatus {
  let cached: { key: string; value: LocalCardDataStatus } | undefined;
  return db.transaction(() => {
    const path = join(dataDirectory, "manifest.json");
    const manifest = JSON.parse(readFileSync(path, "utf8")) as {
      bundleVersion: string; preparedAt?: string; sources?: Record<string, unknown>;
    };
    if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
    const { revision } = db.prepare("select revision from card_catalog_revision where id = 1").get() as { revision: number };
    const key = `${manifest.bundleVersion}:${revision}`;
    if (cached?.key === key) return cached.value;
    const sqlite = new Database(join(dataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
    let engine: EngineCard[];
    try {
      engine = sqlite.prepare("select d.id, d.alias, d.type, coalesce(t.name, '') as name from datas d left join texts t on t.id = d.id").all() as EngineCard[];
    } finally { sqlite.close(); }
    const rows = db.prepare("select ygoprodeck_id as id, name, card_sets_json, cached_at from card_catalog").all() as Array<{ id: number; name: string; card_sets_json: string; cached_at: string }>;
    const sets = db.prepare("select set_name as name, set_code as code, release_date as releaseDate from card_sets").all() as CatalogSetStatus[];
    const artworks = db.prepare("select card_id as cardId, artwork_id as artworkId from card_artworks").all() as ArtworkFamily[];
    const { syncedAt } = db.prepare("select max(synced_at) as syncedAt from card_sets").get() as { syncedAt: string | null };
    const latestRelease = sets.reduce((date, set) => (set.releaseDate ?? "") > date ? set.releaseDate! : date, "");
    const preparedAt = typeof manifest.preparedAt === "string" && Number.isFinite(Date.parse(manifest.preparedAt)) ? manifest.preparedAt : null;
    const value: LocalCardDataStatus = {
      engine: {
        bundleVersion: manifest.bundleVersion,
        preparedAt: preparedAt ?? statSync(path).mtime.toISOString(),
        preparedAtSource: preparedAt ? "manifest" : "manifest-mtime",
        sources: Object.fromEntries(Object.entries(ENGINE_SOURCE_REPOSITORIES).map(([source, repository]) => [source, {
          repository, pinnedSha: typeof manifest.sources?.[source] === "string" ? manifest.sources[source] : null, pinnedCommitDate: null,
        }])) as LocalCardDataStatus["engine"]["sources"],
        cardCount: engine.length, cdbFiles: cdbProvenance(manifest),
      },
      catalog: {
        lastSuccessfulSyncAt: syncedAt, lastCardCachedAt: rows.reduce<string | null>((date, row) => !date || row.cached_at > date ? row.cached_at : date, null),
        totalCards: rows.length, revision,
        newestSets: latestRelease ? sets.filter(set => set.releaseDate === latestRelease).sort((a, b) => a.name.localeCompare(b.name)) : [],
      },
      gap: computeCardDataGap(engine, rows.map(row => ({ id: row.id, name: row.name, cardSets: cardSets(row.card_sets_json) })), artworks, sets),
    };
    cached = { key, value };
    return value;
  });
}
