import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FeatureModule } from "../../runtime/types.js";
import Database from "better-sqlite3";
import { GatewayIntentBits, GuildMember } from "discord.js";
import * as observability from "@yugidraft/shared/observability";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { startBot } from "../../runtime/app.js";
import { deployCommands } from "../../runtime/deploy.js";
import { readConfig } from "../../runtime/config.js";
import { community } from "./index.js";
import * as welcomeCard from "./welcome-card.js";
import { startWelcome } from "./welcome.js";

const dataGuild = "100000000000000010";
const guild = "100000000000000001", app = "100000000000000002", admin = "100000000000000003";
const channel = "100000000000000004", other = "100000000000000005", announce = "100000000000000006";
const role = "100000000000000007", highRole = "100000000000000008", log = "100000000000000009";
const statusChannel = "100000000000000020";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function stubDiscord() {
  const requests: { method: string; path: string; body: any }[] = [];
  let socket: WebSocket, sequence = 0;
  const guilds = new Set<string>();
  const messages = new Map<string, any>();
  let messageSequence = 0;
  const state = { channelGuild: guild, channelType: 5, channelStatus: 0, rolesStatus: 0, messageStatus: 0, editStatus: 0,
    everyonePermissions: "1024", overwrites: [{ id: guild, type: 0, allow: "0", deny: "1024" }],
    createFailure: "",
    rolePosition: 1, roleMentionable: true, nextStatus: 0, crosspostStatus: 0, replyStatus: 0, memberName: "Tester", intents: 0 };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    const raw = bytes.toString();
    const multipart = req.headers["content-type"]?.startsWith("multipart/form-data");
    const body = multipart ? JSON.parse(raw.match(/name="payload_json"\r\n\r\n([^\r]+)\r\n/)![1]) : raw ? JSON.parse(raw) : null;
    if (multipart) {
      body.png = bytes.includes(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      body.filenames = [...raw.matchAll(/filename="([^"]+)"/g)].map(match => match[1]);
    }
    const path = req.url!.replace("/api/v10", "");
    requests.push({ method: req.method!, path, body });
    res.setHeader("content-type", "application/json");
    const send = (data: unknown) => res.end(JSON.stringify(data));
    if (path === "/gateway/bot") return send({ url: gatewayUrl, shards: 1,
      session_start_limit: { total: 1000, remaining: 1000, reset_after: 60_000, max_concurrency: 1 } });
    if (path.split("?")[0] === `/guilds/${guild}`) return send({ id: guild, name: "Test", roles: [], emojis: [], stickers: [], features: [], owner_id: other });
    if (path === `/guilds/${guild}/roles` && state.rolesStatus) {
      res.statusCode = state.rolesStatus;
      return send({ code: 50013, message: "Roles unavailable" });
    }
    if (path === `/guilds/${guild}/roles`) return send([
      { id: guild, name: "@everyone", position: 0, permissions: state.everyonePermissions, managed: false, mentionable: false },
      { id: role, name: "News", position: state.rolePosition, permissions: "0", managed: false, mentionable: state.roleMentionable },
      { id: highRole, name: "Staff", position: 10, permissions: "0", managed: false, mentionable: false },
    ]);
    if (path.startsWith(`/guilds/${guild}/members/`)) return send({ user: { id: path.split("/").at(-1), username: "Tester" },
      nick: state.memberName, roles: [highRole], permissions: "0", joined_at: new Date().toISOString() });
    if (path.includes("/commands")) return send(body);
    if (path.includes("/callback")) { res.statusCode = 204; res.removeHeader("content-type"); return res.end(); }
    if (req.method === "GET" && path.startsWith(`/channels/${statusChannel}/messages/`)) {
      const message = messages.get(path.split("/").at(-1)!);
      if (state.messageStatus || !message) {
        res.statusCode = state.messageStatus || 404;
        return send({ code: res.statusCode === 404 ? 10008 : 50013, message: "Message unavailable" });
      }
      return send(message);
    }
    if (req.method === "GET" && path.startsWith("/channels/")) {
      if (state.channelStatus) { res.statusCode = state.channelStatus; return send({ code: 10003, message: "Channel unavailable" }); }
      return send({ id: path.split("/").at(-1), guild_id: state.channelGuild, type: state.channelType, permission_overwrites: state.overwrites });
    }
    if (req.method === "PATCH" && path.startsWith(`/channels/${statusChannel}/messages/`)) {
      const id = path.split("/").at(-1)!;
      if (state.editStatus || !messages.has(id)) {
        res.statusCode = state.editStatus || 404;
        if (res.statusCode === 429) res.setHeader("retry-after", "90");
        return send({ code: res.statusCode === 404 ? 10008 : 50013, message: "Edit unavailable", retry_after: 90 });
      }
      const message = { ...messages.get(id), ...body };
      messages.set(id, message);
      return send(message);
    }
    if (req.method === "PATCH" && path.startsWith("/webhooks/") && state.replyStatus) {
      res.statusCode = state.replyStatus; state.replyStatus = 0;
      return send({ code: 50013, message: "private reply failure" });
    }
    const status = path.endsWith("/crosspost") ? state.crosspostStatus : state.nextStatus;
    if (req.method === "POST" && path.startsWith("/channels/") && status >= 400) {
      state.nextStatus = 0;
      res.statusCode = status;
      if (status === 429) res.setHeader("retry-after", "0.01");
      return send({ code: status === 404 ? 10003 : 50013, message: "private upstream text", retry_after: 0.01 });
    }
    if (req.method === "POST" && path === `/channels/${statusChannel}/messages`) {
      const duplicate = body.enforce_nonce && [...messages.values()].find(message => message.nonce === body.nonce);
      if (duplicate) return send(duplicate);
      const id = String(100000000000000099n + BigInt(messageSequence++));
      const message = { id, channel_id: statusChannel, author: { id: app, username: "Bot", bot: true }, ...body };
      messages.set(id, message);
      const failure = state.createFailure;
      state.createFailure = "";
      if (failure === "timeout") return;
      if (failure === "disconnect") return req.socket.destroy();
      if (failure === "503") { res.statusCode = 503; return send({ message: "Ambiguous create failure" }); }
      return send(message);
    }
    return send({ id: "100000000000000099", channel_id: announce, content: "", author: { id: app, username: "Bot", bot: true },
      timestamp: new Date().toISOString(), attachments: [], embeds: [] });
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", client => {
    guilds.clear();
    socket = client;
    client.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
    client.on("message", raw => {
      const packet = JSON.parse(raw.toString());
      if (packet.op === 2) state.intents = packet.d.intents;
      if (packet.op === 1) client.send(JSON.stringify({ op: 11, d: null }));
      if (packet.op === 2) client.send(JSON.stringify({ op: 0, t: "READY", s: ++sequence, d: {
        v: 10, user: { id: app, username: "Bot", discriminator: "0000", bot: true }, guilds: [], session_id: "test",
        resume_gateway_url: gatewayUrl, application: { id: app, flags: 0 },
      } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `ws://127.0.0.1:${(server.address() as { port: number }).port}`;
  cleanups.push(async () => {
    for (const client of ws.clients) client.terminate();
    await new Promise<void>(resolve => ws.close(() => resolve()));
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const emit = (data: Record<string, unknown>, actor = admin) => {
    const token = `test-${++sequence}`;
    socket.send(JSON.stringify({ op: 0, t: "INTERACTION_CREATE", s: sequence, d: {
      id: String(100000000000001000n + BigInt(sequence)), application_id: app, token, version: 1, type: 2,
      guild_id: guild, channel: { id: channel, type: 0 }, channel_id: channel, locale: "en-US", guild_locale: "en-US",
      app_permissions: "0", entitlements: [], authorizing_integration_owners: { "0": guild }, context: 0,
      member: { user: { id: actor, username: "Tester", discriminator: "0000" }, roles: [], permissions: "0", joined_at: new Date().toISOString() }, ...data,
    } }));
    return token;
  };
  const response = async (token: string) => {
    await expect.poll(() => requests.find(r => r.path.includes(token) && (r.method === "PATCH" || r.body?.data?.content || r.body?.type === 8 || r.body?.type === 9 || r.body?.data?.embeds))).toBeTruthy();
    const request = requests.find(r => r.path.includes(token) && (r.method === "PATCH" || r.body?.data?.content || r.body?.type === 8 || r.body?.type === 9 || r.body?.data?.embeds))!;
    return request.body?.data ?? request.body;
  };
  return { api: `${gatewayUrl.replace("ws:", "http:")}/api`, requests, state, messages, emit, response,
    join(id = other, bot = false, guildId = guild, options: { pending?: boolean; avatar?: string } = {}) {
      if (!guilds.has(guildId)) socket.send(JSON.stringify({ op: 0, t: "GUILD_CREATE", s: ++sequence, d: {
        id: guildId, name: "Test", owner_id: admin, roles: [], emojis: [], stickers: [], features: [], channels: [], members: [],
        member_count: 3, large: false, unavailable: false, joined_at: new Date().toISOString(),
      } }));
      guilds.add(guildId);
      socket.send(JSON.stringify({ op: 0, t: "GUILD_MEMBER_ADD", s: ++sequence, d: {
        guild_id: guildId, user: { id, username: "NovaDuelist", discriminator: "0000", bot, avatar: options.avatar },
        nick: "NovaDuelist", roles: [], pending: options.pending ?? false, joined_at: new Date().toISOString(),
      } }));
    },
    updateMember(id: string, pending: boolean) {
      socket.send(JSON.stringify({ op: 0, t: "GUILD_MEMBER_UPDATE", s: ++sequence, d: {
        guild_id: guild, user: { id, username: "NovaDuelist", discriminator: "0000" },
        nick: "Updated Duelist", roles: [], pending,
      } }));
    },
    leave(id = other) {
      socket.send(JSON.stringify({ op: 0, t: "GUILD_MEMBER_REMOVE", s: ++sequence, d: {
        guild_id: guild, user: { id, username: "NovaDuelist", discriminator: "0000" },
      } }));
    },
    command(name: string, options: unknown[] = [], actor = admin) { return emit({ data: { name, type: 1, id: app, options } }, actor); },
    modal(id: string, image = "https://app.duelingdomain.com/news.png", actor = admin) {
      return emit({ type: 5, data: { custom_id: id, components: [
        { type: 1, components: [{ type: 4, custom_id: "title", value: "Patch notes" }] },
        { type: 1, components: [{ type: 4, custom_id: "body", value: "**New cards** @everyone" }] },
        { type: 1, components: [{ type: 4, custom_id: "image", value: image }] },
      ] } }, actor);
    },
    button(id: string, actor = admin) { return emit({ type: 3, data: { component_type: 2, custom_id: id },
      message: { id: channel, content: "", author: { id: app, username: "Bot" }, attachments: [], embeds: [] } }, actor); },
  };
}

async function fixture(presence = false, modules: FeatureModule[] = [community], options: {
  botGuildId?: string; welcomeChannelId?: string; statusChannelId?: string;
  setup?: (db: Database.Database, stub: Awaited<ReturnType<typeof stubDiscord>>) => void;
} = { botGuildId: guild }) {
  const directory = mkdtempSync(join(tmpdir(), "bot-community-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  vi.stubEnv("DISCORD_BOT_ENABLED", "1"); vi.stubEnv("OWNER_USER_IDS", "1,3");
  vi.stubEnv("DISCORD_TOKEN", "stub"); vi.stubEnv("DISCORD_CLIENT_ID", app);
  vi.stubEnv("DISCORD_GUILD_ID", options.botGuildId ? dataGuild : guild);
  vi.stubEnv("DISCORD_BOT_GUILD_ID", options.botGuildId);
  vi.stubEnv("DISCORD_ANNOUNCE_CHANNEL_ID", announce);
  vi.stubEnv("DISCORD_WELCOME_CHANNEL_ID", options.welcomeChannelId ?? "");
  vi.stubEnv("DISCORD_STATUS_CHANNEL_ID", options.statusChannelId ?? "");
  vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", log); vi.stubEnv("SITE_DOMAIN", "app.example.test");
  vi.stubEnv("DUEL_DATA_DIR", join(directory, "duel-engine"));
  const db = openDatabase(join(directory, "bot.sqlite"));
  db.prepare("insert into users(id,username,display_name,discord_user_id) values(1,'owner','Owner',?),(2,'user','User',?),(3,'other','Other admin',?)")
    .run(admin, "100000000000000011", other);
  if (!presence) db.exec("drop index if exists users_last_seen_idx; alter table users drop column last_seen_at; alter table users drop column last_route;");
  const stub = await stubDiscord();
  options.setup?.(db, stub);
  const bot = await startBot({ config: { ...readConfig(), restApi: stub.api, healthPath: join(directory, "health.json") }, db, modules });
  cleanups.push(() => bot.stop());
  return { directory, db, stub, bot };
}
const posts = (stub: Awaited<ReturnType<typeof stubDiscord>>) => stub.requests.filter(r => r.path === `/channels/${announce}/messages` && r.method === "POST");
async function preview(stub: Awaited<ReturnType<typeof stubDiscord>>, options: unknown[] = []) {
  const modal = await stub.response(stub.command("announce", options));
  expect(modal.custom_id).toMatch(/^community:announce:/);
  const message = await stub.response(stub.modal(modal.custom_id));
  expect(message.embeds[0].title).toBe("Patch notes");
  return message.components[0].components as { label: string; custom_id: string }[];
}

it.each([undefined, "", guild])("deploys guild commands with bot guild override %s and admin defaults", async botGuildId => {
  const { stub, bot } = await fixture(false, [community], { botGuildId });
  await deployCommands(bot.context.config, [community]);
  expect(stub.requests.find(r => r.method === "PUT")!.path).toBe(`/applications/${app}/guilds/${guild}/commands`);
  const definitions = stub.requests.find(r => r.method === "PUT")!.body;
  expect(definitions.map((c: any) => c.name).sort()).toEqual(["announce", "card", "online", "stats", "welcome"]);
  expect(definitions.find((c: any) => c.name === "card")).toMatchObject({ default_member_permissions: null, contexts: [0], options: [{ name: "name", autocomplete: true }] });
  for (const definition of definitions.filter((c: any) => c.name !== "card")) expect(definition.default_member_permissions).toBe("8");
});

it("posts only after the same admin confirms, crossposts, and queues the mod log", async () => {
  const { stub, db } = await fixture();
  const buttons = await preview(stub);
  expect(buttons.map(b => b.label)).toEqual(["Post", "Cancel"]);
  expect(posts(stub)).toHaveLength(0);
  expect((await stub.response(stub.button(buttons[0].custom_id, other))).content).toContain("Only");
  expect(posts(stub)).toHaveLength(0);
  expect((await stub.response(stub.button(buttons[0].custom_id))).content).toContain("posted");
  expect(posts(stub)).toHaveLength(1);
  expect(posts(stub)[0].body).toMatchObject({ embeds: [{ title: "Patch notes", description: "**New cards** @everyone" }], allowed_mentions: { parse: [] } });
  expect(stub.requests.filter(r => r.path.endsWith("/crosspost"))).toHaveLength(1);
  expect(db.prepare("select action,result from mod_actions where action='announce'").all()).toEqual([{ action: "announce", result: "success" }]);
  expect(db.prepare("select count(*) as n from discord_outbox where kind='mod_log'").get()).toMatchObject({ n: 1 });
  await stub.response(stub.button(buttons[0].custom_id));
  expect(posts(stub)).toHaveLength(1);
});

it("cancels and expires previews; access is checked again for modal and Post", async () => {
  const { stub, db } = await fixture();
  const cancelled = await preview(stub);
  expect((await stub.response(stub.button(cancelled[1].custom_id))).content).toContain("cancel");
  await stub.response(stub.button(cancelled[0].custom_id));
  const expired = await preview(stub);
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  expect((await stub.response(stub.button(expired[0].custom_id))).content).toContain("expired");
  clock.mockRestore();
  const modal = await stub.response(stub.command("announce"));
  vi.stubEnv("OWNER_USER_IDS", "3");
  expect((await stub.response(stub.modal(modal.custom_id))).content).toContain("access");
  vi.stubEnv("OWNER_USER_IDS", "1,3");
  const revoked = await preview(stub);
  db.prepare("update users set discord_user_id=null where id=1").run();
  expect((await stub.response(stub.button(revoked[0].custom_id))).content).toContain("access");
  expect(posts(stub)).toHaveLength(0);
});

it("refuses unlinked/non-owner users, another guild, DMs, and unsafe image URLs", async () => {
  const { stub } = await fixture();
  expect((await stub.response(stub.command("online", [], "100000000000000011"))).content).toContain("access");
  expect((await stub.response(stub.command("announce", [], "100000000000000012"))).content).toContain("access");
  const token = stub.emit({ guild_id: "100000000000000013", data: { name: "stats", type: 1, id: app } });
  expect((await stub.response(token)).content).toContain("server");
  const dm = stub.emit({ guild_id: undefined, member: undefined, user: { id: admin, username: "Owner" }, data: { name: "online", type: 1, id: app } });
  expect((await stub.response(dm)).content).toContain("server");
  const modal = await stub.response(stub.command("announce"));
  expect((await stub.response(stub.modal(modal.custom_id, "http://example.test/image.png"))).content).toContain("HTTPS");
  expect(posts(stub)).toHaveLength(0);
});

it("uses an explicit role choice and checks hierarchy again before posting", async () => {
  const { stub } = await fixture();
  const options = [{ name: "role", type: 8, value: role }];
  // Discord resolves slash role options from this payload; the selected role comes from its list.
  const choose = () => stub.emit({ data: { name: "announce", type: 1, id: app, options,
    resolved: { roles: { [role]: { id: role, name: "News", position: 1, permissions: "0", managed: false, mentionable: true } } } } });
  const modal = await stub.response(choose());
  const message = await stub.response(stub.modal(modal.custom_id));
  expect(message.content).toContain(role);
  const post = message.components[0].components[0].custom_id;
  stub.state.rolePosition = 10;
  expect((await stub.response(stub.button(post))).content).toContain("role");
  expect(posts(stub)).toHaveLength(0);
  stub.state.rolePosition = 1;
  const second = await stub.response(choose());
  const next = await stub.response(stub.modal(second.custom_id));
  await stub.response(stub.button(next.components[0].components[0].custom_id));
  expect(posts(stub)[0].body).toMatchObject({ content: `<@&${role}>`, allowed_mentions: { parse: [], roles: [role] } });
});

it.each([403,404,429])("returns a safe error for Discord %s and never posts twice", async status => {
  const { stub, bot, db } = await fixture();
  bot.client.rest.options.rejectOnRateLimit = () => true;
  const buttons = await preview(stub);
  stub.state.nextStatus = status;
  const reply = await stub.response(stub.button(buttons[0].custom_id));
  expect(reply.content).toMatch(/permission|found|rate limit/i);
  expect(reply.content).not.toContain("private upstream");
  expect(db.prepare("select result from mod_actions where action='announce'").get()).toEqual({ result: "failure" });
  await stub.response(stub.button(buttons[0].custom_id));
  expect(posts(stub)).toHaveLength(1);
});

it("checks destination guild and distinguishes publish failure from post failure", async () => {
  const { stub, db } = await fixture();
  let buttons = await preview(stub);
  stub.state.channelGuild = other;
  expect((await stub.response(stub.button(buttons[0].custom_id))).content).toContain("server");
  expect(posts(stub)).toHaveLength(0);
  stub.state.channelGuild = guild;
  buttons = await preview(stub);
  stub.state.crosspostStatus = 403;
  expect((await stub.response(stub.button(buttons[0].custom_id))).content).toMatch(/posted.*publish/i);
  expect(posts(stub)).toHaveLength(1);
  expect(db.prepare("select params_json from mod_actions where action='announce' and result='success'").get()).toBeTruthy();
});

it("searches engine and catalog, labels previews, renders a public Link card, and limits each user", async () => {
  const { stub, db, directory } = await fixture();
  const cardUser = "100000000000000011";
  mkdirSync(join(directory, "duel-engine"));
  const engine = new Database(join(directory, "duel-engine", "cards.cdb"));
  engine.exec(`create table datas(id integer,ot integer,alias integer,type integer,atk integer,def integer,level integer,race integer,attribute integer);
    create table texts(id integer,name text,desc text);
    insert into datas values(12345,256,0,67108897,2300,5,3,1,32),(55144522,3,0,2,0,0,0,0,0),(55144523,3,55144522,2,0,0,0,0,0);
    insert into texts values(12345,'Preview Warrior','First effect.\nSecond effect.'),(55144522,'Pot of Greed','Draw 2 cards.'),(55144523,'Pot of Greed','Draw 2 cards.');`);
  engine.close();
  db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    values(67890,'Catalog Dragon','Normal Monster','normal','Dragon text','upstream','upstream','[]',?)`).run(new Date().toISOString());
  const auto = stub.emit({ type: 4, data: { name: "card", type: 1, id: app, options: [{ name: "name", type: 3, value: "Preview", focused: true }] } });
  const choices = (await stub.response(auto)).choices;
  expect(choices).toContainEqual({ name: "Preview Warrior — Pre-release", value: "12345" });
  const catalogAuto = stub.emit({ type: 4, data: { name: "card", type: 1, id: app, options: [{ name: "name", type: 3, value: "Catalog", focused: true }] } });
  expect((await stub.response(catalogAuto)).choices[0].name).toBe("Catalog Dragon");
  const cardToken = stub.command("card", [{ name: "name", type: 3, value: "12345" }], cardUser);
  const card = await stub.response(cardToken);
  expect(card.flags ?? 0).toBe(0);
  expect(card.embeds[0]).toMatchObject({ title: "Preview Warrior", image: { url: "https://pics.projectignis.org:2096/pics/12345.jpg" } });
  expect(JSON.stringify(card.embeds)).toContain("Pre-release");
  expect(JSON.stringify(card.embeds)).toContain("LINK-3");
  expect(JSON.stringify(card.embeds)).toContain("2300");
  expect(JSON.stringify(card.embeds)).toContain("First effect.");
  expect(card.allowed_mentions).toMatchObject({ parse: [] });
  for (let i=0; i<4; i++) {
    const normal = await stub.response(stub.command("card", [{ name: "name", type: 3, value: "67890" }], cardUser));
    expect(normal.embeds[0].image.url).toBe("https://images.ygoprodeck.com/images/cards/67890.jpg");
  }
  expect((await stub.response(stub.command("card", [{ name: "name", type: 3, value: "67890" }], cardUser))).content).toContain("30");
  const pot = await stub.response(stub.command("card", [{ name: "name", type: 3, value: "Pot of Greed" }]));
  expect(pot.embeds[0].image.url).toBe("https://pics.projectignis.org:2096/pics/55144522.jpg");
  expect(JSON.stringify(pot.embeds)).toContain("Forbidden");
  db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at)
    values(55144522,'Pot of Greed','Spell Card','spell','Draw 2 cards.','x','x','[]',?),
      (55144524,'Pot of Greed','Spell Card','spell','Draw 2 cards.','x','x','[]',?)`).run(new Date().toISOString(),new Date().toISOString());
  db.exec("insert into card_artworks(card_id,artwork_id,image_url,image_url_small,is_main,source) values(55144522,55144524,'x','x',0,'api')");
  const catalogArt = await stub.response(stub.command("card", [{ name: "name", type: 3, value: "55144524" }]));
  expect(JSON.stringify(catalogArt.embeds)).toContain("Forbidden");
  const alternate = await stub.response(stub.command("card", [{ name: "name", type: 3, value: "55144523" }]));
  expect(JSON.stringify(alternate.embeds)).toContain("Forbidden");
});

it("guards absent presence columns for both private reports", async () => {
  const { stub } = await fixture();
  expect((await stub.response(stub.command("online"))).content).toContain("presence not available");
  const stats = await stub.response(stub.command("stats"));
  expect(JSON.stringify(stats)).toContain("presence not available");
  expect(stats.embeds[0].title).toContain("Stats");
  for (const callback of stub.requests.filter(r => r.body?.type === 5)) expect(callback.body.data.flags).toBe(64);
});

// Exercise the real publisher and HTTP edge without waiting a minute between polls.
function statusSchedule() {
  const original = globalThis.setInterval;
  let poll: (() => Promise<void> | void) | undefined;
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(globalThis, "setInterval").mockImplementation(((callback: () => void, delay: number, ...args: any[]) => {
    if (delay === 60_000) poll = callback;
    return original(callback, delay, ...args);
  }) as typeof setInterval);
  return {
    get installed() { return !!poll; },
    async advance(ms = 60_000) { now += ms; expect(poll).toBeTypeOf("function"); await poll!(); },
    clock,
  };
}
const statusPosts = (stub: Awaited<ReturnType<typeof stubDiscord>>) => stub.requests.filter(r => r.method === "POST" && r.path === `/channels/${statusChannel}/messages`);
const statusEdits = (stub: Awaited<ReturnType<typeof stubDiscord>>) => stub.requests.filter(r => r.method === "PATCH" && r.path.startsWith(`/channels/${statusChannel}/messages/`));
async function statusReady(db: Database.Database) {
  await expect.poll(() => db.prepare("select message_id from discord_status_messages where guild_id=? and channel_id=?").get(guild, statusChannel)).toBeTruthy();
}

it("publishes one bounded online status with the report sources in the data guild", async () => {
  statusSchedule();
  const { stub, db } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db) {
    const now = Date.now(), at = new Date(now).toISOString();
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(now);
    db.prepare("update users set last_seen_at=?,last_route='/duels/[slug]' where id=2").run(now);
    db.prepare("update users set last_seen_at=? where id=3").run(now - 120_001);
    const user = db.prepare("insert into users(id,username,display_name,last_seen_at,last_route) values(?,?,?,?,'/dashboard')");
    for (let id = 4; id < 14; id++) user.run(id, `zed${id}`, `Zed ${String(id).padStart(2,"0")}`, now);
    db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,?,1,'Owner'),(2,?,2,'User')").run(dataGuild,dataGuild);
    const duel = db.prepare(`insert into duels(guild_id,web_slug,name,organizer_player_id,mode,status,format,kind,last_activity_at)
      values(?,?,?,1,'match',?,?,?,?)`);
    for (const [index,format] of ["1v1","tag","ffa3","ffa4"].entries()) duel.run(dataGuild,`status-${index}`,format,"active",format,"play",at);
    duel.run(dataGuild,"status-stale","Stale","active","ffa3","play",new Date(now-600_001).toISOString());
    duel.run(dataGuild,"status-fork","Replay","active","ffa4","replay-fork",at);
    duel.run(guild,"status-foreign","Foreign","active","ffa4","play",at);
    db.exec("insert into duel_seats(duel_id,seat,player_id) values(2,0,2),(7,0,2)");
    duel.run(dataGuild,"status-test","Deck test","active","tag","play",at);
    db.exec(`update duels set setup_json='{"testDuel":true}' where web_slug='status-test'`);
    duel.run(dataGuild,"status-invalid-json","Invalid setup","active","1v1","play",at);
    db.exec("update duels set setup_json='invalid' where web_slug='status-invalid-json'");
    db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug) values(?,'c','Live draft','active',1,'status-draft'),(?,'c','Foreign','active',1,'foreign-draft')").run(dataGuild,guild);
    db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id) values(?,'Live','swiss','active',1),(?,'Done','swiss','completed',1),(?,'Foreign','swiss','active',1)").run(dataGuild,dataGuild,guild);
    const series = db.prepare("insert into duel_series(guild_id,player0_id,player1_id,created_by_player_id,mode,settings_json,status) values(?,1,2,1,'match','{}',?)");
    series.run(dataGuild,"active"); series.run(dataGuild,"between_games"); series.run(dataGuild,"completed"); series.run(guild,"active");
    // Interrupted games leave an unscheduled between_games row forever; neither it nor an orphan active row is live.
    series.run(dataGuild,"active");
    db.exec("update duels set series_id=1,game_number=1 where web_slug='status-0'");
    series.run(dataGuild,"between_games");
    db.prepare("update duel_series set next_game_at=? where id=6").run(new Date(now+60_000).toISOString());
    series.run(dataGuild,"between_games");
    db.prepare("update duel_series set next_game_at=? where id=7").run(new Date(now-600_001).toISOString());
    series.run(dataGuild,"active");
    db.exec("update duels set series_id=8,game_number=1 where web_slug='status-stale'");
    series.run(dataGuild,"active");
    db.exec("update duels set series_id=9,game_number=1 where web_slug='status-test'");
    series.run(dataGuild,"active");
    db.exec("update duels set series_id=10,game_number=1 where web_slug='status-1'");
    const ended = duel.run(dataGuild,"status-ended","Latest ended","completed","tag","play",at);
    db.prepare("update duels set series_id=10,game_number=2 where id=?").run(ended.lastInsertRowid);
    series.run(dataGuild,"active");
    const empty = duel.run(dataGuild,"status-empty","Empty lobby","lobby","tag","play",at);
    db.prepare("update duels set series_id=11,game_number=1 where id=?").run(empty.lastInsertRowid);
    const old = new Date(now-86_400_001).toISOString();
    db.prepare("insert into drafts(guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at,started_at) values(?,'c','Abandoned','active',1,'abandoned',?,?)").run(dataGuild,old,old);
    db.prepare("insert into tournaments(guild_id,name,format,status,created_by_user_id,created_at,started_at) values(?,'Abandoned','swiss','active',1,?,?)").run(dataGuild,old,old);
  } });
  await expect.poll(() => statusPosts(stub).length).toBe(1);
  await statusReady(db);
  expect(statusPosts(stub)).toHaveLength(1);
  const payload = statusPosts(stub)[0].body;
  expect(payload.allowed_mentions).toMatchObject({ parse: [] });
  expect(payload.embeds).toHaveLength(1);
  expect(payload.embeds[0]).toMatchObject({ title: "Dueling Domain • Online now", color: 0x7652b8,
    description: `Updated <t:${Math.floor(Date.now()/1000)}:R>`, fields: [
      { name: "Players online • 12", value: "Owner — Deck builder\nUser — Tag duel\nZed 04 — Dashboard\nZed 05 — Dashboard\nZed 06 — Dashboard\nZed 07 — Dashboard\nZed 08 — Dashboard\nZed 09 — Dashboard\nZed 10 — Dashboard\nZed 11 — Dashboard\n+2 more" },
      { name: "Live duels", value: "1v1: 2\nTag: 1\nFFA3: 1\nFFA4: 1" },
      { name: "Active drafts", value: "1" }, { name: "Active tournaments", value: "1" }, { name: "Active series", value: "2" },
    ] });
  expect(payload.embeds[0].fields.every((field: any) => field.value.length <= 1024)).toBe(true);
});

it.each([
  ["multi-day with future deadline", "active", -172_800_000, 86_400_000, "1"],
  ["multi-day at deadline", "active", -172_800_000, 0, "1"],
  ["recent with expired deadline", "active", 0, -1, "0"],
  ["recent without deadline", "active", 0, null, "1"],
  ["at 24 hours without deadline", "active", -86_400_000, null, "1"],
  ["past 24 hours without deadline", "active", -86_400_001, null, "0"],
  ["completed with future deadline", "completed", 0, 86_400_000, "0"],
])("counts active tournaments: %s", async (_name, status, age, deadline, expected) => {
  statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db) {
    const at = new Date(Date.now()+age).toISOString();
    db.prepare(`insert into tournaments(guild_id,name,format,status,created_by_user_id,created_at,started_at,deadline_at)
      values(?,'Tournament','swiss',?,1,?,?,?)`)
      .run(dataGuild,status,at,at,deadline === null ? null : new Date(Date.now()+deadline).toISOString());
  } });
  await statusReady(db);
  expect(statusPosts(stub)[0].body.embeds[0].fields.find((field: any) => field.name === "Active tournaments").value).toBe(expected);
});

