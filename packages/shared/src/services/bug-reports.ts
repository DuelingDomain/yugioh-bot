import { randomBytes } from "node:crypto";
import { serializeBugReportDiagnostics } from "./bug-report-diagnostics.js";
import type Database from "better-sqlite3";

export class BugReportServiceError extends Error {
  readonly status: number;
  /** Seconds until the reporter may send again; set on 429 only. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "BugReportServiceError";
    this.status = status;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface BugReportSubmitter {
  userId: string;
  username: string;
  email: string | null;
}

export interface BugReport {
  id: number;
  publicId: string;
  guildId: string;
  playerId: number;
  createdAt: string;
  path: string;
  duelSlug: string | null;
  description: string;
  expected: string | null;
  context: unknown;
  githubIssueNumber: number | null;
  githubIssueUrl: string | null;
  githubError: string | null;
  /** The issue number this report was added to as a +1, or null. */
  duplicateOf: number | null;
  /** Private identity at submission time. Never passed to GitHub. */
  submitter: BugReportSubmitter | null;
  /** Server capture with a bounded board and public log tail. Owner access only. */
  diagnostics: unknown;
}

export interface BugReportInput {
  guildId: string;
  playerId: number;
  path: string;
  duelSlug?: string | null;
  description: string;
  expected?: string | null;
  context: unknown;
  diagnostics?: unknown;
  /** Email from the authenticated server session. Never read from the report body. */
  submitterEmail?: string | null;
  /** Server-generated fingerprint for retry protection. Never published. */
  submissionKey?: string;
  /** Set when the player said an open issue is the same bug: the report is saved and linked, no new issue. */
  duplicateOf?: number | null;
}

export interface BugReportLimit {
  /** Reports one player may send inside the window. */
  limit: number;
  windowMs: number;
}

/** 5 reports per player per 10 minutes. */
export const BUG_REPORT_LIMIT: BugReportLimit = { limit: 5, windowMs: 10 * 60 * 1000 };

function mapReport(row: any): BugReport {
  return {
    id: row.id,
    publicId: row.public_id,
    guildId: row.guild_id,
    playerId: row.player_id,
    createdAt: row.created_at,
    path: row.path,
    duelSlug: row.duel_slug ?? null,
    description: row.description,
    expected: row.expected ?? null,
    context: JSON.parse(row.context_json),
    githubIssueNumber: row.github_issue_number ?? null,
    githubIssueUrl: row.github_issue_url ?? null,
    githubError: row.github_error ?? null,
    duplicateOf: row.duplicate_of ?? null,
    submitter: row.submitter_json ? JSON.parse(row.submitter_json) : row.user_id != null
      ? { userId: row.user_id, username: row.username, email: row.email ?? null } : null,
    diagnostics: row.diagnostics_json ? JSON.parse(row.diagnostics_json) : null,
  };
}

