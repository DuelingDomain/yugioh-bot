import { createServer } from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { Client, PermissionFlagsBits as P, REST } from "discord.js";
import { openDatabase } from "@yugidraft/shared/db";
import { loadSharedAdminServices } from "../../runtime/shared.js";
import { createAudit } from "../../runtime/audit.js";
import { Cooldown } from "../../runtime/cooldown.js";
import { createRegistry } from "../../runtime/registry.js";
import type { CommandInteractionLike, FeatureContext, InteractionLike } from "../../runtime/types.js";
import { server } from "./index.js";

const G = "100000000000000001", BOT = "100000000000000002", ADMIN = "100000000000000003";
const MEMBER = "100000000000000004", OWNER = "100000000000000005", OTHER = "100000000000000006";
const ADMIN_ROLE = "100000000000000011", BOT_ROLE = "100000000000000012", LOW_ROLE = "100000000000000013";
const MOD_ROLE = "100000000000000014", CH = "100000000000000021", LOG = "100000000000000022";
const CAT = "100000000000000023", DEST = "100000000000000024";
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const fn of cleanup.splice(0).reverse()) await fn(); });

async function fixture() {
  vi.stubEnv("OWNER_USER_IDS", "1"); vi.stubEnv("DISCORD_BOT_ENABLED", "1"); vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", LOG);
  const db = openDatabase(":memory:"); cleanup.push(() => { db.close(); });
  db.prepare("insert into users(id, username, display_name, discord_user_id) values(1,'admin','Admin',?)").run(ADMIN);
  const requests: { method: string; path: string; body: any }[] = [];
  const roles: any[] = [
    { id: G, name: "@everyone", position: 0, permissions: (P.ViewChannel | P.SendMessages | P.ReadMessageHistory).toString() },
    { id: ADMIN_ROLE, name: "Admin", position: 20, permissions: "0" },
    { id: BOT_ROLE, name: "Bot", position: 30, permissions: "1391837965494" },
    { id: LOW_ROLE, name: "Player", position: 2, permissions: "0" },
    { id: MOD_ROLE, name: "Moderator", position: 5, permissions: P.ModerateMembers.toString() },
  ];
  const members: Record<string, any> = Object.fromEntries([
    [ADMIN, [ADMIN_ROLE]], [BOT, [BOT_ROLE]], [MEMBER, [LOW_ROLE]], [OWNER, [ADMIN_ROLE]], [OTHER, [MOD_ROLE]],
  ].map(([id, rs]) => [id as string, { user: { id, username: "Test" }, roles: rs }]));
  const channels: any[] = [{ id: CH, name: "general", type: 0, guild_id: G, parent_id: null, permission_overwrites: [] },
    { id: LOG, name: "mod-log", type: 0, guild_id: G, parent_id: CAT, permission_overwrites: [] },
    { id: CAT, name: "Staff", type: 4, guild_id: G, parent_id: null, permission_overwrites: [] },
    { id: DEST, name: "Other", type: 4, guild_id: G, parent_id: null, permission_overwrites: [] }];
  let next = 100000000000001000n;
  let failure: { method: string; path: string; status: number } | undefined;
  const http = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    const path = req.url!.replace("/api/v10", "");
    requests.push({ method: req.method!, path, body });
    res.setHeader("content-type", "application/json");
    if (failure && failure.method === req.method && failure.path === path) {
      res.statusCode = failure.status;
      res.end(JSON.stringify({ message: "Sensitive upstream text", code: failure.status === 404 ? 10003 : 50013,
        ...(failure.status === 429 ? { retry_after: 0.01, global: false } : {}) })); return;
    }
    if (body?.permission_overwrites) {
      const botPermissions = roles.filter(r => r.id === G || members[BOT].roles.includes(r.id))
        .reduce((bits, r) => bits | BigInt(r.permissions), 0n);
      const requested = body.permission_overwrites.reduce((bits: bigint, o: any) => bits | BigInt(o.allow) | BigInt(o.deny), 0n);
      if (!(botPermissions & P.Administrator) && (requested & ~botPermissions)) {
        res.statusCode = 403; res.end(JSON.stringify({ code: 50013, message: "Cannot set unowned overwrite bits" })); return;
      }
    }
    let result: any;
    if (path === `/guilds/${G}`) result = { id: G, owner_id: OWNER, features: ["COMMUNITY"] };
    else if (path === `/guilds/${G}/roles`) {
      if (req.method === "POST") { result = { id: String(++next), position: 1, permissions: "0", ...body }; roles.push(result); }
      else result = roles;
    } else if (path.startsWith(`/guilds/${G}/members/`)) {
      const parts = path.split("/"); const m = members[parts[4]];
      if (parts[5] === "roles") {
        if (req.method === "PUT") m.roles = [...new Set([...m.roles, parts[6]])];
        else m.roles = m.roles.filter((id: string) => id !== parts[6]);
      } else result = m;
    } else if (path.startsWith(`/guilds/${G}/roles/`)) {
      const id = path.split("/").at(-1); const role = roles.find(r => r.id === id);
      if (req.method === "DELETE") roles.splice(roles.indexOf(role), 1);
      else { Object.assign(role, body); result = role; }
    } else if (path === `/guilds/${G}/channels`) {
      if (req.method === "POST") { result = { id: String(++next), guild_id: G, permission_overwrites: [], ...body }; channels.push(result); }
      else if (req.method === "PATCH") { for (const item of body) Object.assign(channels.find(c => c.id === item.id), item); result = channels; }
      else result = channels;
    } else if (path.startsWith("/channels/")) {
      const parts = path.split("/"); const channel = channels.find(c => c.id === parts[2]);
      if (parts[3] === "permissions") {
        channel.permission_overwrites = channel.permission_overwrites.filter((o: any) => o.id !== parts[4]);
        if (req.method === "PUT") channel.permission_overwrites.push({ id: parts[4], ...body });
      } else if (req.method === "DELETE") { channels.splice(channels.indexOf(channel), 1); result = channel; }
      else if (req.method === "PATCH") { Object.assign(channel, body); result = channel; }
      else result = channel;
    }
    if (result === undefined) { res.statusCode = 204; res.removeHeader("content-type"); res.end(); }
    else res.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  cleanup.push(() => new Promise<void>(resolve => http.close(() => resolve())));
  const rest = new REST({ api: `http://127.0.0.1:${(http.address() as any).port}/api`, retries: 0,
    rejectOnRateLimit: () => true }).setToken("stub");
  const client = new Client({ intents: [] });
  cleanup.push(async () => { rest.clearHashSweeper(); rest.clearHandlerSweeper(); await client.destroy(); });
  const shared = await loadSharedAdminServices(db);
  const context: FeatureContext = { db, rest, client, shared, audit: createAudit(shared, G),
    config: { token: "stub", clientId: BOT, guildId: G, dataGuildId: G, modLogChannelId: LOG, moderatorRoleId: MOD_ROLE, healthPath: "unused" },
    cooldown: new Cooldown(), signal: new AbortController().signal };
  const replies: any[] = [];
  let replyFails = false;
  let seq = 0;
  function base(actor = ADMIN, guild: string | null = G): InteractionLike {
    return { id: String(++seq), guildId: guild, channelId: CH, user: { id: actor, username: "Admin", displayName: "Admin" },
      async reply(message) { if (replyFails) throw new Error("Reply delivery failed"); replies.push(message); }, async editReply(message) { replies.push(message); },
      async deferReply() {}, async deferUpdate() {}, async showModal() {} };
  }
  async function command(name: string, sub: string, options: Record<string, any> = {}, actor = ADMIN, guild: string | null = G) {
    const interaction: CommandInteractionLike = { ...base(actor, guild), commandName: name, options: {
      getSubcommand: () => sub, getSubcommandGroup: () => null,
      getString: n => options[n] ?? null, getInteger: n => options[n] ?? null, getNumber: n => options[n] ?? null,
      getBoolean: n => options[n] ?? null, getUser: n => options[n] ? { id: options[n], username: "Target", displayName: "Target" } : null,
      getRole: n => options[n] ? { id: options[n], name: "Role", position: 0 } : null,
      getChannel: n => options[n] ? { id: options[n], name: "Channel", type: 0 } : null,
    } };
    const handler = server.commands.find(c => c.data.toJSON().name === name);
    expect(handler, `Missing command ${name}`).toBeDefined();
    await handler!.execute(interaction, context);
    return interaction;
  }
  function confirmId(cancel = false) {
    const prompt = [...replies].reverse().find(r => r.components?.length);
    const row = prompt.components[0].toJSON?.() ?? prompt.components[0];
    return row.components[cancel ? 1 : 0].custom_id;
  }
  async function press(id = confirmId(), actor = ADMIN) {
    const handler = server.buttons.find(b => id.startsWith(b.prefix));
    expect(handler).toBeDefined(); await handler!.execute({ ...base(actor), customId: id }, context);
  }
  const writes = () => requests.filter(r => r.method !== "GET");
  const actions = () => db.prepare("select * from mod_actions order by id").all() as any[];
  return { db, context, command, press, confirmId, replies, requests, writes, actions, roles, members, channels,
    failReply() { replyFails = true; }, fail(method: string, path: string, status: number) { failure = { method, path, status }; } };
}