it("labels only current players at live non-test tables", async () => {
  const { db, stub } = await fixture(true);
  const now = Date.now(), at = new Date(now).toISOString();
  vi.spyOn(Date,"now").mockReturnValue(now);
  db.prepare("update users set last_seen_at=?,last_route='/duels/[slug]' where id=2").run(now);
  db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,?,2,'User')").run(dataGuild);
  db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,kind,last_activity_at)
    values(1,?,'label-live','Live',1,'match','active','tag','play',?)`).run(dataGuild,at);
  db.exec("insert into duel_seats(duel_id,seat,player_id) values(1,0,1)");
  expect(JSON.stringify(await stub.response(stub.command("online")))).toContain("Tag duel");
  for (const setup of [
    () => db.prepare("update duels set last_activity_at=?").run(new Date(now-600_001).toISOString()),
    () => db.prepare("update duels set status='lobby',last_activity_at=?").run(new Date(now-600_001).toISOString()),
    () => db.prepare("update duels set archived_at=?").run(at),
    () => db.exec(`update duels set setup_json='{"testDuel":true}'`),
    () => db.exec(`update duels set setup_json='{"eliminatedSeats":[0]}'`),
    () => db.exec(`update duels set setup_json='{"surrenderedSeats":[0]}'`),
    () => db.exec(`insert into duel_commands(duel_id,seq,seat,command_json) values(1,1,0,'{"promptId":"eliminate:0"}')`),
    () => db.exec("insert into duel_kicked_players(duel_id,player_id) values(1,1)"),
    () => db.exec("delete from duel_seats"),
  ]) {
    db.prepare("update duels set status='active',archived_at=null,setup_json='{}',last_activity_at=?").run(at);
    setup();
    const response = JSON.stringify(await stub.response(stub.command("online")));
    expect(response).not.toContain("Tag duel");
    expect(response).not.toContain("Duel lobby");
    expect(response).toContain("Duel page");
    db.exec("delete from duel_commands; delete from duel_kicked_players");
  }
});

it("edits status on change, ignores presence refresh/order and timestamps, and throttles edits", async () => {
  const schedule = statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db) {
    db.prepare("update users set last_seen_at=?,last_route='/app' where id in (1,2)").run(Date.now());
  } });
  await statusReady(db);
  const before = stub.requests.length;
  // The input row order changes as heartbeats arrive, but the displayed list does not.
  db.prepare("update users set last_seen_at=? where id=2").run(Date.now()+1);
  await schedule.advance();
  expect(stub.requests.slice(before).every(r => r.method === "GET")).toBe(true);
  expect(statusEdits(stub)).toHaveLength(0);
  db.prepare("update users set display_name='@everyone **Duelist**' where id=1").run();
  await schedule.advance(1);
  expect(statusEdits(stub)).toHaveLength(1);
  expect(statusEdits(stub)[0].body.allowed_mentions).toMatchObject({ parse: [] });
  expect(JSON.stringify(statusEdits(stub)[0].body)).toContain("Duelist");
  db.prepare("update users set display_name='Changed again',last_seen_at=? where id=1").run(Date.now());
  await schedule.advance(29_999);
  expect(statusEdits(stub)).toHaveLength(1);
  await schedule.advance(1);
  expect(statusEdits(stub)).toHaveLength(2);
  expect(new Set(statusEdits(stub).map(r => r.path)).size).toBe(1);
  expect(statusPosts(stub)).toHaveLength(1);
});

it.each([
  ["1024", [], false],
  ["0", [], false],
  ["1024", [{ id: guild, type: 0, allow: "0", deny: "1024" }], true],
  ["0", [{ id: guild, type: 0, allow: "0", deny: "1024" }], true],
  ["1024", [{ id: guild, type: 0, allow: "0", deny: "1024" }, { id: role, type: 0, allow: "1024", deny: "0" }], false],
  ["1024", [{ id: guild, type: 0, allow: "0", deny: "1024" }, { id: role, type: 0, allow: "0", deny: "1024" }], true],
  ["1024", [{ id: guild, type: 0, allow: "0", deny: "1024" }, { id: admin, type: 1, allow: "1024", deny: "0" }], true],
  ["1024", [{ id: guild, type: 0, allow: "1024", deny: "1024" }], false],
  ["0", [{ id: guild, type: 0, allow: "1024", deny: "0" }], false],
  ["1032", [{ id: guild, type: 0, allow: "0", deny: "1024" }], false],
])("checks everyone permission %s and overwrites %j before publishing", async (permissions, overwrites, privateChannel) => {
  statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db,stub) {
    stub.state.everyonePermissions = permissions;
    stub.state.overwrites = overwrites;
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(Date.now());
  } });
  await statusReady(db);
  const field = statusPosts(stub)[0].body.embeds[0].fields[0];
  expect(field.name).toBe("Players online • 1");
  expect(field.value).toBe(privateChannel ? "Owner — Deck builder" : "1 player online.");
});

it("removes names and pages when an unchanged status channel becomes public, and restores them when private", async () => {
  const schedule = statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db) {
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(Date.now());
  } });
  await statusReady(db);
  stub.state.overwrites = [];
  await schedule.advance(30_000);
  expect(statusEdits(stub)).toHaveLength(1);
  expect(statusEdits(stub)[0].body.embeds[0].fields[0].value).toBe("1 player online.");
  expect(JSON.stringify(statusEdits(stub)[0].body)).not.toMatch(/Owner|Deck builder/);
  stub.state.overwrites = [{ id: guild, type: 0, allow: "0", deny: "1024" }];
  await schedule.advance(30_000);
  expect(statusEdits(stub)).toHaveLength(2);
  expect(statusEdits(stub)[1].body.embeds[0].fields[0].value).toBe("Owner — Deck builder");
});

it("clips names at grapheme boundaries before escaping Discord formatting and tokens", async () => {
  const schedule = statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel });
  await statusReady(db);
  const family = "👩‍👩‍👧‍👦";
  for (const [name, escaped] of [
    ["[x](https://evil.example)", "\\[x](https://evil.example)"],
    ["# big", "\\# big"], ["- list", "\\- list"], ["1. list", "1\\. list"],
    ["> quote", "\\> quote"], ["-# small", "\\-# small"],
    ["<@123> <#123> <t:123:R>", "‹@123> ‹#123> ‹t:123:R>"],
    ["a".repeat(58)+"😀tail", "a".repeat(58)+"😀…"],
    ["a".repeat(58)+family+"tail", "a".repeat(58)+family+"…"],
    ["a".repeat(58)+"\\tail", "a".repeat(58)+"\\\\…"],
  ]) {
    db.prepare("update users set display_name=?,last_seen_at=?,last_route='/app' where id=1").run(name,Date.now()+30_000);
    await schedule.advance(30_000);
    expect(statusEdits(stub).at(-1)!.body.embeds[0].fields[0].value).toBe(`${escaped} — App`);
  }
});

it("keeps heavily escaped names within the Discord field limit", async () => {
  statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db) {
    const insert = db.prepare("insert into users(username,display_name,last_seen_at,last_route) values(?,?,?,'/duels/[slug]')");
    for (let i=0; i<12; i++) insert.run(`escaped${i}`,"*".repeat(80),Date.now());
  } });
  await statusReady(db);
  const field = statusPosts(stub)[0].body.embeds[0].fields[0];
  expect(field.value.length).toBeLessThanOrEqual(1024);
  expect(field.value).toContain("… — Duel page");
  expect(field.value).toMatch(/\+\d+ more$/);
});

it("reuses a stored bot message after restart without posting or editing unchanged content", async () => {
  const schedule = statusSchedule();
  const { db, stub, bot, directory } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel });
  await statusReady(db);
  const config = bot.context.config;
  const saved = db.prepare("select message_id from discord_status_messages").get() as { message_id: string };
  await bot.stop();
  const reopened = openDatabase(join(directory,"bot.sqlite"));
  const restarted = await startBot({ config, db: reopened, modules: [community] });
  cleanups.push(() => restarted.stop());
  await expect.poll(() => stub.requests.some(r => r.method === "GET" && r.path.endsWith(`/messages/${saved.message_id}`))).toBe(true);
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(1);
  expect(statusEdits(stub)).toHaveLength(0);
  reopened.prepare("update users set last_seen_at=?,last_route='/app' where id=1").run(Date.now());
  await schedule.advance(1);
  expect(statusEdits(stub).map(r => r.path)).toEqual([`/channels/${statusChannel}/messages/${saved.message_id}`]);
});

it.each(["missing", "foreign author", "wrong channel"])("replaces a saved %s message once", async invalid => {
  const schedule = statusSchedule();
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db, stub) {
    db.prepare("insert into discord_status_messages(guild_id,channel_id,message_id,content_hash,updated_at) values(?,?,?,'old',0)").run(guild,statusChannel,"old-message");
    if (invalid !== "missing") stub.messages.set("old-message", { id: "old-message", channel_id: invalid === "wrong channel" ? channel : statusChannel,
      author: { id: invalid === "foreign author" ? other : app }, embeds: [] });
  } });
  await statusReady(db);
  await expect.poll(() => statusPosts(stub).length).toBe(1);
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(1);
  expect(statusEdits(stub)).toHaveLength(0);
});

it("disables the publisher when DISCORD_STATUS_CHANNEL_ID is empty", async () => {
  const schedule = statusSchedule();
  const { stub, db } = await fixture(true);
  await stub.response(stub.command("online"));
  expect(schedule.installed).toBe(false);
  expect(statusPosts(stub)).toHaveLength(0);
  expect(db.prepare("select * from discord_status_messages").all()).toEqual([]);
});

it.each([404,403,"foreign guild","wrong type"])("keeps running with status destination %s, warns once and retries later", async unavailable => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const { stub, db, bot } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(_db,stub) {
    if (typeof unavailable === "number") stub.state.channelStatus = unavailable;
    if (unavailable === "foreign guild") stub.state.channelGuild = dataGuild;
    if (unavailable === "wrong type") stub.state.channelType = 2;
  } });
  await expect.poll(() => warning.mock.calls.length).toBe(1);
  await schedule.advance();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(bot.client.isReady()).toBe(true);
  expect(statusPosts(stub)).toHaveLength(0);
  stub.state.channelStatus = 0; stub.state.channelGuild = guild; stub.state.channelType = 0;
  await schedule.advance();
  await statusReady(db);
  expect(statusPosts(stub)).toHaveLength(1);
});

it("does not replace a stored message on transient permission failure", async () => {
  const schedule = statusSchedule();
  vi.spyOn(observability,"log").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db,stub) {
    db.prepare("insert into discord_status_messages(guild_id,channel_id,message_id,content_hash,updated_at) values(?,?,?,'old',0)").run(guild,statusChannel,"existing");
    stub.messages.set("existing", { id: "existing", channel_id: statusChannel, author: { id: app }, embeds: [] });
    stub.state.messageStatus = 403;
  } });
  await expect.poll(() => stub.requests.some(r => r.path.endsWith("/messages/existing"))).toBe(true);
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(0);
  stub.state.messageStatus = 0;
  await schedule.advance();
  expect(statusEdits(stub)).toHaveLength(1);
  expect(statusPosts(stub)).toHaveLength(0);
  expect(db.prepare("select message_id from discord_status_messages").get()).toEqual({ message_id: "existing" });
});

it("backs off a rate-limited edit and replaces its new message after deletion with a fresh nonce", async () => {
  const schedule = statusSchedule();
  vi.spyOn(observability,"log").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel });
  await statusReady(db);
  db.prepare("update users set last_seen_at=?,last_route='/app' where id=1").run(Date.now()+180_000);
  stub.state.editStatus = 429;
  await schedule.advance();
  expect(statusEdits(stub)).toHaveLength(1);
  const before = stub.requests.length;
  await schedule.advance();
  expect(stub.requests).toHaveLength(before);
  stub.state.editStatus = 0;
  await schedule.advance();
  expect(statusEdits(stub)).toHaveLength(2);
  stub.messages.clear();
  db.prepare("update users set display_name='After deletion' where id=1").run();
  await schedule.advance();
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(2);
  expect(statusPosts(stub)[1].body.nonce).not.toBe(statusPosts(stub)[0].body.nonce);
  expect(db.prepare("select message_id from discord_status_messages").get()).toEqual({ message_id: [...stub.messages.keys()][0] });
});

it.each(["rejected 503", "503", "timeout", "disconnect"])("retries an ambiguous %s create on the next poll with the same nonce", async failure => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const reported = vi.spyOn(observability,"report").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db,stub) {
    if (failure === "rejected 503") stub.state.nextStatus = 503;
    else stub.state.createFailure = failure;
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(Date.now());
  } });
  await expect.poll(() => warning.mock.calls.length, { timeout: 15_000 }).toBe(1);
  expect(reported).toHaveBeenCalledTimes(1);
  expect(statusPosts(stub)).toHaveLength(1);
  expect(db.prepare("select * from discord_status_messages").all()).toEqual([]);
  // A retry can recover an already accepted private payload. It must reconcile current public visibility too.
  stub.state.overwrites = [];
  await schedule.advance();
  await statusReady(db);
  expect(statusPosts(stub)).toHaveLength(2);
  expect(statusPosts(stub)[1].body.nonce).toBe(statusPosts(stub)[0].body.nonce);
  expect(statusPosts(stub)[1].body.enforce_nonce).toBe(true);
  expect(stub.messages.size).toBe(1);
  expect([...stub.messages.values()][0].embeds[0].fields[0].value).toBe("1 player online.");
  await schedule.advance(1);
  expect(statusPosts(stub)).toHaveLength(2);
}, 20_000);

it("persists a recovered message before a failed reconcile edit and reuses it after restart", async () => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const warnings = () => warning.mock.calls.filter(call => call[2]?.operation === "bot.status");
  vi.spyOn(observability,"report").mockImplementation(() => {});
  const { db, stub, bot, directory } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db,stub) {
    stub.state.createFailure = "503";
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(Date.now());
  } });
  await expect.poll(() => warnings().length).toBe(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  stub.state.overwrites = [];
  stub.state.editStatus = 503;
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(2);
  expect(statusEdits(stub)).toHaveLength(1);
  const messageId = [...stub.messages.keys()][0];
  expect(db.prepare("select message_id,content_hash from discord_status_messages").get())
    .toEqual({ message_id: messageId, content_hash: "" });
  const config = bot.context.config;
  await bot.stop();
  stub.state.editStatus = 0;
  await schedule.advance(30_000);
  const reopened = openDatabase(join(directory,"bot.sqlite"));
  const restarted = await startBot({ config, db: reopened, modules: [community] });
  cleanups.push(() => restarted.stop());
  await expect.poll(() => stub.messages.get(messageId).embeds[0].fields[0].value).toBe("1 player online.");
  await expect.poll(() => (reopened.prepare("select content_hash from discord_status_messages").get() as { content_hash: string }).content_hash).not.toBe("");
  expect(statusPosts(stub)).toHaveLength(2);
  expect(statusEdits(stub).map(request => request.path)).toEqual(Array(2).fill(`/channels/${statusChannel}/messages/${messageId}`));
  expect(stub.messages.size).toBe(1);
  expect(reopened.prepare("select message_id from discord_status_messages").get()).toEqual({ message_id: messageId });
});

it("reports Discord errors once per outage and warns again after a successful save", async () => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const reported = vi.spyOn(observability,"report").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(_db,stub) {
    stub.state.channelStatus = 403;
  } });
  await expect.poll(() => warning.mock.calls.length).toBe(1);
  expect(reported).toHaveBeenCalledTimes(1);
  expect(reported.mock.calls[0][1]).toMatchObject({ tags: { operation: "bot.status" } });
  await schedule.advance();
  expect(warning).toHaveBeenCalledTimes(1);
  expect(reported).toHaveBeenCalledTimes(1);
  stub.state.channelStatus = 0;
  await schedule.advance();
  await statusReady(db);
  stub.state.channelStatus = 403;
  await schedule.advance();
  expect(warning).toHaveBeenCalledTimes(2);
  expect(reported).toHaveBeenCalledTimes(2);
});

it.each(["channelStatus", "rolesStatus"] as const)("warns again after %s recovers with unchanged content", async endpoint => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const warnings = () => warning.mock.calls.filter(call => call[2]?.operation === "bot.status");
  const reported = vi.spyOn(observability,"report").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel });
  await statusReady(db);
  const saved = db.prepare("select * from discord_status_messages").get();
  stub.state[endpoint] = 403;
  await schedule.advance();
  await schedule.advance();
  expect(warnings()).toHaveLength(1);
  expect(reported).toHaveBeenCalledTimes(1);
  stub.state[endpoint] = 0;
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(1);
  expect(statusEdits(stub)).toHaveLength(0);
  expect(db.prepare("select * from discord_status_messages").get()).toEqual(saved);
  stub.state[endpoint] = 403;
  await schedule.advance();
  expect(warnings()).toHaveLength(2);
  expect(reported).toHaveBeenCalledTimes(2);
});

it.each([403,429])("preserves an earlier ambiguous create through a later %s rejection", async rejection => {
  const schedule = statusSchedule();
  const warning = vi.spyOn(observability,"log").mockImplementation(() => {});
  const warnings = () => warning.mock.calls.filter(call => call[2]?.operation === "bot.status");
  vi.spyOn(observability,"report").mockImplementation(() => {});
  const { db, stub } = await fixture(true, [community], { botGuildId: guild, statusChannelId: statusChannel, setup(db,stub) {
    stub.state.createFailure = "503";
    db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(Date.now());
  } });
  await expect.poll(() => warnings().length).toBe(1);
  await new Promise<void>(resolve => setImmediate(resolve));
  stub.state.nextStatus = rejection;
  db.prepare("update users set last_seen_at=? where id=1").run(Date.now()+60_000);
  await schedule.advance();
  expect(statusPosts(stub)).toHaveLength(2);
  expect(db.prepare("select * from discord_status_messages").all()).toEqual([]);
  stub.state.overwrites = [];
  await schedule.advance();
  await statusReady(db);
  expect(statusPosts(stub)).toHaveLength(3);
  expect(new Set(statusPosts(stub).map(request => request.body.nonce)).size).toBe(1);
  expect(stub.messages.size).toBe(1);
  expect([...stub.messages.values()][0].embeds[0].fields[0].value).toBe("1 player online.");
  const before = statusEdits(stub).length;
  await schedule.advance(1);
  expect(statusEdits(stub)).toHaveLength(before);
});

it("publishes a status even without the optional presence columns", async () => {
  const { db, stub } = await fixture(false, [community], { botGuildId: guild, statusChannelId: statusChannel });
  await statusReady(db);
  expect(statusPosts(stub)[0].body.embeds[0].fields[0]).toEqual({ name: "Players online", value: "presence not available" });
});

it("registers in the bot guild and keeps site reports and duel labels in the data guild", async () => {
  const { stub, db, bot } = await fixture(true);
  await deployCommands(bot.context.config, [community]);
  expect(stub.requests.find(r => r.method === "PUT")!.path).toBe(`/applications/${app}/guilds/${guild}/commands`);
  const now = Date.now(), today = new Date(now).toISOString().slice(0,10), yesterday = new Date(now-86400000).toISOString().slice(0,10);
  db.prepare("update users set created_at=? where id in (1,2)").run(`${today} 00:00:00`);
  db.prepare("update users set created_at=? where id=3").run(`${yesterday}T00:00:00.000Z`);
  db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(now-120000);
  db.prepare("update users set last_seen_at=?,last_route='/duels/[slug]' where id=2").run(now-1000);
  db.prepare("update users set last_seen_at=?,last_route='/settings' where id=3").run(now-120001);
  db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,?,1,'Owner'),(2,?,2,'User')").run(dataGuild,dataGuild);
  const duel = db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,kind,created_at,started_at,ended_at,last_activity_at,archived_at)
    values(?,?,?,?,1,'match',?,?,?,?,?,?,?,?)`);
  duel.run(1,dataGuild,'live','Live tag','active','tag','play',`${today} 00:00:00`,new Date(now-60000).toISOString(),null,new Date(now-1000).toISOString(),null);
  duel.run(2,dataGuild,'complete','Done','completed','1v1','play',`${yesterday} 00:00:00`,`${yesterday}T01:00:00Z`,`${today}T00:00:00Z`,null,null);
  duel.run(3,dataGuild,'fork','Replay','active','ffa4','replay-fork',`${today} 00:00:00`,`${today}T00:00:00Z`,null,new Date(now).toISOString(),null);
  duel.run(4,dataGuild,'stale','Idle','active','ffa3','play',`${today} 00:00:00`,new Date(now-600001).toISOString(),null,new Date(now-600001).toISOString(),null);
  duel.run(5,dataGuild,'waiting','Waiting','lobby','1v1','play',`${today} 00:00:00`,null,null,new Date(now).toISOString(),null);
  duel.run(6,guild,'foreign','Foreign','active','ffa4','play',`${today} 00:00:00`,new Date(now).toISOString(),null,new Date(now).toISOString(),null);
  db.exec("insert into duel_seats(duel_id,seat,player_id,is_bot) values(1,0,2,0),(2,0,1,0),(4,0,1,0),(6,0,2,0)");
  db.prepare(`insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at,started_at,ended_at)
    values(1,?,'c','Draft','completed','1','done',?,?,?),(2,?,'c','Old lobby','pending','1','old',?,null,null),(3,?,'c','Active','active','1','active',?,?,null)`)
    .run(dataGuild,`${yesterday} 00:00:00`,`${yesterday} 00:00:00`,`${today} 00:00:00`,dataGuild,new Date(now-86400001).toISOString(),dataGuild,`${today} 00:00:00`,`${today} 00:00:00`);
  db.exec("insert into draft_players(draft_id,player_id) values(1,1),(3,1)");
  const clock = vi.spyOn(Date,"now").mockReturnValue(now);
  const online = await stub.response(stub.command("online"));
  expect(JSON.stringify(online)).toContain("Deck builder");
  expect(JSON.stringify(online)).toContain("Tag duel");
  expect(JSON.stringify(online)).not.toContain("4-way duel");
  expect(JSON.stringify(online)).not.toContain("Other admin");
  const stats = await stub.response(stub.command("stats"));
  expect(db.prepare("select distinct guild_id from mod_actions where action in ('online','stats')").all()).toEqual([{ guild_id: guild }]);
  clock.mockRestore();
  const fields = stats.embeds[0].fields;
  expect(fields.find((f: any) => f.name === "Sign-ups").value).toBe("Today: 2\n7 days: 3");
  expect(fields.find((f: any) => f.name === "Active users").value).toBe("Today: 3\n7 days: 3");
  expect(fields.find((f: any) => f.name === "Duels started").value).toBe("Today: 2\n7 days: 3");
  expect(fields.find((f: any) => f.name === "Duels finished").value).toBe("Today: 1\n7 days: 1");
  expect(fields.find((f: any) => f.name === "Drafts started").value).toBe("Today: 1\n7 days: 2");
  expect(fields.find((f: any) => f.name === "Drafts completed").value).toBe("Today: 1\n7 days: 1");
  expect(fields.find((f: any) => f.name === "Live duels").value).toContain("Tag duel: 1");
  expect(fields.find((f: any) => f.name === "Live drafts").value).toBe("Active: 1\nWaiting: 0");
});

