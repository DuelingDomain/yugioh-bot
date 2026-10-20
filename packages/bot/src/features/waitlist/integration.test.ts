import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Client, REST, Routes, MessageFlags, type Interaction } from "discord.js";
import { openDatabase } from "@yugidraft/shared/db";
import { createClerkBackend, type ClerkWaitlistEntryJson } from "@yugidraft/shared/clerk";
import { enqueueJoinRequest } from "@yugidraft/shared/notify";
import { decideWaitlistEntry } from "@yugidraft/shared/services/waitlist-decisions";
import { createWaitlistService } from "@yugidraft/shared/services";
import { deployCommands } from "../../runtime/deploy.js";
import { createDispatcher } from "../../runtime/dispatcher.js";
import { createRegistry } from "../../runtime/registry.js";
import { loadSharedAdminServices } from "../../runtime/shared.js";
import { createAudit } from "../../runtime/audit.js";
import { Cooldown } from "../../runtime/cooldown.js";
import { createOutboxDelivery, startOutboxPoller } from "../../runtime/outbox.js";
import type { FeatureContext, FeatureModule, Stop } from "../../runtime/types.js";
import { createWaitlistFeature, waitlist } from "./index.js";

const guildId = "100000000000000001";
const channelId = "100000000000000002";
const adminId = "100000000000000003";
const modLogId = "100000000000000004";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function fixture() {
  vi.stubEnv("DISCORD_BOT_ENABLED", "1");
  vi.stubEnv("DISCORD_ADMIN_OUTBOX_ENABLED", "1");
  vi.stubEnv("DISCORD_GUILD_ID", guildId);
  vi.stubEnv("DISCORD_WAITLIST_CHANNEL_ID", channelId);
  vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", modLogId);
  vi.stubEnv("OWNER_USER_IDS", "1");
  vi.stubEnv("CLERK_SECRET_KEY", "stub-key");
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", "0");
  const directory = mkdtempSync(join(tmpdir(), "bot-waitlist-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  cleanups.push(() => { if (db.open) db.close(); });
  db.prepare(`insert into users(id,clerk_user_id,discord_user_id,username,display_name,email)
    values(1,'user_owner',?,'owner','Owner','owner@example.com')`).run(adminId);
  const requests: { method: string; path: string; body: any }[] = [];
  const entries: ClerkWaitlistEntryJson[] = [];
  let clerkStatus = 200;
  let listStatus = 200;
  let discordStatus = 200;
  let hold: Promise<void> | undefined;
  let release: (() => void) | undefined;
  let listHold: Promise<void> | undefined;
  let releaseList: (() => void) | undefined;
  let messages = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method!, path: req.url!, body });
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url!, "http://localhost");
    if (url.pathname === "/v1/waitlist_entries") {
      if (listHold) await listHold;
      if (listStatus !== 200) {
        res.statusCode = listStatus;
        res.end(JSON.stringify({ errors: [{ code: "unavailable", message: "private@example.com" }] })); return;
      }
      const query = url.searchParams.get("query")?.toLowerCase();
      const status = url.searchParams.get("status");
      const filtered = entries.filter(e => (!query || e.email_address.toLowerCase().includes(query) || e.id.includes(query)) && (!status || e.status === status));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 10);
      res.end(JSON.stringify({ data: filtered.slice(offset, offset + limit), total_count: filtered.length }));
    } else if (url.pathname.startsWith("/v1/users/")) {
      res.end(JSON.stringify({ id: "user_new", primary_email_address_id: "email_new", email_addresses: [{ id: "email_new", email_address: "newuser@example.com" }] }));
    } else if (url.pathname.startsWith("/v1/waitlist_entries/")) {
      if (hold) await hold;
      const invite = url.pathname.endsWith("/invite");
      res.statusCode = clerkStatus;
      if (clerkStatus === 409) res.end(JSON.stringify({ errors: [{ code: invite ? "waitlist_entry_already_invited" : "waitlist_entry_already_rejected" }] }));
      else if (clerkStatus !== 200) res.end(JSON.stringify({ errors: [{ code: "server_error", message: "private@example.com upstream failure" }] }));
      else {
        const entry = entries.find(e => e.id === url.pathname.split("/").at(-2));
        if (entry) entry.status = invite ? "invited" : "rejected";
        res.end("{}");
      }
    } else if (req.method === "GET" && url.pathname.includes("/channels/")) {
      res.end(JSON.stringify({ id: url.pathname.split("/").at(-1), guild_id: guildId, type: 0 }));
    } else if (url.pathname.includes("/channels/")) {
      res.statusCode = discordStatus;
      if (discordStatus !== 200) res.end(JSON.stringify({ code: discordStatus === 404 ? 10008 : 50013, message: "Refused" }));
      else res.end(JSON.stringify({ id: req.method === "POST" ? String(200000000000000000n + BigInt(++messages)) : url.pathname.split("/").at(-1), channel_id: url.pathname.split("/")[4] }));
    } else if (url.pathname.includes("/callback")) {
      res.removeHeader("content-type"); res.statusCode = 204; res.end();
    } else res.end(JSON.stringify({ id: "300000000000000001", channel_id: channelId }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    release?.(); releaseList?.();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const backend = createClerkBackend({ secretKey: "stub-key", apiUrl: `${base}/v1` });
  const rest = new REST({ api: `${base}/api`, retries: 0, rejectOnRateLimit: () => true }).setToken("stub-token");
  cleanups.push(() => { rest.clearHashSweeper(); rest.clearHandlerSweeper(); });
  const shared = await loadSharedAdminServices(db);
  const controller = new AbortController();
  const client = new Client({ intents: [] });
  cleanups.push(() => client.destroy());
  const context: FeatureContext = { db, shared, rest, client, signal: controller.signal,
    config: { token: "stub-token", clientId: "100000000000000009", guildId, waitlistChannelId: channelId, modLogChannelId: modLogId, restApi: `${base}/api`, healthPath: join(directory, "health.json") },
    audit: createAudit(shared, guildId), cooldown: new Cooldown() };
  let sequence = 0;
  async function dispatch(module: FeatureModule, options: { button?: string; actor?: string; guild?: string | null; action?: string; entry?: string; page?: number } = {}) {
    const id = String(400000000000000000n + BigInt(++sequence));
    const token = `token-${sequence}`;
    const raw = {
      id, token, guildId: options.guild === undefined ? guildId : options.guild, channelId,
      user: { id: options.actor ?? adminId, username: "Owner", displayName: "Owner" },
      commandName: "waitlist", customId: options.button,
      isButton: () => !!options.button, isMessageComponent: () => !!options.button,
      isChatInputCommand: () => !options.button, isAutocomplete: () => false, isModalSubmit: () => false, isRepliable: () => true,
      deferred: false, replied: false,
      options: { getString: (name: string) => name === "action" ? options.action ?? null : name === "entry" ? options.entry ?? null : null,
        getInteger: () => options.page ?? null, getSubcommand: () => null },
      async deferReply(data: unknown) { raw.deferred = true; await rest.post(Routes.interactionCallback(id, token), { body: { type: 5, data } }); },
      async deferUpdate() { raw.deferred = true; await rest.post(Routes.interactionCallback(id, token), { body: { type: 6 } }); },
      async reply(data: unknown) { raw.replied = true; await rest.post(Routes.interactionCallback(id, token), { body: { type: 4, data } }); },
      async editReply(body: unknown) { await rest.patch(Routes.webhookMessage(context.config.clientId, token, "@original"), { body }); },
      async followUp(body: unknown) { await rest.post(Routes.webhook(context.config.clientId, token), { body }); },
    };
    await createDispatcher(createRegistry([module]), context)(raw as unknown as Interaction);
    return requests.filter(r => r.path.includes(token));
  }
  async function start(module: FeatureModule) {
    const stopFeature = await module.start?.(context);
    const stopPoller = startOutboxPoller({ shared: context.shared, guildId, signal: controller.signal, intervalMs: 10,
      deliver: createOutboxDelivery({ token: "stub-token", restApi: `${base}/api`, guildId, signal: controller.signal }) });
    const stop: Stop = async () => { await stopPoller(); await stopFeature?.(); };
    cleanups.push(stop);
    return stop;
  }
  function enqueue(id = "wle_test", email = "member@example.com") {
    entries.push({ id, email_address: email, status: "pending", created_at: Date.now() });
    enqueueJoinRequest(db, { email, clerkEntryId: id, source: "Clerk waitlist", createdAt: new Date().toISOString() });
    return db.prepare<[], { id: string }>("select id from discord_waitlist_actions order by created_at desc,rowid desc limit 1").get()!.id;
  }
  return { db, requests, entries, backend, context, dispatch, start, enqueue,
    setListStatus(status: number) { listStatus = status; },
    holdList() { listHold = new Promise<void>(resolve => { releaseList = resolve; }); },
    releaseList() { releaseList?.(); listHold = undefined; },
    setClerkStatus(status: number) { clerkStatus = status; }, setDiscordStatus(status: number) { discordStatus = status; },
    holdClerk() { hold = new Promise<void>(resolve => { release = resolve; }); },
    releaseClerk() { release?.(); hold = undefined; },
  };
}

it("refuses a non-admin through the real dispatcher and records the denial", async () => {
  const f = await fixture();
  const replies = await f.dispatch(waitlist, { actor: "100000000000000099" });
  expect(JSON.stringify(replies)).toContain("You do not have access");
  expect(f.db.prepare("select result from mod_actions").all()).toEqual([{ result: "denied" }]);
  expect(f.requests.some(r => r.path.startsWith("/v1/"))).toBe(false);
});

const posts = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.method === "POST" && r.path.endsWith(`/channels/${channelId}/messages`));
const edits = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.method === "PATCH" && r.path.includes(`/channels/${channelId}/messages/`));
const clerkDecisions = (f: Awaited<ReturnType<typeof fixture>>) => f.requests.filter(r => r.method === "POST" && r.path.startsWith("/v1/waitlist_entries/"));
const replyText = (replies: { body: any }[]) => replies.map(r => r.body?.content ?? r.body?.data?.content ?? "").join(" ");