it("creates a private channel and queues the audit message", async () => {
  const f = await fixture();
  await f.command("channel", "create", { name: "secret", type: "text", private: true, roles: LOW_ROLE, category: CAT, topic: "Rules", slowmode: 10 });
  const created = f.channels.find(c => c.name === "secret");
  expect(created).toMatchObject({ type: 0, parent_id: CAT, topic: "Rules", rate_limit_per_user: 10 });
  expect(created.permission_overwrites).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: G, deny: P.ViewChannel.toString() }),
    expect.objectContaining({ id: LOW_ROLE, allow: P.ViewChannel.toString() }),
  ]));
  expect(f.actions().at(-1)).toMatchObject({ action: "channel.create", result: "success" });
  const outbox = f.db.prepare("select * from discord_outbox").all() as any[];
  expect(outbox.length).toBe(f.actions().length);
  expect(JSON.parse(outbox.at(-1).payload_json).allowed_mentions.parse).toEqual([]);
});

it("deploys all server commands for admins in the configured guild", async () => {
  const definitions = createRegistry([server]).definitions;
  expect(definitions.map(d => d.name)).toEqual(["channel", "category", "permissions", "role", "setup"]);
  for (const d of definitions) expect(d).toMatchObject({ default_member_permissions: P.Administrator.toString(), contexts: [0] });
});