it("records one success when Discord rejects the final preview update", async () => {
  const { stub,db } = await fixture();
  const buttons = await preview(stub);
  stub.state.replyStatus = 403;
  const token = stub.button(buttons[0].custom_id);
  await stub.response(token);
  await expect.poll(() => stub.requests.filter(r => r.path.includes(token) && r.method === "PATCH").length).toBe(2);
  expect(db.prepare("select count(*) as n from mod_actions where action='announce' and result='success'").get()).toEqual({ n: 1 });
  expect(posts(stub)).toHaveLength(1);
});

it("posts to a text channel without an image or role and does not crosspost", async () => {
  const { stub } = await fixture();
  stub.state.channelType = 0;
  const modal = await stub.response(stub.command("announce"));
  const message = await stub.response(stub.modal(modal.custom_id,""));
  const token = stub.button(message.components[0].components[0].custom_id);
  await stub.response(token);
  expect(posts(stub)).toHaveLength(1);
  expect(posts(stub)[0].body.embeds[0].image).toBeUndefined();
  expect(posts(stub)[0].body.content).toBeUndefined();
  expect(stub.requests.some(r => r.path.endsWith("/crosspost"))).toBe(false);
});

it("claims simultaneous Post presses once and keeps another admin out of the modal", async () => {
  const { stub,db } = await fixture();
  const modal = await stub.response(stub.command("announce"));
  expect((await stub.response(stub.modal(modal.custom_id,"",other))).content).toContain("Only");
  const message = await stub.response(stub.modal(modal.custom_id,""));
  const id = message.components[0].components[0].custom_id;
  const first = stub.button(id), second = stub.button(id);
  await Promise.all([stub.response(first),stub.response(second)]);
  expect(posts(stub)).toHaveLength(1);
  expect(db.prepare("select count(*) as n from mod_actions where action='announce' and result='success'").get()).toEqual({ n: 1 });
});

