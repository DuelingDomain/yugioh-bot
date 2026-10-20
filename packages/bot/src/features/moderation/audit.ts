import { adminAccess, enqueueOutbox, recordModAction } from "@yugidraft/shared/discord-admin";
import type { FeatureContext } from "../../runtime/types.js";

export interface Action {
  kind: string;
  targetId?: string;
  channelId?: string;
  reason: string;
  durationSeconds?: number;
  deleteMessageDays?: number;
  count?: number;
  warningId?: number;
  page?: number;
  messageIds?: string[];
  oldSkipped?: number;
  filterSkipped?: number;
}
export interface ActionResult {
  content?: string;
  embeds?: { title: string; description?: string; fields?: { name: string; value: string }[] }[];
  params?: Record<string, unknown>;
  audited?: boolean;
}

/** The shared service and the complete, duration-bearing outbox body commit together. */
export function audit(context: FeatureContext, actorId: string, action: Action,
  result: "success" | "failure" | "denied", extra: Record<string, unknown> = {}): number {
  return context.db.transaction(() => {
    const account = adminAccess(context.db, actorId);
    const params = { channelId: action.channelId, durationSeconds: action.durationSeconds,
      deleteMessageDays: action.deleteMessageDays, count: action.count, warningId: action.warningId, ...extra };
    const id = recordModAction(context.db, { guildId: context.config.guildId, actorDiscordId: actorId,
      ...(account.siteUserId ? { actorSiteUserId: account.siteUserId } : {}), action: action.kind,
      targetDiscordId: action.targetId ?? action.channelId, reason: action.reason, params, result });
    const channelId = context.config.modLogChannelId;
    if (channelId) {
      const fields = [
        { name: "Action", value: action.kind }, { name: "Result", value: result },
        { name: "Actor", value: actorId }, { name: "Target", value: action.targetId ?? action.channelId ?? "none" },
        { name: "Reason", value: action.reason.slice(0, 1000) },
        { name: "Duration", value: action.durationSeconds === undefined ? "Not applicable" : action.durationSeconds === 0 ? "Removed / disabled" : `${action.durationSeconds} seconds` },
      ];
      const outboxId = enqueueOutbox(context.db, { idempotencyKey: `mod-action:${id}`, kind: "mod_log", channelId,
        modActionId: id, payload: { embeds: [{ title: "Moderation action", fields }] } });
      // recordModAction may already have queued this key. Preserve its nonce and
      // mention policy while filling in fields the shared generic renderer lacks.
      context.db.prepare("update discord_outbox set payload_json=json_set(payload_json,'$.embeds',json(?)) where id=?")
        .run(JSON.stringify([{ title: "Moderation action", fields }]), outboxId);
    }
    return id;
  }).immediate();
}