it("changes only the selected overwrite permission after the same admin confirms", async () => {
  const f = await fixture();
  f.channels[0].permission_overwrites = [{ id: LOW_ROLE, type: 0, allow: P.AttachFiles.toString(), deny: P.Speak.toString() }];
  await f.command("permissions", "set", { channel: CH, role: LOW_ROLE, permission: "send", state: "deny" });
  expect(f.writes()).toHaveLength(0);
  await f.press();
  expect(f.channels[0].permission_overwrites[0]).toEqual({ id: LOW_ROLE, type: 0,
    allow: P.AttachFiles.toString(), deny: (P.Speak | P.SendMessages).toString() });
  expect(f.actions().at(-1)).toMatchObject({ action: "permissions.set", result: "success" });
});

it("gives and takes a low role, but refuses a privileged role", async () => {
  const f = await fixture(); f.members[MEMBER].roles = [];
  await f.command("role", "give", { member: MEMBER, role: LOW_ROLE });
  expect(f.members[MEMBER].roles).toContain(LOW_ROLE);
  await f.command("role", "take", { member: MEMBER, role: LOW_ROLE });
  expect(f.members[MEMBER].roles).not.toContain(LOW_ROLE);
  f.roles.find(r => r.id === LOW_ROLE).permissions = P.ManageRoles.toString();
  await f.command("role", "give", { member: MEMBER, role: LOW_ROLE });
  expect(f.actions().at(-1)).toMatchObject({ action: "role.give", result: "denied" });
  expect(JSON.parse(f.actions().at(-1).params_json)).toMatchObject({ roleId: LOW_ROLE, memberId: MEMBER });
  expect(f.replies.at(-1).content).toContain("Only the server owner");
});