it("refuses high and non-mentionable roles before opening the modal", async () => {
  const { stub } = await fixture();
  const choose = () => stub.emit({ data: { name: "announce", type: 1, id: app,
    options: [{ name: "role", type: 8, value: role }],
    resolved: { roles: { [role]: { id: role, name: "News", position: 1, permissions: "0", managed: false, mentionable: true } } } } });
  stub.state.rolePosition = 10;
  expect((await stub.response(choose())).content).toContain("below");
  stub.state.rolePosition = 1; stub.state.roleMentionable = false;
  expect((await stub.response(choose())).content).toContain("mentionable");
  expect(posts(stub)).toHaveLength(0);
});

it("keeps catalog lookup working when the optional duel-server package is absent", async () => {
  const isolated = mkdtempSync(join(tmpdir(),"bot-lean-community-"));
  cleanups.push(() => rmSync(isolated,{ recursive: true,force: true }));
  writeFileSync(join(isolated,"package.json"),'{"type":"module"}');
  const dependencies = fileURLToPath(new URL("../../../../../node_modules/",import.meta.url));
  mkdirSync(join(isolated,"node_modules","@yugidraft"),{ recursive: true });
  for (const name of ["discord.js","better-sqlite3","@yugidraft/shared"]) symlinkSync(join(dependencies,name),join(isolated,"node_modules",name));
  for (const name of ["card.ts","card-data.ts","common.ts"]) copyFileSync(fileURLToPath(new URL(name,import.meta.url)),join(isolated,name));
  const { cardHandler } = await import(pathToFileURL(join(isolated,"card.ts")).href);
  const handler = cardHandler();
  const { stub,db } = await fixture(false,[{ commands: [handler.command],buttons: [],modals: [],start: () => handler.stop }]);
  db.prepare(`insert into card_catalog(ygoprodeck_id,name,type,frame_type,effect_text,image_url,image_url_small,card_sets_json,cached_at,is_prerelease)
    values(99999,'Catalog Preview','Effect Monster','effect','Preview text','x','x','[]',?,1)`).run(new Date().toISOString());
  const card = await stub.response(stub.command("card",[{ name: "name",type: 3,value: "99999" }]));
  expect(card.embeds[0].footer.text).toContain("TCG status unavailable");
  expect(card.embeds[0].fields).toBeUndefined();
  expect(card.embeds[0].description).toContain("Pre-release");
  expect(card.embeds[0].image.url).toBe("https://pics.projectignis.org:2096/pics/99999.jpg");
});

