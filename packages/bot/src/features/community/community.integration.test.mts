import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FeatureModule } from "../../runtime/types.js";
import Database from "better-sqlite3";
import { WebSocketServer, type WebSocket } from "ws";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "@yugidraft/shared/db";
import { startBot } from "../../runtime/app.js";
import { deployCommands } from "../../runtime/deploy.js";
import { community } from "./index.js";

const guild = "100000000000000001", app = "100000000000000002", admin = "100000000000000003";
const channel = "100000000000000004", other = "100000000000000005", announce = "100000000000000006";
const role = "100000000000000007", highRole = "100000000000000008", log = "100000000000000009";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

async function stubDiscord() {
  const requests: { method: string; path: string; body: any }[] = [];
  let socket: WebSocket, sequence = 0;
  const state = { channelGuild: guild, channelType: 5, rolePosition: 1, roleMentionable: true, nextStatus: 0, crosspostStatus: 0, replyStatus: 0 };
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url!.replace("/api/v10", "");
    requests.push({ method: req.method!, path, body });
    res.setHeader("content-type", "application/json");
    const send = (data: unknown) => res.end(JSON.stringify(data));
    if (path === "/gateway/bot") return send({ url: gatewayUrl, shards: 1,
      session_start_limit: { total: 1000, remaining: 1000, reset_after: 60_000, max_concurrency: 1 } });
    if (path.split("?")[0] === `/guilds/${guild}`) return send({ id: guild, name: "Test", roles: [], emojis: [], stickers: [], features: [], owner_id: other });
    if (path === `/guilds/${guild}/roles`) return send([
      { id: guild, name: "@everyone", position: 0, permissions: "0", managed: false, mentionable: false },
      { id: role, name: "News", position: state.rolePosition, permissions: "0", managed: false, mentionable: state.roleMentionable },
      { id: highRole, name: "Staff", position: 10, permissions: "0", managed: false, mentionable: false },
    ]);
    if (path.startsWith(`/guilds/${guild}/members/`)) return send({ user: { id: path.split("/").at(-1), username: "Tester" },
      roles: [highRole], permissions: "0", joined_at: new Date().toISOString() });
    if (path.includes("/commands")) return send(body);
    if (path.includes("/callback")) { res.statusCode = 204; res.removeHeader("content-type"); return res.end(); }
    if (req.method === "GET" && path.startsWith("/channels/")) return send({ id: path.split("/").at(-1), guild_id: state.channelGuild, type: state.channelType });
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
    return send({ id: "100000000000000099", channel_id: announce, content: "", author: { id: app, username: "Bot", bot: true },
      timestamp: new Date().toISOString(), attachments: [], embeds: [] });
  });
  const ws = new WebSocketServer({ server });
  ws.on("connection", client => {
    socket = client;
    client.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 1000 } }));
    client.on("message", raw => {
      const packet = JSON.parse(raw.toString());
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
  return { api: `${gatewayUrl.replace("ws:", "http:")}/api`, requests, state, emit, response,
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

async function fixture(presence = false, modules: FeatureModule[] = [community]) {
  const directory = mkdtempSync(join(tmpdir(), "bot-community-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  vi.stubEnv("DISCORD_BOT_ENABLED", "1"); vi.stubEnv("OWNER_USER_IDS", "1,3");
  vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", log); vi.stubEnv("SITE_DOMAIN", "app.example.test");
  vi.stubEnv("DUEL_DATA_DIR", join(directory, "duel-engine"));
  const db = openDatabase(join(directory, "bot.sqlite"));
  db.prepare("insert into users(id,username,display_name,discord_user_id) values(1,'owner','Owner',?),(2,'user','User',?),(3,'other','Other admin',?)")
    .run(admin, "100000000000000011", other);
  if (presence) db.exec("alter table users add column last_seen_at integer; alter table users add column last_route text;");
  const stub = await stubDiscord();
  const bot = await startBot({ config: { token: "stub", clientId: app, guildId: guild, announceChannelId: announce,
    modLogChannelId: log, restApi: stub.api, healthPath: join(directory, "health.json") }, db, modules });
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

it("deploys four guild commands with public card access and admin defaults", async () => {
  const { stub } = await fixture();
  await deployCommands({ token: "stub", clientId: app, guildId: guild, restApi: stub.api }, [community]);
  const definitions = stub.requests.find(r => r.method === "PUT")!.body;
  expect(definitions.map((c: any) => c.name).sort()).toEqual(["announce", "card", "online", "stats"]);
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

it("matches admin UTC counts, distinct active users, live filters and section labels", async () => {
  const { stub, db } = await fixture(true);
  const now = Date.now(), today = new Date(now).toISOString().slice(0,10), yesterday = new Date(now-86400000).toISOString().slice(0,10);
  db.prepare("update users set created_at=? where id in (1,2)").run(`${today} 00:00:00`);
  db.prepare("update users set created_at=? where id=3").run(`${yesterday}T00:00:00.000Z`);
  db.prepare("update users set last_seen_at=?,last_route='/decks/new' where id=1").run(now-120000);
  db.prepare("update users set last_seen_at=?,last_route='/duels/[slug]' where id=2").run(now-1000);
  db.prepare("update users set last_seen_at=?,last_route='/settings' where id=3").run(now-120001);
  db.prepare("insert into players(id,guild_id,user_id,display_name) values(1,?,1,'Owner'),(2,?,2,'User')").run(guild,guild);
  const duel = db.prepare(`insert into duels(id,guild_id,web_slug,name,organizer_player_id,mode,status,format,kind,created_at,started_at,ended_at,last_activity_at,archived_at)
    values(?,?,?,?,1,'match',?,?,?,?,?,?,?,?)`);
  duel.run(1,guild,'live','Live tag','active','tag','play',`${today} 00:00:00`,new Date(now-60000).toISOString(),null,new Date(now-1000).toISOString(),null);
  duel.run(2,guild,'complete','Done','completed','1v1','play',`${yesterday} 00:00:00`,`${yesterday}T01:00:00Z`,`${today}T00:00:00Z`,null,null);
  duel.run(3,guild,'fork','Replay','active','ffa4','replay-fork',`${today} 00:00:00`,`${today}T00:00:00Z`,null,new Date(now).toISOString(),null);
  duel.run(4,guild,'stale','Idle','active','ffa3','play',`${today} 00:00:00`,new Date(now-600001).toISOString(),null,new Date(now-600001).toISOString(),null);
  duel.run(5,guild,'waiting','Waiting','lobby','1v1','play',`${today} 00:00:00`,null,null,new Date(now).toISOString(),null);
  duel.run(6,other,'foreign','Foreign','active','ffa4','play',`${today} 00:00:00`,new Date(now).toISOString(),null,new Date(now).toISOString(),null);
  db.exec("insert into duel_seats(duel_id,seat,player_id,is_bot) values(1,0,2,0),(2,0,1,0),(4,0,1,0)");
  db.prepare(`insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id,web_slug,created_at,started_at,ended_at)
    values(1,?,'c','Draft','completed','1','done',?,?,?),(2,?,'c','Old lobby','pending','1','old',?,null,null),(3,?,'c','Active','active','1','active',?,?,null)`)
    .run(guild,`${yesterday} 00:00:00`,`${yesterday} 00:00:00`,`${today} 00:00:00`,guild,new Date(now-86400001).toISOString(),guild,`${today} 00:00:00`,`${today} 00:00:00`);
  db.exec("insert into draft_players(draft_id,player_id) values(1,1),(3,1)");
  const clock = vi.spyOn(Date,"now").mockReturnValue(now);
  const online = await stub.response(stub.command("online"));
  expect(JSON.stringify(online)).toContain("Deck builder");
  expect(JSON.stringify(online)).toContain("Tag duel");
  expect(JSON.stringify(online)).not.toContain("Other admin");
  const stats = await stub.response(stub.command("stats"));
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
