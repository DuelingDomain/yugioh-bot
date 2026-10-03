import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { BugReportServiceError, createBugReportService } from "../../src/services/bug-reports.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  migrate(db);
  db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (1, 'guild-a', 'u1', 'One')").run();
  db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (2, 'guild-a', 'u2', 'Two')").run();
  db.prepare("insert into players (id, guild_id, discord_user_id, display_name) values (3, 'guild-b', 'u3', 'Three')").run();
  db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values ('guild-a', 'duel-a', 'T', 1, 'normal', 'active')").run();
  return { db, reports: createBugReportService(db) };
}

const base = { guildId: "guild-a", playerId: 1, path: "/duels/duel-a", description: "It froze", context: { phase: "main1" } };

function status(work: () => unknown) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(BugReportServiceError);
    return error as BugReportServiceError;
  }
  throw new Error("expected BugReportServiceError");
}

describe("bug reports", () => {
  it("saves a report and reads it back with its context", () => {
    const { reports } = setup();
    const report = reports.create({ ...base, duelSlug: "duel-a", expected: "It should move on" }, { now: Date.UTC(2026, 9, 3) });
    expect(report).toMatchObject({
      guildId: "guild-a", playerId: 1, path: "/duels/duel-a", duelSlug: "duel-a", description: "It froze",
      expected: "It should move on", context: { phase: "main1" }, githubIssueNumber: null, githubIssueUrl: null, githubError: null,
      createdAt: "2026-10-03T00:00:00.000Z",
    });
    expect(reports.get(report.id, "guild-a")).toEqual(report);
  });

  it("keeps the github issue or the github error", () => {
    const { reports } = setup();
    const a = reports.create(base);
    expect(reports.recordIssue(a.id, "guild-a", { number: 12, url: "https://github.com/o/r/issues/12" }))
      .toMatchObject({ githubIssueNumber: 12, githubIssueUrl: "https://github.com/o/r/issues/12", githubError: null });
    const b = reports.create(base);
    expect(reports.recordIssueError(b.id, "guild-a", "x".repeat(900)).githubError).toHaveLength(500);
  });

  it("limits each player to 5 reports in 10 minutes and says when to retry", () => {
    const { reports } = setup();
    const t0 = Date.UTC(2026, 9, 3);
    for (let i = 0; i < 5; i += 1) reports.create(base, { now: t0 + i * 1000 });
    const error = status(() => reports.create(base, { now: t0 + 60_000 }));
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(540);
    // Another player is not affected, and the first slot frees after the window.
    expect(reports.create({ ...base, playerId: 2 }, { now: t0 + 60_000 }).playerId).toBe(2);
    expect(reports.create(base, { now: t0 + 10 * 60_000 + 1 }).id).toBeGreaterThan(5);
  });

  it("assertWithinLimit counts like create does, without writing", () => {
    const { db, reports } = setup();
    const t0 = Date.UTC(2026, 9, 3);
    for (let i = 0; i < 4; i += 1) reports.create(base, { now: t0 + i * 1000 });
    expect(() => reports.assertWithinLimit("guild-a", 1, { now: t0 + 60_000 })).not.toThrow();
    reports.create(base, { now: t0 + 4000 });
    const error = status(() => reports.assertWithinLimit("guild-a", 1, { now: t0 + 60_000 }));
    expect(error.status).toBe(429);
    expect(error.retryAfterSeconds).toBe(540);
    expect(() => reports.assertWithinLimit("guild-a", 2, { now: t0 + 60_000 })).not.toThrow();
    expect(() => reports.assertWithinLimit("guild-a", 1, { now: t0 + 10 * 60_000 + 1 })).not.toThrow();
    expect((db.prepare("select count(*) as n from bug_reports").get() as { n: number }).n).toBe(5);
  });

  it("does not store a report that the limit refused", () => {
    const { db, reports } = setup();
    for (let i = 0; i < 5; i += 1) reports.create(base, { now: 1000 + i });
    status(() => reports.create(base, { now: 2000 }));
    expect((db.prepare("select count(*) as n from bug_reports").get() as { n: number }).n).toBe(5);
  });

  it("refuses a duel slug from another guild or an unknown slug", () => {
    const { reports } = setup();
    expect(status(() => reports.create({ ...base, guildId: "guild-b", playerId: 3, duelSlug: "duel-a" })).status).toBe(404);
    expect(status(() => reports.create({ ...base, duelSlug: "nope" })).status).toBe(404);
    expect(reports.create({ ...base, guildId: "guild-b", playerId: 3 }).duelSlug).toBeNull();
  });

  it("scopes reads and writes to the guild", () => {
    const { reports } = setup();
    const report = reports.create(base);
    expect(status(() => reports.get(report.id, "guild-b")).status).toBe(404);
    expect(status(() => reports.recordIssueError(report.id, "guild-b", "other guild")).status).toBe(404);
    expect(reports.get(report.id, "guild-a").githubError).toBeNull();
  });
});

describe("bug report duplicates", () => {
  it("links a +1 to an issue and keeps it out of the issue lists", () => {
    const { reports } = setup();
    const t0 = Date.UTC(2026, 9, 3);
    const first = reports.create({ ...base, duelSlug: "duel-a" }, { now: t0 });
    reports.recordIssue(first.id, "guild-a", { number: 5, url: "https://github.com/o/r/issues/5" });
    const second = reports.create({ ...base, playerId: 2, duelSlug: "duel-a", duplicateOf: 5 }, { now: t0 + 1000 });
    reports.recordIssue(second.id, "guild-a", { number: 5, url: "https://github.com/o/r/issues/5" });
    expect(reports.get(second.id, "guild-a")).toMatchObject({ duplicateOf: 5, githubIssueNumber: 5 });
    expect(reports.get(first.id, "guild-a").duplicateOf).toBeNull();
    expect(reports.listWithIssue("guild-a").map((r) => r.id)).toEqual([first.id]);
    expect(reports.ownsIssue("guild-a", 5)).toBe(true);
    expect(reports.ownsIssue("guild-a", 6)).toBe(false);
    expect(reports.ownsIssue("guild-b", 5)).toBe(false);
  });

  it("lists the issues of other players in one duel and nothing from other guilds", () => {
    const { reports } = setup();
    const a = reports.create({ ...base, duelSlug: "duel-a" });
    reports.recordIssue(a.id, "guild-a", { number: 7, url: "u7" });
    const none = reports.create({ ...base, playerId: 2, duelSlug: "duel-a" });
    expect(none.githubIssueNumber).toBeNull();
    expect(reports.listWithIssueInDuel("guild-a", "duel-a", 2).map((r) => r.githubIssueNumber)).toEqual([7]);
    expect(reports.listWithIssueInDuel("guild-a", "duel-a", 1)).toEqual([]);
    expect(reports.listWithIssueInDuel("guild-b", "duel-a", 2)).toEqual([]);
    expect(reports.listWithIssue("guild-b")).toEqual([]);
  });
});

describe("bug_reports table", () => {
  it("has duplicate_of from the CREATE TABLE and migrates again without error", () => {
    const { db } = setup();
    migrate(db);
    const columns = (db.prepare("pragma table_info(bug_reports)").all() as Array<{ name: string }>).map((c) => c.name);
    expect(columns.filter((name) => name === "duplicate_of")).toHaveLength(1);
    expect(db.prepare("select name from sqlite_master where type = 'index' and name in ('bug_reports_player_idx', 'bug_reports_duel_idx')").all()).toHaveLength(2);
  });
});