it.each([false, true])("posts waitlist and signup embeds with the email flag %s and no signup buttons", async fullEmail => {
  const f = await fixture();
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", fullEmail ? "1" : "0");
  f.enqueue();
  enqueueJoinRequest(f.db, { email: "newuser@example.com", subjectId: "user_new", source: "sign-up" });
  await f.start(createWaitlistFeature({ backend: f.backend }));
  await expect.poll(() => posts(f).length).toBe(2);
  const [pending, signup] = posts(f);
  expect(JSON.stringify(pending.body)).toContain(fullEmail ? "member@example.com" : "m***@example.com");
  expect(JSON.stringify(signup.body)).toContain(fullEmail ? "newuser@example.com" : "n***@example.com");
  if (!fullEmail) expect(JSON.stringify(posts(f))).not.toContain("member@example.com");
  expect(pending.body.embeds[0].fields).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "Source" }), expect.objectContaining({ name: "When", value: expect.stringContaining("<t:") }),
    { name: "Position", value: "1", inline: true }, { name: "Pending", value: "1", inline: true },
  ]));
  expect(pending.body.components[0].components.map((button: any) => button.label)).toEqual(["Approve", "Reject"]);
  expect(signup.body.components).toEqual([]);
  for (const post of posts(f)) expect(post.body).toMatchObject({ enforce_nonce: true, nonce: expect.any(String), allowed_mentions: { parse: [] } });
  expect(f.db.prepare("select status,payload_json from discord_outbox").all()).toEqual([
    { status: "posted", payload_json: null }, { status: "posted", payload_json: null },
  ]);
});

