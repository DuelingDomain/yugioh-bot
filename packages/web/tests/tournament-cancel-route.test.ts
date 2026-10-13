import { fixtureUserId, fixtureDiscordId, seedFixtureUsers } from "./fixtures/identity";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createTournamentService } from "@yugidraft/shared/services";

const auth = vi.fn();
const announcer = { announce: vi.fn(async (..._args: unknown[]) => ({ ok: true as const })) };
const broadcaster = { draft: vi.fn(), tournament: vi.fn() };
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(auth);
});
vi.mock("@/lib/notify", () => ({ announcer, broadcaster }));
const notifyDuelChange = vi.fn(async (_slug: string, _guildId: string) => {});
vi.mock("@/lib/notify-duel", () => ({ notifyDuelChange }));
const tempDirs: string[] = [];

function as(key: string, name = key) {
  auth.mockResolvedValue({ user: { id: String(fixtureUserId(key)), discordUserId: fixtureDiscordId(key), name } });
}

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "tcancel-"));
  tempDirs.push(dir);
  process.env.DATABASE_PATH = join(dir, "bot.sqlite");
  process.env.DISCORD_GUILD_ID = "g1";
  const db = new Database(process.env.DATABASE_PATH);
  migrate(db);
  seedFixtureUsers(db, FIXTURE_KEYS);
  const insert = db.prepare("insert into players (guild_id, user_id, discord_user_id, display_name) values (?, ?, ?, ?)");
  const a = Number(insert.run("g1", fixtureUserId("u-a"), fixtureDiscordId("u-a"), "Alice").lastInsertRowid);
  const b = Number(insert.run("g1", fixtureUserId("u-b"), fixtureDiscordId("u-b"), "Bob").lastInsertRowid);
  const tournaments = createTournamentService(db);
  const make = (guild: string, name: string, slug: string) => {
    // Open, so any guild member can read it; the 403 below is then about the cancel right alone.
    const t = tournaments.create(guild, name, "round_robin", fixtureUserId("u-org"), { visibility: "open" });
    db.prepare("update tournaments set web_slug = ? where id = ?").run(slug, t.id);
    return t;
  };
  const pending = make("g1", "Pending Cup", "pending-cup");
  tournaments.join(pending.id, a);
  const active = make("g1", "Active Cup", "active-cup");
  tournaments.join(active.id, a);
  tournaments.join(active.id, b);
  tournaments.start(active.id);
  const other = make("g2", "Other Guild Cup", "other-guild");
  const status = (id: number) => (db.prepare("select status from tournaments where id = ?").get(id) as { status: string }).status;
  return { db, tournaments, pending, active, other, status };
}

const del = async (slug: string) => {
  const { DELETE } = await import("../app/api/tournaments/[slug]/route");
  return DELETE(new Request("http://localhost/x", { method: "DELETE" }), { params: Promise.resolve({ slug }) });
};

describe("DELETE /api/tournaments/[slug] (cancel)", () => {
  beforeEach(() => {
    vi.resetModules();
    auth.mockReset();
    announcer.announce.mockClear();
    broadcaster.tournament.mockClear();
    notifyDuelChange.mockClear();
  });
  afterEach(() => {
    for (const key of ["DATABASE_PATH", "DISCORD_GUILD_ID"]) delete process.env[key];
    while (tempDirs.length) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  it("401 without a session", async () => {
    const s = seed();
    auth.mockResolvedValue(null);
    expect((await del("pending-cup")).status).toBe(401);
    expect(s.status(s.pending.id)).toBe("pending");
  });

  it("lets the creator cancel a pending tournament and tells the web", async () => {
    const s = seed();
    as("u-org");
    const res = await del("pending-cup");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: s.pending.id, status: "cancelled" });
    expect(s.status(s.pending.id)).toBe("cancelled");
    expect(broadcaster.tournament).toHaveBeenCalledTimes(1);
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "cancelled", slug: "pending-cup" });
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("lets the creator cancel an active tournament", async () => {
    const s = seed();
    as("u-org");
    const res = await del("active-cup");
    expect(res.status).toBe(200);
    expect(s.status(s.active.id)).toBe("cancelled");
    expect(broadcaster.tournament).toHaveBeenCalledWith({ kind: "cancelled", slug: "active-cup" });
  });

  it("refuses a participant and another guild member who is not the creator with 403", async () => {
    const s = seed();
    for (const key of ["u-a", "u-x"]) {
      as(key);
      const res = await del("active-cup");
      expect(res.status).toBe(403);
    }
    expect(s.status(s.active.id)).toBe("active");
    expect(broadcaster.tournament).not.toHaveBeenCalled();
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("hides a private tournament from a non-participant with 404", async () => {
    const s = seed();
    s.db.prepare("update tournaments set visibility = 'private' where id = ?").run(s.active.id);
    as("u-x");
    expect((await del("active-cup")).status).toBe(404);
    expect(s.status(s.active.id)).toBe("active");
  });

  it("does not use the OWNER_USER_IDS list as a cancel right (creator only)", async () => {
    const s = seed();
    vi.stubEnv("OWNER_USER_IDS", String(fixtureUserId("u-x")));
    as("u-x");
    expect((await del("active-cup")).status).toBe(403);
    expect(s.status(s.active.id)).toBe("active");
    vi.unstubAllEnvs();
  });

  it("is scoped to the configured guild: another guild's tournament is 404 even for its creator", async () => {
    const s = seed();
    as("u-org");
    expect((await del("other-guild")).status).toBe(404);
    expect(s.status(s.other.id)).toBe("pending");
    expect((await del("missing-slug")).status).toBe(404);
    expect(broadcaster.tournament).not.toHaveBeenCalled();
  });

  it.each(["completed", "cancelled"])("answers 409 for a %s tournament and changes nothing", async (status) => {
    const s = seed();
    s.db.prepare("update tournaments set status = ? where id = ?").run(status, s.active.id);
    as("u-org");
    const res = await del("active-cup");
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe(`Tournament is already ${status}`);
    expect(s.status(s.active.id)).toBe(status);
    expect(broadcaster.tournament).not.toHaveBeenCalled();
    expect(notifyDuelChange).not.toHaveBeenCalled();
  });

  it("a second cancel after the first gets 409 and sends nothing more", async () => {
    seed();
    as("u-org");
    expect((await del("active-cup")).status).toBe(200);
    broadcaster.tournament.mockClear();
    expect((await del("active-cup")).status).toBe(409);
    expect(broadcaster.tournament).not.toHaveBeenCalled();
  });
});
const FIXTURE_KEYS = ["u-org", "u-a", "u-b", "u-x"] as const;
