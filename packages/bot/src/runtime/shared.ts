import type Database from "better-sqlite3";
import { log } from "@yugidraft/shared/observability";
import { createRequire } from "node:module";

export const OUTBOX_TABLE = "discord_outbox";
export interface AdminAccess { isAdmin: boolean; siteUserId: number | null }
export interface ModAction {
  guildId: string; actorDiscordId: string; action: string; targetDiscordId?: string;
  reason?: string; result: "success" | "failure" | "denied"; params?: Record<string, unknown>;
}
/** Task B owns persistence. Task A never creates the table or claims rows itself. */
export interface DiscordOutboxRow {
  id: number; kind: string; operation: "post" | "edit";
  channel_id: string; message_id: string | null; payload_json: string;
  idempotency_key: string; lease_token: string; lease_expires_at: number;
  attempts: number;
}
export interface OutboxSweep {
  guildId: string;
  limit: number;
  signal: AbortSignal;
  deliver(row: DiscordOutboxRow): Promise<{ messageId: string }>;
}
export interface SharedAdminServices {
  adminAccess(discordUserId: string): AdminAccess | Promise<AdminAccess>;
  recordModAction(action: ModAction): void | Promise<void>;
  pollDiscordOutbox(sweep: OutboxSweep): Promise<void>;
}

/** Optional boundary until B lands. Missing services deny privileged interactions. */
export async function loadSharedAdminServices(db: Database.Database): Promise<SharedAdminServices> {
  const specifier = "@yugidraft/shared/discord-admin";
  try {
    createRequire(import.meta.url).resolve(specifier);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    log("warn", "[bot] Shared admin services are not installed; privileged handlers and discord_outbox delivery are disabled");
    return {
      adminAccess: () => { throw new Error("Shared admin access service is unavailable"); },
      recordModAction: () => { throw new Error("Shared admin audit service is unavailable"); },
      pollDiscordOutbox: async () => {},
    };
  }
  const shared = await import(specifier) as SharedAdminCore;
  for (const name of ["adminAccess", "recordModAction", "claimOutbox", "markPosted", "markFailed"] as const) {
    if (typeof shared[name] !== "function") throw new Error(`Shared discord-admin is missing ${name}; see ADR 0006`);
  }
  return {
    adminAccess: discordId => shared.adminAccess(db, discordId),
    recordModAction: action => { shared.recordModAction(db, action); },
    async pollDiscordOutbox(sweep) {
      for (const row of shared.claimOutbox(db, sweep.limit)) {
        if (sweep.signal.aborted) { shared.markFailed(db, row); continue; }
        try { shared.markPosted(db, row, await sweep.deliver(row)); }
        catch { shared.markFailed(db, row); }
      }
    },
  };
}

/** Structural contract with B. No imports from its unmerged package export. */
interface SharedAdminCore {
  adminAccess(db: Database.Database, discordId: string): AdminAccess;
  recordModAction(db: Database.Database, action: ModAction): unknown;
  claimOutbox(db: Database.Database, limit: number): DiscordOutboxRow[];
  markPosted(db: Database.Database, row: DiscordOutboxRow, posted: { messageId: string }): boolean;
  markFailed(db: Database.Database, row: DiscordOutboxRow): boolean;
}
