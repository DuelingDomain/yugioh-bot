import Database from "better-sqlite3";
import { migrate } from "@yugidraft/shared/db";
import { notifyJoinRequest, decideWaitlistAction, waitlistActionToken, webhookHash, type WaitlistAction } from "@yugidraft/shared/notify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tickDiscordAdmin } from "../src/discord-admin.js";

let db: Database.Database;
let calls: { url: string; method: string; body: any }[];
let respond: (url: string, method: string) => Response;
const now = Date.parse("2026-10-19T12:00:00Z");
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  db = new Database(":memory:"); migrate(db);
  db.prepare("insert into users(id,username,display_name,created_at,last_seen_at,last_route) values(1,'owner','Owner',?,?,?)")
    .run("2026-10-19 01:00:00", now, "/decks/[id]");
  db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,'community',1,'Owner')").run();
  vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "1");
  vi.stubEnv("DISCORD_ADMIN_STATUS_WEBHOOK_URL", "https://discord.example.test/api/webhooks/2/status-fixture");
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "https://discord.example.test/api/webhooks/1/alert-fixture");
  vi.stubEnv("CLERK_SECRET_KEY", "sk_test_fixture");
  vi.stubEnv("DISCORD_GUILD_ID", "community");
  calls = [];
  respond = url => url.includes("api.clerk.com") ? Response.json({ data: [], total_count: 17 }) : Response.json({ id: "222222" });
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    return respond(url, method);
  }));
});
afterEach(() => { db.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("worker Discord status with real SQLite and external HTTP stubs", () => {
  it("creates once, persists ID across migrations, then edits; caches the cheap pending count", async () => {
    await tickDiscordAdmin(db);
    migrate(db);
    await tickDiscordAdmin(db);
    const discord = calls.filter(c => c.url.includes("discord"));
    expect(discord.map(c => c.method)).toEqual(["POST", "PATCH"]);
    expect(discord[0].url).toContain("wait=true");
    expect(discord[1].url).toContain("/messages/222222");
    expect(discord[0].body.content).toContain("Online now: 1\nOwner — Deck builder");
    expect(discord[0].body.content).toContain("Sign-ups today (UTC): 1");
    expect(discord[0].body.content).toContain("Waitlist pending: 17");
    expect(discord[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(1);
    expect(calls.find(c => c.url.includes("clerk"))!.url).toBe("https://api.clerk.com/v1/waitlist_entries?status=pending&limit=1");
    vi.setSystemTime(now + 5 * 60_000);
    await tickDiscordAdmin(db);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(2);
  });

  it("recreates only a missing status message and keeps other failures for later ticks", async () => {
    await tickDiscordAdmin(db);
    respond = (_url, method) => method === "PATCH" ? Response.json({ code: 10008 }, { status: 404 }) : Response.json({ id: "333333" });
    await tickDiscordAdmin(db);
    expect(calls.filter(c => c.url.includes("discord")).map(c => c.method)).toEqual(["POST", "PATCH", "POST"]);
    expect(db.prepare("select message_id from discord_admin_status").get()).toEqual({ message_id: "333333" });
    respond = () => Response.json({}, { status: 500 });
    await tickDiscordAdmin(db);
    expect(calls.at(-1)!.method).toBe("PATCH");
    expect(db.prepare("select message_id from discord_admin_status").get()).toEqual({ message_id: "333333" });
  });

  it("respects Discord retry-after and does not recreate on bad webhook or permissions", async () => {
    await tickDiscordAdmin(db);
    respond = () => Response.json({ retry_after: 180 }, { status: 429 });
    await tickDiscordAdmin(db);
    const count = calls.length;
    vi.setSystemTime(now + 60_000); await tickDiscordAdmin(db);
    expect(calls).toHaveLength(count);
    vi.setSystemTime(now + 181_000); await tickDiscordAdmin(db);
    expect(calls).toHaveLength(count + 1);
    respond = () => Response.json({ code: 10015 }, { status: 404 });
    vi.setSystemTime(now + 400_000); await tickDiscordAdmin(db);
    expect(calls.at(-1)!.method).toBe("PATCH");
  });

  it("caps names and content, excludes stale users, scopes live game stats and counts UTC completions", async () => {
    for (let id = 2; id <= 29; id++) db.prepare("insert into users(id,username,display_name,last_seen_at,last_route) values(?,?,?,?,?)")
      .run(id, `p${id}`, id === 2 ? "@everyone\n[bad](https://evil.test)" : "x".repeat(120), id === 29 ? now - 120_000 : now, "/draft/[slug]");
    const insert = db.prepare("insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,ended_at) values(?,?,?,1,'normal',?,?,?)");
    for (const format of ["1v1", "tag", "ffa3", "ffa4"]) insert.run("community", format, "Private table name", "active", format, null);
    insert.run("other", "other", "Hidden", "active", "1v1", null);
    insert.run("community", "finished", "Finished", "completed", "1v1", "2026-10-19 00:01:00");
    insert.run("community", "old", "Yesterday", "completed", "1v1", "2026-10-18 23:59:59");
    db.prepare("insert into drafts(guild_id,name,status,created_by_user_id,config_json) values('community','Draft','active',1,'{}'),('other','Other','active',1,'{}')").run();
    await tickDiscordAdmin(db);
    const body = calls.find(c => c.url.includes("discord"))!.body;
    expect(body.content.length).toBeLessThanOrEqual(2000);
    expect(body.content).toContain("Online now: 28");
    expect(body.content).toContain("+3 more");
    expect(body.content).toContain("1v1: 1 | Tag: 1 | 3-way: 1 | 4-way: 1");
    expect(body.content).toContain("Duels finished today (UTC): 1");
    expect(body.content).toContain("Drafts live: 1");
    expect(body.content).not.toContain("Private table name");
    expect(body.content).not.toContain("[bad](https://evil.test)");
  });

  it("clears presence after 24 hours even with publishing off; does no external HTTP", async () => {
    vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "0");
    db.prepare("update users set last_seen_at=?").run(now - 24 * 60 * 60_000);
    await tickDiscordAdmin(db);
    expect(db.prepare("select last_seen_at,last_route from users").get()).toEqual({ last_seen_at: null, last_route: null });
    expect(calls).toEqual([]);
  });

  it("backs off Clerk failures and marks cached data stale without breaking Discord", async () => {
    await tickDiscordAdmin(db);
    vi.setSystemTime(now + 5 * 60_000);
    respond = url => url.includes("clerk") ? Response.json({}, { status: 503 }) : Response.json({ id: "222222" });
    await tickDiscordAdmin(db); await tickDiscordAdmin(db);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(2);
    expect(calls.at(-1)!.body.content).toContain("Waitlist pending: 17 (stale)");
  });

  it("repairs a failed alert edit without re-running the completed Clerk decision, even with online status off", async () => {
    vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "0");
    vi.stubEnv("DISCORD_ADMIN_ACTION_SIGNING_SECRET", "integration-placeholder-32-characters-long");
    vi.stubEnv("WEB_URL", "https://app.example.test");
    await notifyJoinRequest(db, { email: "player@example.test", source: "Clerk waitlist", clerkEntryId: "waitlist_fixture" });
    const row = db.prepare<[], WaitlistAction>("select * from discord_waitlist_actions").get()!;
    respond = url => url.includes("clerk") ? Response.json({ id: "waitlist_fixture", status: "invited" }) : Response.json({}, { status: 503 });
    await decideWaitlistAction(db, waitlistActionToken(row, "approve"), { userId: 1, name: "Owner" });
    expect(db.prepare("select completed_at,discord_updated_at from discord_waitlist_actions").get()).toEqual({ completed_at: now, discord_updated_at: null });
    respond = () => Response.json({ id: "222222" });
    vi.setSystemTime(now + 60_000);
    await tickDiscordAdmin(db);
    expect(calls.filter(c => c.url.includes("clerk"))).toHaveLength(1);
    expect(calls.at(-1)!.method).toBe("PATCH");
    expect(JSON.stringify(calls.at(-1)!.body)).toContain("Approved by Owner");
    expect(db.prepare("select discord_updated_at,message_json from discord_waitlist_actions").get()).toEqual({ discord_updated_at: now + 60_000, message_json: null });
  });

  it("purges retained alert bodies and expired actions while keeping a short edit retry grace", async () => {
    vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "0");
    vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", "");
    const payload = JSON.stringify({ embeds: [{ fields: [{ name: "Email", value: "player@example.test" }] }] });
    const insert = db.prepare(`insert into discord_waitlist_actions(id,subject_hash,expires_at,completed_at,
      discord_message_id,discord_updated_at,message_json) values(?,?,?,?,'123456',?,?)`);
    insert.run("expired-completed", "expired-completed", now - 1, now - 60_000, now - 30_000, payload);
    insert.run("completed", "completed", now + 60_000, now - 60_000, now - 30_000, payload);
    insert.run("expired-unused", "expired-unused", now - 1, null, null, payload);
    insert.run("in-progress", "in-progress", now - 1, null, null, payload);
    db.prepare("update discord_waitlist_actions set attempted_at=? where id='in-progress'").run(now);
    insert.run("retry-grace", "retry-grace", now - 1, now - 60_000, null, payload);
    insert.run("retry-exhausted", "retry-exhausted", now - 15 * 60_000, now - 60_000, null, payload);

    await tickDiscordAdmin(db);

    expect(db.prepare("select * from discord_waitlist_actions where id='expired-completed'").get()).toBeUndefined();
    expect(db.prepare("select message_json from discord_waitlist_actions where id='completed'").get()).toEqual({ message_json: null });
    expect(db.prepare("select id from discord_waitlist_actions order by id").all()).toEqual([{ id: "completed" }, { id: "in-progress" }, { id: "retry-grace" }]);
    expect(db.prepare("select message_json from discord_waitlist_actions where id='retry-grace'").get()).toEqual({ message_json: payload });
    expect(calls).toEqual([]);
  });

  it("does not let old webhook edits starve a failed edit in the current channel", async () => {
    vi.stubEnv("DISCORD_ONLINE_STATUS_ENABLED", "0");
    const insert = db.prepare(`insert into discord_waitlist_actions(id,subject_hash,expires_at,decision,actor_name,completed_at,
      discord_message_id,webhook_hash,message_json) values(?,?,?,'approve','Owner',?,?,?,?)`);
    const payload = JSON.stringify({ allowed_mentions: { parse: [] }, embeds: [{ fields: [] }] });
    for (let id = 1; id <= 12; id++) insert.run(`old-${id}`, `old-${id}`, now + 10000, now - 60000, String(id), "old-webhook-hash", payload);
    insert.run("current", "current", now + 10000, now, "123456", webhookHash(process.env.DISCORD_ADMIN_WEBHOOK_URL!), payload);
    await tickDiscordAdmin(db);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("PATCH");
    expect(calls[0].url).toContain("/messages/123456");
    expect(db.prepare("select discord_updated_at from discord_waitlist_actions where id='current'").get()).toEqual({ discord_updated_at: now });
  });
});
