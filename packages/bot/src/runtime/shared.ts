import type Database from "better-sqlite3";
import { adminAccess, recordModAction, claimOutbox, markPosted, markFailed,
  type ClaimedOutbox, type ModActionInput } from "@yugidraft/shared/discord-admin";

export const OUTBOX_TABLE = "discord_outbox";
export type AdminAccess = ReturnType<typeof adminAccess>;
export type ModAction = ModActionInput;
export type DiscordOutboxRow = ClaimedOutbox;
export interface SharedAdminServices {
  adminAccess(discordUserId: string): AdminAccess | Promise<AdminAccess>;
  recordModAction(action: ModAction): void | Promise<void>;
  claimOutbox(limit: number): ClaimedOutbox[];
  markPosted(row: ClaimedOutbox, posted: Parameters<typeof markPosted>[2]): boolean;
  markFailed(row: ClaimedOutbox, failure: Parameters<typeof markFailed>[2]): boolean;
}

/** Bind the shared persistence API to this process's database. */
export async function loadSharedAdminServices(db: Database.Database): Promise<SharedAdminServices> {
  return {
    adminAccess: discordId => adminAccess(db, discordId),
    recordModAction: action => { recordModAction(db, action); },
    claimOutbox: limit => claimOutbox(db, limit),
    markPosted: (row, posted) => markPosted(db, row, posted),
    markFailed: (row, failure) => markFailed(db, row, failure),
  };
}
