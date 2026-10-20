import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ChatInputCommandInteraction, ButtonInteraction, UserContextMenuCommandInteraction,
  Client, ClientUser, Events, PermissionFlagsBits as P } from "discord.js";
import { openDatabase } from "@yugidraft/shared/db";
import { recordModAction } from "@yugidraft/shared/discord-admin";
import { deleteUserAccount } from "@yugidraft/shared/services";
import { loadSharedAdminServices } from "../../runtime/shared.js";
import { createAudit } from "../../runtime/audit.js";
import { createDispatcher } from "../../runtime/dispatcher.js";
import { createRegistry } from "../../runtime/registry.js";
import { Cooldown } from "../../runtime/cooldown.js";
import { createOutboxDelivery } from "../../runtime/outbox.js";
import type { FeatureContext } from "../../runtime/types.js";
import { moderation } from "./index.js";
import { activeLock } from "./channels.js";

const guild = "100000000000000001", bot = "100000000000000002", actor = "100000000000000003";
const target = "100000000000000004", channel = "100000000000000005", owner = "100000000000000006";
const modRole = "100000000000000010", botRole = "100000000000000011", lowRole = "100000000000000012";
const admin = "100000000000000007", outsider = "100000000000000008";
const adminRole = "100000000000000013";
const modLogChannel = "100000000000000014", hiddenChannel = "100000000000000015";
const moderatorPermissions = P.ViewChannel | P.ManageMessages | P.ManageChannels | P.ManageRoles;
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

// SDK constructors accept raw Gateway payloads at runtime but mark them protected
// in TypeScript. This boundary drives the real adapters without mocking handlers.
function gatewayObject<T>(constructor: unknown, client: Client, data: unknown): T {
  return new (constructor as new (client: Client, data: unknown) => T)(client, data);
}