it.each(["approve", "reject"] as const)("makes %s idempotent, edits the alert and sends one mod-log line", async decision => {
  const f = await fixture();
  const id = f.enqueue();
  const feature = createWaitlistFeature({ backend: f.backend });
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  const reply = await f.dispatch(feature, { button: `wl:${decision}:${id}` });
  expect(reply[0].body).toMatchObject({ type: 5, data: { flags: 64 } });
  expect(replyText(reply)).toContain(decision === "approve" ? "Approved by Owner · <t:" : "Rejected by Owner · <t:");
  await expect.poll(() => edits(f).length).toBe(1);
  expect(edits(f)[0].body).toMatchObject({ components: [], embeds: [], content: expect.stringContaining("by Owner · <t:") });
  expect(JSON.stringify(edits(f))).not.toContain("member@example.com");
  const again = await f.dispatch(feature, { button: `wl:${decision === "approve" ? "reject" : "approve"}:${id}` });
  expect(replyText(again)).toContain("Already decided");
  expect(clerkDecisions(f)).toHaveLength(1);
  expect(f.db.prepare("select action,result from mod_actions").all()).toEqual([{ action: `waitlist.${decision}`, result: "success" }]);
  await expect.poll(() => f.requests.filter(r => r.method === "POST" && r.path.endsWith(`/channels/${modLogId}/messages`)).length).toBe(1);
  expect(f.db.prepare("select discord_updated_at from discord_waitlist_actions").get()).toEqual({ discord_updated_at: expect.any(Number) });
});

