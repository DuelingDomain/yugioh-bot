import { PermissionFlagsBits as P, Routes, type RESTGetAPIGuildMemberResult, type APIRole } from "discord.js";
import { adminAccess, type ModWarning } from "@yugidraft/shared/discord-admin";
import { easternDayKey } from "@yugidraft/shared/util/eastern-time";
import type { FeatureContext } from "../../runtime/types.js";
import { audit, type Action, type ActionResult } from "./audit.js";
import { Refusal, type Actor } from "./security.js";

/** Eastern day of the Discord join time ("2025-01-01 ET"), or "Unknown". */
function joinedDay(value: string | null | undefined): string {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? `${easternDayKey(ms)} ET` : "Unknown";
}

export function warningCount(context: FeatureContext, targetId: string): number {
  return context.db.prepare<[string, string], { count: number }>("select count(*) count from mod_warnings where guild_id=? and target_discord_id=?")
    .get(context.config.guildId, targetId)!.count;
}

export function requireWarning(context: FeatureContext, action: Action, actor: Actor): ModWarning {
  if (!actor.admin) throw new Refusal("Only site admins can clear a warning.");
  const row = context.db.prepare<[string, string, number], ModWarning>("select * from mod_warnings where guild_id=? and target_discord_id=? and id=?")
    .get(context.config.guildId, action.targetId!, action.warningId!);
  if (!row) throw new Refusal("This warning was not found for this user in this server.");
  return row;
}

export async function executeMemberAction(context: FeatureContext, actor: Actor, action: Action): Promise<ActionResult> {
  const guildId = context.config.guildId, target = action.targetId!;
  const options = { reason: `Actor ${actor.id}: ${action.reason}`.slice(0, 512) };
  switch (action.kind) {
    case "timeout":
    case "untimeout": {
      const until = action.durationSeconds ? new Date(Date.now() + action.durationSeconds * 1000).toISOString() : null;
      await context.rest.patch(Routes.guildMember(guildId, target), { ...options, body: { communication_disabled_until: until } });
      return { content: until ? `Timed out user ${target} for ${action.durationSeconds} seconds.` : `Removed the timeout from user ${target}.` };
    }
    case "kick":
      await context.rest.delete(Routes.guildMember(guildId, target), options);
      return { content: `Kicked user ${target}.` };
    case "ban":
      await context.rest.put(Routes.guildBan(guildId, target), { ...options, body: { delete_message_seconds: (action.deleteMessageDays ?? 0) * 86400 } });
      return { content: `Banned user ${target}. Deleted up to ${action.deleteMessageDays ?? 0} days of messages.` };
    case "unban":
      await context.rest.delete(Routes.guildBan(guildId, target), options);
      return { content: `Unbanned user ${target}.` };
    case "warn": {
      // Persist first. A closed DM must not discard a warning or cause a retry to
      // create a second warning. The warning and its audit/outbox are atomic.
      const saved = context.db.transaction(() => {
        const actionId = audit(context, actor.id, action, "success");
        const account = adminAccess(context.db, actor.id);
        const id = Number(context.db.prepare(`insert into mod_warnings(guild_id,actor_user_id,actor_discord_id,target_discord_id,reason,mod_action_id,created_at)
          values(?,?,?,?,?,?,?)`).run(guildId, account.siteUserId, actor.id, target, action.reason, actionId, Date.now()).lastInsertRowid);
        return { id, count: warningCount(context, target) };
      }).immediate();
      let delivered = true;
      try {
        const dm = await context.rest.post(Routes.userChannels(), { body: { recipient_id: target } }) as { id: string };
        await context.rest.post(Routes.channelMessages(dm.id), { body: {
          content: `You received a warning in server ${guildId}.\nReason: ${action.reason}\nWarnings: ${saved.count}.`, allowed_mentions: { parse: [] },
        } });
      } catch { delivered = false; }
      return { content: `Warning #${saved.id} saved for user ${target}. Total warnings: ${saved.count}. ${delivered ? "DM sent." : "DM could not be sent."}`, audited: true };
    }
    case "warnings": {
      const count = warningCount(context, target), page = action.page ?? 1;
      const pages = Math.max(1, Math.ceil(count / 10));
      if (page > pages) throw new Refusal(`Choose a warning page from 1 to ${pages}.`);
      const rows = context.db.prepare<[string, string, number], ModWarning>(`select * from mod_warnings where guild_id=? and target_discord_id=?
        order by created_at desc,id desc limit 10 offset ?`).all(guildId, target, (page - 1) * 10);
      return { content: `User ${target}: ${count} warnings. Page ${page}/${pages}. Site admins can use the clear option to remove one warning.`,
        embeds: rows.length ? [{ title: "Warnings", fields: rows.map(row => ({ name: `#${row.id} · ${easternDayKey(row.created_at)} · actor ${row.actor_discord_id ?? "unknown"}`, value: row.reason.slice(0, 500) })) }] : undefined };
    }
    case "warning_clear": {
      const row = requireWarning(context, action, actor);
      context.db.transaction(() => {
        context.db.prepare("delete from mod_warnings where id=? and guild_id=? and target_discord_id=?").run(row.id, guildId, target);
        audit(context, actor.id, action, "success", { warningId: row.id });
      }).immediate();
      return { content: `Cleared warning #${row.id} for user ${target}. Remaining warnings: ${warningCount(context, target)}.`, audited: true };
    }
    case "user_info": {
      const [member, roles] = await Promise.all([
        context.rest.get(Routes.guildMember(guildId, target)) as Promise<RESTGetAPIGuildMemberResult>,
        context.rest.get(Routes.guildRoles(guildId)) as Promise<APIRole[]>,
      ]);
      const recent = context.db.prepare<[string, string], { action: string; reason: string | null; result: string; created_at: number }>(`select action,reason,result,created_at from mod_actions
        where guild_id=? and target_discord_id=? and action not in ('user_info','warnings','lock_snapshot')
        order by created_at desc,id desc limit 5`).all(guildId, target);
      const roleList = roles.filter(role => member.roles.includes(role.id)).sort((a, b) => b.position - a.position)
        .map(role => `${role.name ?? "Role"} (${role.id})`).join("\n");
      return { embeds: [{ title: `User info · ${target}`, fields: [
        { name: "Joined", value: joinedDay(member.joined_at) },
        { name: "Roles", value: roleList.slice(0, 1000) || "No roles" },
        { name: "Warnings", value: String(warningCount(context, target)) },
        { name: "Recent mod actions", value: recent.map(row => `${easternDayKey(row.created_at)} · ${row.action} · ${row.result}\n${(row.reason ?? "No reason").slice(0, 130)}`).join("\n").slice(0, 1000) || "None" },
      ] }] };
    }
    default: throw new Refusal("This moderation action is not available.");
  }
}

export function memberPermission(action: Action): bigint {
  switch (action.kind) {
    case "timeout": case "untimeout": return P.ModerateMembers;
    case "kick": return P.KickMembers;
    case "ban": case "unban": return P.BanMembers;
    default: return 0n;
  }
}
