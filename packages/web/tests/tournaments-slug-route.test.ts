import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
// packages/web/tests/tournaments-slug-route.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.fn();
const tempDirs: string[] = [];
vi.mock("@/lib/auth", () => ({ auth }));
// Avoid real inter-service HTTP calls during settings edits.
vi.mock("@/lib/notify", () => ({
  broadcaster: { draft: vi.fn(), tournament: vi.fn() },
  announcer: { announce: vi.fn() },
}));

const SLUG = "abc123";

async function setupDb(opts?: { status?: string }) {
  const tempDir = mkdtempSync(join(tmpdir(), "yugioh-tournaments-slug-"));
  const dbPath = join(tempDir, "test.sqlite");
  tempDirs.push(tempDir);
  process.env.DATABASE_PATH = dbPath;
  process.env.DISCORD_GUILD_ID = "guild-1";
  const Database = (await import("better-sqlite3")).default;
  const { migrate } = await import("@yugidraft/shared/db");
  const db = new Database(dbPath);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  db.prepare(
    "insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values (?, ?, ?, ?, ?, ?)",
  ).run("guild-1", "Cup", "round_robin", opts?.status ?? "active", fixtureUserId("host"), SLUG);
  db.close();
}

function readDb<T>(fn: (db: import("better-sqlite3").Database) => T): Promise<T> {
  return (async () => {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(process.env.DATABASE_PATH as string);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  })();
}

const futureIso = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const params = Promise.resolve({ slug: SLUG });

describe("PUT /api/tournaments/[slug] timing settings", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Host" } });
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("creator can edit timing on an active tournament", async () => {
    await setupDb({ status: "active" });
    const deadlineAt = futureIso();
    const { PUT } = await import("../app/api/tournaments/[slug]/route");
    const res = await PUT(
      new Request(`http://localhost/api/tournaments/${SLUG}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineAt, reportConfirmWindowHours: 6 }),
      }) as any,
      { params },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deadlineAt).toBe(deadlineAt);
    expect(json.reportConfirmWindowHours).toBe(6);
    const row = await readDb((db) =>
      db
        .prepare("select deadline_at, report_confirm_window_hours from tournaments where web_slug = ?")
        .get(SLUG) as { deadline_at: string | null; report_confirm_window_hours: number | null },
    );
    expect(row.deadline_at).toBe(deadlineAt);
    expect(row.report_confirm_window_hours).toBe(6);
  });

  it("non-creator gets 403", async () => {
    await setupDb({ status: "active" });
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("intruder")), discordUserId: fixtureDiscordId("intruder"), name: "Nope" } });
    const { PUT } = await import("../app/api/tournaments/[slug]/route");
    const res = await PUT(
      new Request(`http://localhost/api/tournaments/${SLUG}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportConfirmWindowHours: 6 }),
      }) as any,
      { params },
    );
    expect(res.status).toBe(403);
  });

  it("editing a completed tournament returns 400", async () => {
    await setupDb({ status: "completed" });
    const { PUT } = await import("../app/api/tournaments/[slug]/route");
    const res = await PUT(
      new Request(`http://localhost/api/tournaments/${SLUG}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportConfirmWindowHours: 6 }),
      }) as any,
      { params },
    );
    expect(res.status).toBe(400);
  });

  it("clears the deadline when deadlineAt is null", async () => {
    await setupDb({ status: "active" });
    // seed a deadline first
    await readDb((db) =>
      db.prepare("update tournaments set deadline_at = ? where web_slug = ?").run(futureIso(), SLUG),
    );
    const { PUT } = await import("../app/api/tournaments/[slug]/route");
    const res = await PUT(
      new Request(`http://localhost/api/tournaments/${SLUG}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deadlineAt: null }),
      }) as any,
      { params },
    );
    expect(res.status).toBe(200);
    const row = await readDb((db) =>
      db.prepare("select deadline_at from tournaments where web_slug = ?").get(SLUG) as {
        deadline_at: string | null;
      },
    );
    expect(row.deadline_at).toBeNull();
  });
});

describe("GET /api/tournaments/[slug] exposes timing fields", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Host" } });
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("returns deadlineAt and reportConfirmWindowHours in the JSON", async () => {
    await setupDb({ status: "active" });
    const deadlineAt = futureIso();
    await readDb((db) =>
      db
        .prepare("update tournaments set deadline_at = ?, report_confirm_window_hours = ? where web_slug = ?")
        .run(deadlineAt, 12, SLUG),
    );
    const { GET } = await import("../app/api/tournaments/[slug]/route");
    const res = await GET(new Request(`http://localhost/api/tournaments/${SLUG}`) as any, { params });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.deadlineAt).toBe(deadlineAt);
    expect(json.reportConfirmWindowHours).toBe(12);
  });
});

describe("PUT /api/tournaments/[slug] is atomic", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: String(fixtureUserId("host")), discordUserId: fixtureDiscordId("host"), name: "Host" } });
  });
  afterEach(() => {
    delete process.env.DATABASE_PATH;
    delete process.env.DISCORD_GUILD_ID;
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  const put = async (body: unknown) => {
    const { PUT } = await import("../app/api/tournaments/[slug]/route");
    return PUT(
      new Request("http://localhost/api/tournaments/abc123", { method: "PUT", body: JSON.stringify(body) }) as never,
      { params },
    );
  };
  const row = () =>
    readDb((db) =>
      db.prepare("select name, deadline_at, report_confirm_window_hours, best_of from tournaments where web_slug = ?").get(SLUG),
    );

  it("a failing rules update leaves the name and settings unchanged", async () => {
    await setupDb({ status: "pending" });
    const before = await row();
    const res = await put({ name: "Renamed", deadlineAt: futureIso(), reportConfirmWindowHours: 6, bestOf: 2 });
    expect(res.status).toBe(400);
    expect(await row()).toEqual(before);
  });

  it("a failing settings update leaves the name unchanged", async () => {
    await setupDb({ status: "pending" });
    const before = await row();
    const res = await put({ name: "Renamed", reportConfirmWindowHours: -5 });
    expect(res.status).toBe(400);
    expect(await row()).toEqual(before);
  });

  it("applies name, settings and rules together when all are valid", async () => {
    await setupDb({ status: "pending" });
    const res = await put({ name: "Renamed", reportConfirmWindowHours: 6, bestOf: 1 });
    expect(res.status).toBe(200);
    expect(await row()).toMatchObject({ name: "Renamed", report_confirm_window_hours: 6, best_of: 1 });
  });
});

const FIXTURE_KEYS = ["host", "intruder"] as const;

// Membership is a dependency of these routes; authorization still runs through the real web boundary.
vi.mock("@/lib/discord-guild-membership", () => ({ verifyDiscordGuildMembership: vi.fn(async () => ({ ok: true })) }));
