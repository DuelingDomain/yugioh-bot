import type Database from "better-sqlite3";
import { createLiveNowService } from "./live-now.js";

export interface OpenNowResult {
  tournaments: Array<{ slug: string; name: string; format: string; joinedCount: number; viewerJoined: boolean }>;
  drafts: Array<{ slug: string; name: string; mode: string; seatsTaken: number; seatCount: number | null; viewerJoined: boolean }>;
  duelsInProgress: number;
}

export interface OpenNowService {
  /** Guild-wide joinable lobbies. A viewer without a player row has no memberships. */
  forPlayer(guildId: string, playerId: number | null): OpenNowResult;
}

type ReadParams = { guild: string; viewer: number | null };
type TournamentRow = Omit<OpenNowResult["tournaments"][number], "viewerJoined"> & { viewerJoined: number };
type DraftRow = Omit<OpenNowResult["drafts"][number], "viewerJoined"> & { viewerJoined: number };

export function createOpenNowService(db: Database.Database): OpenNowService {
  const tournaments = db.prepare<ReadParams, TournamentRow>(`
    select t.web_slug as slug, t.name, t.format,
      (select count(*) from tournament_participants p where p.tournament_id = t.id) as joinedCount,
      exists (select 1 from tournament_participants p where p.tournament_id = t.id and p.player_id = @viewer) as viewerJoined
    from tournaments t
    where t.guild_id = @guild and t.status = 'pending' and t.visibility = 'open' and t.web_slug is not null and t.web_slug != ''
    order by julianday(t.created_at) desc, t.id desc
    limit 5
  `);
  const drafts = db.prepare<ReadParams, DraftRow>(`
    with lobbies as (
      select d.id, d.created_at, d.web_slug as slug, d.name,
        coalesce(json_extract(d.config_json, '$.mode'), 'booster') as mode,
        (select count(*) from draft_players p where p.draft_id = d.id) as seatsTaken,
        exists (select 1 from draft_players p where p.draft_id = d.id and p.player_id = @viewer) as viewerJoined,
        case when json_extract(d.config_json, '$.mode') = 'theme'
          and coalesce(json_extract(d.config_json, '$.uniqueThemes'), 1) != 0
        then (
          select count(*) from cubes c
          where c.guild_id = d.guild_id
            and c.id in (select value from json_each(d.config_json, '$.allowedCubeIds'))
        ) else null end as seatCount
      from drafts d
      where d.guild_id = @guild and d.status = 'pending' and d.visibility = 'open' and d.web_slug is not null and d.web_slug != ''
    )
    select slug, name, mode, seatsTaken, seatCount, viewerJoined from lobbies
    where seatCount is null or seatsTaken < seatCount
    order by julianday(created_at) desc, id desc
    limit 5
  `);
  const live = createLiveNowService(db);

  return {
    forPlayer(guildId, playerId) {
      const params = { guild: guildId, viewer: playerId };
      return {
        tournaments: tournaments.all(params).map((row) => ({ ...row, viewerJoined: Boolean(row.viewerJoined) })),
        drafts: drafts.all(params).map((row) => ({ ...row, viewerJoined: Boolean(row.viewerJoined) })),
        duelsInProgress: live.countInProgress(guildId, playerId, { excludeSeated: true }),
      };
    },
  };
}
