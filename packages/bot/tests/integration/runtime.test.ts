import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, expect, it } from "vitest";
import { Routes, SlashCommandBuilder } from "discord.js";
import { openDatabase } from "@yugidraft/shared/db";
import { startBot } from "../../src/runtime/app.js";
import { deployCommands } from "../../src/runtime/deploy.js";
import type { FeatureModule } from "../../src/runtime/types.js";

const guildId = "100000000000000001";
const applicationId = "100000000000000002";
const userId = "100000000000000003";
const channelId = "100000000000000004";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function discordStub(options: { holdMessagePosts?: boolean; holdGuildFetch?: boolean } = {}) {
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
    else {
      if (options.holdMessagePosts && req.method === "POST" && path.startsWith("/channels/")) {
        await new Promise<void>(resolve => { releaseMessage = resolve; });
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
  let featureStopped = false;
  const feature: FeatureModule = { ...probe, async start() { return async () => { featureStopped = true; }; } };
  const bot = await startBot({ config: { token: "stub-token", clientId: applicationId, guildId,
    restApi: stub.api, healthPath, moderatorRoleId: "moderator" }, db, modules: [feature] });
  cleanups.push(() => bot.stop());
  expect(stub.intents).toBe(1 | 2 | 4 | 2097152);
  expect(JSON.parse(readFileSync(healthPath, "utf8"))).toMatchObject({ state: "ready", pid: process.pid });
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
});

it("routes button and modal prefixes and binds one-use confirmations to the invoker", async () => {
  const stub = await discordStub();
  const directory = mkdtempSync(join(tmpdir(), "discord-components-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const feature: FeatureModule = {
    commands: [{ data: new SlashCommandBuilder().setName("confirmprobe").setDescription("Confirm probe"), access: "public",
      async execute(interaction, context) {
        const payload = Object.freeze({ content: "Confirmed payload" });
        await context.confirmations.request(interaction, { summary: payload.content, access: "public",
          async execute() { await context.rest.post(Routes.channelMessages(channelId), { body: payload }); } });
      } }],
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
  stub.interaction({ data: { name: "confirmprobe", type: 1, id: applicationId } });
  await expect.poll(() => stub.requests.find(request => request.body?.components?.length > 0) !== undefined).toBe(true);
  const prompt = stub.requests.find(request => request.body?.components?.length > 0)!.body;
  const customId = prompt.components[0].components[0].custom_id;
  const button = { type: 3, data: { component_type: 2, custom_id: customId },
    message: { id: channelId, content: "", author: { id: applicationId, username: "Bot" }, attachments: [], embeds: [] } };
  stub.interaction({ ...button, member: { user: { id: "100000000000000008", username: "Other" }, roles: [], permissions: "0" } });
  await expect.poll(() => stub.requests.find(request => request.body?.content?.includes("Only the member")) !== undefined).toBe(true);
  expect(stub.requests.filter(request => request.path.includes(`/channels/${channelId}/messages`))).toHaveLength(0);
  stub.interaction(button);
  await expect.poll(() => stub.requests.filter(request => request.path.includes(`/channels/${channelId}/messages`)).length).toBe(1);
  await expect.poll(() => stub.requests.some(request => request.body?.content === "Action complete.")).toBe(true);
  stub.interaction(button);
  await expect.poll(() => stub.requests.some(request => request.body?.content === "This confirmation has expired.")).toBe(true);
  expect(stub.requests.filter(request => request.path.includes(`/channels/${channelId}/messages`))).toHaveLength(1);
  const sourceEdits = stub.requests.filter(request => request.method === "PATCH").length;
  stub.interaction({ ...button, data: { component_type: 2, custom_id: "failure:probe" } });
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
