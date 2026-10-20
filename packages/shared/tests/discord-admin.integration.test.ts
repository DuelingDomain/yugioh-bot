import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase, migrate } from "../src/db/index.js";
import { createClerkBackend } from "../src/clerk/backend.js";
import { adminAccess, isAdminActor, isModerator, lookupSiteAccount, enqueueOutbox, claimOutbox, markPosted, markFailed,
  recordModAction, addWarning, listWarnings } from "../src/discord-admin/index.js";
import { decideWaitlistEntry, prepareWaitlistAction } from "../src/services/waitlist-decisions.js";
import { createWaitlistService } from "../src/services/waitlist.js";
import { deleteUserAccount } from "../src/services/account-deletion.js";
import { notifyJoinRequest } from "../src/notify/join-request.js";

let server: Server;
let apiUrl: string;
let db: Database.Database;
let directory: string;
let requests: Array<{ method: string; path: string; body: string }>;
let status: number;
let errorCode: string;
let release: (() => void) | undefined;
let hold: Promise<void> | undefined;
const owner = { siteUserId: 1 };
const email = "player@example.test";
const clerk = () => createClerkBackend({ secretKey: "test-key", apiUrl });
const action = () => prepareWaitlistAction(db, { email, clerkEntryId: "wle_1" });
const decide = (decision: "approve" | "reject" = "approve", actor = owner, source: "web" | "discord" = "web") =>
  decideWaitlistEntry(db, { clerkEntryId: "wle_1", decision, actor, source }, clerk());
