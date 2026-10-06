import type Database from "better-sqlite3";

export interface RejoinDraft {
  slug: string;
  name: string;
  /** "active" is dealing now; "pending" is a lobby. */
  status: "active" | "pending";
}

/**
 * The lobby and active drafts the signed-in user sits in, live ones first. Scoped to one guild.
 * Finished and cancelled drafts, and drafts with no web address, are left out.
 */
export function findRejoinDrafts(db: Database.Database, guildId: string, userId: number): RejoinDraft[] {
  const rows = db
    .prepare(
      `select d.web_slug as slug, d.name, d.status
       from drafts d
       inner join draft_players dp on dp.draft_id = d.id
       inner join players p on p.id = dp.player_id
       where d.guild_id = ? and p.guild_id = d.guild_id and p.user_id = ?
         and d.status in ('pending', 'active') and d.web_slug is not null
       order by case d.status when 'active' then 0 else 1 end, d.created_at desc, d.id desc
       limit 3`,
    )
    .all(guildId, userId) as Array<{ slug: string; name: string; status: "active" | "pending" }>;
  return rows;
}
