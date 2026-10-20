import { DiscordAPIError, HTTPError, RateLimitError, PermissionFlagsBits as P, Routes,
  type RESTGetAPIGuildMemberResult, type APIRole, type APIChannel, type APIGuild } from "discord.js";
import { adminAccess, isAdminActor, isModerator } from "@yugidraft/shared/discord-admin";
import type { FeatureContext, InteractionLike } from "../../runtime/types.js";

export class Refusal extends Error {}
export type Member = RESTGetAPIGuildMemberResult;
export type GuildChannel = APIChannel & { guild_id?: string; permission_overwrites?: { id: string; type: number; allow: string; deny: string }[] };
export interface Actor { id: string; member: Member; admin: boolean }

export function errorReply(error: unknown): { result: "denied" | "failure"; code: string; content: string } {
  if (error instanceof Refusal) return { result: "denied", code: "refused", content: error.message };
  if (error instanceof RateLimitError || ((error instanceof DiscordAPIError || error instanceof HTTPError) && error.status === 429))
    return { result: "failure", code: "discord_rate_limit", content: "Discord rate limit reached. Wait and try again." };
  if (error instanceof DiscordAPIError || error instanceof HTTPError) {
    if (error.status === 403) return { result: "failure", code: "discord_forbidden", content: "Discord refused this action. Check the bot permissions and role position." };
    if (error.status === 404) return { result: "failure", code: "discord_not_found", content: "The member, ban, channel or message was not found. It may have left or been deleted." };
    if (error.status === 400) return { result: "failure", code: "discord_invalid", content: "Discord rejected this action. Check the command values and target." };
  }
  return { result: "failure", code: "discord_unavailable", content: "The action could not be completed. Try again later." };
}

export async function authorize(interaction: InteractionLike, context: FeatureContext): Promise<Actor> {
  if (interaction.guildId !== context.config.guildId || context.signal.aborted) throw new Refusal("Use this command in the configured server.");
  const member = await context.rest.get(Routes.guildMember(context.config.guildId, interaction.user.id)) as Member;
  const identity = { discordUserId: interaction.user.id, roles: member.roles };
  if (!isModerator(context.db, identity)) throw new Refusal("You do not have access to this action.");
  return { id: interaction.user.id, member, admin: adminAccess(context.db, identity).isAdmin };
}

export function snowflake(value: string | null): string {
  if (!value || !/^[1-9]\d{16,19}$/.test(value) || BigInt(value) > 18446744073709551615n) throw new Refusal("Enter a valid Discord user ID.");
  return value;
}

export async function fetchChannel(context: FeatureContext, id: string, allowedTypes: readonly number[] = [0, 5, 15, 16]): Promise<GuildChannel> {
  const channel = await context.rest.get(Routes.channel(id)) as GuildChannel;
  if (channel.guild_id !== context.config.guildId) throw new Refusal("The channel must be in the configured server.");
  if (!allowedTypes.includes(channel.type)) throw new Refusal("Choose a supported server channel. Threads are not supported by this command.");
  return channel;
}

async function guildState(context: FeatureContext) {
  const [guild, roles, bot] = await Promise.all([
    context.rest.get(Routes.guild(context.config.guildId)) as Promise<APIGuild>,
    context.rest.get(Routes.guildRoles(context.config.guildId)) as Promise<APIRole[]>,
    context.rest.get(Routes.guildMember(context.config.guildId, context.client.user?.id ?? context.config.clientId)) as Promise<Member>,
  ]);
  return { guild, roles, bot };
}

function compareRoles(a: APIRole, b: APIRole) {
  return a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? 1 : a.id === b.id ? 0 : -1);
}
function topRole(member: Member, roles: APIRole[], guildId: string): APIRole {
  const found = roles.filter(role => role.id === guildId || member.roles.includes(role.id));
  if (!found.length) throw new Refusal("Could not verify the member role hierarchy.");
  return found.sort(compareRoles).at(-1)!;
}

export async function checkTarget(context: FeatureContext, actor: Actor, targetId: string, allowAbsent = false) {
  const { guild, roles, bot } = await guildState(context);
  if ([guild.owner_id, context.client.user?.id ?? context.config.clientId, actor.id].includes(targetId)
    || isAdminActor(context.db, { discordUserId: targetId }))
    throw new Refusal("You cannot act on the server owner, a site admin, the bot or yourself.");
  let target: Member;
  try { target = await context.rest.get(Routes.guildMember(context.config.guildId, targetId)) as Member; }
  catch (error) { if (allowAbsent && error instanceof DiscordAPIError && error.code === 10007) return; throw error; }
  const highest = topRole(target, roles, guild.id);
  if (compareRoles(topRole(bot, roles, guild.id), highest) <= 0
    || (actor.id !== guild.owner_id && compareRoles(topRole(actor.member, roles, guild.id), highest) <= 0))
    throw new Refusal("The actor and bot must both have a higher role than the target.");
  return { target, roles };
}

function effectivePermissions(guild: APIGuild, roles: APIRole[], member: Member, channel?: GuildChannel) {
  let bits = roles.filter(role => role.id === guild.id || member.roles.includes(role.id))
    .reduce((all, role) => all | BigInt(role.permissions), 0n);
  if (member.user.id === guild.owner_id || bits & P.Administrator) return P.Administrator;
  if (channel?.permission_overwrites) {
    const overwrites = channel.permission_overwrites;
    const everyone = overwrites.find(row => row.id === guild.id && row.type === 0);
    if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
    let allow = 0n, deny = 0n;
    for (const row of overwrites) if (row.type === 0 && member.roles.includes(row.id)) { allow |= BigInt(row.allow); deny |= BigInt(row.deny); }
    bits = (bits & ~deny) | allow;
    const overwrite = overwrites.find(row => row.type === 1 && row.id === member.user.id);
    if (overwrite) bits = (bits & ~BigInt(overwrite.deny)) | BigInt(overwrite.allow);
  }
  return bits;
}

export async function requireActorChannelPermission(context: FeatureContext, actor: Actor, permission: bigint,
  channel: GuildChannel, resolvedPermissions?: string | null) {
  if (!actor.admin && [context.config.modLogChannelId, context.config.waitlistChannelId,
    context.config.statusChannelId, context.config.announceChannelId].includes(channel.id))
    throw new Refusal("Only site admins can moderate a configured bot channel.");
  const required = permission | P.ViewChannel;
  const requirePermission = (bits: bigint) => {
    if (!(bits & P.Administrator) && (bits & required) !== required)
      throw new Refusal("You are missing a required Discord permission in this channel.");
  };
  if (resolvedPermissions != null) requirePermission(BigInt(resolvedPermissions));
  const { guild, roles } = await guildState(context);
  // Confirmation buttons have no resolved channel option. Recompute from fresh
  // membership, roles and overwrites so revocations cannot bypass this check.
  requirePermission(effectivePermissions(guild, roles, actor.member, channel));
}

export async function requireBotPermission(context: FeatureContext, permission: bigint, channel?: GuildChannel) {
  const { guild, roles, bot } = await guildState(context);
  const bits = effectivePermissions(guild, roles, bot, channel);
  const required = permission | (channel ? P.ViewChannel : 0n);
  if (!(bits & P.Administrator) && (bits & required) !== required) throw new Refusal("The bot is missing a required Discord permission in this server or channel.");
}
