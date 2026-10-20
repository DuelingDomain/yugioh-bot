import { randomBytes } from "node:crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits as P } from "discord.js";
import type { CommandInteractionLike, ButtonInteractionLike, FeatureContext, InteractionLike } from "../../runtime/types.js";
import { audit, type Action, type ActionResult } from "./audit.js";
import { authorize, checkTarget, errorReply, fetchChannel, Refusal, requireActorChannelPermission, requireBotPermission, snowflake, type Actor, type GuildChannel } from "./security.js";
import { executeMemberAction, memberPermission, requireWarning } from "./members.js";
import { checkLockState, executeChannelAction, preparePurge } from "./channels.js";

interface Pending { actorId: string; guildId: string; expires: number; action: Action }
const pending = new WeakMap<FeatureContext, Map<string, Pending>>();
const channelKinds = new Set(["purge", "slowmode", "lock", "unlock"]);
const readKinds = new Set(["warnings", "user_info"]);
const targetKinds = new Set(["timeout", "untimeout", "kick", "ban", "warn"]);

export async function reply(interaction: InteractionLike, result: ActionResult) {
  await interaction.reply({ content: result.content, embeds: result.embeds, components: [],
    flags: MessageFlags.Ephemeral, allowedMentions: { parse: [], repliedUser: false } });
}

export async function failure(interaction: InteractionLike, context: FeatureContext, action: Action, error: unknown) {
  const safe = errorReply(error);
  audit(context, interaction.user.id, action, safe.result, { error: safe.code });
  await reply(interaction, { content: safe.content });
}

function duration(value: string | null): number {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "remove" || normalized === "0") return 0;
  const parts = normalized?.matchAll(/(\d+)([smhdw])/g);
  let total = 0, consumed = "";
  for (const part of parts ?? []) {
    consumed += part[0]; total += Number(part[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[part[2]]!);
  }
  if (!normalized || consumed !== normalized || !Number.isSafeInteger(total) || total < 1 || total > 28 * 86400)
    throw new Refusal("Use a duration such as 30m, 2h or 1d12h, up to 28 days. Use remove or 0 to remove a timeout.");
  return total;
}
function integer(value: number | null, min: number, max: number, label: string): number {
  if (value === null || !Number.isSafeInteger(value) || value < min || value > max) throw new Refusal(`${label} must be an integer from ${min} to ${max}.`);
  return value;
}

function parse(interaction: CommandInteractionLike, action: Action) {
  const { options } = interaction;
  let channelPermissions: string | null | undefined;
  if (channelKinds.has(action.kind)) {
    const channel = options.getChannel("channel");
    action.channelId = channel?.id ?? interaction.channelId ?? undefined;
    channelPermissions = channel ? channel.permissions : interaction.memberPermissions;
  }
  if ([...targetKinds, "warnings"].includes(action.kind)) action.targetId = snowflake(options.getUser("user")?.id ?? null);
  if (action.kind === "unban") action.targetId = snowflake(options.getString("user-id"));
  if (action.kind === "purge") { action.targetId = options.getUser("user")?.id; action.count = integer(options.getInteger("count"), 1, 100, "Count"); }
  if (action.kind === "timeout") action.durationSeconds = duration(options.getString("duration"));
  if (action.kind === "untimeout") action.durationSeconds = 0;
  if (action.kind === "slowmode") action.durationSeconds = integer(options.getInteger("seconds"), 0, 21600, "Seconds");
  if (action.kind === "ban") action.deleteMessageDays = integer(options.getInteger("delete-message-days") ?? 0, 0, 7, "Delete-message-days");
  if (action.kind === "warn" && action.reason === "No reason supplied.") throw new Refusal("Enter a reason for this warning.");
  if (action.kind === "warnings") {
    action.page = integer(options.getInteger("page") ?? 1, 1, 1000000, "Page");
    const clear = options.getInteger("clear");
    if (clear !== null) { action.warningId = integer(clear, 1, Number.MAX_SAFE_INTEGER, "Warning ID"); action.kind = "warning_clear"; }
  }
  return channelPermissions;
}

async function check(context: FeatureContext, actor: Actor, action: Action, resolvedPermissions?: string | null): Promise<GuildChannel | undefined> {
  if (targetKinds.has(action.kind)) {
    const target = await checkTarget(context, actor, action.targetId!, action.kind === "ban");
    if ((action.kind === "timeout" || action.kind === "untimeout") && target) {
      const permission = target.roles.filter(role => role.id === context.config.guildId || target.target.roles.includes(role.id))
        .reduce((bits, role) => bits | BigInt(role.permissions), 0n);
      if ((permission & P.Administrator) || target.target.user.bot) throw new Refusal("Discord cannot time out an administrator or a bot.");
    }
  }
  if (action.kind === "unban") await checkTarget(context, actor, action.targetId!, true);
  if (action.kind === "warning_clear") requireWarning(context, action, actor);
  const permission = memberPermission(action);
  if (permission) await requireBotPermission(context, permission);
  if (channelKinds.has(action.kind)) {
    if (!action.channelId) throw new Refusal("Choose a channel in this server.");
    const channel = await fetchChannel(context, action.channelId, action.kind === "slowmode" ? [0, 2, 13, 15, 16] : [0, 5, 15, 16]);
    const required = action.kind === "purge" ? P.ManageMessages | P.ReadMessageHistory
      : action.kind === "slowmode" ? P.ManageChannels : P.ManageRoles;
    await requireActorChannelPermission(context, actor, action.kind === "purge" ? P.ManageMessages : required, channel, resolvedPermissions);
    await requireBotPermission(context, required, channel);
    if (action.kind === "purge" && ![0, 5].includes(channel.type)) throw new Refusal("Purge requires a text or announcement channel.");
    if (action.kind === "lock" || action.kind === "unlock") {
      checkLockState(context, action);
      // Discord requires a bot to hold the permission that it overwrites too.
      // Unlock may restore SendMessages even though @everyone is now denied.
      if (action.kind === "lock") await requireBotPermission(context, P.SendMessages, channel);
    }
    return channel;
  }
}