it("creates and reuses the admin layout with exact visibility and prints env lines", async () => {
  const f = await fixture();
  await f.command("setup", "channels"); expect(f.writes()).toHaveLength(0); await f.press();
  const category = f.channels.find(c => c.name === "Admin");
  expect(category.permission_overwrites).toEqual(expect.arrayContaining([
    { id: G, type: 0, allow: "0", deny: P.ViewChannel.toString() },
    { id: ADMIN, type: 1, allow: P.ViewChannel.toString(), deny: "0" },
  ]));
  const signups = f.channels.find(c => c.name === "signups");
  const modlog = f.channels.find(c => c.name === "mod-log");
  const online = f.channels.find(c => c.name === "online-now");
  for (const ch of [signups, modlog, online]) expect(ch.parent_id).toBe(category.id);
  expect(modlog.permission_overwrites).toContainEqual({ id: MOD_ROLE, type: 0, allow: P.ViewChannel.toString(), deny: "0" });
  expect(signups.permission_overwrites.some((o: any) => o.id === MOD_ROLE)).toBe(false);
  const announcements = f.channels.find(c => c.name === "announcements");
  expect(announcements.parent_id).toBeNull();
  const everyone = announcements.permission_overwrites.find((o: any) => o.id === G);
  expect(BigInt(everyone.allow) & P.ViewChannel).toBe(P.ViewChannel);
  expect(BigInt(everyone.deny) & P.SendMessages).toBe(P.SendMessages);
  expect(f.replies.at(-1).content).toContain(`DISCORD_WAITLIST_CHANNEL_ID=${signups.id}`);
  expect(f.replies.at(-1).content).toContain(`DISCORD_MOD_LOG_CHANNEL_ID=${LOG}`);
  const welcome = f.channels.find(c => c.name === "welcome");
  expect(welcome.parent_id).toBeNull();
  expect(welcome.permission_overwrites).toEqual(announcements.permission_overwrites);
  expect(f.replies.at(-1).content).toContain(`DISCORD_WELCOME_CHANNEL_ID=${welcome.id}`);
  const created = f.requests.filter(r => r.method === "POST").length;
  const writes = f.writes().length;
  f.context.cooldown = new Cooldown();
  await f.command("setup", "channels"); await f.press();
  expect(f.requests.filter(r => r.method === "POST")).toHaveLength(created);
  expect(f.writes()).toHaveLength(writes);
});

it.each([0, 5])("confirms and repairs an existing type %s welcome channel", async type => {
  const f = await fixture();
  const welcome = { id: "100000000000000025", name: "welcome", type, guild_id: G,
    parent_id: CAT, permission_overwrites: [{ id: G, type: 0, allow: "0", deny: P.ViewChannel.toString() }] };
  f.channels.push(welcome);
  await f.command("setup", "channels");
  expect(f.writes()).toHaveLength(0);
  expect(f.replies.at(-1).content).toContain("An existing #welcome will be moved to the top level and its permission overwrites replaced.");
  await f.press();
  expect(welcome.parent_id).toBeNull();
  expect(welcome.type).toBe(type);
  expect(welcome.permission_overwrites).toEqual(f.channels.find(c => c.name === "announcements").permission_overwrites);
  expect(f.requests.filter(r => r.method === "POST" && r.body?.name === "welcome")).toHaveLength(0);
  expect(f.replies.at(-1).content).toContain(`DISCORD_WELCOME_CHANNEL_ID=${welcome.id}`);
});

