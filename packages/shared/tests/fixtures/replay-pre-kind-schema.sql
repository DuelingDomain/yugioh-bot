-- Synthetic pre-replay local Discord schema.
-- Duel/history tables, local player identity, FK dependencies and indexes. No data.

CREATE TABLE matches (
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
    , notify_channel_id text, notify_message_id text);

CREATE TABLE tournament_matches (
      id integer primary key autoincrement,
      tournament_id integer not null references tournaments(id),
      match_id integer references matches(id),
      player_one_id integer not null references players(id),
      player_two_id integer references players(id),
      round_number integer not null,
      status text not null,
      metadata_json text not null default '{}'
    );

CREATE TABLE duels (
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
    , settings_json text, clock_json text, invite_code text, format text not null default '1v1', snapshot_seats_json text, setup_json text, series_id integer references duel_series(id), game_number integer, best_of integer not null default 1, ranked integer not null default 0, opening_json text);

CREATE TABLE duel_seats (
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

CREATE TABLE duel_commands (
      id integer primary key autoincrement,
      duel_id integer not null references duels(id) on delete cascade,
      seq integer not null,
      seat integer not null,
      command_json text not null,
      created_at text not null default current_timestamp,
      unique (duel_id, seq)
    );

CREATE INDEX duels_guild_status_idx on duels (guild_id, status);

CREATE INDEX duels_guild_archived_created_idx on duels (guild_id, archived_at, created_at);

CREATE INDEX duels_archive_due_idx on duels (ended_at) where archived_at is null;

CREATE UNIQUE INDEX duels_invite_code_idx on duels (invite_code) where invite_code is not null;

CREATE TABLE duel_series (
      id integer primary key autoincrement,
      guild_id text not null,
      best_of integer not null default 1,
      ranked integer not null default 0,
      player0_id integer not null references players(id),
      player1_id integer not null references players(id),
      wins0 integer not null default 0,
      wins1 integer not null default 0,
      status text not null default 'active',
      winner_player_id integer references players(id),
      tournament_match_id integer references tournament_matches(id),
      match_id integer references matches(id),
      mode text not null,
      master_rule integer not null default 5,
      settings_json text not null,
      base_deck0_json text,
      base_deck1_json text,
      deck0_json text,
      deck1_json text,
      side_ready0 integer not null default 0,
      side_ready1 integer not null default 0,
      next_game_at text,
      created_by_player_id integer not null references players(id),
      created_at text not null default current_timestamp,
      ended_at text, first_chooser integer, first_choice text, vs_bot integer not null default 0,
      check (best_of in (1, 3)),
      check (status in ('active', 'between_games', 'completed', 'cancelled'))
    );

CREATE UNIQUE INDEX duel_series_open_tournament_match_idx
      on duel_series (tournament_match_id)
      where tournament_match_id is not null and status in ('active', 'between_games');

CREATE INDEX duel_series_between_games_idx on duel_series (next_game_at) where status = 'between_games';

CREATE INDEX duels_series_idx on duels (series_id, game_number) where series_id is not null;



CREATE TABLE players (
  id integer primary key autoincrement,
  guild_id text not null,
  discord_user_id text not null,
  display_name text not null,
  created_at text not null default current_timestamp,
  unique(guild_id,discord_user_id)
);

CREATE TABLE "tournaments" (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, format text not null, status text not null,
  created_by_user_id text not null,
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, completed_announced_at text, deadline_at text,
  report_confirm_window_hours integer, best_of integer not null default 3, duel_rules_json text
, visibility text not null default 'private' check (visibility in ('open', 'private')), invite_code text);

CREATE TABLE "cubes" (
  id integer primary key autoincrement,
  guild_id text not null, name text not null, archetype text, banlist text,
  config_json text not null default '{}',
  created_by_user_id text not null,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  unique (guild_id, name)
);

CREATE TABLE "drafts" (
  id integer primary key autoincrement,
  guild_id text not null, channel_id text, name text not null, status text not null,
  created_by_user_id text not null,
  config_json text not null default '{}',
  current_wave_number integer not null default 0, current_pick_step integer not null default 0,
  pick_deadline_at text, status_message_id text,
  created_at text not null default current_timestamp, started_at text, ended_at text,
  web_slug text, tournament_id integer references tournaments(id), complete_message_id text,
  lobby_revision integer not null default 0, lobby_auto_start integer not null default 0,
  lobby_auto_held integer not null default 0, lobby_start_at text, lobby_start_kind text,
  lobby_start_token text, lobby_start_revision integer, lobby_start_setup_hash text,
  lobby_start_force integer not null default 0, lobby_start_error text, lobby_nudged_at text
, visibility text not null default 'private' check (visibility in ('open', 'private')), invite_code text);

CREATE TABLE "seasons" (
  id integer primary key autoincrement,
  guild_id text not null, number integer not null, name text, status text not null,
  started_at text not null default current_timestamp, ended_at text,
  created_by_user_id text
);

CREATE TABLE "saved_decks" (
  id integer primary key autoincrement,
  guild_id text not null,
  owner_user_id text not null,
  name text not null, mode text not null, deck_json text not null,
  created_at text not null default current_timestamp,
  updated_at text not null default current_timestamp,
  draft_id integer references drafts(id) on delete set null
);


CREATE UNIQUE INDEX tournaments_web_slug_unique
  on tournaments(web_slug) where web_slug is not null;

CREATE INDEX tournaments_creator_idx on tournaments(created_by_user_id);

CREATE INDEX cubes_creator_idx on cubes(created_by_user_id);

CREATE INDEX drafts_creator_idx on drafts(created_by_user_id);

CREATE UNIQUE INDEX seasons_one_active on seasons(guild_id) where status = 'active';

CREATE INDEX seasons_creator_idx on seasons(created_by_user_id);

CREATE INDEX saved_decks_owner_list_idx on saved_decks(guild_id, owner_user_id, updated_at);

CREATE UNIQUE INDEX saved_decks_owner_draft_idx
  on saved_decks(guild_id, owner_user_id, draft_id) where draft_id is not null;

CREATE UNIQUE INDEX drafts_web_slug_unique on drafts(web_slug) where web_slug is not null;

CREATE INDEX drafts_guild_status_created_idx on drafts(guild_id, status, created_at);

CREATE INDEX tournaments_guild_status_created_idx on tournaments(guild_id, status, created_at);

CREATE UNIQUE INDEX drafts_invite_code_unique
        on drafts(invite_code) where invite_code is not null;

CREATE UNIQUE INDEX tournaments_invite_code_unique
        on tournaments(invite_code) where invite_code is not null;

CREATE UNIQUE INDEX tournaments_current_host_name_unique
        on tournaments(guild_id, created_by_user_id, name) where status in ('pending', 'active');

CREATE UNIQUE INDEX drafts_current_host_name_unique
        on drafts(guild_id, created_by_user_id, name) where status in ('pending', 'active');
