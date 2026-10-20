/**
 * The /admin data contract. One response type per section, plus one person (people/<id>).
 * New fields are optional so an older client or test fixture still reads a newer answer.
 * Times are epoch milliseconds unless the name says otherwise.
 */

export type SectionResult<T> =
  | { state: "ok"; data: T; updatedAt: number }
  /** An external service is not set up. `message` is one short sentence that says which env to add. */
  | { state: "not-configured"; message: string; updatedAt: number }
  /** A configured service did not answer. `message` is safe to show: never a key, URL secret or stack. */
  | { state: "error"; message: string; updatedAt: number };

export const SECTION_IDS = ["online", "waitlist", "live", "today", "stats", "errors", "usage", "system"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** How the app keys a person: the Discord ID on this local build (no users table). */
export type UserKey = string;

/* ---- online ---- */
/** The duel table or draft a person is in now. */
export interface PersonPlace {
  kind: "duel" | "draft";
  slug: string;
  name: string;
  /** /duels/<slug> or /draft/<slug>. */
  href: string;
  /** "4-way duel", "Duel lobby", "Draft", "Draft lobby". */
  label: string;
  status: string;
}
export interface OnlinePerson {
  userId: UserKey;
  name: string;
  /** Null on this build: Discord sign-in only, no usernames. */
  username: string | null;
  /** https profile picture, or null for the initials circle. */
  avatarUrl: string | null;
  /** Friendly page label, for example "Deck builder" or "4-way duel". */
  label: string;
  lastSeenAt: number;
  /** Start of the current online stretch; null when unknown. */
  onlineSince: number | null;
  current: PersonPlace | null;
}
export interface OnlineData {
  /** Online now. */
  count: number;
  windowSeconds: number;
  users: OnlinePerson[];
  bySection: { label: string; count: number }[];
}

/* ---- one person (GET /api/admin/console/people/<userId>) ---- */
export interface PersonActivity {
  kind: "duel" | "draft";
  name: string;
  /** Replay for an ended duel, the table for an open one, the draft page for a draft. */
  href: string;
  /** "1v1 duel", "Tag duel", "Draft". */
  what: string;
  /** "Won", "Lost", "Draw", "Ended early", "Playing", "Lobby", "Completed", "Cancelled", "Drafting". */
  outcome: string;
  tone: "good" | "bad" | "live" | "quiet";
  /** Last change: end, start or creation time. */
  at: number | null;
}
export interface PersonDetail {
  userId: UserKey;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  online: boolean;
  /** Friendly page label of the latest beat, or null when never seen. */
  label: string | null;
  lastSeenAt: number | null;
  onlineSince: number | null;
  /** First time seen as a player in the guild. */
  joinedAt: number | null;
  current: PersonPlace | null;
  /** Newest first, at most 8. */
  recent: PersonActivity[];
  /** Duels and drafts started in the last 7 days. */
  week: { duels: number; drafts: number };
  /** Finished duels with a winner in the last 30 days. */
  results: { wins: number; games: number };
}

/* ---- waitlist (Clerk) ---- */
export interface WaitlistEntry { id: string; email: string; status: string; createdAt: number | null }
export interface WaitlistDecision { id: string; email: string; status: "invited" | "rejected" | "completed"; at: number | null }
export interface WaitlistData {
  /** Pending entries in Clerk. */
  pending: number;
  entries: WaitlistEntry[];
  /** Latest decided entries, newest first (at most 5). Missing when Clerk did not answer that call. */
  decided?: WaitlistDecision[];
}

/* ---- live duels and drafts ---- */
export type LiveDuelFormat = "1v1" | "tag" | "ffa3" | "ffa4";
export interface LiveSeat {
  name: string;
  avatarUrl: string | null;
  bot: boolean;
  /** users.id, so a click can open the person; null for a bot. */
  userId: UserKey | null;
}
export interface LiveDuel {
  slug: string;
  name: string;
  format: LiveDuelFormat;
  /** "1v1 duel", "Tag duel", "3-way duel", "4-way duel". */
  formatLabel: string;
  status: "lobby" | "active";
  players: string[];
  /** When the game began; null for a lobby that has not started. */
  startedAt: number | null;
  /** When the table was opened. */
  createdAt?: number;
  /** Ranked or tournament game (counts for rating) against a casual one. */
  ranked?: boolean;
  /** Played with Genesys point rules. */
  genesys?: boolean;
  /** Page the admin opens to watch, for example /duels/<slug>. */
  watchHref: string;
  /** One entry per seat, seat order. Same names as `players`, plus picture and bot flag. */
  seats?: LiveSeat[];
  /** Turn number from the duel clock; null before the first turn or without a clock. */
  turn?: number | null;
  /** Seat whose turn it is (index into `seats`), or null. */
  activeSeat?: number | null;
  /** Last input on the table. */
  lastActivityAt?: number | null;
}
export interface LiveDraft {
  slug: string;
  name: string;
  status: "pending" | "active";
  players: string[];
  startedAt: number | null;
  createdAt?: number;
  /** "Round 2, pick 3" while the draft runs; null in the lobby. */
  progress?: string | null;
  href: string;
  /** Same names as `players`, plus picture and bot flag. */
  seats?: LiveSeat[];
  /** "Theme" or "Booster". */
  modeLabel?: string;
  /** Source cube name, when the draft came from a cube. */
  cubeName?: string | null;
  /** Main-round picks made by the furthest player, and the main-round target per player. */
  picksMade?: number;
  picksTotal?: number;
}
export interface LiveData {
  /** Live duels = the entries with status "active". */
  duels: LiveDuel[];
  drafts: LiveDraft[];
}

/* ---- today (GET /api/admin/console/today?tz=<minutes east of UTC>&start=<local midnight, epoch ms>) ---- */
/** How a seat did in a duel of today. Null while the duel runs, or when it ended without a result. */
export type SeatOutcome = "won" | "lost" | "draw" | null;
export interface TodaySeat extends LiveSeat {
  outcome: SeatOutcome;
}
/**
 * live: running now. won: a team or player won. draw: finished with no winner. interrupted: closed early (idle, server stop).
 * cancelled: the table closed after the start with no result. idle: still open but past the idle cut-off; the host closes it soon.
 */
export type TodayResult = "live" | "won" | "draw" | "interrupted" | "cancelled" | "idle";
export interface TodayDuel {
  slug: string;
  name: string;
  format: LiveDuelFormat;
  formatLabel: string;
  ranked: boolean;
  genesys: boolean;
  result: TodayResult;
  /** One entry per seat, seat order, with the outcome of that seat (Tag partners share the result). */
  seats: TodaySeat[];
  /** Turns played: the final count for an ended duel, the clock turn for a running one. */
  turns: number | null;
  startedAt: number;
  /** Null while the duel runs. */
  endedAt: number | null;
  /** Internal path only: /duels/<slug>/replay for an ended duel, /duels/<slug> for a running one. */
  href: string;
}
export interface TodayCounts {
  all: number;
  oneVsOne: number;
  /** Tag, 3-way and 4-way. */
  multi: number;
  ranked: number;
}
export interface TodayData {
  /** Minutes east of UTC that set "today" (from the browser, clamped to ±840). 0 = UTC. */
  tzOffsetMinutes: number;
  /** Start of today (epoch ms): the browser's local midnight (`start`), else midnight at `tzOffsetMinutes`. */
  dayStart: number;
  /** Duels that started today, by filter. `duels` holds at most `limit` of them. */
  counts: TodayCounts;
  /** Newest start first. */
  duels: TodayDuel[];
  limit: number;
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
  today: Record<StatKey, number>;
  last7Days: Record<StatKey, number>;
  /** The seven days before `days`, for "vs last week". */
  previous7Days?: Record<StatKey, number>;
}

/* ---- errors (Sentry) ---- */
export interface ErrorIssue {
  id: string;
  title: string;
  /** Events in the last 24 hours. */
  count: number;
  /** ISO time. */
  lastSeen: string;
  /** ISO time of the first event, or null. An issue first seen in the last 24 hours is "new". */
  firstSeen?: string | null;
  url: string;
  level: string | null;
  /** Short code location, for example "app/api/duels/route". */
  culprit?: string | null;
  /** People affected (Sentry user count), or null when Sentry gives none. */
  users?: number | null;
  /** Sentry project slug. */
  project?: string;
  /** Events per hour for the last 24 hours, oldest first, when Sentry sends them. */
  hourly?: number[];
}
export interface ErrorsData {
  issues: ErrorIssue[];
  /** Error events in the last 24 hours. */
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
  /** Daily visitors for the last 7 days, oldest first. The last one is today. */
  dauSeries?: number[];
  /** Page views in the last 7 days. */
  pageviews7d?: number | null;
  /** Top pages of the last 7 days by views. Route templates only, for example "/duels/[slug]". */
  topPages?: { path: string; views: number }[];
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
  /** Services down or stale, plus one when disk space is at warn or fail. 0 = "All systems up". */
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
/** Snapshot the worker stores every hour (packages/worker/src/disk-usage.ts). */
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
  today: TodayData;
  stats: StatsData;
  errors: ErrorsData;
  usage: UsageData;
  system: SystemData;
}
