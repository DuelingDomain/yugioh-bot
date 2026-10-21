import Database from "better-sqlite3";
import { isOwnerUser } from "../access/owner-access.js";
import type { AdminSpectateClaims } from "../ws/admin-spectate-token.js";
import { resolveDraftDatabasePath } from "./draft-access.js";

/** Current owner policy and configured guild, checked before any private read or broadcast. No writes. */
export function canAdminSpectate(db: Database.Database, claims: Pick<AdminSpectateClaims, "userId" | "guildId" | "slug" | "kind">): boolean {
  if (!isOwnerUser(claims.userId) || !process.env.DISCORD_GUILD_ID || claims.guildId !== process.env.DISCORD_GUILD_ID) return false;
  if (!db.prepare("select 1 from users where id=?").get(claims.userId)) return false;
  if (claims.kind === "duel") return !!db.prepare("select 1 from duels where web_slug=? and guild_id=? and kind='play'").get(claims.slug, claims.guildId);
  if (claims.kind === "draft") return !!db.prepare("select 1 from drafts where web_slug=? and guild_id=?").get(claims.slug, claims.guildId);
  return false;
}
export function createAdminSpectateAccessReader(databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite") {
  const path = resolveDraftDatabasePath(databasePath);
  let db: Database.Database | undefined;
  return {
    canRead(claims: AdminSpectateClaims): boolean {
      try { db ??= new Database(path, { readonly: true, fileMustExist: true }); return canAdminSpectate(db, claims); }
      catch { return false; }
    },
    close() { db?.close(); db = undefined; },
  };
}