export function createBugReportService(db: Database.Database) {
  const duelInGuild = db.prepare("select 1 from duels where web_slug = ? and guild_id = ?");
  const recentFor = db.prepare(
    "select created_at from bug_reports where guild_id = ? and player_id = ? and created_at > ? order by created_at asc",
  );
  const insert = db.prepare(`
    insert into bug_reports (guild_id, player_id, created_at, path, duel_slug, description, expected, context_json, duplicate_of, submitter_json, diagnostics_json, public_id, submission_key)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const identityJoin = "from bug_reports r join players p on p.id = r.player_id";
  const selectOne = db.prepare(`select r.*, p.discord_user_id as user_id, p.display_name as username, null as email ${identityJoin} where r.id = ? and r.guild_id = ?`);
  const submitter = db.prepare("select discord_user_id as userId, display_name as username, null as email from players where id = ? and guild_id = ?");
  const listReports = db.prepare(`select r.id, r.public_id, r.created_at, r.duel_slug, r.github_issue_number, r.github_issue_url,
    r.github_error, r.submitter_json, p.discord_user_id as user_id, p.display_name as username, null as email ${identityJoin}
    where r.guild_id = ? and r.id < ? order by r.id desc limit ?`);
  // Duplicate checks must not load hundreds of full board captures.
  const candidateColumns = "id, public_id, guild_id, player_id, created_at, path, duel_slug, description, expected, context_json, github_issue_number, github_issue_url, github_error, duplicate_of, submitter_json";
  const recentSubmission = db.prepare(`select id from bug_reports
    where guild_id = ? and player_id = ? and submission_key = ? and created_at > ? order by id desc limit 1`);
  // Reports that own an issue (a +1 shares the issue of the report it joined, so it is left out).
  const withIssue = db.prepare(
    `select ${candidateColumns} from bug_reports where guild_id = ? and github_issue_number is not null and duplicate_of is null order by id desc limit ?`,
  );
  const withIssueInDuel = db.prepare(
    `select ${candidateColumns} from bug_reports where guild_id = ? and duel_slug = ? and player_id <> ? and github_issue_number is not null and duplicate_of is null order by id desc limit ?`,
  );
  const issueOwner = db.prepare(
    "select 1 from bug_reports where guild_id = ? and github_issue_number = ? and duplicate_of is null",
  );
  const setIssue = db.prepare(
    "update bug_reports set github_issue_number = ?, github_issue_url = ?, github_error = null where id = ? and guild_id = ?",
  );
  const setError = db.prepare("update bug_reports set github_error = ? where id = ? and guild_id = ?");

  /** Throws 429 with `retryAfterSeconds` when the player has used up the window. Counts only; it writes nothing. */
  function assertWithinLimit(guildId: string, playerId: number, now: number, { limit, windowMs }: BugReportLimit): void {
    const since = new Date(now - windowMs).toISOString();
    const recent = recentFor.all(guildId, playerId, since) as Array<{ created_at: string }>;
    if (recent.length >= limit) {
      const oldest = Date.parse(recent[recent.length - limit]!.created_at);
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      throw new BugReportServiceError("Too many bug reports. Try again later.", 429, retryAfter);
    }
  }

  function get(id: number, guildId: string): BugReport {
    const row = selectOne.get(id, guildId);
    if (!row) throw new BugReportServiceError("Bug report not found", 404);
    return mapReport(row);
  }

  function findRecentSubmission(guildId: string, playerId: number, key: string, now = Date.now()): BugReport | null {
    const row = recentSubmission.get(guildId, playerId, key, new Date(now - BUG_REPORT_LIMIT.windowMs).toISOString()) as { id: number } | undefined;
    return row ? get(row.id, guildId) : null;
  }

  return {
    get,
    findRecentSubmission,

    /**
     * Saves one report, unless the player is over the limit (429 with `retryAfterSeconds`). The count and the insert
     * run in one transaction. A duel slug must belong to the guild (404 otherwise).
     */
    create(input: BugReportInput, options: { now?: number; limit?: BugReportLimit } = {}): BugReport {
      const now = options.now ?? Date.now();
      const duelSlug = input.duelSlug ?? null;
      const run = db.transaction(() => {
        if (duelSlug !== null && !duelInGuild.get(duelSlug, input.guildId)) {
          throw new BugReportServiceError("Duel not found", 404);
        }
        assertWithinLimit(input.guildId, input.playerId, now, options.limit ?? BUG_REPORT_LIMIT);
        const author = submitter.get(input.playerId, input.guildId) as BugReportSubmitter | undefined;
        if (!author) throw new BugReportServiceError("Report submitter not found", 404);
        const info = insert.run(
          input.guildId,
          input.playerId,
          new Date(now).toISOString(),
          input.path,
          duelSlug,
          input.description,
          input.expected ?? null,
          JSON.stringify(input.context ?? {}),
          input.duplicateOf ?? null,
          JSON.stringify({ ...author, email: input.submitterEmail ?? null }),
          serializeBugReportDiagnostics(input.diagnostics),
          randomBytes(9).toString("base64url"),
          input.submissionKey ?? null,
        );
        return Number(info.lastInsertRowid);
      });
      return get(run(), input.guildId);
    },

    /** Claim a submission in SQLite before any issue write, including across web processes. */
    createOnce(input: BugReportInput & { submissionKey: string }) {
      return db.transaction(() => {
        const existing = findRecentSubmission(input.guildId, input.playerId, input.submissionKey);
        return existing ? { report: existing, created: false }
          : { report: this.create(input), created: true };
      }).immediate();
    },

    /**
     * Throws 429 (with `retryAfterSeconds`) when the player already sent the most reports allowed in the window. The
     * same count `create` makes, without a write: call it before any slow or costly work (a GitHub call).
     */
    assertWithinLimit(guildId: string, playerId: number, options: { now?: number; limit?: BugReportLimit } = {}): void {
      assertWithinLimit(guildId, playerId, options.now ?? Date.now(), options.limit ?? BUG_REPORT_LIMIT);
    },

    /** The newest reports that own a GitHub issue. The local source of duplicate candidates when GitHub cannot be read. */
    listWithIssue(guildId: string, limit = 200): BugReport[] {
      return (withIssue.all(guildId, limit) as unknown[]).map(mapReport);
    },

    /** Small owner-list rows; large board data is read only on the separate detail route. */
    list(guildId: string, before = Number.MAX_SAFE_INTEGER, limit = 50) {
      const rows = listReports.all(guildId, before, limit) as Array<{
        id: number; public_id: string; created_at: string; duel_slug: string | null; github_issue_number: number | null;
        github_issue_url: string | null; github_error: string | null; submitter_json: string | null;
        user_id: string; username: string; email: string | null;
      }>;
      return rows.map(row => ({
        id: row.id, publicId: row.public_id, createdAt: row.created_at, duelSlug: row.duel_slug,
        githubIssueNumber: row.github_issue_number, githubIssueUrl: row.github_issue_url, githubError: row.github_error,
        submitter: (row.submitter_json ? JSON.parse(row.submitter_json)
          : { userId: row.user_id, username: row.username, email: row.email }) as BugReportSubmitter,
      }));
    },

    /** Reports with an issue from other players in one duel, newest first. */
    listWithIssueInDuel(guildId: string, duelSlug: string, exceptPlayerId: number, limit = 50): BugReport[] {
      return (withIssueInDuel.all(guildId, duelSlug, exceptPlayerId, limit) as unknown[]).map(mapReport);
    },

    /** True when a saved report opened this issue number: only those issues may take a +1 when GitHub is unreadable. */
    ownsIssue(guildId: string, issueNumber: number): boolean {
      return issueOwner.get(guildId, issueNumber) !== undefined;
    },

    recordIssue(id: number, guildId: string, issue: { number: number; url: string }): BugReport {
      setIssue.run(issue.number, issue.url, id, guildId);
      return get(id, guildId);
    },

    recordIssueError(id: number, guildId: string, message: string): BugReport {
      setError.run(message.slice(0, 500), id, guildId);
      return get(id, guildId);
    },
  };
}

export type BugReportService = ReturnType<typeof createBugReportService>;
