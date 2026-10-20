import type Database from "better-sqlite3";
import { isOwnerUser } from "../access/owner-access.js";

/** Trusted session or Discord interaction identity; roles must come from the guild interaction. */
export type AdminActor = ({ siteUserId: number | string; discordUserId?: never }
  | { discordUserId: string; siteUserId?: never }) & { roles?: readonly string[] };

export interface LinkedSiteAccount {
  siteUserId: number;
  discordUserId: string | null;
  displayName: string;
}

/** The users table already owns the unique, verified Discord link. */
export function lookupSiteAccount(db: Database.Database, actor: AdminActor): LinkedSiteAccount | null {
  const columns = "id as siteUserId, discord_user_id as discordUserId, display_name as displayName";
  if (actor.siteUserId !== undefined) {
    const value = String(actor.siteUserId);
    if (actor.discordUserId !== undefined || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return null;
    return db.prepare<[number], LinkedSiteAccount>(`select ${columns} from users where id=?`).get(Number(value)) ?? null;
  }
  if (typeof actor.discordUserId !== "string" || !actor.discordUserId.trim()) return null;
  return db.prepare<[string], LinkedSiteAccount>(`select ${columns} from users where discord_user_id=?`).get(actor.discordUserId) ?? null;
}

export function isAdminActor(db: Database.Database, actor: AdminActor): boolean {
  return adminAccess(db, actor).isAdmin;
}

export function isModerator(db: Database.Database, actor: AdminActor): boolean {
  return adminAccess(db, actor).isModerator;
}

export function adminAccess(db: Database.Database, actor: AdminActor | string) {
  const identity = typeof actor === "string" ? { discordUserId: actor } : actor;
  const account = lookupSiteAccount(db, identity);
  const isAdmin = account !== null && isOwnerUser(account.siteUserId);
  const role = process.env.DISCORD_MODERATOR_ROLE_ID?.trim();
  return { siteUserId: account?.siteUserId ?? null, discordUserId: account?.discordUserId ?? identity.discordUserId ?? null,
    isAdmin, isModerator: isAdmin || (identity.discordUserId !== undefined && !!role && identity.roles?.includes(role) === true) };
}
