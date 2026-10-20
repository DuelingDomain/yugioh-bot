import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { Routes, SlashCommandBuilder } from "discord.js";
import { openDatabase, migrate } from "@yugidraft/shared/db";
import { enqueueOutbox, type OutboxRow } from "@yugidraft/shared/discord-admin";
import { startBot } from "../../src/runtime/app.js";
import { deployCommands } from "../../src/runtime/deploy.js";
import type { FeatureModule } from "../../src/runtime/types.js";

const guildId = "100000000000000001";
const applicationId = "100000000000000002";
const userId = "100000000000000003";
const channelId = "100000000000000004";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function discordStub(options: { holdMessagePosts?: boolean; holdMessageBody?: boolean; holdGuildFetch?: boolean;
  channelGuildId?: string; messageStatus?: number; editStatus?: number;
  globalRateLimit?: boolean; exhaustedMessageBucket?: boolean } = {}) {
  const requests: { method: string; path: string; body: any }[] = [];
  let socket: WebSocket | undefined;
  let sequence = 0;
  let intents = 0;
  let releaseMessage: (() => void) | undefined;
  let releaseGuild: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    requests.push({ method: req.method!, path: req.url!, body });
    res.setHeader("content-type", "application/json");
    const path = req.url!.replace("/api/v10", "");
    if (path === "/gateway/bot") res.end(JSON.stringify({ url: gatewayUrl, shards: 1,
      session_start_limit: { total: 1000, remaining: 1000, reset_after: 60_000, max_concurrency: 1 } }));
    else if (path.split("?")[0] === `/guilds/${guildId}`) {
      if (options.holdGuildFetch) await new Promise<void>(resolve => { releaseGuild = resolve; });
      res.end(JSON.stringify({ id: guildId, name: "Test guild",
        roles: [], emojis: [], stickers: [], features: [], owner_id: userId }));
    }
    else if (path.startsWith(`/guilds/${guildId}/members/`)) res.end(JSON.stringify({ user: { id: path.split("/").at(-1), username: "Tester" }, roles: ["moderator"], joined_at: new Date().toISOString() }));
    else if (path.includes("/commands")) res.end(JSON.stringify(body));
    else if (path.includes("/callback")) { res.removeHeader("content-type"); res.statusCode = 204; res.end(); }
    else if (req.method === "GET" && path.startsWith("/channels/")) {
      res.end(JSON.stringify({ id: path.split("/").at(-1), guild_id: options.channelGuildId ?? guildId, type: 0 }));
    }
    else {
      if (options.holdMessagePosts && req.method === "POST" && path.startsWith("/channels/")) {
        await new Promise<void>(resolve => { releaseMessage = resolve; });
      }
      const status = req.method === "PATCH" ? options.editStatus : options.messageStatus;
      if (path.startsWith("/channels/") && status && status >= 400) {
        res.statusCode = status;
        if (status === 429) {
          res.setHeader("retry-after", "120");
          if (options.globalRateLimit) res.setHeader("x-ratelimit-global", "true");
        }
        res.end(JSON.stringify({ code: status === 404 ? 10008 : 50013, message: "Private upstream error",
          ...(status === 429 ? { retry_after: 120, global: options.globalRateLimit ?? false } : {}) }));
        return;
      }
      if (options.exhaustedMessageBucket && req.method === "POST" && path.startsWith("/channels/")) {
        res.setHeader("x-ratelimit-limit", "1"); res.setHeader("x-ratelimit-remaining", "0");
        res.setHeader("x-ratelimit-reset-after", "120"); res.setHeader("x-ratelimit-bucket", "test-message-bucket");
      }
      if (options.holdMessageBody && req.method === "POST" && path.startsWith("/channels/")) {
        res.write("{");
        await new Promise<void>(resolve => { releaseMessage = resolve; });
        res.end("}");
        return;
      }
      res.end(JSON.stringify({ id: "100000000000000099", channel_id: channelId, content: "", author: { id: applicationId, username: "Bot", bot: true }, timestamp: new Date().toISOString(), attachments: [], embeds: [] }));
    }
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", client => {
    socket = client;
    client.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
    client.on("message", raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.op === 1) client.send(JSON.stringify({ op: 11, d: null }));
      if (packet.op === 2) {
        intents = packet.d.intents;
        client.send(JSON.stringify({ op: 0, t: "READY", s: ++sequence, d: {
          v: 10, user: { id: applicationId, username: "Bot", discriminator: "0000", bot: true },
          guilds: [], session_id: "test-session", resume_gateway_url: gatewayUrl,
          application: { id: applicationId, flags: 0 },
        } }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const gatewayUrl = `ws://127.0.0.1:${port}`;
  cleanups.push(async () => {
    releaseGuild?.(); releaseMessage?.();
    for (const client of ws.clients) client.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  return {
    api: `http://127.0.0.1:${port}/api`, requests, get intents() { return intents; },
    releaseMessage() { releaseMessage?.(); },
    interaction(data: Record<string, unknown>) {
      socket!.send(JSON.stringify({ op: 0, t: "INTERACTION_CREATE", s: ++sequence, d: {
        id: String(100000000000000100n + BigInt(sequence)), application_id: applicationId,
        token: `interaction-token-${sequence}`, version: 1, type: 2, guild_id: guildId,
        channel: { id: channelId, type: 0 }, channel_id: channelId, locale: "en-US", guild_locale: "en-US",
        app_permissions: "0", entitlements: [], authorizing_integration_owners: { "0": guildId }, context: 0,
        member: { user: { id: userId, username: "Tester", discriminator: "0000" }, roles: [], permissions: "0", joined_at: new Date().toISOString() },
        ...data,
      } }));
    },
  };
}

const probe: FeatureModule = {
  commands: [{ data: new SlashCommandBuilder().setName("probe").setDescription("Integration probe"), access: "public",
    async execute(interaction) { await interaction.reply({ content: "Ready @everyone" }); } }],
  buttons: [], modals: [],
};

it("bulk replaces only guild commands using the same registry as the dispatcher", async () => {
  const stub = await discordStub();
  await deployCommands({ token: "stub-token", clientId: applicationId, guildId, restApi: stub.api }, [probe]);
  const put = stub.requests.find(request => request.method === "PUT")!;
  expect(put.path).toBe(`/api/v10/applications/${applicationId}/guilds/${guildId}/commands`);
  expect(put.body).toMatchObject([{ name: "probe", contexts: [0], default_member_permissions: null }]);
  await deployCommands({ token: "stub-token", clientId: applicationId, guildId, restApi: stub.api }, []);
  expect(stub.requests.at(-1)!.body).toEqual([]);
});

it("connects with the exact intents, dispatches gateway interactions, refuses other guilds and drains on shutdown", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-runtime-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const healthPath = join(directory, "heartbeat.json");
  const db = openDatabase(join(directory, "bot.sqlite"));
  db.prepare("insert into bot_heartbeat(id,at,pid) values(1,0,999999)").run();
  const monitor = openDatabase(join(directory, "bot.sqlite"));
  cleanups.push(() => { monitor.close(); });
  let featureStopped = false;
  const feature: FeatureModule = { ...probe, async start() { return async () => { featureStopped = true; }; } };
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId,
    restApi: stub.api, healthPath, moderatorRoleId: "moderator" }, db, modules: [feature] });
  cleanups.push(() => bot.stop());
  expect(stub.intents).toBe(1 | 2 | 4 | 2097152);
  expect(JSON.parse(readFileSync(healthPath, "utf8"))).toMatchObject({ state: "ready", pid: process.pid });
  expect(monitor.prepare("select * from bot_heartbeat").get()).toEqual({ id: 1, at: expect.any(Number), pid: process.pid });
  migrate(monitor); migrate(monitor);
  expect(monitor.prepare("select pid from bot_heartbeat").get()).toEqual({ pid: process.pid });
  stub.interaction({ data: { name: "probe", type: 1, id: applicationId, options: [] } });
  await expect.poll(() => stub.requests.find(request => request.method === "PATCH")?.body.content).toBe("Ready @everyone");
  expect(stub.requests.find(request => request.method === "PATCH")?.body.allowed_mentions).toEqual({ parse: [], replied_user: false });
  stub.interaction({ guild_id: "100000000000000009", data: { name: "probe", type: 1, id: applicationId } });
  await expect.poll(() => stub.requests.filter(request => request.path.includes("/callback")).length).toBe(2);
  expect(stub.requests.filter(request => request.path.includes("/callback")).at(-1)!.body.data.content).toContain("server");
  stub.interaction({ guild_id: undefined, member: undefined, user: { id: userId, username: "Tester" },
    data: { name: "probe", type: 1, id: applicationId } });
  await expect.poll(() => stub.requests.filter(request => request.path.includes("/callback")).length).toBe(3);
  expect(stub.requests.filter(request => request.path.includes("/callback")).at(-1)!.body.data.flags).toBe(64);
  await bot.stop();
  expect(featureStopped).toBe(true);
  expect(db.open).toBe(false);
  expect(existsSync(healthPath)).toBe(false);
  expect(monitor.prepare("select * from bot_heartbeat").all()).toEqual([]);
});

it("routes button and modal prefixes and preserves the source on handler failures", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-components-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const feature: FeatureModule = {
    commands: [],
    buttons: [{ prefix: "probe:", access: "public", async execute(interaction) { await interaction.reply({ content: "Button routed" }); } },
      { prefix: "failure:", access: "public", acknowledgement: "deferUpdate", async execute() { throw new Error("Integration failure probe"); } }],
    modals: [{ prefix: "probe:", access: "public", async execute(interaction) {
      await interaction.reply({ content: `Modal: ${interaction.fields.getTextInputValue("reason")}` });
    } }],
  };
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId,
    restApi: stub.api, healthPath: join(directory, "health.json") },
    db: openDatabase(join(directory, "bot.sqlite")), modules: [feature] });
  cleanups.push(() => bot.stop());
  stub.interaction({ type: 3, data: { component_type: 2, custom_id: "probe:button" },
    message: { id: channelId, content: "", author: { id: applicationId, username: "Bot" }, attachments: [], embeds: [] } });
  await expect.poll(() => stub.requests.find(request => request.body?.content === "Button routed") !== undefined).toBe(true);
  stub.interaction({ type: 5, data: { custom_id: "probe:modal", components: [{ type: 1, components: [{ type: 4, custom_id: "reason", value: "Test" }] }] } });
  await expect.poll(() => stub.requests.find(request => request.body?.content === "Modal: Test") !== undefined).toBe(true);
  const sourceEdits = stub.requests.filter(request => request.method === "PATCH").length;
  stub.interaction({ type: 3, data: { component_type: 2, custom_id: "failure:probe" },
    message: { id: channelId, content: "", author: { id: applicationId, username: "Bot" }, attachments: [], embeds: [] } });
  await expect.poll(() => stub.requests.find(request => request.method === "POST" && request.path.includes("/webhooks/")
    && request.body?.content === "The action could not be completed. Try again later.") !== undefined).toBe(true);
  expect(stub.requests.at(-1)!.body.flags).toBe(64);
  expect(stub.requests.filter(request => request.method === "PATCH")).toHaveLength(sourceEdits);
});