async function setup() {
  vi.stubEnv("DISCORD_BOT_ENABLED", "1"); vi.stubEnv("DISCORD_MOD_LOG_CHANNEL_ID", modLogChannel);
  vi.stubEnv("DISCORD_MODERATOR_ROLE_ID", modRole); vi.stubEnv("OWNER_USER_IDS", "1");
  const dir = mkdtempSync(join(tmpdir(), "moderation-integration-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  let db = openDatabase(join(dir, "bot.sqlite")); cleanup.push(() => { if (db.open) db.close(); });
  db.prepare("insert into users(id,discord_user_id,username,display_name,created_at) values(1,?,'site-owner','Site owner',?)").run(admin, Date.now());
  const members = new Map([ [actor, [modRole]], [admin, [adminRole]], [bot, [botRole]], [target, [lowRole]], [outsider, []], [owner, [botRole]] ]);
  const state = { overwrites: [] as { id: string; type: number; allow: string; deny: string }[],
    messages: [] as { id: string; author: { id: string }; timestamp: string }[],
    actorPermissions: moderatorPermissions, resolvedChannelPermissions: moderatorPermissions,
    botPermissions: P.ViewChannel | P.SendMessages | P.ReadMessageHistory | P.ManageMessages | P.ManageChannels | P.ManageRoles | P.ModerateMembers | P.KickMembers | P.BanMembers,
    status: 0, failPath: "", foreignChannel: false, dmFails: false, channelType: 0, applyBeforeFailure: false };
  const requests: { method: string; path: string; body: any; reason?: string }[] = [];
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const path = req.url!.replace("/api/v10", "");
    requests.push({ method: req.method!, path, body, reason: req.headers["x-audit-log-reason"] as string });
    res.setHeader("content-type", "application/json");
    if (state.status && path === state.failPath && req.method !== "GET") {
      if (state.applyBeforeFailure && req.method === "PUT" && path === `/channels/${channel}/permissions/${guild}`)
        state.overwrites = [...state.overwrites.filter(row => row.id !== guild), { id: guild, ...body }];
      res.statusCode = state.status;
      res.end(JSON.stringify({ code: 50013, message: "PRIVATE UPSTREAM secret@example.com", retry_after: 0.01, global: false })); return;
    }
    if (req.method === "GET" && path === `/guilds/${guild}`) res.end(JSON.stringify({ id: guild, owner_id: owner, name: "Test" }));
    else if (req.method === "GET" && path === `/guilds/${guild}/roles`) res.end(JSON.stringify([
      { id: guild, position: 0, permissions: "0" }, { id: lowRole, position: 1, permissions: "0" },
      { id: modRole, position: 5, permissions: String(state.actorPermissions) }, { id: adminRole, position: 8, permissions: String(P.Administrator) }, { id: botRole, position: 10, permissions: String(state.botPermissions) },
    ]));
    else if (req.method === "GET" && path.startsWith(`/guilds/${guild}/members/`)) {
      const id = path.split("/").at(-1)!;
      if (!members.has(id)) { res.statusCode = 404; res.end(JSON.stringify({ code: 10007, message: "Unknown member" })); }
      else res.end(JSON.stringify({ user: { id, username: "Member", discriminator: "0" }, roles: members.get(id), joined_at: "2025-01-01T00:00:00.000Z" }));
    } else if (req.method === "GET" && [channel, modLogChannel, hiddenChannel].some(id => path === `/channels/${id}`)) res.end(JSON.stringify({ id: path.split("/")[2], guild_id: state.foreignChannel ? outsider : guild, type: state.channelType, permission_overwrites: state.overwrites }));
    else if (req.method === "GET" && path.startsWith(`/channels/${channel}/messages?`)) res.end(JSON.stringify(state.messages));
    else if (req.method === "PUT" && path === `/channels/${channel}/permissions/${guild}`) {
      state.overwrites = [...state.overwrites.filter(row => row.id !== guild), { id: guild, ...body }]; res.removeHeader("content-type"); res.statusCode = 204; res.end();
    } else if (req.method === "DELETE" && path === `/channels/${channel}/permissions/${guild}`) {
      state.overwrites = state.overwrites.filter(row => row.id !== guild); res.removeHeader("content-type"); res.statusCode = 204; res.end();
    } else if (path === "/users/@me/channels") {
      if (state.dmFails) { res.statusCode = 403; res.end(JSON.stringify({ code: 50007, message: "Cannot DM" })); }
      else res.end(JSON.stringify({ id: "100000000000000090", type: 1 }));
    } else if (path.includes("/callback")) { res.removeHeader("content-type"); res.statusCode = 204; res.end(); }
    else res.end(JSON.stringify({ id: "100000000000000099", channel_id: path.startsWith("/channels/") ? path.split("/")[2] : channel, content: body?.content ?? "", author: { id: bot, username: "Bot" }, timestamp: new Date().toISOString(), attachments: [], embeds: [] }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const api = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const client = new Client({ intents: [], rest: { api, retries: 0, rejectOnRateLimit: () => true, globalRequestsPerSecond: 1000, timeout: 1000 } });
  client.rest.setToken("stub-token"); client.user = gatewayObject<ClientUser>(ClientUser, client, { id: bot, username: "Bot", discriminator: "0", bot: true });
  cleanup.push(async () => { await client.destroy(); client.rest.clearHashSweeper(); client.rest.clearHandlerSweeper(); });
  const shared = await loadSharedAdminServices(db);
  const context: FeatureContext = { db, client, rest: client.rest, config: { token: "stub-token", clientId: bot, guildId: guild, moderatorRoleId: modRole, modLogChannelId: modLogChannel, healthPath: join(dir, "health.json"), restApi: api },
    shared, signal: new AbortController().signal, cooldown: new Cooldown(), audit: createAudit(shared, guild) };
  const stop = await moderation.start?.(context); if (stop) cleanup.push(stop);
  const dispatch = createDispatcher(createRegistry([moderation]), context);
  let sequence = 0;
  const payload = (who = actor) => ({ id: String(100000000000001000n + BigInt(++sequence)), application_id: bot, token: `token-${sequence}`, version: 1,
    guild_id: guild, channel_id: channel, channel: { id: channel, type: 0 }, locale: "en-US", context: 0, app_permissions: "0", entitlements: [],
    member: { user: { id: who, username: "Actor", discriminator: "0" }, roles: members.get(who) ?? [], permissions: String(who === admin ? P.Administrator : moderatorPermissions), joined_at: new Date().toISOString() } });
  const response = () => {
    const latest = requests.filter(row => row.path.includes("/webhooks/") && ["PATCH", "POST"].includes(row.method)
      || row.path.includes("/callback") && row.body?.type === 4).at(-1);
    return latest?.path.includes("/callback") ? latest.body.data : latest?.body;
  };
  async function command(name: string, values: Record<string, string | number | boolean> = {}, who = actor, overrides = {}) {
    const options = Object.entries(values).map(([name, value]) => ({ name, value, type: name === "user" ? 6 : name === "channel" ? 7 : typeof value === "number" ? 4 : typeof value === "boolean" ? 5 : 3 }));
    const raw = { ...payload(who), type: 2, data: { id: bot, name, type: 1, options,
      resolved: { users: { [target]: { id: target, username: "Target", discriminator: "0" }, [owner]: { id: owner, username: "Owner", discriminator: "0" }, [bot]: { id: bot, username: "Bot", discriminator: "0" }, [admin]: { id: admin, username: "Admin", discriminator: "0" } }, channels: Object.fromEntries([channel, modLogChannel, hiddenChannel].map(id => [id, { id, type: 0, name: id === modLogChannel ? "mod-log" : "test", permissions: String(who === admin ? P.Administrator : state.resolvedChannelPermissions) }])) } }, ...overrides };
    await dispatch(gatewayObject<ChatInputCommandInteraction>(ChatInputCommandInteraction, client, raw)); return response();
  }
  async function button(id: string, who = actor) {
    const raw = { ...payload(who), type: 3, data: { custom_id: id, component_type: 2 }, message: { id: bot, channel_id: channel, author: { id: bot, username: "Bot", discriminator: "0" }, content: "Confirm", timestamp: new Date().toISOString(), attachments: [], embeds: [], components: [] } };
    await dispatch(gatewayObject<ButtonInteraction>(ButtonInteraction, client, raw)); return response();
  }
  function confirmId() { return response().components[0].components[0].custom_id as string; }
  const writes = () => requests.filter(row => row.method !== "GET" && !row.path.includes("/webhooks/") && !row.path.includes("/interactions/"));
  const actions = () => db.prepare("select * from mod_actions order by id").all() as any[];
  async function restart() {
    if (stop) await stop(); db.close(); db = openDatabase(join(dir, "bot.sqlite"));
    context.db = db; context.cooldown = new Cooldown();
    context.shared = await loadSharedAdminServices(db); context.audit = createAudit(context.shared, guild);
    const restartedStop = await moderation.start?.(context); if (restartedStop) cleanup.push(restartedStop);
  }
  return { context, db, members, state, requests, command, button, response, confirmId, writes, actions, payload, client, api, restart };
}

it("registers all moderation commands with guild-only defaults and the User info user command", async () => {
  const definitions = createRegistry([moderation]).definitions;
  expect(definitions.map(row => row.name)).toEqual(expect.arrayContaining(["timeout", "untimeout", "kick", "ban", "unban", "purge", "warn", "warnings", "slowmode", "lock", "unlock", "User info"]));
  expect(definitions.every(row => row.default_member_permissions === String(P.ModerateMembers) && row.contexts?.[0] === 0)).toBe(true);
  expect(definitions.find(row => row.name === "User info")?.type).toBe(2);
});

it.each([actor, admin])("applies and removes a timeout for an authorized actor %s; logs duration through the outbox", async who => {
  const t = await setup();
  await t.command("timeout", { user: target, duration: "1h30m", reason: "Repeated spam" }, who);
  expect(t.writes().find(row => row.method === "PATCH")?.body.communication_disabled_until).toBeDefined();
  const action = t.actions().find(row => row.action === "timeout");
  expect(action).toMatchObject({ actor_discord_id: who, target_discord_id: target, result: "success", reason: "Repeated spam" });
  expect(JSON.parse(action.params_json)).toMatchObject({ durationSeconds: 5400 });
  const rows = t.db.prepare("select * from discord_outbox where mod_action_id=?").all(action.id) as any[];
  expect(rows).toHaveLength(1);
  expect(JSON.parse(rows[0].payload_json).embeds[0].fields).toContainEqual({ name: "Duration", value: "5400 seconds" });
  t.context.cooldown = new Cooldown(); await t.command("timeout", { user: target, duration: "remove", reason: "Resolved" }, who);
  expect(t.writes().filter(row => row.method === "PATCH").at(-1)?.body.communication_disabled_until).toBeNull();
  const [claim] = t.context.shared.claimOutbox(1);
  await createOutboxDelivery({ token: "stub-token", restApi: t.api, guildId: guild, signal: t.context.signal })(claim);
  expect(t.writes().at(-1)?.body.allowed_mentions).toEqual({ parse: [], users: [], roles: [], replied_user: false });
});

it.each(["0s", "29d", "1.5h", "soon"])("rejects invalid timeout %s without a member mutation", async duration => {
  const t = await setup(); await t.command("timeout", { user: target, duration, reason: "Test" });
  expect(t.writes()).toHaveLength(0); expect(t.actions().at(-1)?.result).toBe("denied");
});

it("rejects nonmoderators, revoked roles, protected members, hierarchy and foreign channels", async () => {
  const t = await setup();
  await t.command("warn", { user: target, reason: "Test" }, outsider); expect(t.actions().at(-1)?.result).toBe("denied");
  for (const id of [owner, bot, admin]) { await t.command("kick", { user: id, reason: "Test" }); expect(t.response().components ?? []).toHaveLength(0); }
  t.members.set(target, [modRole]); await t.command("ban", { user: target }); expect(t.response().content).toContain("role");
  t.members.set(target, [lowRole]); await t.command("kick", { user: target }); const confirm = t.confirmId();
  t.members.set(actor, []); await t.button(confirm); expect(t.writes()).toHaveLength(0);
  t.members.set(actor, [modRole]); t.state.foreignChannel = true;
  await t.command("slowmode", { channel, seconds: 5 }); expect(t.writes()).toHaveLength(0);
});

it("denies a Moderator channel actions in the configured #mod-log", async () => {
  const t = await setup();
  for (const name of ["slowmode", "purge", "lock", "unlock"]) {
    t.context.cooldown = new Cooldown();
    const values: Record<string, string | number> = name === "purge" ? { count: 1 }
      : { channel: modLogChannel, ...(name === "slowmode" ? { seconds: 5 } : {}) };
    await t.command(name, values, actor, name === "purge" ? { channel_id: modLogChannel, channel: { id: modLogChannel, type: 0 } } : {});
    expect(t.writes()).toHaveLength(0);
    expect(t.response().content).toContain("configured bot channel");
    expect(t.response().components ?? []).toHaveLength(0);
    expect(t.actions().at(-1)).toMatchObject({ action: name, result: "denied" });
  }
});

it("denies a Moderator channel actions in a channel they cannot see", async () => {
  const t = await setup();
  // The invocation channel and guild role permit these actions. Discord's
  // resolved target-channel permissions must still deny the inaccessible target.
  t.state.resolvedChannelPermissions &= ~P.ViewChannel;
  for (const name of ["slowmode", "lock", "unlock"]) {
    t.context.cooldown = new Cooldown();
    await t.command(name, { channel: hiddenChannel, ...(name === "slowmode" ? { seconds: 5 } : {}) });
    expect(t.writes()).toHaveLength(0);
    expect(t.response().content).toContain("permission");
    expect(t.response().components ?? []).toHaveLength(0);
    expect(t.actions().at(-1)).toMatchObject({ action: name, result: "denied" });
  }
  t.context.cooldown = new Cooldown();
  await t.command("purge", { count: 1 }, actor, { channel_id: hiddenChannel, channel: { id: hiddenChannel, type: 0 },
    member: { ...t.payload().member, permissions: String(moderatorPermissions & ~P.ViewChannel) } });
  expect(t.writes()).toHaveLength(0);
  expect(t.response().content).toContain("permission");
  expect(t.actions().at(-1)).toMatchObject({ action: "purge", result: "denied" });

  t.context.cooldown = new Cooldown(); t.state.resolvedChannelPermissions = moderatorPermissions;
  await t.command("lock", { channel }); const confirm = t.confirmId();
  t.state.overwrites = [{ id: actor, type: 1, allow: "0", deny: String(P.ViewChannel) }];
  await t.button(confirm);
  expect(t.writes()).toHaveLength(0);
  expect(t.response().content).toContain("permission");
  expect(t.actions().at(-1)).toMatchObject({ action: "lock", result: "denied" });
});

it("refuses DMs and another guild through the real dispatcher", async () => {
  const t = await setup();
  await t.command("warn", { user: target, reason: "Test" }, actor, { guild_id: outsider });
  await t.command("warn", { user: target, reason: "Test" }, actor, { guild_id: undefined, member: undefined, user: { id: actor, username: "Actor" } });
  expect(t.writes()).toHaveLength(0);
  expect(t.requests.filter(row => row.path.includes("/callback")).every(row => row.body.data.flags === 64)).toBe(true);
});

it.each(["kick", "ban"])("confirms %s only once for its original actor, preserves options, rechecks hierarchy", async name => {
  const t = await setup(); await t.command(name, { user: target, reason: "Spam", ...(name === "ban" ? { "delete-message-days": 3 } : {}) });
  const confirm = t.confirmId(); expect(t.writes()).toHaveLength(0);
  await t.button(confirm, admin); expect(t.writes()).toHaveLength(0);
  await Promise.all([t.button(confirm), t.button(confirm)]);
  const writes = t.writes(); expect(writes).toHaveLength(1);
  expect(writes[0].path).toContain(target);
  if (name === "ban") expect(writes[0].body).toEqual({ delete_message_seconds: 259200 });
  expect(t.actions().filter(row => row.action === name && row.result === "success")).toHaveLength(1);
  t.context.cooldown = new Cooldown(); await t.command(name, { user: target }); const next = t.confirmId();
  t.members.set(target, [botRole]); await t.button(next); expect(t.writes()).toHaveLength(1);
});

it("expires and cancels confirmations without a Discord mutation", async () => {
  const t = await setup(); await t.command("kick", { user: target }); const id = t.confirmId();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 60_001);
  await t.button(id); expect(t.response().content).toContain("expired"); vi.restoreAllMocks();
  await t.command("ban", { user: target }); await t.button(t.confirmId().replace(":yes:", ":no:"));
  expect(t.response().content).toContain("Cancelled"); expect(t.writes()).toHaveLength(0);
});

it("unbans a validated user ID and enforces bot permissions", async () => {
  const t = await setup(); await t.command("unban", { "user-id": target, reason: "Appeal" });
  expect(t.writes()[0]).toMatchObject({ method: "DELETE", path: `/guilds/${guild}/bans/${target}` });
  t.context.cooldown = new Cooldown(); t.state.botPermissions &= ~P.BanMembers;
  await t.command("unban", { "user-id": target }); expect(t.writes()).toHaveLength(1);
  await t.command("unban", { "user-id": "invalid" }); expect(t.writes()).toHaveLength(1);
});

it("stores warnings, handles closed DMs, lists them, and only lets admins clear a scoped warning", async () => {
  const t = await setup(); t.state.dmFails = true;
  await t.command("warn", { user: target, reason: "Stop spam" });
  expect(t.response().content).toContain("1"); expect(t.response().content).toContain("DM");
  const warning = t.db.prepare("select * from mod_warnings").get() as any; expect(warning.reason).toBe("Stop spam");
  await t.command("warnings", { user: target }); expect(JSON.stringify(t.response())).toContain("Stop spam");
  await t.command("warnings", { user: target, clear: warning.id }); expect(t.db.prepare("select count(*) n from mod_warnings").get()).toEqual({ n: 1 });
  await t.command("warnings", { user: target, clear: warning.id }, admin); await t.button(t.confirmId(), admin);
  expect(t.db.prepare("select count(*) n from mod_warnings").get()).toEqual({ n: 0 });
  expect(t.actions().some(row => row.action === "warning_clear" && row.result === "success")).toBe(true);
});

it("purges recent messages with a user filter, skips old messages and handles one-message deletion", async () => {
  const t = await setup();
  const message = (n: number, id: string, age: number) => ({ id: String((BigInt(Date.now() - age) - 1420070400000n) << 22n | BigInt(n)), author: { id }, timestamp: new Date(Date.now() - age).toISOString() });
  t.state.messages = [message(1, target, 1000), message(2, outsider, 1000), message(3, target, 15 * 86400000)];
  await t.command("purge", { count: 3, user: target });
  expect(t.writes()).toHaveLength(1); expect(t.writes()[0].method).toBe("DELETE");
  expect(t.response().content).toContain("14 days");
  t.context.cooldown = new Cooldown(); t.state.messages = [message(4, target, 1000), message(5, target, 2000)];
  await t.command("purge", { count: 20 }); expect(t.writes()).toHaveLength(1);
  await t.button(t.confirmId()); expect(t.writes().at(-1)?.body.messages).toHaveLength(2);
});

it.each([null, { id: guild, type: 0, allow: String(P.SendMessages | P.ViewChannel), deny: String(P.AddReactions) }])("restores the exact prior @everyone overwrite, including absence, after module restart", async previous => {
  const t = await setup(); t.state.overwrites = previous ? [previous] : [];
  t.db.prepare("insert into users(id,discord_user_id,username,display_name) values(2,?,'moderator','Moderator')").run(actor);
  await t.command("lock", { channel, reason: "Incident" }); await t.button(t.confirmId());
  expect(BigInt(t.state.overwrites[0].deny) & P.SendMessages).toBe(P.SendMessages);
  t.context.cooldown = new Cooldown();
  await t.command("lock", { channel }); expect(t.response().content).toContain("already");
  deleteUserAccount(t.db, 2);
  expect(activeLock(t.context, channel)).toBeDefined();
  expect(t.db.prepare("select actor_user_id,actor_discord_id,reason from mod_actions where action='lock_snapshot'").get())
    .toEqual({ actor_user_id: null, actor_discord_id: null, reason: null });
  await t.restart();
  await t.command("unlock", { channel }, admin); await t.button(t.confirmId(), admin);
  expect(t.state.overwrites).toEqual(previous ? [previous] : []);
  deleteUserAccount(t.context.db, 1);
  expect(activeLock(t.context, channel)).toBeUndefined();
});

it("sets slowmode, validates bounds and refuses missing bot permissions", async () => {
  const t = await setup(); await t.command("slowmode", { channel, seconds: 21600, reason: "Busy" });
  expect(t.writes()[0].body).toEqual({ rate_limit_per_user: 21600 });
  t.context.cooldown = new Cooldown(); await t.command("slowmode", { channel, seconds: 0 }); expect(t.writes()[1].body).toEqual({ rate_limit_per_user: 0 });
  t.context.cooldown = new Cooldown(); await t.command("slowmode", { channel, seconds: 21601 }); expect(t.writes()).toHaveLength(2);
  t.state.botPermissions &= ~P.ManageChannels; await t.command("slowmode", { channel, seconds: 0 }); expect(t.writes()).toHaveLength(2);
});

it.each([403, 404, 429])("audits a safe failure and gives an ephemeral Discord %s error", async status => {
  const t = await setup(); t.state.status = status; t.state.failPath = `/guilds/${guild}/members/${target}`;
  await t.command("timeout", { user: target, duration: "5m", reason: "Test" });
  expect(t.actions().at(-1)?.result).toBe("failure"); expect(t.response().content).toMatch(status === 403 ? /permission/i : status === 404 ? /found|left|deleted/i : /rate|wait|limit/i);
  expect(JSON.stringify(t.actions()) + JSON.stringify(t.response())).not.toContain("PRIVATE UPSTREAM");
  expect(t.requests.find(row => row.path.includes("/callback"))?.body.data.flags).toBe(64);
});

it("handles User info through the feature startup listener with fresh moderator access", async () => {
  const t = await setup(); recordModAction(t.db, { guildId: guild, actorDiscordId: actor, targetDiscordId: target, action: "timeout", reason: "Recent action", result: "success" });
  for (let n = 0; n < 6; n++) recordModAction(t.db, { guildId: guild, actorDiscordId: actor, targetDiscordId: target, action: "user_info", reason: "Lookup", result: "success" });
  const raw = { ...t.payload(), type: 2, data: { id: bot, name: "User info", type: 2, target_id: target, resolved: { users: { [target]: { id: target, username: "Target", discriminator: "0" } } } } };
  t.client.emit(Events.InteractionCreate, gatewayObject<UserContextMenuCommandInteraction>(UserContextMenuCommandInteraction, t.client, raw));
  await expect.poll(() => JSON.stringify(t.response())).toContain("Recent action");
  expect(JSON.stringify(t.response())).toContain("2025"); expect(JSON.stringify(t.response())).toContain(lowRole);
});

it("keeps a lock snapshot when Discord applies a write but returns failure, then restores it after reopening SQLite", async () => {
  const t = await setup();
  const previous = { id: guild, type: 0, allow: String(P.SendMessages | P.ViewChannel), deny: String(P.AddReactions) };
  t.state.overwrites = [previous]; t.state.status = 500; t.state.applyBeforeFailure = true; t.state.failPath = `/channels/${channel}/permissions/${guild}`;
  await t.command("lock", { channel, reason: "Incident" }); await t.button(t.confirmId());
  expect(t.actions().at(-1)).toMatchObject({ action: "lock", result: "failure" });
  expect(t.actions().some(row => row.action === "lock_snapshot")).toBe(true);
  expect(BigInt(t.state.overwrites[0].deny) & P.SendMessages).toBe(P.SendMessages);
  await t.restart(); t.state.status = 0;
  await t.command("unlock", { channel }); await t.button(t.confirmId());
  expect(t.state.overwrites).toEqual([previous]);
});

it("does not delete messages that age past the purge limit while confirmation is pending", async () => {
  const t = await setup();
  const created = Date.now() - 14 * 86400000 + 20000;
  const id = String((BigInt(created) - 1420070400000n) << 22n);
  t.state.messages = [{ id, author: { id: target }, timestamp: new Date(created).toISOString() }];
  await t.command("purge", { count: 11 }); const confirm = t.confirmId();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 25000);
  await t.button(confirm);
  expect(t.writes()).toHaveLength(0); expect(t.response().content).toContain("Skipped 1");
});

it("validates purge and ban bounds and applies the actor cooldown", async () => {
  const t = await setup();
  for (const count of [0, 101]) await t.command("purge", { count });
  await t.command("ban", { user: target, "delete-message-days": 8 });
  expect(t.writes()).toHaveLength(0); expect(t.actions().every(row => row.result === "denied")).toBe(true);
  await t.command("timeout", { user: target, duration: "5m" });
  await t.command("untimeout", { user: target });
  expect(t.writes()).toHaveLength(1); expect(t.response().content).toContain("three seconds");
});

it("bans a user who has already left and denies a target at or above the bot role", async () => {
  const t = await setup(); t.members.delete(target);
  await t.command("ban", { user: target, "delete-message-days": 7 }); await t.button(t.confirmId());
  expect(t.writes()[0].body.delete_message_seconds).toBe(604800);
  t.context.cooldown = new Cooldown(); t.members.set(target, [botRole]);
  await t.command("timeout", { user: target, duration: "5m" }, admin);
  expect(t.writes()).toHaveLength(1); expect(t.response().content).toContain("higher role");
});

it("scopes warning removal by user and guild, and keeps warning pages below Discord limits", async () => {
  const t = await setup();
  const actionId = recordModAction(t.db, { guildId: guild, actorDiscordId: actor, targetDiscordId: target, action: "warn", reason: "Seed", result: "success" });
  const insert = t.db.prepare("insert into mod_warnings(guild_id,actor_discord_id,target_discord_id,reason,mod_action_id,created_at) values(?,?,?,?,?,?)");
  const foreign = Number(insert.run(outsider, actor, target, "Foreign", actionId, Date.now()).lastInsertRowid);
  const otherUser = Number(insert.run(guild, actor, outsider, "Other user", actionId, Date.now()).lastInsertRowid);
  for (const id of [foreign, otherUser]) {
    await t.command("warnings", { user: target, clear: id }, admin);
    expect(t.response().content).toContain("not found");
  }
  for (let n = 0; n < 11; n++) insert.run(guild, actor, target, `Warning ${n}: ${"x".repeat(480)}`, actionId, Date.now());
  await t.command("warnings", { user: target, page: 2 });
  expect(t.response().content).toContain("11 warnings. Page 2/2"); expect(t.response().embeds[0].fields).toHaveLength(1);
  await t.command("warnings", { user: target, page: 1 });
  expect(t.response().embeds[0].fields).toHaveLength(10);
  expect(JSON.stringify(t.response()).length).toBeLessThan(7000);
});

it("applies channel overwrites to bot permission checks and does not reveal User info to a revoked moderator", async () => {
  const t = await setup();
  t.state.overwrites = [{ id: botRole, type: 0, allow: "0", deny: String(P.ManageChannels) }];
  await t.command("slowmode", { channel, seconds: 0 }); expect(t.writes()).toHaveLength(0);
  t.members.set(actor, []);
  const raw = { ...t.payload(), type: 2, data: { id: bot, name: "User info", type: 2, target_id: target, resolved: { users: { [target]: { id: target, username: "Target", discriminator: "0" } } } } };
  t.client.emit(Events.InteractionCreate, gatewayObject<UserContextMenuCommandInteraction>(UserContextMenuCommandInteraction, t.client, raw));
  await expect.poll(() => t.response()?.content).toContain("access");
  expect(t.response().embeds ?? []).toHaveLength(0);
  expect(t.actions().at(-1)).toMatchObject({ action: "user_info", result: "denied" });
});

it("restricts slowmode to Discord supported channel types", async () => {
  const t = await setup(); t.state.channelType = 5;
  await t.command("slowmode", { channel, seconds: 30 }); expect(t.writes()).toHaveLength(0);
  t.context.cooldown = new Cooldown(); t.state.channelType = 2;
  await t.command("slowmode", { channel, seconds: 30 }); expect(t.writes()[0].body.rate_limit_per_user).toBe(30);
});

it("sends a warning DM with the warning count and all mentions disabled", async () => {
  const t = await setup(); await t.command("warn", { user: target, reason: "Stop @everyone spam" });
  expect(t.response().content).toContain("DM sent");
  const dm = t.writes().find(row => row.path === "/channels/100000000000000090/messages");
  expect(dm?.body.content).toContain("Warnings: 1"); expect(dm?.body.allowed_mentions).toEqual({ parse: [] });
  expect(t.actions().filter(row => row.action === "warn")).toHaveLength(1);
  expect(t.db.prepare("select count(*) n from discord_outbox where mod_action_id is not null").get()).toEqual({ n: 1 });
});