it.each([OTHER, "100000000000000007"])("refuses unlinked admins and moderators: %s", async actor => {
  const f = await fixture();
  await f.command("channel", "create", { name: "bad", type: "text" }, actor);
  expect(f.writes()).toHaveLength(0);
  expect(f.actions().at(-1)).toMatchObject({ result: "denied" });
  expect(f.replies.at(-1)).toMatchObject({ flags: 64, allowedMentions: { parse: [] } });
});

it.each([null, "100000000000000099"])("refuses commands outside the configured guild: %s", async guild => {
  const f = await fixture(); await f.command("category", "create", { name: "Bad" }, ADMIN, guild);
  expect(f.writes()).toHaveLength(0); expect(f.actions().at(-1).result).toBe("denied");
});

it.each(["text", "voice", "announcement", "forum", "stage"])("creates a %s channel", async type => {
  const f = await fixture(); await f.command("channel", "create", { name: "new-channel", type });
  expect(f.channels.find(c => c.name === "new-channel").type).toBe(({ text: 0, voice: 2, announcement: 5, forum: 15, stage: 13 } as any)[type]);
});

it("edits all channel settings and clears its category", async () => {
  const f = await fixture();
  await f.command("channel", "edit", { channel: CH, name: "renamed", topic: "new", slowmode: 4, category: CAT, position: 2, nsfw: true });
  expect(f.channels[0]).toMatchObject({ name: "renamed", topic: "new", rate_limit_per_user: 4, parent_id: CAT, position: 2, nsfw: true });
  await f.command("channel", "edit", { channel: CH, uncategorized: true }); expect(f.channels[0].parent_id).toBeNull();
});

it.each(["modLogChannelId", "waitlistChannelId", "statusChannelId", "announceChannelId", "welcomeChannelId"] as const)("protects the configured %s channel", async key => {
  const f = await fixture(); f.context.config[key] = CH;
  await f.command("channel", "delete", { channel: CH });
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("configured bot channel");
  expect(f.actions().at(-1).target_discord_id).toBe(CH);
});

it("binds deletion to the same admin and consumes the confirmation once", async () => {
  const f = await fixture();
  f.db.prepare("insert into users(id,username,display_name,discord_user_id) values(2,'other','Other',?)").run(OTHER);
  vi.stubEnv("OWNER_USER_IDS", "1,2");
  await f.command("channel", "delete", { channel: CH }); const id = f.confirmId();
  await f.press(id, OTHER); expect(f.writes()).toHaveLength(0);
  await Promise.all([f.press(id), f.press(id)]);
  expect(f.requests.filter(r => r.method === "DELETE")).toHaveLength(1);
  expect(f.channels.some(c => c.id === CH)).toBe(false);
});

it("cancels a deletion and logs the cancellation", async () => {
  const f = await fixture(); await f.command("channel", "delete", { channel: CH }); await f.press(f.confirmId(true));
  expect(f.writes()).toHaveLength(0); expect(f.actions().at(-1)).toMatchObject({ action: "channel.delete", result: "denied" });
});

it("expires a confirmation at 60 seconds", async () => {
  const f = await fixture(); await f.command("channel", "delete", { channel: CH });
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 60001);
  await f.press(); expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("expired");
});

it("rechecks admin access and protected channel configuration on confirmation", async () => {
  const f = await fixture(); await f.command("channel", "delete", { channel: CH }); const id = f.confirmId();
  vi.stubEnv("OWNER_USER_IDS", ""); await f.press(id); expect(f.writes()).toHaveLength(0);
  vi.stubEnv("OWNER_USER_IDS", "1"); f.context.config.statusChannelId = CH; await f.press(id);
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("configured bot channel");
});