it("rejects conflicting module registrations before network access", async () => {
  const stub = await discordStub();
  await expect(deployCommands({ token: "stub-token", clientId: applicationId, guildId, restApi: stub.api }, [probe, probe]))
    .rejects.toThrow("Duplicate command name");
  expect(stub.requests).toEqual([]);
});

it("drains an active REST operation before closing SQLite and the gateway", async () => {
  const stub = await discordStub({ holdMessagePosts: true });
  const directory = mkdtempSync(join(tmpdir(), "discord-drain-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const feature: FeatureModule = { commands: [{ data: new SlashCommandBuilder().setName("postprobe").setDescription("Post probe"),
    access: "public", async execute(interaction, context) {
      await context.rest.post(Routes.channelMessages(channelId), { body: { content: "Drain probe" } });
      await interaction.reply({ content: "Posted" });
    } }], buttons: [], modals: [] };
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId,
    restApi: stub.api, healthPath: join(directory, "health.json") },
    db: openDatabase(join(directory, "bot.sqlite")), modules: [feature] });
  cleanups.push(async () => { stub.releaseMessage(); await bot.stop(); });
  stub.interaction({ data: { name: "postprobe", type: 1, id: applicationId } });
  await expect.poll(() => stub.requests.some(request => request.body?.content === "Drain probe")).toBe(true);
  let stopped = false;
  const stopping = bot.stop().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(stopped).toBe(false);
  expect(bot.context.db.open).toBe(true);
  stub.releaseMessage();
  await stopping;
  expect(bot.context.db.open).toBe(false);
  expect(stub.requests.some(request => request.body?.content === "Posted")).toBe(true);
});

