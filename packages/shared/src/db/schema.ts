import type Database from "better-sqlite3";
import { generateWebSlug } from "../util/web-slug.js";

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.pragma(`table_info(${table})`) as Array<{ name: string }>).some((info) => info.name === column);
}

function addColumnIfMissing(db: Database.Database, table: string, column: string, definition: string) {
  if (!hasColumn(db, table, column)) {
    db.exec(`alter table ${table} add column ${column} ${definition}`);
  }
}

export function migrate(db: Database.Database) {
  db.exec("drop table if exists tournaments_without_name_unique");

  // Cube/theme unification: the legacy theme tables and the draft_templates
  // store are replaced by the unified cubes/cube_cards/draft_player_cube tables
  // below. Data was throwaway test data, so we drop rather than migrate. Drop
  // children before parents. Idempotent: no-op on a fresh database.
  db.exec(`
    drop table if exists draft_player_theme;
    drop table if exists theme_cards;
    drop table if exists themes;
    drop table if exists draft_templates;
  `);

  db.exec(`
    create table if not exists players (
      id integer primary key autoincrement,
      guild_id text not null,
      discord_user_id text not null,
      display_name text not null,
      created_at text not null default current_timestamp,
      unique (guild_id, discord_user_id)
    );

    create table if not exists tournaments (
      id integer primary key autoincrement,
      guild_id text not null,
      name text not null,
      format text not null,
      status text not null,
      created_by_user_id text not null,
      created_at text not null default current_timestamp,
      started_at text,
      ended_at text
    );

    create table if not exists tournament_participants (
      tournament_id integer not null references tournaments(id),
      player_id integer not null references players(id),
      joined_at text not null default current_timestamp,
      primary key (tournament_id, player_id)
    );

    create table if not exists card_catalog (
      ygoprodeck_id integer primary key not null,
      name text not null,
      type text not null,
      frame_type text not null,
      effect_text text,
      atk integer,
      def integer,
      attribute text,
      level integer,
      image_url text not null,
      image_url_small text not null,
      card_sets_json text not null,
      cached_at text not null
    );

    create table if not exists cubes (
      id integer primary key autoincrement,
      guild_id text not null,
      name text not null,
      archetype text,
      banlist text,
      config_json text not null default '{}',
      created_by_user_id text not null,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique (guild_id, name)
    );

    create table if not exists cube_cards (
      cube_id integer not null references cubes(id) on delete cascade,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      pool text not null,
      max_copies integer not null default 3,
      source text,
      primary key (cube_id, catalog_card_id)
    );

    create table if not exists draft_player_cube (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      cube_id integer not null references cubes(id),
      primary key (draft_id, player_id)
    );

    create table if not exists archetypes (
      name text primary key,
      synced_at text not null
    );

    create table if not exists drafts (
      id integer primary key autoincrement,
      guild_id text not null,
      channel_id text not null,
      name text not null,
      status text not null,
      created_by_user_id text not null,
      config_json text not null default '{}',
      current_wave_number integer not null default 0,
      current_pick_step integer not null default 0,
      pick_deadline_at text,
      status_message_id text,
      created_at text not null default current_timestamp,
      started_at text,
      ended_at text
    );

    create table if not exists draft_players (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      pick_count integer not null default 0,
      finished_at text,
      seat_index integer,
      joined_at text not null default current_timestamp,
      primary key (draft_id, player_id)
    );

    create table if not exists draft_packs (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      wave_number integer not null,
      origin_seat_index integer not null,
      current_holder_seat_index integer not null,
      pass_direction integer not null,
      created_at text not null default current_timestamp,
      unique (draft_id, wave_number, origin_seat_index)
    );

    create table if not exists draft_cards (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      wave_number integer not null,
      draft_pack_id integer references draft_packs(id),
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      position integer,
      picked_by_player_id integer,
      picked_at text,
      created_at text not null default current_timestamp,
      foreign key (draft_id, picked_by_player_id) references draft_players(draft_id, player_id),
      unique (id, draft_id, wave_number)
    );

    create table if not exists draft_deal (
      draft_id integer not null references drafts(id),
      position integer not null,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      primary key (draft_id, position)
    );

    create table if not exists draft_picks (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      player_id integer not null,
      draft_card_id integer not null references draft_cards(id),
      wave_number integer not null,
      pick_step integer not null,
      pick_method text not null default 'manual',
      picked_at text not null,
      foreign key (draft_id, player_id) references draft_players(draft_id, player_id),
      foreign key (draft_card_id, draft_id, wave_number) references draft_cards(id, draft_id, wave_number),
      unique (draft_id, player_id, wave_number, pick_step),
      unique (draft_card_id)
    );

    create table if not exists matches (
      id integer primary key autoincrement,
      guild_id text not null,
      player_one_id integer not null references players(id),
      player_two_id integer not null references players(id),
      winner_id integer references players(id),
      reporter_id integer not null references players(id),
      approver_id integer references players(id),
      status text not null,
      source text not null,
      tournament_id integer references tournaments(id),
      created_at text not null default current_timestamp,
      resolved_at text
    );

    create table if not exists tournament_matches (
      id integer primary key autoincrement,
      tournament_id integer not null references tournaments(id),
      match_id integer references matches(id),
      player_one_id integer not null references players(id),
      player_two_id integer references players(id),
      round_number integer not null,
      status text not null,
      metadata_json text not null default '{}'
    );

    create table if not exists card_sets (
      set_name text primary key not null,
      synced_at text not null
    );
  `);

  const tournamentSchema = db
    .prepare("select sql from sqlite_master where type = 'table' and name = 'tournaments'")
    .get() as { sql: string } | undefined;

  if (tournamentSchema?.sql.includes("unique (guild_id, name)")) {
    const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;

    try {
      db.pragma("foreign_keys = off");
      db.exec(`
        begin;

        create table tournaments_without_name_unique (
          id integer primary key autoincrement,
          guild_id text not null,
          name text not null,
          format text not null,
          status text not null,
          created_by_user_id text not null,
          created_at text not null default current_timestamp,
          started_at text,
          ended_at text
        );

        insert into tournaments_without_name_unique (
          id,
          guild_id,
          name,
          format,
          status,
          created_by_user_id,
          created_at,
          started_at,
          ended_at
        )
        select
          id,
          guild_id,
          name,
          format,
          status,
          created_by_user_id,
          created_at,
          started_at,
          ended_at
        from tournaments;

        drop table tournaments;
        alter table tournaments_without_name_unique rename to tournaments;

        commit;
      `);
    } catch (error) {
      db.exec("rollback;");
      throw error;
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    }
  }

  addColumnIfMissing(db, "drafts", "pick_deadline_at", "text");
  addColumnIfMissing(db, "drafts", "status_message_id", "text");
  addColumnIfMissing(db, "drafts", "web_slug", "text");
  addColumnIfMissing(db, "tournaments", "web_slug", "text");
  const slugless = db
    .prepare("select id from tournaments where web_slug is null")
    .all() as Array<{ id: number }>;
  if (slugless.length > 0) {
    const update = db.prepare("update tournaments set web_slug = ? where id = ?");
    for (const { id } of slugless) {
      update.run(generateWebSlug(), id);
    }
  }
  addColumnIfMissing(db, "draft_players", "seat_index", "integer");
  addColumnIfMissing(db, "draft_cards", "draft_pack_id", "integer references draft_packs(id)");
  addColumnIfMissing(db, "draft_cards", "position", "integer");
  addColumnIfMissing(db, "draft_picks", "pick_method", "text not null default 'manual'");
  addColumnIfMissing(db, "card_catalog", "effect_text", "text");
  addColumnIfMissing(db, "card_catalog", "atk", "integer");
  addColumnIfMissing(db, "card_catalog", "def", "integer");
  addColumnIfMissing(db, "card_catalog", "attribute", "text");
  addColumnIfMissing(db, "card_catalog", "level", "integer");
  addColumnIfMissing(db, "card_catalog", "archetype", "text");
  addColumnIfMissing(db, "card_sets", "card_count", "integer");
  addColumnIfMissing(db, "card_sets", "set_code", "text");
  addColumnIfMissing(db, "drafts", "tournament_id", "integer references tournaments(id)");
  addColumnIfMissing(db, "drafts", "complete_message_id", "text");
  addColumnIfMissing(db, "matches", "notify_channel_id", "text");
  addColumnIfMissing(db, "matches", "notify_message_id", "text");
  addColumnIfMissing(db, "tournaments", "completed_announced_at", "text");
  addColumnIfMissing(db, "tournaments", "deadline_at", "text");
  addColumnIfMissing(db, "tournaments", "report_confirm_window_hours", "integer");

  // Rename: draft_cube -> draft_deal (copy rows then drop; idempotent)
  const hasLegacyCube = db
    .prepare("select 1 from sqlite_master where type='table' and name='draft_cube'")
    .get();
  if (hasLegacyCube) {
    const foreignKeys = db.pragma("foreign_keys", { simple: true }) as number;
    try {
      db.pragma("foreign_keys = off");
      db.exec(`
        insert into draft_deal (draft_id, position, catalog_card_id)
          select draft_id, position, catalog_card_id from draft_cube;
        drop table draft_cube;
      `);
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? "on" : "off"}`);
    }
  }

  // Rename: draft_packs.pack_round -> wave_number (idempotent)
  const packCols = db.prepare("pragma table_info(draft_packs)").all() as Array<{ name: string }>;
  const hasPackRound = packCols.some((c) => c.name === "pack_round");
  const hasWaveNumber = packCols.some((c) => c.name === "wave_number");
  if (hasPackRound && !hasWaveNumber) {
    db.exec("alter table draft_packs rename column pack_round to wave_number");
  }

  db.exec(`
    create unique index if not exists tournaments_current_name_unique
    on tournaments (guild_id, name)
    where status in ('pending', 'active');

    create unique index if not exists tournaments_web_slug_unique
    on tournaments (web_slug)
    where web_slug is not null;

    create unique index if not exists drafts_current_name_unique
    on drafts (guild_id, name)
    where status in ('pending', 'active');

    create index if not exists draft_cards_unpicked_by_draft_wave
    on draft_cards (draft_id, wave_number)
    where picked_by_player_id is null;

    create index if not exists draft_packs_holder_idx
    on draft_packs (draft_id, wave_number, current_holder_seat_index);

    create index if not exists draft_cards_pack_idx
    on draft_cards (draft_pack_id, picked_by_player_id, position);
  `);

  db.exec(`
    create table if not exists guild_settings (
      guild_id text primary key not null,
      announce_draft_created integer not null default 1,
      announce_draft_started integer not null default 1,
      announce_draft_completed integer not null default 1,
      announce_tournament_created integer not null default 1,
      announce_tournament_completed integer not null default 1,
      announce_channel_id text
    );
  `);

  db.exec(`
    create table if not exists seasons (
      id integer primary key autoincrement,
      guild_id text not null,
      number integer not null,
      name text,
      status text not null,
      started_at text not null default current_timestamp,
      ended_at text,
      created_by_user_id text
    );

    create unique index if not exists seasons_one_active
      on seasons (guild_id) where status = 'active';

    create table if not exists player_ratings (
      guild_id text not null,
      player_id integer not null references players(id),
      elo integer not null default 1000,
      career_winnings integer not null default 0,
      best_streak_alltime integer not null default 0,
      primary key (guild_id, player_id)
    );

    create table if not exists point_awards (
      id integer primary key autoincrement,
      guild_id text not null,
      season_id integer not null references seasons(id),
      player_id integer not null references players(id),
      kind text not null,                 -- 'match_win' | 'placement'
      placement text,                     -- 'champion' | 'runnerUp' | 'top4' (placement awards only)
      match_id integer references matches(id),
      tournament_id integer references tournaments(id),
      points integer not null,
      opponent_elo integer,
      size_multiplier real,
      created_at text not null default current_timestamp
    );

    create unique index if not exists point_awards_match_unique
      on point_awards (match_id, kind) where match_id is not null;

    create unique index if not exists point_awards_placement_unique
      on point_awards (tournament_id, player_id, kind) where kind = 'placement';

    create table if not exists season_standings (
      guild_id text not null,
      season_id integer not null references seasons(id),
      player_id integer not null references players(id),
      winnings integer not null default 0,
      wins integer not null default 0,
      losses integer not null default 0,
      current_streak integer not null default 0,
      best_streak integer not null default 0,
      primary key (season_id, player_id)
    );

    create table if not exists player_achievements (
      guild_id text not null,
      player_id integer not null references players(id),
      achievement_key text not null,
      unlocked_at text not null default current_timestamp,
      primary key (guild_id, player_id, achievement_key)
    );
  `);

  // Backfill tournament_id on match-win awards whose match belongs to a
  // tournament. Idempotent: the `tournament_id is null` guard means already
  // stamped rows are skipped, so this is safe to run on every startup.
  db.exec(`
    update point_awards
    set tournament_id = (
      select tm.tournament_id from tournament_matches tm where tm.match_id = point_awards.match_id
    )
    where kind = 'match_win'
      and tournament_id is null
      and match_id is not null
      and exists (select 1 from tournament_matches tm where tm.match_id = point_awards.match_id);
  `);

  db.exec(`
    create table if not exists duels (
      id integer primary key autoincrement,
      guild_id text not null,
      web_slug text not null unique,
      name text not null,
      organizer_player_id integer not null references players(id),
      mode text not null,
      master_rule integer not null default 5,
      status text not null,
      seed_json text,
      bundle_version text,
      created_at text not null default current_timestamp,
      ended_at text,
      archived_at text,
      last_activity_at text,
      winner_player_id integer references players(id),
      winner_seat integer,
      result_reason text,
      snapshot_public_json text,
      snapshot_seat0_json text,
      snapshot_seat1_json text
    );

    create table if not exists duel_seats (
      duel_id integer not null references duels(id) on delete cascade,
      seat integer not null,
      player_id integer references players(id),
      is_bot integer not null default 0,
      ready integer not null default 0,
      deck_json text,
      primary key (duel_id, seat),
      unique (duel_id, player_id),
      check ((is_bot = 0 and player_id is not null) or (is_bot = 1 and player_id is null))
    );

    create table if not exists duel_commands (
      id integer primary key autoincrement,
      duel_id integer not null references duels(id) on delete cascade,
      seq integer not null,
      seat integer not null,
      command_json text not null,
      created_at text not null default current_timestamp,
      unique (duel_id, seq)
    );

    create index if not exists duels_guild_status_idx on duels (guild_id, status);
  `);

  addColumnIfMissing(db, "duels", "winner_seat", "integer");
  addColumnIfMissing(db, "duels", "archived_at", "text");
  addColumnIfMissing(db, "duels", "last_activity_at", "text");
  addColumnIfMissing(db, "duels", "snapshot_public_json", "text");
  addColumnIfMissing(db, "duels", "snapshot_seat0_json", "text");
  addColumnIfMissing(db, "duels", "snapshot_seat1_json", "text");
  addColumnIfMissing(db, "duels", "master_rule", "integer not null default 5");
  addColumnIfMissing(db, "duels", "settings_json", "text");
  addColumnIfMissing(db, "duels", "clock_json", "text");
  addColumnIfMissing(db, "duels", "invite_code", "text");
  addColumnIfMissing(db, "duels", "format", "text not null default '1v1'");
  addColumnIfMissing(db, "duels", "snapshot_seats_json", "text");
  addColumnIfMissing(db, "duels", "setup_json", "text");

  db.transaction(() => {
    const seatInfo = db.prepare<[], { name: string; notnull: number }>("pragma table_info(duel_seats)").all();
    const playerCol = seatInfo.find((column) => column.name === "player_id");
    const hasBotCol = seatInfo.some((column) => column.name === "is_bot");
    if (playerCol && (!hasBotCol || playerCol.notnull === 1)) {
      db.exec(`
        create table duel_seats_bot (
          duel_id integer not null references duels(id) on delete cascade,
          seat integer not null,
          player_id integer references players(id),
          is_bot integer not null default 0,
          ready integer not null default 0,
          deck_json text,
          primary key (duel_id, seat),
          unique (duel_id, player_id),
          check ((is_bot = 0 and player_id is not null) or (is_bot = 1 and player_id is null))
        );
        insert into duel_seats_bot (duel_id, seat, player_id, is_bot, ready, deck_json)
          select duel_id, seat, player_id, 0, ready, deck_json from duel_seats;
        drop table duel_seats;
        alter table duel_seats_bot rename to duel_seats;
      `);
    }
  }).immediate();

  db.exec(`
    create index if not exists duels_guild_archived_created_idx on duels (guild_id, archived_at, created_at);
    create index if not exists duels_archive_due_idx on duels (ended_at) where archived_at is null;
    create table if not exists duel_invite_grants (
      duel_id integer not null references duels(id) on delete cascade,
      player_id integer not null references players(id),
      created_at text not null default current_timestamp,
      primary key (duel_id, player_id)
    );
    create index if not exists duel_invite_grants_player_idx on duel_invite_grants (player_id);
    create unique index if not exists duels_invite_code_idx on duels (invite_code) where invite_code is not null;

    update duels
    set winner_seat = (
      select s.seat from duel_seats s
      where s.duel_id = duels.id and s.player_id = duels.winner_player_id
    )
    where winner_player_id is not null and winner_seat is null;
  `);

  db.exec(`
    create table if not exists saved_decks (
      id integer primary key autoincrement,
      guild_id text not null,
      owner_user_id text not null,
      name text not null,
      mode text not null,
      deck_json text not null,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    );
    create index if not exists saved_decks_owner_list_idx on saved_decks (guild_id, owner_user_id, updated_at);
  `);
}
