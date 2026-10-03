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

export interface BugReport {
  id: number;
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
}

export interface BugReportInput {
  guildId: string;
  playerId: number;
  path: string;
  duelSlug?: string | null;
  description: string;
  expected?: string | null;
  context: unknown;
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
  };
}

export function createBugReportService(db: Database.Database) {
  const duelInGuild = db.prepare("select 1 from duels where web_slug = ? and guild_id = ?");
  const recentFor = db.prepare(
    "select created_at from bug_reports where guild_id = ? and player_id = ? and created_at > ? order by created_at asc",
  );
  const insert = db.prepare(`
    insert into bug_reports (guild_id, player_id, created_at, path, duel_slug, description, expected, context_json, duplicate_of)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectOne = db.prepare("select * from bug_reports where id = ? and guild_id = ?");
  // Reports that own an issue (a +1 shares the issue of the report it joined, so it is left out).
  const withIssue = db.prepare(
    "select * from bug_reports where guild_id = ? and github_issue_number is not null and duplicate_of is null order by id desc limit ?",
  );
  const withIssueInDuel = db.prepare(
    "select * from bug_reports where guild_id = ? and duel_slug = ? and player_id <> ? and github_issue_number is not null and duplicate_of is null order by id desc limit ?",
  );
  const issueOwner = db.prepare(
    "select 1 from bug_reports where guild_id = ? and github_issue_number = ? and duplicate_of is null",
  );
  const setIssue = db.prepare(
    "update bug_reports set github_issue_number = ?, github_issue_url = ?, github_error = null where id = ? and guild_id = ?",
  );
  const setError = db.prepare("update bug_reports set github_error = ? where id = ? and guild_id = ?");

  function get(id: number, guildId: string): BugReport {
    const row = selectOne.get(id, guildId);
    if (!row) throw new BugReportServiceError("Bug report not found", 404);
    return mapReport(row);
  }

  return {
    get,

    /**
     * Saves one report, unless the player is over the limit (429 with `retryAfterSeconds`). The count and the insert
     * run in one transaction. A duel slug must belong to the guild (404 otherwise).
     */
    create(input: BugReportInput, options: { now?: number; limit?: BugReportLimit } = {}): BugReport {
      const now = options.now ?? Date.now();
      const { limit, windowMs } = options.limit ?? BUG_REPORT_LIMIT;
      const duelSlug = input.duelSlug ?? null;
      const run = db.transaction(() => {
        if (duelSlug !== null && !duelInGuild.get(duelSlug, input.guildId)) {
          throw new BugReportServiceError("Duel not found", 404);
        }
        const since = new Date(now - windowMs).toISOString();
        const recent = recentFor.all(input.guildId, input.playerId, since) as Array<{ created_at: string }>;
        if (recent.length >= limit) {
          const oldest = Date.parse(recent[recent.length - limit]!.created_at);
          const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
          throw new BugReportServiceError("Too many bug reports. Try again later.", 429, retryAfter);
        }
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
        );
        return Number(info.lastInsertRowid);
      });
      return get(run(), input.guildId);
    },

    /** The newest reports that own a GitHub issue. The local source of duplicate candidates when GitHub cannot be read. */
    listWithIssue(guildId: string, limit = 200): BugReport[] {
      return (withIssue.all(guildId, limit) as unknown[]).map(mapReport);
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