it("closes startup resources when the application ID does not match the bot token", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-bad-app-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  await expect(startBot({ config: { token: "stub-token", clientId: "100000000000000009", guildId,
    restApi: stub.api, healthPath: join(directory, "health.json") }, db, modules: [] }))
    .rejects.toThrow("DISCORD_CLIENT_ID does not match");
  expect(db.open).toBe(false);
  expect(existsSync(join(directory, "health.json"))).toBe(false);
});

it("cancels a held startup guild request and closes SQLite before the server responds", async () => {
  const stub = await discordStub({ holdGuildFetch: true });
  const directory = mkdtempSync(join(tmpdir(), "discord-startup-cancel-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  const controller = new AbortController();
  const result = startBot({ config: { token: "stub-token", clientId: applicationId, guildId,
    restApi: stub.api, healthPath: join(directory, "health.json") }, db, modules: [], signal: controller.signal })
    .then(bot => bot.stop(), error => error);
  await expect.poll(() => stub.requests.some(request => request.path.includes(`/guilds/${guildId}`))).toBe(true);
  controller.abort();
  await expect.poll(() => db.open).toBe(false);
  expect(await result).toBeInstanceOf(Error);
  expect(existsSync(join(directory, "health.json"))).toBe(false);
});

function queueMessage(db: ReturnType<typeof openDatabase>, key: string, operation: "post" | "edit" = "post") {
  return enqueueOutbox(db, { idempotencyKey: key, kind: "mod_log", channelId, operation,
    ...(operation === "edit" ? { messageId: "100000000000000098" } : {}),
    payload: { content: key, embeds: [{ description: "@everyone" }] } });
}
function outboxRow(db: ReturnType<typeof openDatabase>, id: number) {
  return db.prepare<[number], OutboxRow>("select * from discord_outbox where id=?").get(id)!;
}

it("delivers stored post/edit bodies through the real shared outbox and skips terminal rows after restart", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "bot.sqlite");
  const db = openDatabase(path);
  const postId = queueMessage(db, "durable-post");
  const editId = queueMessage(db, "durable-edit", "edit");
  const nonce = JSON.parse(outboxRow(db, postId).payload_json!).nonce;
  // Even an old or malformed producer cannot enable mentions at the REST edge.
  db.prepare("update discord_outbox set payload_json=json_set(payload_json,'$.allowed_mentions',json(?))")
    .run(JSON.stringify({ parse: ["everyone"], users: [userId], roles: [guildId], replied_user: true }));
  const options = { config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, modules: [] };
  const bot = await startBot({ ...options, db });
  cleanups.push(() => bot.stop());
  await expect.poll(() => outboxRow(db, editId).status).toBe("posted");
  for (const id of [postId, editId]) {
    expect(outboxRow(db, id)).toMatchObject({ status: "posted", attempts: 1, payload_json: null,
      channel_id: channelId, message_id: "100000000000000099" });
  }
  const messages = stub.requests.filter(request => request.method !== "GET" && request.path.startsWith(`/api/v10/channels/${channelId}/messages`));
  expect(messages.map(request => request.method)).toEqual(["POST", "PATCH"]);
  expect(messages[0].body).toMatchObject({ content: "durable-post", nonce, enforce_nonce: true,
    allowed_mentions: { parse: [], users: [], roles: [], replied_user: false } });
  expect(messages[1].path).toBe(`/api/v10/channels/${channelId}/messages/100000000000000098`);
  expect(messages[1].body.allowed_mentions).toEqual(messages[0].body.allowed_mentions);
  await bot.stop();
  const restarted = await startBot({ ...options, db: openDatabase(path) });
  cleanups.push(() => restarted.stop());
  expect(stub.requests.filter(request => request.method === "POST" && request.path.includes("/channels/"))).toHaveLength(1);
});