function stubAvatar() {
  // A real 1x1 PNG; no Discord CDN calls leave the integration fixture.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3foAAAAASUVORK5CYII=", "base64");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(png, { headers: { "content-type": "image/png" } })));
  return png;
}

it("welcomes Gateway joins with one user mention and a PNG, and reuses durable numbers after restart", async () => {
  stubAvatar();
  const { stub, db, bot, directory } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(1);
  expect(posts(stub)[0].body).toMatchObject({ content: `Hey <@${other}>, welcome to **Dueling Domain**!`,
    allowed_mentions: { parse: [], users: [other], roles: [], replied_user: false },
    filenames: ["welcome.png"], png: true });
  await expect.poll(() => db.prepare("select last_welcomed_at from discord_welcome_members").get())
    .toEqual({ last_welcomed_at: expect.any(Number) });
  const row = db.prepare("select * from discord_welcome_members").get();
  expect(row).toMatchObject({ guild_id: guild, discord_user_id: other, number: 1 });
  stub.leave();
  stub.join();
  await stub.response(stub.command("stats"));
  expect(posts(stub)).toHaveLength(1);
  expect(db.prepare("select * from discord_welcome_members").all()).toEqual([row]);
  stub.join("100000000000000011");
  await expect.poll(() => posts(stub).length).toBe(2);
  expect(db.prepare("select number from discord_welcome_members where discord_user_id=?").get("100000000000000011")).toEqual({ number: 2 });
  await bot.stop();
  const reopened = openDatabase(join(directory, "bot.sqlite"));
  const restarted = await startBot({ config: { ...bot.context.config, healthPath: join(directory, "restart-health.json") }, db: reopened, modules: [community] });
  cleanups.push(() => restarted.stop());
  stub.join();
  await stub.response(stub.command("stats"));
  expect(posts(stub)).toHaveLength(2);
  // A fresh database connection retains the cooldown, then permits a later
  // welcome without changing either the member number or first join time.
  reopened.prepare("update discord_welcome_members set last_welcomed_at=? where discord_user_id=?")
    .run(Date.now() - 24 * 60 * 60 * 1000 - 1, other);
  stub.leave();
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(3);
  expect(posts(stub).every(post => post.body.png)).toBe(true);
  expect(reopened.prepare("select * from discord_welcome_members where discord_user_id=?").get(other))
    .toMatchObject({ guild_id: guild, discord_user_id: other, number: 1, first_joined_at: (row as any).first_joined_at });
});

