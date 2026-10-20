import { Routes, type REST } from "discord.js";
import type { SharedAdminServices, ModAction } from "./shared.js";

export function createAudit(shared: SharedAdminServices, guildId: string) {
  return async (action: Omit<ModAction, "guildId">): Promise<void> => {
    // B writes the audit row and mod-log outbox row in one transaction.
    await shared.recordModAction({ ...action, guildId });
  };
}

/** Phase 1 can call this from its outbox renderer. Never post twice after recordModAction. */
export async function postAuditMessage(rest: REST, channelId: string, payload: Record<string, unknown>) {
  const message = await rest.post(Routes.channelMessages(channelId), { body: {
    ...payload, allowed_mentions: { parse: [], replied_user: false },
  } }) as { id: string };
  return { messageId: message.id };
}
