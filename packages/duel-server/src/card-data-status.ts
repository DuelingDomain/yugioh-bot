import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogSetStatus, EngineDataSource, LocalCardDataStatus } from "@yugidraft/shared/types";
import { computeCardDataGap, type EngineCard, type GapCatalogCard, type ArtworkFamily } from "./card-data-gap.js";
import { createRecentCardSetCache } from "./recent-card-sets.js";
import { isReleasedDatabaseFile, sortDatabaseFiles } from "./released-database-files.js";
export { computeCardDataGap } from "./card-data-gap.js";

export const ENGINE_SOURCE_REPOSITORIES: Record<EngineDataSource, string> = {
  database: "ProjectIgnis/BabelCDB", scripts: "ProjectIgnis/CardScripts", strings: "ProjectIgnis/Distribution",
};
export interface EngineDataManifest { bundleVersion: string; sources?: Record<string, unknown> }
function cdbProvenance(manifest: EngineDataManifest): string[] {
  if (!manifest.sources || !Object.hasOwn(manifest.sources, "databaseFiles")) return ["cards.cdb"];
  const files = manifest.sources.databaseFiles;
  if (!Array.isArray(files) || !files.includes("cards.cdb") || !files.every(file => typeof file === "string" && isReleasedDatabaseFile(file))) {
    throw new Error("Engine manifest sources.databaseFiles must be a released CDB filename array");
  }
  return sortDatabaseFiles([...new Set(files)]);
}
function cardSets(json: string): GapCatalogCard["cardSets"] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((set): set is GapCatalogCard["cardSets"][number] =>
      !!set && typeof set === "object" && typeof set.set_name === "string"
      && (set.set_code == null || typeof set.set_code === "string")) : [];
  } catch { return []; }
}

/** One startup bundle identity and a >=60s snapshot, even during frequent catalog upserts. */
export function createLocalCardDataStatus(db: Database.Database, dataDirectory: string, options: {
  manifest?: EngineDataManifest; now?: () => number; fetch?: typeof globalThis.fetch;
} = {}) {
  const manifest = options.manifest ?? JSON.parse(readFileSync(join(dataDirectory, "manifest.json"), "utf8")) as EngineDataManifest;
  if (!manifest.bundleVersion) throw new Error("Engine resource manifest has no bundle version");
  const now = options.now ?? Date.now, recent = createRecentCardSetCache(db, options);
  let cached: { at: number; value: LocalCardDataStatus } | undefined;
  let engine: EngineCard[] | undefined;
  const read = () => {
    if (cached && now() - cached.at < 60_000) return cached.value;
    const value = db.transaction((): LocalCardDataStatus => {
      const files = cdbProvenance(manifest);
      if (!engine) {
        // Prepared cards.cdb is the merged base + release databases. The host's
        // startup manifest identifies this installed bundle for its whole lifetime.
        const sqlite = new Database(join(dataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
        try { engine = sqlite.prepare("select d.id, d.alias, d.type, coalesce(t.name, '') as name from datas d left join texts t on t.id = d.id").all() as EngineCard[]; }
        finally { sqlite.close(); }
      }
      const { revision } = db.prepare("select revision from card_catalog_revision where id = 1").get() as { revision: number };
      const rows = db.prepare("select ygoprodeck_id as id, name, type, frame_type as frameType, card_sets_json, cached_at from card_catalog").all() as Array<GapCatalogCard & { card_sets_json: string; cached_at: string }>;
      const sets = db.prepare("select set_name as name, set_code as code, release_date as releaseDate from card_sets").all() as CatalogSetStatus[];
      const artworks = db.prepare("select card_id as cardId, artwork_id as artworkId from card_artworks").all() as ArtworkFamily[];
      const { syncedAt } = db.prepare("select max(synced_at) as syncedAt from card_sets").get() as { syncedAt: string | null };
      const latestRelease = sets.reduce((date, set) => (set.releaseDate ?? "") > date ? set.releaseDate! : date, "");
      const gap = computeCardDataGap(engine, rows.map(row => ({ ...row, cardSets: cardSets(row.card_sets_json) })), artworks, sets, recent.read(sets));
      if (syncedAt === null) gap.recentSetsMissingFromEngineCount = null;
      return {
        engine: {
          bundleVersion: manifest.bundleVersion, preparedAt: null, preparedAtSource: "unknown",
          sources: Object.fromEntries(Object.entries(ENGINE_SOURCE_REPOSITORIES).map(([source, repository]) => [source, {
            repository, pinnedSha: typeof manifest.sources?.[source] === "string" ? manifest.sources[source] : null, pinnedCommitDate: null,
          }])) as LocalCardDataStatus["engine"]["sources"],
          cardCount: engine.length, cdbFiles: files,
        },
        catalog: {
          lastSuccessfulSyncAt: syncedAt,
          lastCardCachedAt: rows.reduce<string | null>((date, row) => !date || row.cached_at > date ? row.cached_at : date, null),
          totalCards: rows.length, revision,
          newestSets: latestRelease ? sets.filter(set => set.releaseDate === latestRelease).sort((a, b) => a.name.localeCompare(b.name)) : [],
        },
        gap,
      };
    })();
    cached = { at: now(), value };
    return value;
  };
  return Object.assign(read, { close: recent.close });
}