it("caps a 50-member Gateway join raid before assigning numbers and caches the destination", async () => {
  const png = stubAvatar();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const render = vi.spyOn(welcomeCard, "renderWelcomeCard").mockImplementation(async () => { await gate; return png; });
  let drain: ReturnType<typeof startWelcome>;
  const { stub, db } = await fixture(false, [{ ...community, start(c) { return drain = startWelcome(c); } }],
    { botGuildId: guild, welcomeChannelId: announce });
  cleanups.push(() => release());
  for (let n = 0; n < 50; n++) stub.join(String(100000000000010000n + BigInt(n)));
  await stub.response(stub.command("stats"));
  expect(render).toHaveBeenCalledTimes(1);
  release();
  await drain!();
  expect(posts(stub)).toHaveLength(20);
  expect(db.prepare("select count(*) as n, max(number) as last from discord_welcome_members").get()).toEqual({ n: 20, last: 20 });
  expect(stub.requests.filter(r => r.method === "GET" && r.path === `/channels/${announce}`)).toHaveLength(1);
});

it("drops joins queued for more than two minutes before assigning a number", async () => {
  const png = stubAvatar();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(welcomeCard, "renderWelcomeCard").mockImplementation(async () => { await gate; return png; });
  let drain: ReturnType<typeof startWelcome>;
  const { stub, db } = await fixture(false, [{ ...community, start(c) { return drain = startWelcome(c); } }],
    { botGuildId: guild, welcomeChannelId: announce });
  cleanups.push(() => release());
  stub.join();
  stub.join("100000000000000011");
  await stub.response(stub.command("stats"));
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_001);
  release();
  await drain!();
  expect(posts(stub)).toHaveLength(1);
  expect(db.prepare("select discord_user_id, number from discord_welcome_members").all()).toEqual([{ discord_user_id: other, number: 1 }]);
});

