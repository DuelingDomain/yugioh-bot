/** Card pools are global; access to this operator snapshot is guild-admin-only. */
export type EngineDataSource = "database" | "scripts" | "strings";
export type DataStatus = "ok" | "unknown";
export interface EngineSourcePin {
  repository: string;
  pinnedSha: string | null;
  /** GitHub committer date, ISO 8601; null if unavailable. */
  pinnedCommitDate: string | null;
}
export interface EngineDataStatus {
  bundleVersion: string;
  preparedAt: string | null;
  /** Current bundles have no preparation timestamp and report unknown. Legacy tags are retained for clients. */
  preparedAtSource: "manifest" | "manifest-mtime" | "unknown";
  sources: Record<EngineDataSource, EngineSourcePin>;
  /** Raw datas rows, including alternate passcodes and tokens. */
  cardCount: number;
  /** CDB provenance listed in the manifest, including merged release files. */
  cdbFiles: string[];
}
export interface CatalogSetStatus {
  name: string;
  code: string | null;
  releaseDate: string | null;
}
export interface CardCatalogStatus {
  /** Successful cardsets.php refresh (SETS_SYNC_CRON), not a full cardinfo import. */
  lastSuccessfulSyncAt: string | null;
  /** Most recent successful individual/bulk card cache write. */
  lastCardCachedAt: string | null;
  /** Locally cached rows, including artwork passcodes; the catalog is populated on demand. */
  totalCards: number;
  revision: number;
  newestSets: CatalogSetStatus[];
}
export interface CardDataGapCard {
  id: number;
  name: string;
  setCode: string | null;
  setReleaseDate: string | null;
}
export interface CardDataGapStatus {
  /** Unique missing families in known sets from the last 12 calendar months; null until the set index is synced. */
  recentSetsMissingFromEngineCount: number | null;
  /** Recent sets that have not been fetched successfully; excluded from the primary count. */
  recentSetsUnknownCount: number;
  recentSets: CardDataSetGapStatus[];
  /** Diagnostic only: the on-demand catalog is incomplete. Skills and tokens are excluded. */
  cachedCatalogMissingCount: number;
  cachedCatalogMissing: CardDataGapCard[];
  /** Same normalized name/type exists in the engine under a different passcode family. */
  cachedCatalogIdMismatch: CardDataGapCard[];
}
export interface CardDataSetGapStatus extends CatalogSetStatus {
  /** ok may be stale while a daily/weekly refresh is in flight; checkedAt is the last successful fetch. */
  status: DataStatus;
  checkedAt: string | null;
  /** Playable families; null means the set has not been fetched successfully. */
  total: number | null;
  missingCount: number | null;
  missingCards: CardDataGapCard[];
  idMismatch: CardDataGapCard[];
}
export interface UpstreamSourceStatus {
  status: DataStatus;
  repository: string;
  defaultBranch: string | null;
  latestSha: string | null;
  latestCommitDate: string | null;
  /** Missing commits from compare pinned...HEAD (`ahead_by`), null if unknown. */
  behindCommits: number | null;
  /** Whole days between pinned and HEAD commit dates, not age since today. */
  behindDays: number | null;
  comparison: "identical" | "ahead" | "behind" | "diverged" | "unknown";
}
export interface EngineUpdateWorkflowStatus {
  lastRunStatus: DataStatus;
  lastRun: { conclusion: string | null; status: string; date: string; url: string } | null;
  pullRequestStatus: DataStatus;
  /** null + ok means no open PR; null + unknown means lookup failed. */
  openPullRequest: { number: number; title: string; url: string; updatedAt: string } | null;
}
export interface CardDataStatus {
  generatedAt: string;
  engine: EngineDataStatus;
  catalog: CardCatalogStatus;
  gap: CardDataGapStatus;
  upstream: {
    /** Oldest GitHub resource fetch time; null on a cold read before any completed refresh. */
    checkedAt: string | null;
    /** Earliest expiry of the cached GitHub resources. */
    expiresAt: string;
    sources: Record<EngineDataSource, UpstreamSourceStatus>;
    babelCdbFiles: { status: DataStatus; files: string[] };
  };
  updateWorkflow: EngineUpdateWorkflowStatus;
}
/** The signed host response before adding GitHub metadata. */
export type LocalCardDataStatus = Pick<CardDataStatus, "engine" | "catalog" | "gap">;
