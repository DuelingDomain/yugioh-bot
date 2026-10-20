import { PermissionFlagsBits as P, Routes, type RESTGetAPIChannelMessagesResult } from "discord.js";
import type { FeatureContext } from "../../runtime/types.js";
import { audit, type Action, type ActionResult } from "./audit.js";
import { Refusal, type Actor, type GuildChannel } from "./security.js";

const fourteenDays = 14 * 86400000;
function recent(id: string, now = Date.now()) {
  if (!/^\d{17,20}$/.test(id)) return false;
  const created = Number((BigInt(id) >> 22n) + 1420070400000n);
  // A small margin also keeps messages that age out while Discord queues the
  // request out of the bulk-delete body.
  return created > now - fourteenDays + 5000;
}

export async function preparePurge(context: FeatureContext, action: Action) {
  const messages = await context.rest.get(Routes.channelMessages(action.channelId!), {
    query: new URLSearchParams({ limit: String(action.count) }),
  }) as RESTGetAPIChannelMessagesResult;
  action.messageIds = []; action.oldSkipped = 0; action.filterSkipped = 0;
  for (const message of messages.slice(0, action.count)) {
    if (!recent(message.id) || Date.parse(message.timestamp) <= Date.now() - fourteenDays + 5000) { action.oldSkipped++; continue; }
    if (action.targetId && message.author.id !== action.targetId) { action.filterSkipped++; continue; }
    action.messageIds.push(message.id);
  }
}

type Overwrite = { id: string; type: number; allow: string; deny: string };
export interface LockSnapshot { id: number; previousOverwrite: Overwrite | null }
export function activeLock(context: FeatureContext, channelId: string): LockSnapshot | undefined {
  const row = context.db.prepare<[string, string], { id: number; params_json: string }>(`select s.id,s.params_json from mod_actions s
    where s.guild_id=? and s.action='lock_snapshot' and json_extract(s.params_json,'$.channelId')=?
    and not exists (select 1 from mod_actions u where u.guild_id=s.guild_id and u.action='unlock' and u.result='success'
      and json_extract(u.params_json,'$.snapshotId')=s.id) order by s.id desc limit 1`).get(context.config.guildId, channelId);
  return row ? { id: row.id, previousOverwrite: JSON.parse(row.params_json).previousOverwrite } : undefined;
}

export function checkLockState(context: FeatureContext, action: Action) {
  const snapshot = activeLock(context, action.channelId!);
  if (action.kind === "lock" && snapshot) throw new Refusal("This channel is already locked or has a saved lock snapshot. Use unlock to restore it first.");
  if (action.kind === "unlock" && !snapshot) throw new Refusal("No saved lock exists for this channel. There is no previous overwrite to restore.");
}

export async function executeChannelAction(context: FeatureContext, actor: Actor, action: Action, channel: GuildChannel): Promise<ActionResult> {
  const channelId = action.channelId!;
  const options = { reason: `Actor ${actor.id}: ${action.reason}`.slice(0, 512) };
  if (action.kind === "slowmode") {
    await context.rest.patch(Routes.channel(channelId), { ...options, body: { rate_limit_per_user: action.durationSeconds } });
    return { content: `Slowmode in channel ${channelId}: ${action.durationSeconds} seconds.` };
  }
  if (action.kind === "purge") {
    const ids = (action.messageIds ?? []).filter(id => recent(id));
    const agedOut = (action.messageIds?.length ?? 0) - ids.length;
    if (ids.length === 1) await context.rest.delete(Routes.channelMessage(channelId, ids[0]), options);
    else if (ids.length > 1) await context.rest.post(Routes.channelBulkDelete(channelId), { ...options, body: { messages: ids } });
    const skipped = (action.oldSkipped ?? 0) + agedOut;
    return { content: `Deleted ${ids.length} messages in channel ${channelId}. Skipped ${skipped} messages at least 14 days old (or within 5 seconds of that limit). ${action.filterSkipped ?? 0} messages did not match the user filter.`,
      params: { deleted: ids.length, oldSkipped: skipped, filterSkipped: action.filterSkipped ?? 0 } };
  }
  checkLockState(context, action);
  if (action.kind === "lock") {
    const previous = channel.permission_overwrites?.find(row => row.type === 0 && row.id === context.config.guildId) ?? null;
    // Save BEFORE REST. A crash or uncertain HTTP result must leave a durable
    // recovery path. Never overwrite the first snapshot on a repeated lock.
    const snapshotId = audit(context, actor.id, { ...action, kind: "lock_snapshot" }, "success", { previousOverwrite: previous });
    await context.rest.put(Routes.channelPermission(channelId, context.config.guildId), { ...options,
      body: { type: 0, allow: String(BigInt(previous?.allow ?? "0") & ~P.SendMessages), deny: String(BigInt(previous?.deny ?? "0") | P.SendMessages) } });
    return { content: `Locked channel ${channelId}. The previous @everyone overwrite is saved.`, params: { snapshotId } };
  }
  if (action.kind === "unlock") {
    const snapshot = activeLock(context, channelId)!;
    if (snapshot.previousOverwrite) {
      const { type, allow, deny } = snapshot.previousOverwrite;
      await context.rest.put(Routes.channelPermission(channelId, context.config.guildId), { ...options, body: { type, allow, deny } });
    } else await context.rest.delete(Routes.channelPermission(channelId, context.config.guildId), options);
    return { content: `Unlocked channel ${channelId}. Restored the exact previous @everyone overwrite.`, params: { snapshotId: snapshot.id } };
  }
  throw new Refusal("This channel action is not available.");
}