it.each([
  [429, "failed", "rate_limited"], [500, "failed", "transport"],
  [400, "dead", "invalid_payload"], [403, "dead", "rejected"],
] as const)("stores safe retry state for Discord HTTP %s", async (messageStatus, status, code) => {
  const stub = await discordStub({ messageStatus });
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-failure-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  const id = queueMessage(db, "retry-probe");
  const before = Date.now();
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, db, modules: [] });
  cleanups.push(() => bot.stop());
  await expect.poll(() => outboxRow(db, id).status).toBe(status);
  const row = outboxRow(db, id);
  expect(row).toMatchObject({ attempts: 1, last_error: code, lease_token: null });
  expect(row.payload_json === null).toBe(status === "dead");
  expect(JSON.stringify(row)).not.toContain("Private upstream error");
  expect(row.available_at).toBeGreaterThanOrEqual(before + (messageStatus === 429 ? 120_000 : 1000));
  expect(stub.requests.filter(request => request.method === "POST" && request.path.includes("/channels/"))).toHaveLength(1);
});

it("isolates invalid JSON and foreign-guild rows, then acknowledges a deleted edit target", async () => {
  const stub = await discordStub({ channelGuildId: "100000000000000009" });
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-refused-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  const invalid = queueMessage(db, "invalid");
  db.prepare("update discord_outbox set payload_json='{' where id=?").run(invalid);
  const foreign = queueMessage(db, "foreign");
  const options = { config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, db, modules: [] };
  const bot = await startBot(options);
  cleanups.push(() => bot.stop());
  await expect.poll(() => outboxRow(db, foreign).status).toBe("dead");
  expect(outboxRow(db, invalid)).toMatchObject({ status: "dead", last_error: "invalid_payload", payload_json: null });
  expect(outboxRow(db, foreign)).toMatchObject({ last_error: "rejected", payload_json: null });
  expect(stub.requests.some(request => request.method === "POST" && request.path.includes("/channels/"))).toBe(false);

  const deletedStub = await discordStub({ editStatus: 404 });
  const deletedDb = openDatabase(join(directory, "deleted.sqlite"));
  const deleted = queueMessage(deletedDb, "deleted", "edit");
  const deletedBot = await startBot({ ...options, db: deletedDb,
    config: { ...options.config, restApi: deletedStub.api, healthPath: join(directory, "deleted-health.json") } });
  cleanups.push(() => deletedBot.stop());
  await expect.poll(() => outboxRow(deletedDb, deleted).status).toBe("posted");
  expect(outboxRow(deletedDb, deleted)).toMatchObject({ message_id: "100000000000000098", payload_json: null, attempts: 1 });
});

