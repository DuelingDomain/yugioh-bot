import Database from "better-sqlite3";
import { isOwnerUser } from "../access/owner-access.js";
import type { AdminSpectateClaims } from "../ws/admin-spectate-token.js";
import { resolveDraftDatabasePath } from "./draft-access.js";

type SpectateTarget = Pick<AdminSpectateClaims, "userId" | "guildId" | "slug" | "kind">;

/** Players and invitees must use their ordinary view while the game or a player's linked tournament is live. */
export function isAdminSpectateParticipant(db: Database.Database, claims: SpectateTarget): boolean {
  if (claims.kind === "duel") return !!db.prepare(`select 1 from duels d
    where d.web_slug=? and d.guild_id=? and d.status in ('lobby','active') and (
      exists(select 1 from duel_seats s join players p on p.id=s.player_id
        where s.duel_id=d.id and p.user_id=?) or
      exists(select 1 from duel_invite_grants i join players p on p.id=i.player_id
        where i.duel_id=d.id and p.user_id=?))`).get(claims.slug, claims.guildId, claims.userId, claims.userId);
  if (claims.kind === "draft") return !!db.prepare(`select 1 from drafts d
    where d.web_slug=? and d.guild_id=? and (
      exists(select 1 from draft_players dp join players p on p.id=dp.player_id
        where dp.draft_id=d.id and p.user_id=? and (d.status in ('pending','active') or
          exists(select 1 from tournaments t where t.id=d.tournament_id and t.status in ('pending','active')))) or
      exists(select 1 from draft_invite_grants i where i.draft_id=d.id and i.user_id=? and d.status in ('pending','active')))`)
    .get(claims.slug, claims.guildId, claims.userId, claims.userId);
  return false;
}

/** Current owner policy, guild and live participation, checked before private reads or broadcasts. No writes. */
export function canAdminSpectate(db: Database.Database, claims: SpectateTarget): boolean {
  if (!isOwnerUser(claims.userId) || !process.env.DISCORD_GUILD_ID || claims.guildId !== process.env.DISCORD_GUILD_ID) return false;
  if (!db.prepare("select 1 from users where id=?").get(claims.userId)) return false;
  if (isAdminSpectateParticipant(db, claims)) return false;
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