it("requests a static PNG for an animated member avatar", async () => {
  stubAvatar();
  const { stub } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join(other, false, guild, { avatar: "a_0123456789abcdef0123456789abcdef" });
  await expect.poll(() => posts(stub).length).toBe(1);
  expect(fetch).toHaveBeenCalledWith(`https://cdn.discordapp.com/avatars/${other}/a_0123456789abcdef0123456789abcdef.png?size=256`, expect.anything());
  expect(posts(stub)[0].body.png).toBe(true);
});

it("waits for membership screening and welcomes the pending-to-approved transition once", async () => {
  stubAvatar();
  const { stub, db, bot } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  expect(stub.state.intents & GatewayIntentBits.GuildMembers).toBe(GatewayIntentBits.GuildMembers);
  stub.join(other, false, guild, { pending: true });
  await stub.response(stub.command("stats"));
  expect(posts(stub)).toHaveLength(0);
  expect(db.prepare("select count(*) as n from discord_welcome_members").get()).toEqual({ n: 0 });
  stub.updateMember(other, false);
  await expect.poll(() => posts(stub).length).toBe(1);
  stub.updateMember(other, false);
  stub.updateMember(other, true);
  stub.updateMember(other, false);
  await stub.response(stub.command("stats"));
  await bot.stop();
  expect(posts(stub)).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("welcomes screened joins after member-cache eviction and expires abandoned screening slots", async () => {
  stubAvatar();
  const { stub, db, bot } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join(other, false, guild, { pending: true });
  for (let n = 0; n < 101; n++) stub.join(String(100000000000010000n + BigInt(n)), false, guild, { pending: true });
  await stub.response(stub.command("stats"));
  expect(bot.client.guilds.cache.get(guild)!.members.cache.has(other)).toBe(false);
  // An ordinary update for an uncached existing member must not create a greeting.
  stub.updateMember("100000000000000099", false);
  await stub.response(stub.command("stats"));
  expect(posts(stub)).toHaveLength(0);
  stub.updateMember(other, false);
  await expect.poll(() => posts(stub).length).toBe(1);
  stub.updateMember(other, false);
  // Abandoned/evicted pending members must not occupy the bounded tracking
  // slots forever, even if discord.js suppresses their removal events.
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_001);
  const fresh = "100000000000000088";
  stub.join(fresh, false, guild, { pending: true });
  for (let n = 0; n < 101; n++) stub.join(String(100000000000020000n + BigInt(n)), false, guild, { pending: true });
  await stub.response(stub.command("stats"));
  expect(bot.client.guilds.cache.get(guild)!.members.cache.has(fresh)).toBe(false);
  stub.updateMember(fresh, false);
  await expect.poll(() => posts(stub).length).toBe(2);
  expect(db.prepare("select count(*) as n from discord_welcome_members").get()).toEqual({ n: 2 });
});

it("revalidates the cached welcome destination after one minute before numbering", async () => {
  stubAvatar();
  const reported = vi.spyOn(observability, "report").mockImplementation(() => {});
  const { stub, db } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(1);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
  stub.state.channelGuild = other;
  stub.join("100000000000000011");
  await expect.poll(() => reported.mock.calls.some(([, context]) => context?.tags?.operation === "bot.welcome.join")).toBe(true);
  expect(posts(stub)).toHaveLength(1);
  expect(db.prepare("select count(*) as n from discord_welcome_members").get()).toEqual({ n: 1 });
  expect(stub.requests.filter(r => r.method === "GET" && r.path === `/channels/${announce}`)).toHaveLength(2);
});

it("migrates existing welcome rows without changing their durable member numbers", async () => {
  stubAvatar();
  const { stub, bot, directory, db } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  db.prepare("insert into discord_welcome_members(guild_id, discord_user_id, number) values(?,?,?)").run(guild, other, 178);
  await bot.stop();
  const legacy = new Database(join(directory, "bot.sqlite"));
  legacy.exec("alter table discord_welcome_members drop column last_welcomed_at");
  legacy.close();
  const reopened = openDatabase(join(directory, "bot.sqlite"));
  const restarted = await startBot({ config: { ...bot.context.config, healthPath: join(directory, "restart-health.json") }, db: reopened, modules: [community] });
  cleanups.push(() => restarted.stop());
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(1);
  await expect.poll(() => reopened.prepare("select number, last_welcomed_at from discord_welcome_members where discord_user_id=?").get(other))
    .toEqual({ number: 178, last_welcomed_at: expect.any(Number) });
});

it("keeps a member's number and allows retry after a failed welcome post", async () => {
  stubAvatar();
  const reported = vi.spyOn(observability, "report").mockImplementation(() => {});
  const { stub, db } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.state.nextStatus = 403;
  stub.join();
  await expect.poll(() => reported.mock.calls.some(([, context]) => context?.tags?.operation === "bot.welcome.join")).toBe(true);
  expect(db.prepare("select number, last_welcomed_at from discord_welcome_members").get()).toEqual({ number: 1, last_welcomed_at: null });
  stub.leave(); stub.join();
  await expect.poll(() => db.prepare("select last_welcomed_at from discord_welcome_members").get())
    .toEqual({ last_welcomed_at: expect.any(Number) });
  expect(posts(stub)).toHaveLength(2);
  expect(db.prepare("select number from discord_welcome_members").all()).toEqual([{ number: 1 }]);
});

it.each(["off", "bot", "foreign"])("skips welcome delivery for %s", async kind => {
  stubAvatar();
  const { stub, bot } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: kind === "off" ? "" : announce });
  stub.join(other, kind === "bot", kind === "foreign" ? other : guild);
  // A subsequent interaction fences Gateway processing and queued delivery.
  await stub.response(stub.command("stats"));
  await bot.stop();
  expect(posts(stub)).toHaveLength(0);
  // stop closes SQLite, so only assert no CDN work for skipped joins.
  expect(fetch).not.toHaveBeenCalled();
});