it.each(["approve", "reject"] as const)("accepts Clerk 409 already-%s as success", async decision => {
  const f = await fixture();
  const id = f.enqueue();
  f.setClerkStatus(409);
  const feature = createWaitlistFeature({ backend: f.backend });
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  expect(replyText(await f.dispatch(feature, { button: `wl:${decision}:${id}` }))).toContain("by Owner");
  await expect.poll(() => edits(f).length).toBe(1);
  expect(f.db.prepare("select completed_at from discord_waitlist_actions").get()).toEqual({ completed_at: expect.any(Number) });
});

it("keeps buttons after Clerk 5xx, refuses a conflicting decision, and permits retry", async () => {
  const f = await fixture();
  const id = f.enqueue();
  const feature = createWaitlistFeature({ backend: f.backend });
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  f.setClerkStatus(500);
  const failure = await f.dispatch(feature, { button: `wl:approve:${id}` });
  expect(replyText(failure)).toContain("buttons are still available");
  expect(JSON.stringify(failure)).not.toContain("private@example.com");
  expect(edits(f)).toHaveLength(0);
  expect(replyText(await f.dispatch(feature, { button: `wl:reject:${id}` }))).toContain("already reserved");
  expect(clerkDecisions(f)).toHaveLength(1);
  f.setClerkStatus(200);
  await f.dispatch(feature, { button: `wl:approve:${id}` });
  await expect.poll(() => edits(f).length).toBe(1);
  expect(clerkDecisions(f)).toHaveLength(2);
  expect(f.db.prepare("select result from mod_actions order by id").all()).toEqual([{ result: "failure" }, { result: "success" }]);
});

it("fences concurrent approve/reject presses and double presses", async () => {
  const f = await fixture();
  const id = f.enqueue();
  const feature = createWaitlistFeature({ backend: f.backend });
  f.holdClerk();
  const first = f.dispatch(feature, { button: `wl:approve:${id}` });
  await expect.poll(() => clerkDecisions(f).length).toBe(1);
  expect(replyText(await f.dispatch(feature, { button: `wl:approve:${id}` }))).toContain("processing");
  expect(replyText(await f.dispatch(feature, { button: `wl:reject:${id}` }))).toContain("reserved");
  f.releaseClerk();
  await first;
  expect(clerkDecisions(f)).toHaveLength(1);
  expect(f.db.prepare("select decision,source,actor_discord_id from discord_waitlist_actions").get())
    .toEqual({ decision: "approve", source: "discord", actor_discord_id: adminId });
});

it("edits a posted alert after a web-source decision through the Phase 0 outbox path", async () => {
  const f = await fixture();
  f.enqueue();
  await f.start(createWaitlistFeature({ backend: f.backend }));
  await expect.poll(() => posts(f).length).toBe(1);
  await decideWaitlistEntry(f.db, { clerkEntryId: "wle_test", decision: "approve", actor: { siteUserId: 1 }, source: "web" }, f.backend);
  await expect.poll(() => edits(f).length).toBe(1);
  expect(edits(f)[0].body.content).toMatch(/Approved by Owner · <t:\d+:f> \(web\)/);
  expect(edits(f)[0].body.components).toEqual([]);
  expect(f.db.prepare("select discord_updated_at from discord_waitlist_actions").get()).toEqual({ discord_updated_at: expect.any(Number) });
});

it("posts only a final decision when the web decides before delivery and does not post again on restart", async () => {
  const f = await fixture();
  f.enqueue();
  await decideWaitlistEntry(f.db, { clerkEntryId: "wle_test", decision: "reject", actor: { siteUserId: 1 }, source: "web" }, f.backend);
  const feature = createWaitlistFeature({ backend: f.backend });
  const stop = await f.start(feature);
  await expect.poll(() => edits(f).length).toBe(1);
  expect(posts(f)).toHaveLength(1);
  expect(posts(f)[0].body).toMatchObject({ content: expect.stringContaining("Rejected by Owner · <t:"), components: [], embeds: [] });
  expect(JSON.stringify(posts(f))).not.toContain("m***@example.com");
  await stop();
  await f.start(feature);
  expect(posts(f)).toHaveLength(1);
});

