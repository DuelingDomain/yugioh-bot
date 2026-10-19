/**
 * The /admin data contract. One response type per section. A section worker may ADD optional
 * fields to its own data type; it must keep the fields the summary strip reads (marked STRIP).
 * Times are epoch milliseconds unless the name says otherwise.
 */

export type SectionResult<T> =
  | { state: "ok"; data: T; updatedAt: number }
  /** An external service is not set up. `message` is one short sentence that says which env to add. */
  | { state: "not-configured"; message: string; updatedAt: number }
  /** A configured service did not answer. `message` is safe to show: never a key, URL secret or stack. */
  | { state: "error"; message: string; updatedAt: number };

export const SECTION_IDS = ["online", "waitlist", "live", "stats", "errors", "usage", "system"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/* ---- online (owner of this file: base) ---- */
export interface OnlineData {
  /** STRIP: Online now. */
  count: number;
  windowSeconds: number;
  users: { userId: number; name: string; label: string; lastSeenAt: number }[];
  bySection: { label: string; count: number }[];
}

/* ---- waitlist (Clerk) ---- */
export interface WaitlistEntry { id: string; email: string; status: string; createdAt: number | null }
export interface WaitlistData {
  /** STRIP: Pending waitlist. */
  pending: number;
  entries: WaitlistEntry[];
}

/* ---- live duels and drafts ---- */
export type LiveDuelFormat = "1v1" | "tag" | "ffa3" | "ffa4";
export interface LiveDuel {
  slug: string;
  name: string;
  format: LiveDuelFormat;
  /** "1v1 duel", "Tag duel", "3-way duel", "4-way duel". */
  formatLabel: string;
  status: "lobby" | "active";
  players: string[];
  startedAt: number | null;
  /** Page the admin opens to watch, for example /duels/<slug>. */
  watchHref: string;
}
export interface LiveDraft {
  slug: string;
  name: string;
  status: "pending" | "active";
  players: string[];
  startedAt: number | null;
  href: string;
}
export interface LiveData {
  /** STRIP: Live duels = the entries with status "active". */
  duels: LiveDuel[];
  drafts: LiveDraft[];
}

/* ---- stats (UTC days) ---- */
export const STAT_KEYS = ["signups", "activeUsers", "duelsStarted", "duelsFinished", "draftsStarted", "draftsCompleted"] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export interface StatsData {
  timezone: "UTC";
  /** Seven YYYY-MM-DD days, oldest first. The last one is today. */
  days: string[];
  /** One number per day, same order as `days`. */
  series: Record<StatKey, number[]>;
  /** STRIP: Sign-ups today = today.signups. */
  today: Record<StatKey, number>;
  last7Days: Record<StatKey, number>;
}

/* ---- errors (Sentry) ---- */
export interface ErrorIssue {
  id: string;
  title: string;
  count: number;
  /** ISO time. */
  lastSeen: string;
  url: string;
  level: string | null;
}
export interface ErrorsData {
  issues: ErrorIssue[];
  /** STRIP: Errors last 24 h = issues with an event in the last 24 hours. */
  last24h: number;
  /** Link to the Sentry project, or null. */
  dashboardUrl: string | null;
}

/* ---- usage (PostHog) ---- */
export interface UsageData {
  dau: number | null;
  wau: number | null;
  pageviewsToday: number | null;
  dashboardUrl: string | null;
}

/* ---- system ---- */
export interface SystemData {
  /** Deploy commit (SENTRY_RELEASE) or null. */
  version: string | null;
  /** When this web process started: the best proxy for the last deploy. */
  startedAt: number;
  cardData: {
    state: "up-to-date" | "behind" | "unknown";
    headline: string;
    /** Newest committed update snapshot (card-data-history.json), or null. */
    lastUpdate?: { label: string; date: string; pullRequestNumber: number; pullRequestUrl: string } | null;
    /** Newest pinned engine commit date (ISO), when the duel server answered. */
    dataAsOf?: string | null;
  } | null;
  duelServer: {
    ok: boolean;
    detail: string | null;
    /** Round trip of a cheap health call, ms. Null when it did not answer. */
    latencyMs?: number | null;
    /** Play tables with status active, counted from the database. */
    activeTables?: number | null;
  };
  worker: {
    ok: boolean;
    lastTickAt: number | null;
    /** True when the heartbeat is older than 3 minutes. */
    stale?: boolean;
    pid?: number | null;
  };
  /** Short SHA and GitHub link for `version`; null when the release is not a commit SHA. */
  commit?: { short: string; url: string } | null;
  /** SQLite file and write-ahead log size in bytes; null for an in-memory database. */
  database?: { bytes: number; walBytes: number } | null;
  /** One row per service, in display order. */
  services?: ServiceHealth[];
  /** STRIP (optional): services down or stale, plus one when disk space is at warn or fail. 0 = "All systems up". */
  problems?: number;
  /** Filesystem that holds the data volume. Null when the data directory cannot be read. */
  disk?: DiskStatus | null;
}
export type ServiceState = "up" | "down" | "stale" | "not-deployed" | "not-configured";
export interface ServiceHealth {
  id: "web" | "duel" | "worker" | "ws" | "bot" | "database";
  label: string;
  state: ServiceState;
  /** One short, safe sentence. Never a URL or key. */
  detail: string;
  latencyMs?: number | null;
  lastBeatAt?: number | null;
}
/** Snapshot the worker stores every ~10 minutes (packages/worker/src/disk-usage.ts). */
export interface DiskBreakdown {
  measuredAt: number;
  dataBytes: number;
  database: { bytes: number; walBytes: number };
  images: { bytes: number; capBytes: number };
  engine: { bytes: number } | null;
  backups: { bytes: number } | null;
  other: { bytes: number };
}
export interface DiskStatus {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  /** 0 to 100, one decimal. */
  usedPercent: number;
  /** warn at 80 % used or under 10 GB free; fail at 90 % used or under 5 GB free. */
  tone: "ok" | "warn" | "fail";
  /** Null until the worker has measured once. */
  breakdown: DiskBreakdown | null;
  /** Used bytes over the last 7 days, oldest first (at most 56 points); null without history. */
  trend: { values: number[]; daysUntilFull: number | null } | null;
}

export interface SectionDataMap {
  online: OnlineData;
  waitlist: WaitlistData;
  live: LiveData;
  stats: StatsData;
  errors: ErrorsData;
  usage: UsageData;
  system: SystemData;
}