it("creates and renames a category; refuses to delete children without a destination", async () => {
  const f = await fixture(); await f.command("category", "create", { name: "New" });
  const ch = f.channels.find(c => c.name === "New"); expect(ch.type).toBe(4);
  await f.command("category", "rename", { category: ch.id, name: "Renamed" }); expect(ch.name).toBe("Renamed");
  const before = f.writes().length; await f.command("category", "delete", { category: CAT });
  expect(f.writes()).toHaveLength(before); expect(f.replies.at(-1).content).toContain("not empty");
});

it("moves the confirmed category children before deletion", async () => {
  const f = await fixture(); f.channels[1].permission_overwrites = [{ id: LOW_ROLE, type: 0, allow: P.ViewChannel.toString(), deny: "0" }];
  await f.command("category", "delete", { category: CAT, "move-to": DEST });
  expect(f.replies.at(-1).content).toContain(`to ${DEST}`); await f.press();
  expect(f.channels.find(c => c.id === LOG).parent_id).toBe(DEST);
  expect(f.channels.find(c => c.id === LOG).permission_overwrites).toHaveLength(1);
  expect(f.channels.some(c => c.id === CAT)).toBe(false);
});

it("refuses category deletion when its children change during confirmation", async () => {
  const f = await fixture(); await f.command("category", "delete", { category: DEST });
  f.channels[0].parent_id = DEST; await f.press();
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("children changed");
});

it("moves category children to root when explicitly confirmed", async () => {
  const f = await fixture(); await f.command("category", "delete", { category: CAT, "move-to-root": true }); await f.press();
  expect(f.channels.find(c => c.id === LOG).parent_id).toBeNull(); expect(f.channels.some(c => c.id === CAT)).toBe(false);
});

it("allows, denies, and clears a curated member overwrite without losing unrelated bits", async () => {
  const f = await fixture();
  for (const mode of ["allow", "deny", "neutral"]) {
    f.context.cooldown = new Cooldown();
    await f.command("permissions", "set", { channel: CAT, member: MEMBER, permission: "view", state: mode }); await f.press();
    const overwrite = f.channels.find(c => c.id === CAT).permission_overwrites[0];
    if (mode === "neutral") expect(overwrite).toBeUndefined();
    else expect(overwrite).toMatchObject({ id: MEMBER, type: 1, [mode]: P.ViewChannel.toString() });
  }
});

it("shows all overwrite bits, including ones outside the curated list", async () => {
  const f = await fixture(); f.channels[0].permission_overwrites = [{ id: LOW_ROLE, type: 0, allow: P.ManageWebhooks.toString(), deny: P.SendMessages.toString() }];
  await f.command("permissions", "view", { channel: CH });
  expect(f.replies.at(-1).content).toContain("ManageWebhooks"); expect(f.replies.at(-1).content).toContain("SendMessages");
  expect(f.actions().at(-1)).toMatchObject({ action: "permissions.view", result: "success" });
});

it.each([{}, { role: LOW_ROLE, member: MEMBER }])("requires exactly one permission target: %j", async target => {
  const f = await fixture(); await f.command("permissions", "set", { channel: CH, permission: "view", state: "deny", ...target });
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("exactly one");
});

it("creates and edits role appearance and confirms its deletion", async () => {
  const f = await fixture(); await f.command("role", "create", { name: "New", colour: "#336699", hoist: true, mentionable: true });
  const role = f.roles.find(r => r.name === "New"); expect(role).toMatchObject({ color: 0x336699, permissions: "0", hoist: true, mentionable: true });
  await f.command("role", "edit", { role: role.id, name: "Changed", colour: "000000", hoist: false, mentionable: false });
  expect(role).toMatchObject({ name: "Changed", color: 0, hoist: false, mentionable: false });
  await f.command("role", "delete", { role: role.id }); expect(f.roles).toContain(role); await f.press(); expect(f.roles).not.toContain(role);
});