function needsConfirmation(action: Action) {
  return ["kick", "ban", "lock", "unlock", "warning_clear"].includes(action.kind) || (action.kind === "purge" && action.count! > 10);
}

async function requestConfirmation(interaction: InteractionLike, context: FeatureContext, action: Action) {
  let entries = pending.get(context);
  if (!entries) { entries = new Map(); pending.set(context, entries); }
  for (const [id, entry] of entries) if (entry.expires <= Date.now()) entries.delete(id);
  if (entries.size >= 1000) throw new Refusal("Too many pending confirmations. Wait one minute and try again.");
  const id = randomBytes(16).toString("hex");
  entries.set(id, { actorId: interaction.user.id, guildId: context.config.guildId, expires: Date.now() + 60000,
    action: { ...action, messageIds: action.messageIds ? [...action.messageIds] : undefined } });
  const details = [ `Confirm ${action.kind} for ${action.targetId ?? action.channelId}.`,
    ...(action.deleteMessageDays !== undefined ? [`Delete message history: ${action.deleteMessageDays} days.`] : []),
    ...(action.count !== undefined ? [`Scan: ${action.count}. Delete: ${action.messageIds?.length ?? 0} messages. User filter: ${action.targetId ?? "none"}.`] : []),
    ...(action.warningId ? [`Warning: #${action.warningId}.`] : []),
    `Reason: ${action.reason}`, "Expires in 60 seconds. Only you can confirm.",
  ];
  await interaction.reply({ content: details.join("\n"), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`mod:yes:${id}`).setLabel("Confirm").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`mod:no:${id}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
    )] });
}

async function run(interaction: InteractionLike, context: FeatureContext, actor: Actor, action: Action, confirmed = false,
  resolvedPermissions?: string | null) {
  // The runtime cooldown is acquired only when actually executing a mutation,
  // so a quick confirmation is not blocked by the initial command request.
  const operation = async () => {
    const current = await authorize(interaction, context);
    const channel = await check(context, current, action, resolvedPermissions);
    if (action.kind === "purge" && !action.messageIds) await preparePurge(context, action);
    const result = channel ? await executeChannelAction(context, current, action, channel)
      : await executeMemberAction(context, current, action);
    if (!result.audited) audit(context, actor.id, action, "success", result.params);
    await reply(interaction, result);
  };
  if (!confirmed && needsConfirmation(action)) {
    await check(context, actor, action, resolvedPermissions);
    if (action.kind === "purge") await preparePurge(context, action);
    await requestConfirmation(interaction, context, action); return;
  }
  if (readKinds.has(action.kind)) await operation();
  else if (!await context.cooldown.run(context.config.guildId, actor.id, operation)) throw new Refusal("Wait three seconds before another action. Another action may be in progress in this server.");
}

export async function command(interaction: CommandInteractionLike, context: FeatureContext) {
  const reason = interaction.options.getString("reason")?.trim() || "No reason supplied.";
  const action: Action = { kind: interaction.commandName, reason: reason.slice(0, 500),
    targetId: interaction.options.getUser("user")?.id };
  try {
    const actor = await authorize(interaction, context);
    const permissions = parse(interaction, action); await run(interaction, context, actor, action, false, permissions);
  } catch (error) { await failure(interaction, context, action, error); }
}

export async function button(interaction: ButtonInteractionLike, context: FeatureContext) {
  let action: Action = { kind: "moderation_confirmation", reason: "Confirmation request" };
  try {
    const actor = await authorize(interaction, context);
    const [, decision, id] = interaction.customId.split(":");
    const entries = pending.get(context), entry = entries?.get(id);
    if (!entry) throw new Refusal("This confirmation has expired. Run the command again.");
    if (entry.actorId !== actor.id || entry.guildId !== interaction.guildId) throw new Refusal("Only the member who requested this action can confirm it.");
    entries!.delete(id); action = entry.action;
    await interaction.deferUpdate();
    const source = interaction;
    interaction = { ...source, async reply({ flags, ephemeral, ...message }) {
      await source.editReply({ ...message, components: [] });
    } };
    if (entry.expires <= Date.now()) throw new Refusal("This confirmation has expired. Run the command again.");
    if (decision === "no") {
      audit(context, actor.id, { ...action, kind: `${action.kind}_cancel` }, "success");
      await reply(interaction, { content: "Cancelled." }); return;
    }
    if (decision !== "yes") throw new Refusal("This confirmation is invalid.");
    await run(interaction, context, actor, action, true);
  } catch (error) { await failure(interaction, context, action, error); }
}

export async function userInfo(interaction: InteractionLike, context: FeatureContext, targetId: string) {
  const action: Action = { kind: "user_info", targetId, reason: "Moderator user information lookup" };
  try { const actor = await authorize(interaction, context); await run(interaction, context, actor, action); }
  catch (error) { await failure(interaction, context, action, error); }
}

export function clearConfirmations(context: FeatureContext) { pending.delete(context); }
