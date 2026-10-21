import type Database from "better-sqlite3";
import { enqueueOutbox } from "./outbox.js";

export interface ModActionInput {
  guildId: string; actorSiteUserId?: number; actorDiscordId?: string;
  action: string; targetSiteUserId?: number; targetDiscordId?: string;
  /** Suppress the Discord mirror for private console reads. Persistence is always required. */
  notifyDiscord?: boolean;
  reason?: string; params?: Record<string, unknown>; result: "success" | "failure" | "denied";
}

/** Persist both successes and refusals. Supply safe parameters, never raw API errors. */
export function recordModAction(db: Database.Database, input: ModActionInput): number {
  return db.transaction(() => {
    const id = Number(db.prepare(`insert into mod_actions(guild_id,actor_user_id,actor_discord_id,action,
      target_user_id,target_discord_id,reason,params_json,result,created_at) values(?,?,?,?,?,?,?,?,?,?)`)
      .run(input.guildId, input.actorSiteUserId ?? null, input.actorDiscordId ?? null, input.action,
        input.targetSiteUserId ?? null, input.targetDiscordId ?? null, input.reason ?? null,
        JSON.stringify(input.params ?? {}), input.result, Date.now()).lastInsertRowid);
    const channelId = process.env.DISCORD_MOD_LOG_CHANNEL_ID?.trim();
    if (input.notifyDiscord !== false && process.env.DISCORD_BOT_ENABLED === "1" && channelId) enqueueOutbox(db, {
      idempotencyKey: `mod-action:${id}`, kind: "mod_log", channelId, modActionId: id,
      payload: { embeds: [{ title: "Moderation action", fields: [
        { name: "Action", value: input.action.slice(0, 200) },
        { name: "Result", value: input.result },
        { name: "Actor", value: input.actorDiscordId ?? String(input.actorSiteUserId ?? "system") },
        { name: "Target", value: input.targetDiscordId ?? String(input.targetSiteUserId ?? "none") },
        ...(input.reason ? [{ name: "Reason", value: input.reason.slice(0, 1000) }] : []),
      ] }] },
    });
    return id;
  }).immediate();
}

export interface WarningInput {
  guildId: string; actorSiteUserId?: number; actorDiscordId?: string; targetDiscordId: string; reason: string;
}
export interface ModWarning {
  id: number; guild_id: string; actor_user_id: number | null; actor_discord_id: string | null;
  target_discord_id: string; reason: string; mod_action_id: number; created_at: number;
}

export function addWarning(db: Database.Database, input: WarningInput): number {
  return db.transaction(() => {
    const actionId = recordModAction(db, { ...input, action: "warn", result: "success" });
    return Number(db.prepare(`insert into mod_warnings(guild_id,actor_user_id,actor_discord_id,target_discord_id,
      reason,mod_action_id,created_at) values(?,?,?,?,?,?,?)`).run(input.guildId, input.actorSiteUserId ?? null,
      input.actorDiscordId ?? null, input.targetDiscordId, input.reason, actionId, Date.now()).lastInsertRowid);
  }).immediate();
}

export function listWarnings(db: Database.Database, guildId: string, targetDiscordId: string, limit = 100): ModWarning[] {
  return db.prepare<[string, string, number], ModWarning>(`select * from mod_warnings where guild_id=? and target_discord_id=?
    order by created_at desc,id desc limit ?`).all(guildId, targetDiscordId, Math.min(100, Math.max(0, Math.trunc(limit))));
}