it("lists ten pending entries with per-entry buttons and pages without duplicate custom IDs", async () => {
  const f = await fixture();
  for (let index = 0; index < 12; index++) f.entries.push({ id: `wle_${index}`, email_address: `member${index}@example.com`, status: "pending", created_at: Date.now() });
  const feature = createWaitlistFeature({ backend: f.backend });
  const first = await f.dispatch(feature);
  const body = first.at(-1)!.body;
  expect(body.flags).toBe(MessageFlags.IsComponentsV2);
  const rows = body.components.filter((component: any) => component.type === 1);
  expect(rows).toHaveLength(11);
  expect(rows.slice(0, 10).every((row: any) => row.components.length === 2)).toBe(true);
  const ids = rows.flatMap((row: any) => row.components.map((button: any) => button.custom_id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(JSON.stringify(body)).not.toContain("member0@example.com");
  const second = await f.dispatch(feature, { button: rows.at(-1).components[2].custom_id });
  expect(second.at(-1)!.body.components.filter((component: any) => component.type === 1)).toHaveLength(3);
  expect(JSON.stringify(second.at(-1)!.body)).toContain("Page 2/2");
  await f.dispatch(feature, { button: rows[0].components[0].custom_id });
  expect(clerkDecisions(f)[0].path).toBe("/v1/waitlist_entries/wle_0/invite");
});

it("approves by exact email or ID and refuses partial matches", async () => {
  const f = await fixture();
  f.entries.push({ id: "wle_email", email_address: "member@example.com", status: "pending" }, { id: "wle_id", email_address: "other@example.com", status: "pending" });
  const feature = createWaitlistFeature({ backend: f.backend });
  const partial = await f.dispatch(feature, { action: "approve", entry: "member" });
  expect(replyText(partial)).toContain("No exact entry");
  expect(clerkDecisions(f)).toHaveLength(0);
  expect(replyText(await f.dispatch(feature, { action: "approve", entry: "MEMBER@example.com" }))).toContain("Approved");
  expect(replyText(await f.dispatch(feature, { action: "reject", entry: "wle_id" }))).toContain("Rejected");
  expect(clerkDecisions(f).map(r => r.path)).toEqual(["/v1/waitlist_entries/wle_email/invite", "/v1/waitlist_entries/wle_id/reject"]);
});

it("re-checks admin access on stale alert and pagination buttons and refuses other guilds and DMs", async () => {
  const f = await fixture();
  const id = f.enqueue();
  const feature = createWaitlistFeature({ backend: f.backend });
  vi.stubEnv("OWNER_USER_IDS", "99");
  expect(replyText(await f.dispatch(feature, { button: `wl:approve:${id}` }))).toContain("do not have access");
  expect(replyText(await f.dispatch(feature, { button: "wlp:next:2" }))).toContain("do not have access");
  vi.stubEnv("OWNER_USER_IDS", "1");
  f.db.prepare("update users set discord_user_id=null where id=1").run();
  expect(replyText(await f.dispatch(feature, { action: "approve", entry: "wle_test" }))).toContain("do not have access");
  expect(replyText(await f.dispatch(feature, { button: `wl:approve:${id}`, guild: "100000000000000099" }))).toContain("configured server");
  expect(replyText(await f.dispatch(feature, { guild: null }))).toContain("configured server");
  expect(clerkDecisions(f)).toHaveLength(0);
});

it("registers guild-only admin command permissions at the Discord REST edge", async () => {
  const f = await fixture();
  await deployCommands(f.context.config, [createWaitlistFeature({ backend: f.backend })]);
  const definition = f.requests.find(r => r.method === "PUT")!.body[0];
  expect(definition).toMatchObject({ name: "waitlist", contexts: [0], default_member_permissions: "8" });
});

it("re-reads a web decision completed while a claimed alert is being enriched", async () => {
  const f = await fixture();
  f.enqueue();
  f.holdList();
  await f.start(createWaitlistFeature({ backend: f.backend }));
  await expect.poll(() => f.requests.some(r => r.path.startsWith("/v1/waitlist_entries?"))).toBe(true);
  await decideWaitlistEntry(f.db, { clerkEntryId: "wle_test", decision: "approve", source: "web", actor: { siteUserId: 1 } }, f.backend);
  f.releaseList();
  await expect.poll(() => edits(f).length).toBe(1);
  expect(posts(f)[0].body).toMatchObject({ content: expect.stringContaining("Approved by Owner"), embeds: [], components: [] });
  expect(JSON.stringify(posts(f))).not.toContain("m***@example.com");
});

it("does not deliver a subject deleted during enrichment, including with full email enabled", async () => {
  const f = await fixture();
  vi.stubEnv("DISCORD_ADMIN_SHOW_FULL_EMAIL", "1");
  f.enqueue();
  f.holdList();
  const stop = await f.start(createWaitlistFeature({ backend: f.backend }));
  await expect.poll(() => f.requests.some(r => r.path.startsWith("/v1/waitlist_entries?"))).toBe(true);
  expect(JSON.stringify(f.db.prepare("select payload_json from discord_outbox").all())).not.toContain("member@example.com");
  createWaitlistService(f.db).remove("member@example.com");
  f.releaseList();
  await stop();
  expect(posts(f)).toHaveLength(0);
  expect(f.db.prepare("select * from discord_outbox").all()).toEqual([]);
});

it("releases an undelivered claim on stop and posts it once after reopening SQLite", async () => {
  const f = await fixture();
  f.enqueue();
  f.holdList();
  const feature = createWaitlistFeature({ backend: f.backend });
  const stop = await f.start(feature);
  await expect.poll(() => f.requests.some(r => r.path.startsWith("/v1/waitlist_entries?"))).toBe(true);
  const stopping = stop();
  f.releaseList();
  await stopping;
  expect(posts(f)).toHaveLength(0);
  expect(f.db.prepare("select status,lease_token from discord_outbox").get()).toEqual({ status: "failed", lease_token: null });
  const path = f.db.name;
  f.db.close();
  const reopened = openDatabase(path);
  cleanups.push(() => { reopened.close(); });
  reopened.prepare("update discord_outbox set available_at=0").run();
  f.context.db = reopened;
  f.context.shared = await loadSharedAdminServices(reopened);
  f.context.audit = createAudit(f.context.shared, guildId);
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  expect(reopened.prepare("select status,attempts from discord_outbox").get()).toEqual({ status: "posted", attempts: 2 });
});

it("delivers masked alerts with a known pending count during a Clerk outage", async () => {
  const f = await fixture();
  f.enqueue();
  f.setListStatus(503);
  const feature = createWaitlistFeature({ backend: f.backend });
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  expect(posts(f)[0].body.embeds[0].fields).toContainEqual({ name: "Pending (known)", value: "1", inline: true });
  expect(posts(f)[0].body.components[0].components).toHaveLength(2);
  const replies = await f.dispatch(feature);
  expect(replyText(replies)).toContain("could not be completed");
  expect(JSON.stringify(replies)).not.toContain("private@example.com");
});

it.each([403, 404, 429])("preserves the Phase 0 edit policy for Discord %s after a decision", async status => {
  const f = await fixture();
  const id = f.enqueue();
  const feature = createWaitlistFeature({ backend: f.backend });
  await f.start(feature);
  await expect.poll(() => posts(f).length).toBe(1);
  f.setDiscordStatus(status);
  await f.dispatch(feature, { button: `wl:approve:${id}` });
  await expect.poll(() => f.db.prepare<[], { status: string }>("select status from discord_outbox where operation='edit'").get()?.status).toBe(status === 404 ? "posted" : status === 403 ? "dead" : "failed");
  const row = f.db.prepare<[], { last_error: string | null }>("select last_error from discord_outbox where operation='edit'").get()!;
  expect(row.last_error).toBe(status === 404 ? null : status === 403 ? "rejected" : "rate_limited");
  expect(f.db.prepare("select completed_at from discord_waitlist_actions").get()).toEqual({ completed_at: expect.any(Number) });
});

it("discards a poison decision edit without blocking other alerts", async () => {
  const f = await fixture();
  f.enqueue();
  await decideWaitlistEntry(f.db, { clerkEntryId: "wle_test", decision: "approve", source: "web", actor: { siteUserId: 1 } }, f.backend);
  f.db.prepare("update discord_outbox set payload_json='{' where kind='waitlist_decision'").run();
  enqueueJoinRequest(f.db, { email: "newuser@example.com", subjectId: "user_new", source: "sign-up" });
  await f.start(createWaitlistFeature({ backend: f.backend }));
  await expect.poll(() => posts(f).length).toBe(2);
  expect(f.db.prepare("select status,last_error from discord_outbox where kind='waitlist_decision'").get())
    .toEqual({ status: "dead", last_error: "invalid_payload" });
});