it.each([OWNER, BOT, ADMIN])("refuses to act on the server owner, bot, or site owner: %s", async member => {
  const f = await fixture(); await f.command("role", "give", { member, role: LOW_ROLE }); expect(f.writes()).toHaveLength(0);
  expect(f.actions().at(-1).result).toBe("denied");
});

it.each([P.Administrator, P.ManageGuild, P.ManageRoles])("requires the server owner for privileged role bits %s", async permission => {
  const f = await fixture(); f.roles.find(r => r.id === LOW_ROLE).permissions = permission.toString();
  await f.command("role", "take", { member: MEMBER, role: LOW_ROLE }); expect(f.writes()).toHaveLength(0);
  f.db.prepare("update users set discord_user_id=? where id=1").run(OWNER);
  await f.command("role", "take", { member: MEMBER, role: LOW_ROLE }, OWNER);
  expect(f.members[MEMBER].roles).not.toContain(LOW_ROLE); expect(f.actions().at(-1).result).toBe("success");
});

it("rechecks role hierarchy at confirmation time", async () => {
  const f = await fixture(); await f.command("role", "delete", { role: LOW_ROLE });
  f.roles.find(r => r.id === LOW_ROLE).position = 20;
  await f.press(); expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("highest role");
});

it("checks the target member hierarchy and the bot hierarchy", async () => {
  const f = await fixture(); f.roles.find(r => r.id === MOD_ROLE).position = 20;
  await f.command("role", "give", { member: OTHER, role: LOW_ROLE }); expect(f.writes()).toHaveLength(0);
  f.roles.find(r => r.id === LOW_ROLE).position = 30;
  await f.command("role", "delete", { role: LOW_ROLE }); expect(f.writes()).toHaveLength(0);
});

it.each([403, 404, 429])("returns a safe Discord %s error and audits the failure", async status => {
  const f = await fixture(); f.fail("POST", `/guilds/${G}/channels`, status);
  await f.command("channel", "create", { name: "Fail", type: "text" });
  expect(f.actions().at(-1).result).toBe("failure");
  expect(f.replies.at(-1).content).not.toContain("Sensitive upstream");
  expect(f.replies.at(-1).content).toContain(status === 403 ? "refused" : status === 404 ? "could not find" : "limited");
});

it("refuses setup name collisions before any writes", async () => {
  const f = await fixture(); f.channels.push({ ...f.channels[0], id: "100000000000000088", name: "Admin", type: 0 });
  await f.command("setup", "channels"); await f.press(); expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("wrong type");
});

it("queues setup audit delivery before the mod-log environment value is set", async () => {
  const f = await fixture(); vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", ""); f.context.config.modLogChannelId = undefined;
  await f.command("setup", "channels"); await f.press();
  const queued = f.db.prepare("select channel_id from discord_outbox").all();
  expect(queued).toEqual([{ channel_id: LOG }]);
});

it("refuses a role operation if the bot lacks Manage Roles", async () => {
  const f = await fixture(); f.roles.find(r => r.id === BOT_ROLE).permissions = "0";
  await f.command("role", "give", { role: LOW_ROLE, member: MEMBER });
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("ManageRoles");
});

it("refuses a private channel overwrite if the bot lacks Manage Roles", async () => {
  const f = await fixture(); f.roles.find(r => r.id === BOT_ROLE).permissions = P.ManageChannels.toString();
  await f.command("channel", "create", { name: "Secret", type: "text", private: true });
  expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("ManageRoles");
});

it("rechecks the bot's effective channel permissions before a permission change", async () => {
  const f = await fixture(); f.roles.find(r => r.id === BOT_ROLE).permissions = (P.ManageRoles | P.ManageChannels).toString();
  await f.command("permissions", "set", { channel: CH, role: LOW_ROLE, permission: "speak", state: "allow" });
  await f.press(); expect(f.writes()).toHaveLength(0); expect(f.replies.at(-1).content).toContain("does not hold");
});

