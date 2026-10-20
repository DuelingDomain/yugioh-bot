import { MessageFlags, PermissionFlagsBits as P, PermissionsBitField, RateLimitError, Routes,
  type APIRole, type RESTGetAPIGuildMemberResult, type InteractionReplyOptions } from "discord.js";
import { enqueueOutbox, recordModAction } from "@yugidraft/shared/discord-admin";
import type { FeatureContext, InteractionLike } from "../../runtime/types.js";

export class Refusal extends Error {}
class ReplyDeliveryError extends Error {
  constructor(cause: unknown) { super("The server command reply could not be delivered.", { cause }); }
}
export interface Overwrite { id: string; type: number; allow: string; deny: string }
export interface GuildChannel {
  id: string; guild_id: string; name: string; type: number; parent_id?: string | null;
  permission_overwrites?: Overwrite[];
}
export interface State {
  ownerId: string; roles: APIRole[]; actor: RESTGetAPIGuildMemberResult; bot: RESTGetAPIGuildMemberResult;
  actorId: string; botId: string; guildId: string;
}
export interface Action {
  action: string; targetId?: string; params?: Record<string, unknown>; summary?: string; modLogChannelId?: string;
  run(): Promise<string | InteractionReplyOptions>;
}

export async function say(i: InteractionLike, message: string | InteractionReplyOptions) {
  try {
    await i.reply({ ...(typeof message === "string" ? { content: message } : message),
      flags: MessageFlags.Ephemeral, allowedMentions: { parse: [], repliedUser: false } });
  } catch (error) { throw new ReplyDeliveryError(error); }
}
export async function admin(i: InteractionLike, c: FeatureContext) {
  if (!i.guildId || i.guildId !== c.config.guildId) throw new Refusal("Use this command in the configured server.");
  if (!(await c.shared.adminAccess(i.user.id)).isAdmin) throw new Refusal("Only linked site admins can use this command.");
}
export async function state(i: InteractionLike, c: FeatureContext): Promise<State> {
  await admin(i, c);
  const [guild, roles, actor, bot] = await Promise.all([
    c.rest.get(Routes.guild(c.config.guildId)) as Promise<{ owner_id: string }>,
    c.rest.get(Routes.guildRoles(c.config.guildId)) as Promise<APIRole[]>,
    c.rest.get(Routes.guildMember(c.config.guildId, i.user.id)) as Promise<RESTGetAPIGuildMemberResult>,
    c.rest.get(Routes.guildMember(c.config.guildId, c.config.clientId)) as Promise<RESTGetAPIGuildMemberResult>,
  ]);
  return { ownerId: guild.owner_id, roles, actor, bot, actorId: i.user.id, botId: c.config.clientId, guildId: c.config.guildId };
}
function bits(s: State, member: RESTGetAPIGuildMemberResult) {
  return s.roles.filter(r => r.id === s.guildId || member.roles.includes(r.id))
    .reduce((value, r) => value | BigInt(r.permissions), 0n);
}
export function botPermissions(s: State, channel?: GuildChannel) {
  let value = bits(s, s.bot);
  if (value & P.Administrator) return PermissionsBitField.All;
  const overwrites = channel?.permission_overwrites ?? [];
  const everyone = overwrites.find(o => o.id === s.guildId && o.type === 0);
  if (everyone) value = (value & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  const roles = overwrites.filter(o => o.type === 0 && s.bot.roles.includes(o.id));
  value = (value & ~roles.reduce((v, o) => v | BigInt(o.deny), 0n)) | roles.reduce((v, o) => v | BigInt(o.allow), 0n);
  const member = overwrites.find(o => o.type === 1 && o.id === s.botId);
  if (member) value = (value & ~BigInt(member.deny)) | BigInt(member.allow);
  return value;
}
export function needBot(s: State, required: bigint, channel?: GuildChannel) {
  if ((botPermissions(s, channel) & required) !== required)
    throw new Refusal(`The bot needs these permissions here: ${new PermissionsBitField(required).toArray().join(", ")}.`);
}
const top = (s: State, member: RESTGetAPIGuildMemberResult) => Math.max(0,
  ...s.roles.filter(r => member.roles.includes(r.id)).map(r => r.position));
export function checkRole(s: State, id: string, options: { everyone?: boolean; sensitive?: boolean } = {}) {
  const role = s.roles.find(r => r.id === id);
  if (!role) throw new Refusal("This role no longer exists in this server.");
  if (id === s.guildId && options.everyone) return role;
  if (id === s.guildId || role.managed) throw new Refusal("The bot cannot change @everyone or an integration role.");
  if (role.position >= top(s, s.bot) || (s.actorId !== s.ownerId && role.position >= top(s, s.actor)))
    throw new Refusal("Both your highest role and the bot's highest role must be above the target role.");
  if (options.sensitive && s.actorId !== s.ownerId && (BigInt(role.permissions) & (P.Administrator | P.ManageGuild | P.ManageRoles)))
    throw new Refusal("Only the server owner can manage roles with Administrator, Manage Server, or Manage Roles.");
  return role;
}
export async function checkMember(s: State, id: string, c: FeatureContext) {
  if (id === s.ownerId || id === s.botId || (await c.shared.adminAccess(id)).isAdmin)
    throw new Refusal("The bot cannot act on the server owner, a site owner, or itself.");
  const member = await c.rest.get(Routes.guildMember(s.guildId, id)) as RESTGetAPIGuildMemberResult;
  if (top(s, member) >= top(s, s.bot) || (s.actorId !== s.ownerId && top(s, member) >= top(s, s.actor)))
    throw new Refusal("Both your highest role and the bot's highest role must be above the member's highest role.");
  return member;
}
export async function getChannel(c: FeatureContext, id: string, types = [0, 2, 4, 5, 13, 15]) {
  const channel = await c.rest.get(Routes.channel(id)) as GuildChannel;
  if (!channel || channel.guild_id !== c.config.guildId || !types.includes(channel.type))
    throw new Refusal("Choose a supported channel in the configured server.");
  return channel;
}
export async function getChannels(c: FeatureContext) {
  const channels = await c.rest.get(Routes.guildChannels(c.config.guildId)) as GuildChannel[];
  return channels.filter(ch => ch.guild_id === c.config.guildId);
}
export function protectedChannel(c: FeatureContext, id: string) {
  if ([c.config.modLogChannelId, c.config.waitlistChannelId, c.config.statusChannelId, c.config.announceChannelId].includes(id))
    throw new Refusal("This is a configured bot channel. Change the bot configuration before you delete it.");
}
export function validName(value: string | null) {
  if (!value || !value.trim() || value.length > 100) throw new Refusal("Use a name with 1 to 100 characters.");
  return value.trim();
}
export function requiredId(value: { id: string } | null) {
  if (!value || !/^\d{17,20}$/.test(value.id)) throw new Refusal("Choose a valid server target.");
  return value.id;
}
export function errorMessage(error: unknown) {
  if (error instanceof Refusal) return error.message;
  const e = error as { status?: number; name?: string } | null;
  if (e?.status === 403) return "Discord refused this action. Check the bot's permissions and role position.";
  if (e?.status === 404) return "Discord could not find the target. It may have been deleted or left the server.";
  if (e?.status === 429 || error instanceof RateLimitError) return "Discord has limited requests. Wait, then try again.";
  if (e?.status === 400) return "Discord rejected these options. Check the channel type and server features.";
  return "The action failed. Check the bot configuration and try again.";
}
export async function audit(c: FeatureContext, i: InteractionLike, a: Pick<Action, "action" | "targetId" | "params" | "modLogChannelId">,
  result: "success" | "failure" | "denied", reason?: string) {
  const access = await c.shared.adminAccess(i.user.id);
  c.db.transaction(() => {
    const id = recordModAction(c.db, { guildId: c.config.guildId, actorDiscordId: i.user.id,
      ...(access.siteUserId === null ? {} : { actorSiteUserId: access.siteUserId }),
      action: a.action, targetDiscordId: a.targetId, params: a.params, result, reason });
    // First setup can create the log before its env value exists. Keep this post atomic
    // with the audit row, and do not duplicate the shared service's configured post.
    const channelId = a.modLogChannelId ?? c.config.modLogChannelId;
    if (channelId && !(process.env.DISCORD_BOT_ENABLED === "1" && process.env.DISCORD_MOD_LOG_CHANNEL_ID?.trim()))
      enqueueOutbox(c.db, { idempotencyKey: `mod-action:${id}`, kind: "mod_log", channelId, modActionId: id,
        payload: { embeds: [{ title: "Server management action", fields: [
          { name: "Action", value: a.action }, { name: "Result", value: result },
          { name: "Actor", value: i.user.id }, { name: "Target", value: a.targetId ?? "none" },
          ...(reason ? [{ name: "Reason", value: reason.slice(0, 1000) }] : []),
        ] }] } });
  }).immediate();
}
export async function fail(c: FeatureContext, i: InteractionLike, a: Pick<Action, "action" | "targetId" | "params" | "modLogChannelId">, error: unknown) {
  // A failed response does not change an action's already committed outcome.
  if (error instanceof ReplyDeliveryError) throw error;
  const reason = errorMessage(error);
  await audit(c, i, a, error instanceof Refusal ? "denied" : "failure", reason);
  await say(i, reason);
}
export async function perform(c: FeatureContext, i: InteractionLike, action: Action) {
  let reply: string | InteractionReplyOptions;
  try {
    await admin(i, c);
    reply = await action.run();
  } catch (error) { await fail(c, i, action, error); return; }
  await audit(c, i, action, "success");
  await say(i, reply);
}

/** Explicit member access works even when site admins have no Discord Administrator role. */
export async function privateOverwrites(c: FeatureContext): Promise<Overwrite[]> {
  const admins = c.db.prepare<[], { id: string }>("select discord_user_id as id from users where discord_user_id is not null").all();
  const ids = new Set([c.config.clientId]);
  for (const member of admins) if ((await c.shared.adminAccess(member.id)).isAdmin) ids.add(member.id);
  return [{ id: c.config.guildId, type: 0, allow: "0", deny: P.ViewChannel.toString() },
    ...[...ids].map(id => ({ id, type: 1, allow: P.ViewChannel.toString(), deny: "0" }))];
}