it("drains one claimed message on shutdown and leaves later rows pending", async () => {
  const stub = await discordStub({ holdMessagePosts: true });
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-drain-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "bot.sqlite");
  const db = openDatabase(path);
  const first = queueMessage(db, "held-post");
  const second = queueMessage(db, "later-post");
  const monitor = openDatabase(path);
  cleanups.push(() => { monitor.close(); });
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, db, modules: [] });
  cleanups.push(async () => { stub.releaseMessage(); await bot.stop(); });
  await expect.poll(() => stub.requests.some(request => request.body?.content === "held-post")).toBe(true);
  let stopped = false;
  const stopping = bot.stop().then(() => { stopped = true; });
  await new Promise(resolve => setTimeout(resolve, 25));
  expect(stopped).toBe(false);
  expect(outboxRow(monitor, first).status).toBe("processing");
  expect(outboxRow(monitor, second)).toMatchObject({ status: "pending", attempts: 0 });
  stub.releaseMessage();
  await stopping;
  expect(outboxRow(monitor, first).status).toBe("posted");
  expect(outboxRow(monitor, second)).toMatchObject({ status: "pending", attempts: 0 });
});

it("refreshes database health only while ready and does not clear another process's heartbeat", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-heartbeat-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  cleanups.push(() => { vi.useRealTimers(); });
  const db = openDatabase(join(directory, "bot.sqlite"));
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, db, modules: [] });
  cleanups.push(() => bot.stop());
  db.prepare("update bot_heartbeat set at=0").run();
  vi.advanceTimersByTime(30_000);
  expect(db.prepare<[], { at: number }>("select at from bot_heartbeat").get()!.at).toBeGreaterThan(0);
  // Exercise a real Gateway disconnect before the next heartbeat interval.
  await bot.client.destroy();
  vi.advanceTimersByTime(30_000);
  expect(db.prepare("select * from bot_heartbeat").all()).toEqual([]);
  db.prepare("insert into bot_heartbeat(id,at,pid) values(1,0,999999)").run();
  const monitor = openDatabase(join(directory, "bot.sqlite"));
  cleanups.push(() => { monitor.close(); });
  await bot.stop();
  expect(monitor.prepare("select pid from bot_heartbeat").get()).toEqual({ pid: 999999 });
});