it("returns large overwrite lists as an attachment", async () => {
  const f = await fixture(); f.channels[0].permission_overwrites = Array.from({ length: 30 }, (_, index) => ({ id: String(100000000000000100n + BigInt(index)), type: 0,
    allow: P.ManageWebhooks.toString(), deny: P.SendMessages.toString() }));
  await f.command("permissions", "view", { channel: CH });
  const reply = f.replies.at(-1); expect(reply.files).toHaveLength(1); expect(reply.flags).toBe(64);
  expect(reply.files[0].attachment.toString()).toContain("100000000000000129");
});

it("rejects another destructive confirmation during the actor cooldown", async () => {
  const f = await fixture(); await f.command("category", "delete", { category: DEST }); await f.press();
  await f.command("channel", "delete", { channel: CH }); await f.press();
  expect(f.channels.some(c => c.id === CH)).toBe(true); expect(f.replies.at(-1).content).toContain("three seconds");
});

it("rejects a channel target from another guild", async () => {
  const f = await fixture(); f.channels[0].guild_id = "100000000000000099";
  await f.command("channel", "delete", { channel: CH }); expect(f.writes()).toHaveLength(0);
});

it("sets up read-only announcements with the approved bot permissions", async () => {
  const f = await fixture(); expect(BigInt(f.roles.find(r => r.id === BOT_ROLE).permissions) & P.Administrator).toBe(0n);
  await f.command("setup", "channels"); await f.press();
  expect(f.actions().at(-1)).toMatchObject({ action: "setup.channels", result: "success" });
  const overwrite = f.channels.find(c => c.name === "announcements").permission_overwrites.find((o: any) => o.id === G);
  expect(BigInt(overwrite.deny) & (P.SendMessages | P.SendMessagesInThreads)).toBe(P.SendMessages | P.SendMessagesInThreads);
});

it.each([P.CreatePublicThreads, P.CreatePrivateThreads])("refuses unsupported member thread grants before setup writes: %s", async permission => {
  const f = await fixture(); f.roles.find(r => r.id === LOW_ROLE).permissions = permission.toString();
  await f.command("setup", "channels"); await f.press();
  expect(f.writes()).toHaveLength(0);
  expect(f.actions().at(-1)).toMatchObject({ action: "setup.channels", result: "denied" });
  expect(f.replies.at(-1).content).toContain("thread creation"); expect(f.replies.at(-1).content).toContain(LOW_ROLE);
});

it("keeps a successful mutation audit when its reply cannot be delivered", async () => {
  const f = await fixture(); f.failReply();
  await f.command("channel", "create", { name: "Made", type: "text" }).catch(() => {});
  expect(f.channels.some(c => c.name === "Made")).toBe(true);
  expect(f.actions().map(a => a.result)).toEqual(["success"]);
});

it.each([G, LOW_ROLE])("refuses edits to @everyone or an integration role: %s", async id => {
  const f = await fixture(); if (id === LOW_ROLE) f.roles.find(r => r.id === LOW_ROLE).managed = true;
  await f.command("role", "edit", { role: id, name: "Changed" });
  expect(f.writes()).toHaveLength(0); expect(f.actions().at(-1).result).toBe("denied");
});

it("keeps the displayed permission payload when command options later change", async () => {
  const f = await fixture(); const options = { channel: CH, role: LOW_ROLE, permission: "send", state: "deny" };
  await f.command("permissions", "set", options);
  options.channel = LOG; options.permission = "view"; options.state = "allow";
  await f.press();
  expect(f.channels[0].permission_overwrites).toContainEqual({ id: LOW_ROLE, type: 0, allow: "0", deny: P.SendMessages.toString() });
  expect(f.channels[1].permission_overwrites).toHaveLength(0);
});