it("posts the greeting even when welcome rendering fails", async () => {
  vi.spyOn(welcomeCard, "renderWelcomeCard").mockRejectedValue(new Error("render failed"));
  const { stub, db } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(1);
  expect(posts(stub)[0].body.content).toBe(`Hey <@${other}>, welcome to **Dueling Domain**!`);
  expect(posts(stub)[0].body.attachments).toBeUndefined();
  expect(db.prepare("select number from discord_welcome_members").get()).toEqual({ number: 1 });
});

it("terminates a stalled render worker, posts text, and renders the next join", async () => {
  stubAvatar();
  const isolated = mkdtempSync(join(tmpdir(), "bot-welcome-timeout-"));
  cleanups.push(() => rmSync(isolated, { recursive: true, force: true }));
  const source = join(isolated, "src/features/community"), assets = join(isolated, "assets/welcome");
  mkdirSync(source, { recursive: true }); mkdirSync(assets, { recursive: true });
  symlinkSync(fileURLToPath(new URL("../../../../../node_modules/", import.meta.url)), join(isolated, "node_modules"));
  const originalAssets = fileURLToPath(new URL("../../../assets/welcome/", import.meta.url));
  symlinkSync(join(originalAssets, "fonts"), join(assets, "fonts"));
  copyFileSync(join(originalAssets, "first-pull.svg"), join(assets, "first-pull.svg"));
  copyFileSync(fileURLToPath(new URL("welcome-card.ts", import.meta.url)), join(source, "welcome-card.ts"));
  const marker = join(isolated, "started");
  writeFileSync(join(assets, "render.cjs"), `
    const fs = require("node:fs");
    if (fs.existsSync(${JSON.stringify(marker)})) require(${JSON.stringify(join(originalAssets, "render.cjs"))});
    else { fs.writeFileSync(${JSON.stringify(marker)}, "started"); setInterval(() => {}, 1000); }
  `);
  const renderer = await import(pathToFileURL(join(source, "welcome-card.ts")).href);
  vi.spyOn(welcomeCard, "renderWelcomeCard").mockImplementation(renderer.renderWelcomeCard);
  const reported = vi.spyOn(observability, "report").mockImplementation(() => {});
  const { stub } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join();
  await expect.poll(() => posts(stub).length, { timeout: 12_000 }).toBe(1);
  expect(posts(stub)[0].body.content).toBe(`Hey <@${other}>, welcome to **Dueling Domain**!`);
  expect(posts(stub)[0].body.attachments).toBeUndefined();
  expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: "Welcome render worker timed out" }),
    { tags: { operation: "bot.welcome.render" } });
  stub.join("100000000000000011");
  await expect.poll(() => posts(stub).length).toBe(2);
  expect(posts(stub)[1].body.png).toBe(true);
}, 20_000);

it("previews a real card privately for linked owners only, defaulting to self or a chosen member", async () => {
  stubAvatar();
  const { stub, db } = await fixture();
  const options = [{ name: "preview", type: 1 }];
  expect((await stub.response(stub.command("welcome", options, "100000000000000011"))).content).toContain("access");
  const token = stub.command("welcome", options);
  const reply = await stub.response(token);
  expect(reply).toMatchObject({ filenames: ["welcome.png"], png: true });
  expect(stub.requests.find(r => r.path.includes(token) && r.path.includes("/callback"))!.body.data.flags).toBe(64);
  const chosen = stub.emit({ data: { name: "welcome", type: 1, id: app,
    options: [{ name: "preview", type: 1, options: [{ name: "member", type: 6, value: other }] }],
    resolved: { users: { [other]: { id: other, username: "Other" } } } } });
  expect((await stub.response(chosen)).png).toBe(true);
  expect(db.prepare("select count(*) as n from discord_welcome_members").get()).toEqual({ n: 0 });
  expect(posts(stub)).toHaveLength(0);
});

it("renders safely with failed avatars, XML, emoji and long unsupported names", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  const { stub } = await fixture();
  stub.state.memberName = "Alexandria<&\" 魔法😀".repeat(12);
  expect((await stub.response(stub.command("welcome", [{ name: "preview", type: 1 }]))).png).toBe(true);
  stub.state.memberName = "魔法😀";
  expect((await stub.response(stub.command("welcome", [{ name: "preview", type: 1 }]))).png).toBe(true);
});

it.each(["http-error", "too-large-header", "too-large-stream", "bad-png", "corrupt-png", "oversized-bitmap"])("falls back to initials for %s avatar responses", async kind => {
  const displayAvatar = vi.spyOn(GuildMember.prototype, "displayAvatarURL");
  const fetchAvatar = vi.fn(async () => {
    if (kind === "http-error") return new Response(null, { status: 500 });
    if (kind === "too-large-header") return new Response("", { headers: { "content-length": "524289" } });
    if (kind === "too-large-stream") return new Response(Buffer.alloc(524289));
    if (kind === "bad-png") return new Response("not a PNG");
    const bytes = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
    const dimension = kind === "corrupt-png" ? 256 : 2048;
    bytes.writeUInt32BE(dimension, 16); bytes.writeUInt32BE(dimension, 20);
    return new Response(bytes);
  });
  vi.stubGlobal("fetch", fetchAvatar);
  const { stub } = await fixture();
  expect((await stub.response(stub.command("welcome", [{ name: "preview", type: 1 }]))).png).toBe(true);
  expect(displayAvatar).toHaveBeenCalledWith({ extension: "png", size: 256, forceStatic: true });
  expect(fetchAvatar).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/cdn\.discordapp\.com\/.*\.png/), expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it("refuses a welcome channel in another guild and recovers for the next valid join", async () => {
  stubAvatar();
  const reported = vi.spyOn(observability, "report").mockImplementation(() => {});
  const { stub, db } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.state.channelGuild = other;
  stub.join();
  await expect.poll(() => reported.mock.calls.some(([, context]) => context?.tags?.operation === "bot.welcome.join")).toBe(true);
  expect(posts(stub)).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  expect(db.prepare("select count(*) as n from discord_welcome_members").get()).toEqual({ n: 0 });
  stub.state.channelGuild = guild;
  stub.join();
  await expect.poll(() => posts(stub).length).toBe(1);
  expect(posts(stub)[0].body.png).toBe(true);
});

it("times out a stalled avatar download and still sends the welcome PNG", async () => {
  vi.stubGlobal("fetch", vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
    options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
  })));
  const { stub } = await fixture(false, [community], { botGuildId: guild, welcomeChannelId: announce });
  stub.join();
  await expect.poll(() => posts(stub).length, { timeout: 4000 }).toBe(1);
  expect(posts(stub)[0].body.png).toBe(true);
});
