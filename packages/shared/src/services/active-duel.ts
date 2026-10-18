import type Database from "better-sqlite3";
import type { DuelFormat } from "../duels/settings.js";
import { duelSeriesTournamentReadScope } from "./tournament-read-scope.js";

export interface ActiveDuel {
  slug: string;
  state: "lobby" | "playing";
  role: "host" | "guest";
  format: DuelFormat;
}

export interface ActiveDuelService {
  /** One metadata query; an unfinished match keeps its latest game as the destination. */
  forPlayer(guildId: string, playerId: number): ActiveDuel | null;
}

export function createActiveDuelService(db: Database.Database): ActiveDuelService {
  const select = db.prepare<{ guild: string; viewer: number }, ActiveDuel>(`
    select d.web_slug as slug, d.format,
      case when d.status = 'active' or d.opening_json is not null or d.started_at is not null
        or s.status = 'between_games' or d.game_number > 1 then 'playing' else 'lobby' end as state,
      case when d.organizer_player_id = @viewer then 'host' else 'guest' end as role
    from duel_seats me
    join players viewer on viewer.id = me.player_id and viewer.guild_id = @guild
    join duels d on d.id = me.duel_id and d.guild_id = @guild
    left join duel_series s on s.id = d.series_id and s.guild_id = @guild
    where me.player_id = @viewer and me.is_bot = 0 and d.kind = 'play'
      and ${duelSeriesTournamentReadScope("d.series_id", "viewer.user_id")}
      and (d.status = 'active' or d.series_id is null or (
        s.status in ('active', 'between_games')
        and d.id = (select latest.id from duels latest where latest.series_id = s.id
          order by latest.game_number desc, latest.id desc limit 1)
      ))
      and (d.status in ('lobby', 'active')
        or (s.status = 'between_games' and d.status in ('completed', 'interrupted')))
      and not exists (
        select 1 from json_each(d.setup_json, '$.surrenderedSeats') gone where gone.value = me.seat
          and not exists (
            select 1 from duel_commands c where c.duel_id = d.id and c.seat = me.seat
              and json_extract(c.command_json, '$.promptId') glob 'eliminate-eot:*'
          )
      )
      and not exists (
        select 1 from json_each(d.setup_json, '$.eliminatedSeats') gone where gone.value = me.seat
      )
      and not exists (
        select 1 from duel_commands c where c.duel_id = d.id and c.seat = me.seat
          and json_extract(c.command_json, '$.promptId') glob 'eliminate:*'
      )
    order by state desc, julianday(d.created_at) desc, d.id desc
    limit 1
  `);
  return { forPlayer: (guildId, playerId) => select.get({ guild: guildId, viewer: playerId }) ?? null };
}