it.each(["global", "bucket"])("exits without lingering REST timers after a %s rate limit", async kind => {
  const stub = await discordStub(kind === "global"
    ? { messageStatus: 429, globalRateLimit: true } : { exhaustedMessageBucket: true });
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-exit-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const db = openDatabase(join(directory, "bot.sqlite"));
  queueMessage(db, "first-exit-probe"); queueMessage(db, "second-exit-probe");
  db.close();
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const source = `
    import { writeSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { openDatabase } from '@yugidraft/shared/db';
    import { startBot } from './packages/bot/src/runtime/app.ts';
    const db = openDatabase(${JSON.stringify(join(directory, "bot.sqlite"))});
    const bot = await startBot({ db, modules: [], config: ${JSON.stringify({ token: "stub-token", clientId: applicationId,
      guildId, restApi: stub.api, healthPath: join(directory, "health.json") })} });
    while (['pending','processing'].includes(db.prepare('select status from discord_outbox where id=1').get().status)) await delay(10);
    if (${JSON.stringify(kind)} === 'bucket') {
      while (['pending','processing'].includes(db.prepare('select status from discord_outbox where id=2').get().status)) await delay(10);
    }
    const states = db.prepare('select status from discord_outbox order by id').all().map(row => row.status);
    await bot.stop();
    writeSync(1, JSON.stringify(states));
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const closed = new Promise<number | null>(resolve => child.once("close", resolve));
  try {
    await expect.poll(() => stdout !== "" || child.exitCode !== null, { timeout: 5000 }).toBe(true);
    await expect.poll(() => child.exitCode !== null, { timeout: 2000 }).toBe(true);
    expect(await closed, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual(kind === "global" ? ["failed", "pending"] : ["posted", "posted"]);
  } finally {
    child.kill("SIGKILL");
    await closed;
  }
}, 15_000);

it("bounds a stalled response body within the container shutdown grace", async () => {
  const stub = await discordStub({ holdMessageBody: true });
  const directory = mkdtempSync(join(tmpdir(), "discord-outbox-body-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "bot.sqlite");
  const db = openDatabase(path);
  const first = queueMessage(db, "slow-body");
  const second = queueMessage(db, "later-body");
  const monitor = openDatabase(path);
  cleanups.push(() => { monitor.close(); });
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId, restApi: stub.api,
    healthPath: join(directory, "health.json") }, db, modules: [] });
  cleanups.push(async () => { stub.releaseMessage(); await bot.stop(); });
  await expect.poll(() => stub.requests.some(request => request.body?.content === "slow-body")).toBe(true);
  const before = Date.now();
  await bot.stop();
  expect(Date.now() - before).toBeLessThan(40_000);
  expect(outboxRow(monitor, first)).toMatchObject({ status: "failed", last_error: "transport", lease_token: null });
  expect(outboxRow(monitor, second)).toMatchObject({ status: "pending", attempts: 0 });
  expect(monitor.prepare("select * from bot_heartbeat").all()).toEqual([]);
}, 40_000);