const queue = (key: string) => enqueueOutbox(db, { idempotencyKey: key, kind: "test", channelId: "waitlist", payload: { content: key } });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method!, path: req.url!, body });
    if (hold) await hold;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status >= 400 ? { errors: [{ code: errorCode, message: "Private upstream text" }] } : { id: "wle_1" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "discord-shared-"));
  db = openDatabase(join(directory, "test.sqlite"));
  db.exec(`insert into users(id,username,display_name,discord_user_id,email,clerk_user_id) values
    (1,'owner','Owner','discord-owner','owner@example.test','user_owner'),
    (2,'member','Member','discord-member','player@example.test','user_member'),
    (3,'web-owner','Web Owner',null,null,'user_web');`);
  requests = []; status = 200; errorCode = ""; release = undefined; hold = undefined;
  vi.stubEnv("OWNER_USER_IDS", "1,3");
  vi.stubEnv("DISCORD_BOT_ENABLED", "1");
  vi.stubEnv("DISCORD_ADMIN_OUTBOX_ENABLED", "1");
  vi.stubEnv("DISCORD_MODERATOR_ROLE_ID", "moderator");
  vi.stubEnv("DISCORD_WAITLIST_CHANNEL_ID", "waitlist");
  vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", "mod-log");
  vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", "1");
  vi.stubEnv("DISCORD_JOIN_REQUEST_ALERTS_ENABLED", "1");
  vi.stubEnv("DISCORD_ADMIN_WEBHOOK_URL", undefined);
});
afterEach(() => {
  release?.();
  db.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("shared Discord administration with SQLite", () => {
  it("uses the stored account link and current owner list for both actor types", () => {
    expect(lookupSiteAccount(db, { discordUserId: "discord-owner" })).toMatchObject({ siteUserId: 1 });
    expect(isAdminActor(db, owner)).toBe(true);
    expect(isAdminActor(db, { siteUserId: "3" })).toBe(true);
    expect(isAdminActor(db, { discordUserId: "discord-owner" })).toBe(true);
    expect(isAdminActor(db, { discordUserId: "3", roles: ["moderator"] })).toBe(false);
    expect(isAdminActor(db, { siteUserId: 999 })).toBe(false);
    expect(isModerator(db, { discordUserId: "discord-member", roles: ["moderator"] })).toBe(true);
    expect(isModerator(db, { discordUserId: "discord-member", roles: ["Administrator"] })).toBe(false);
    expect(adminAccess(db, "discord-owner")).toMatchObject({ siteUserId: 1, isAdmin: true, isModerator: true });
    db.exec("update users set discord_user_id=null where id=1");
    expect(isAdminActor(db, { discordUserId: "discord-owner" })).toBe(false);
    vi.stubEnv("OWNER_USER_IDS", "");
    expect(isAdminActor(db, owner)).toBe(false);
  });

  it("deduplicates durable alerts, binds a later Clerk ID and never stores full email", async () => {
    createWaitlistService(db).join(email);
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    const rows = db.prepare("select * from discord_outbox").all();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).toContain("p***@example.test");
    expect(JSON.stringify(rows)).not.toContain(email);
    expect(db.prepare("select clerk_entry_id from discord_waitlist_actions").get()).toEqual({ clerk_entry_id: "wle_1" });
    migrate(db);
    db.close(); db = openDatabase(join(directory, "test.sqlite"));
    const [claimed] = claimOutbox(db, 10);
    expect(claimed.payload_json).toContain("wl:approve:");
    expect(JSON.parse(claimed.payload_json)).toMatchObject({ enforce_nonce: true, nonce: expect.any(String) });
    expect(markPosted(db, claimed, { messageId: "message-1" })).toBe(true);
    expect(claimOutbox(db, 10)).toEqual([]);
    expect(db.prepare("select message_id,channel_id from discord_waitlist_actions").get())
      .toEqual({ message_id: "message-1", channel_id: "waitlist" });
    expect(db.prepare("select payload_json from discord_outbox").get()).toEqual({ payload_json: null });
  });

  it("fences competing outbox consumers and reclaims only expired leases", () => {
    queue("one");
    const second = openDatabase(join(directory, "test.sqlite"));
    try {
      const now = Date.now();
      const [first] = claimOutbox(db, 10, { now, leaseMs: 1000 });
      expect(claimOutbox(second, 10, { now })).toEqual([]);
      const [replacement] = claimOutbox(second, 10, { now: now + 1001 });
      expect(replacement.lease_token).not.toBe(first.lease_token);
      expect(markPosted(db, first, { messageId: "stale" })).toBe(false);
      expect(markFailed(db, first, {})).toBe(false);
      expect(markPosted(second, replacement, { messageId: "current" })).toBe(true);
    } finally { second.close(); }
  });

  it("retries poison rows without blocking other messages and honors rate limits", () => {
    expect(queue("poison")).toBe(queue("poison"));
    queue("good");
    const now = Date.now();
    const [poison, good] = claimOutbox(db, 10, { now });
    expect(markFailed(db, poison, { retryAfterMs: 120_000 }, now)).toBe(true);
    markPosted(db, good, { messageId: "ok" }, now);
    expect(claimOutbox(db, 10, { now: now + 60_000 })).toEqual([]);
    expect(claimOutbox(db, 10, { now: now + 120_001 })).toHaveLength(1);
  });

  it("caps claims at 30 each minute across SQLite connections and restarts", () => {
    for (let i = 0; i < 35; i++) queue(`message-${i}`);
    const now = Date.now();
    const claimed = claimOutbox(db, 100, { now });
    expect(claimed).toHaveLength(30);
    for (const row of claimed) markPosted(db, row, { messageId: String(row.id) }, now);
    db.close(); db = openDatabase(join(directory, "test.sqlite"));
    expect(claimOutbox(db, 100, { now: now + 59_999 })).toHaveLength(0);
    expect(claimOutbox(db, 100, { now: now + 60_001 })).toHaveLength(5);
  });

  it("stops retrying a poison message after eight failures and drops its body", () => {
    queue("poison");
    const now = Date.now();
    for (let i = 0; i < 8; i++) {
      const at = now + i * 120_000;
      const [row] = claimOutbox(db, 1, { now: at });
      expect(row.attempts).toBe(i + 1);
      markFailed(db, row, { code: "rejected" }, at);
    }
    expect(db.prepare("select status,payload_json,last_error from discord_outbox").get())
      .toEqual({ status: "dead", payload_json: null, last_error: "rejected" });
    expect(claimOutbox(db, 1, { now: now + 2_000_000 })).toEqual([]);
  });

  it("records moderation and warnings and queues an audit message", () => {
    const id = recordModAction(db, { guildId: "guild", actorSiteUserId: 1, actorDiscordId: "discord-owner",
      action: "timeout", targetDiscordId: "discord-member", reason: "Flood", result: "success", params: { seconds: 60 } });
    expect(db.prepare("select action,result,params_json from mod_actions where id=?").get(id))
      .toEqual({ action: "timeout", result: "success", params_json: '{"seconds":60}' });
    const warning = addWarning(db, { guildId: "guild", actorSiteUserId: 1, actorDiscordId: "discord-owner", targetDiscordId: "discord-member", reason: "Flood" });
    expect(listWarnings(db, "guild", "discord-member")).toMatchObject([{ id: warning, reason: "Flood" }]);
    expect(listWarnings(db, "other", "discord-member")).toEqual([]);
    expect(db.prepare("select kind from discord_outbox where mod_action_id=?").get(id)).toEqual({ kind: "mod_log" });
  });
});

describe("one leased Clerk decision for web and Discord", () => {
  it.each(["web", "discord"] as const)("completes through %s, saves the actor, clears email and queues an edit", async source => {
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    const [alert] = claimOutbox(db, 1);
    markPosted(db, alert, { messageId: "posted" });
    const result = await decide("approve", owner, source);
    expect(result.status).toBe("completed");
    expect(result.action).toMatchObject({ decision: "approve", actor_user_id: 1, actor_name: "Owner", source, completed_at: expect.any(Number) });
    expect(requests).toEqual([{ method: "POST", path: "/v1/waitlist_entries/wle_1/invite", body: "{}" }]);
    const [edit] = claimOutbox(db, 10);
    expect(edit).toMatchObject({ operation: "edit", channel_id: "waitlist", message_id: "posted" });
    expect(edit.payload_json).toContain("Approved by Owner");
    expect(edit.payload_json).not.toContain("@example.test");
    markPosted(db, edit, { messageId: "posted" });
    expect(db.prepare("select discord_updated_at from discord_waitlist_actions").get()).toEqual({ discord_updated_at: expect.any(Number) });
    expect((await decide("reject")).status).toBe("already_decided");
    expect(requests).toHaveLength(1);
  });

  it("refuses a non-owner, including a moderator, before calling Clerk", async () => {
    action();
    await expect(decideWaitlistEntry(db, { clerkEntryId: "wle_1", decision: "approve", source: "discord",
      actor: { discordUserId: "discord-member", roles: ["moderator"] } }, clerk())).rejects.toMatchObject({ status: 403 });
    expect(requests).toHaveLength(0);
    expect(db.prepare("select decision from discord_waitlist_actions").get()).toEqual({ decision: null });
  });

  it("requires an email hash before a web-first decision so privacy deletion can find it", async () => {
    await expect(decide()).rejects.toMatchObject({ status: 409, code: "waitlist_identity_not_ready" });
    expect(requests).toHaveLength(0);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    const result = await decideWaitlistEntry(db, { clerkEntryId: "wle_1", email,
      decision: "approve", actor: owner, source: "web" }, clerk());
    expect(result.status).toBe("completed");
    expect(JSON.stringify(result.action)).not.toContain(email);
    deleteUserAccount(db, 2);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    expect(db.prepare("select * from discord_outbox where kind='waitlist_decision'").all()).toEqual([]);
  });

  it("does not restore a decision deleted during the Clerk request", async () => {
    action();
    hold = new Promise<void>(resolve => { release = resolve; });
    const pending = decide().catch(error => error);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    createWaitlistService(db).remove(email);
    release!();
    expect(await pending).toMatchObject({ status: 409, code: "decision_lease_lost" });
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    expect(db.prepare("select * from discord_outbox").all()).toEqual([]);
  });

  it("claims the lease before HTTP and keeps the first actor across double presses and conflicting decisions", async () => {
    action();
    hold = new Promise<void>(resolve => { release = resolve; });
    const first = decide();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect((await decide()).status).toBe("in_progress");
    expect((await decide("reject", { siteUserId: 3 }, "discord")).status).toBe("conflict");
    release!(); await first;
    expect((await decide()).action.actor_user_id).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it.each([["approve", "waitlist_entry_already_invited"], ["reject", "waitlist_entry_already_rejected"]] as const)
    ("treats Clerk 409 %s as success", async (decision, code) => {
      action(); status = 409; errorCode = code;
      expect((await decide(decision)).status).toBe("completed");
      expect((await decide(decision)).status).toBe("already_decided");
      expect(requests).toHaveLength(1);
    });

  it.each([500, 409])("keeps the pinned decision retryable on Clerk status %i", async failure => {
    action(); status = failure; errorCode = "unexpected_conflict";
    await expect(decide()).rejects.toMatchObject({ status: 503, code: "clerk_unavailable" });
    expect(db.prepare("select result from mod_actions where action='waitlist.approve'").all()).toEqual([{ result: "failure" }]);
    expect((await decide("reject")).status).toBe("conflict");
    status = 200;
    expect((await decide("approve", { siteUserId: 3 })).action.actor_user_id).toBe(1);
    expect(requests).toHaveLength(2);
  });

  it("fences an old HTTP completion after a replacement decision lease", async () => {
    action();
    hold = new Promise<void>(resolve => { release = resolve; });
    const first = decide().catch(error => error);
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    db.prepare("update discord_waitlist_actions set lease_expires_at=?").run(Date.now() - 1);
    const second = decide("approve", { siteUserId: 3 });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    release!();
    expect(await first).toMatchObject({ status: 409, code: "decision_lease_lost" });
    expect((await second).action.actor_user_id).toBe(1);
    expect(db.prepare("select count(*) as n from mod_actions where result='success'").get()).toEqual({ n: 1 });
  });

  it("recovers a crashed decision lease and waits for an unposted alert before claiming its edit", async () => {
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    db.prepare(`update discord_waitlist_actions set decision='approve',actor_user_id=1,actor_name='Owner',source='web',
      attempted_at=?,lease_expires_at=?,lease_token='crashed'`).run(Date.now() - 60_000, Date.now() - 1);
    expect((await decide()).status).toBe("completed");
    const posts = claimOutbox(db, 1);
    expect(posts).toHaveLength(1);
    expect(posts[0].payload_json).not.toContain("@example.test");
    markPosted(db, posts[0], { messageId: "after-restart" });
    const [edit] = claimOutbox(db, 10);
    expect(edit.message_id).toBe("after-restart");
  });

  it("removes decision and queued alert data on waitlist deletion, including direct SQLite deletes", async () => {
    createWaitlistService(db).join(email);
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    db.prepare("delete from waitlist_signups where email=?").run(email);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    expect(db.prepare("select * from discord_outbox").all()).toEqual([]);
    action();
    createWaitlistService(db).remove(email);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
  });

  it("uses one email normalization for waitlist joins and deletion, including legacy Unicode domains", () => {
    createWaitlistService(db).join("player@bücher.test");
    expect(createWaitlistService(db).remove("player@bücher.test").signups).toBe(1);
    db.prepare("insert into waitlist_signups(email,created_at,source) values(?,?,?)")
      .run("player@bücher.test", new Date().toISOString(), "legacy");
    expect(createWaitlistService(db).remove("player@bücher.test").signups).toBe(1);
    expect(db.prepare("select * from waitlist_signups").all()).toEqual([]);
  });

  it("clears signup alerts, decisions, audit rows and warnings on account deletion", async () => {
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    await notifyJoinRequest(db, { email, subjectId: "user_member", source: "sign-up" });
    addWarning(db, { guildId: "guild", actorSiteUserId: 1, targetDiscordId: "discord-member", reason: "Reason" });
    deleteUserAccount(db, 2);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    expect(db.prepare("select * from discord_outbox").all()).toEqual([]);
    expect(db.prepare("select * from mod_warnings").all()).toEqual([]);
  });

  it.each([["1", "waitlist-first"], ["0", "waitlist-first"], ["1", "signup-first"], ["0", "signup-first"]])
    ("keeps a stable deletion link after an email change: signup alerts %s, %s", async (signupAlerts, order) => {
    db.prepare("delete from users where id=2").run();
    vi.stubEnv("DISCORD_SIGNUP_ALERTS_ENABLED", signupAlerts);
    const signup = () => notifyJoinRequest(db, { email, subjectId: "user_member", source: "sign-up" });
    if (order === "signup-first") await signup();
    createWaitlistService(db).join(email);
    await notifyJoinRequest(db, { email, clerkEntryId: "wle_1", source: "Clerk waitlist" });
    // The signed signup can precede the first local user/session sync.
    if (order === "waitlist-first") await signup();
    db.prepare(`insert into users(id,username,display_name,clerk_user_id,email)
      values(2,'member','Member','user_member','new@example.test')`).run();
    deleteUserAccount(db, 2);
    expect(db.prepare("select * from discord_outbox").all()).toEqual([]);
    expect(db.prepare("select * from discord_waitlist_actions").all()).toEqual([]);
    expect(db.prepare("select * from join_request_notifications").all()).toEqual([]);
    expect(db.prepare("select * from waitlist_signups").all()).toEqual([]);
    expect(db.prepare("select * from discord_join_subjects").all()).toEqual([]);
  });
});
