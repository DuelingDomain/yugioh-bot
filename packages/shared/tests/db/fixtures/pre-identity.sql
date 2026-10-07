CREATE TABLE archetypes (
      name text primary key,
      synced_at text not null
    );

CREATE TABLE bug_reports (
      id integer primary key autoincrement,
      guild_id text not null,
      player_id integer not null references players(id),
      created_at text not null,
      path text not null,
      duel_slug text,
      description text not null,
      expected text,
      context_json text not null,
      github_issue_number integer,
      github_issue_url text,
      github_error text,
      -- The open from-app issue this report was added to instead of opening a new one (null for a report with its own issue).
      duplicate_of integer
    );

CREATE TABLE card_artworks (
      card_id integer not null references card_catalog(ygoprodeck_id),
      artwork_id integer primary key references card_catalog(ygoprodeck_id),
      image_url text not null,
      image_url_small text not null,
      image_url_cropped text,
      is_main integer not null check (is_main in (0, 1)),
      source text not null default 'api' check (source in ('api', 'engine'))
    );

CREATE TABLE card_catalog (
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
    , archetype text);

CREATE TABLE card_sets (
      set_name text primary key not null,
      synced_at text not null
    , card_count integer, set_code text);

CREATE TABLE cube_cards (
      cube_id integer not null references cubes(id) on delete cascade,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      pool text not null,
      max_copies integer not null default 3,
      source text,
      primary key (cube_id, catalog_card_id)
    );

CREATE TABLE cubes (
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

CREATE TABLE draft_cards (
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

CREATE TABLE draft_deal (
      draft_id integer not null references drafts(id),
      position integer not null,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      primary key (draft_id, position)
    );

CREATE TABLE draft_packs (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      wave_number integer not null,
      origin_seat_index integer not null,
      current_holder_seat_index integer not null,
      pass_direction integer not null,
      created_at text not null default current_timestamp,
      unique (draft_id, wave_number, origin_seat_index)
    );

CREATE TABLE draft_passes (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      player_id integer not null,
      wave_number integer not null,
      pick_step integer not null,
      passed_at text not null,
      foreign key (draft_id, player_id) references draft_players(draft_id, player_id),
      unique (draft_id, player_id, wave_number, pick_step)
    );

CREATE TABLE draft_picks (
      id integer primary key autoincrement,
      draft_id integer not null references drafts(id),
      player_id integer not null,
      draft_card_id integer not null references draft_cards(id),
      wave_number integer not null,
      pick_step integer not null,
      pick_method text not null default 'manual',
      forced integer not null default 0 check (forced in (0, 1)),
      picked_at text not null,
      foreign key (draft_id, player_id) references draft_players(draft_id, player_id),
      foreign key (draft_card_id, draft_id, wave_number) references draft_cards(id, draft_id, wave_number),
      unique (draft_id, player_id, wave_number, pick_step),
      unique (draft_card_id)
    );

CREATE TABLE draft_player_cube (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      cube_id integer not null references cubes(id),
      primary key (draft_id, player_id)
    );

CREATE TABLE draft_players (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      pick_count integer not null default 0,
      finished_at text,
      seat_index integer,
      joined_at text not null default current_timestamp, deck_saved_at text,
      primary key (draft_id, player_id)
    );

CREATE TABLE draft_undealt (
      draft_id integer not null references drafts(id) on delete cascade,
      position integer not null,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      primary key (draft_id, position)
    );

CREATE TABLE drafts (
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
    , web_slug text, tournament_id integer references tournaments(id), complete_message_id text);

CREATE TABLE duel_commands (
      id integer primary key autoincrement,
      duel_id integer not null references duels(id) on delete cascade,
      seq integer not null,
      seat integer not null,
      command_json text not null,
      created_at text not null default current_timestamp,
      unique (duel_id, seq)
    );

CREATE TABLE duel_invite_grants (
      duel_id integer not null references duels(id) on delete cascade,
      player_id integer not null references players(id),
      created_at text not null default current_timestamp,
      primary key (duel_id, player_id)
    );

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

CREATE TABLE guild_settings (
      guild_id text primary key not null,
      announce_draft_created integer not null default 1,
      announce_draft_started integer not null default 1,
      announce_draft_completed integer not null default 1,
      announce_tournament_created integer not null default 1,
      announce_tournament_completed integer not null default 1,
      announce_channel_id text
    );

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

CREATE TABLE player_achievements (
      guild_id text not null,
      player_id integer not null references players(id),
      achievement_key text not null,
      unlocked_at text not null default current_timestamp,
      primary key (guild_id, player_id, achievement_key)
    );

CREATE TABLE player_ratings (
      guild_id text not null,
      player_id integer not null references players(id),
      elo integer not null default 1000,
      career_winnings integer not null default 0,
      best_streak_alltime integer not null default 0,
      primary key (guild_id, player_id)
    );

CREATE TABLE players (
      id integer primary key autoincrement,
      guild_id text not null,
      discord_user_id text not null,
      display_name text not null,
      created_at text not null default current_timestamp,
      unique (guild_id, discord_user_id)
    );

CREATE TABLE point_awards (
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

CREATE TABLE saved_decks (
      id integer primary key autoincrement,
      guild_id text not null,
      owner_user_id text not null,
      name text not null,
      mode text not null,
      deck_json text not null,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp
    , draft_id integer references drafts(id) on delete set null);

CREATE TABLE season_standings (
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

CREATE TABLE seasons (
      id integer primary key autoincrement,
      guild_id text not null,
      number integer not null,
      name text,
      status text not null,
      started_at text not null default current_timestamp,
      ended_at text,
      created_by_user_id text
    );

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

CREATE TABLE tournament_participants (
      tournament_id integer not null references tournaments(id),
      player_id integer not null references players(id),
      joined_at text not null default current_timestamp, saved_deck_id integer references saved_decks(id) on delete set null, deck_json text, deck_registered_at text, deck_locked_at text,
      primary key (tournament_id, player_id)
    );

CREATE TABLE tournaments (
      id integer primary key autoincrement,
      guild_id text not null,
      name text not null,
      format text not null,
      status text not null,
      created_by_user_id text not null,
      created_at text not null default current_timestamp,
      started_at text,
      ended_at text
    , web_slug text, completed_announced_at text, deadline_at text, report_confirm_window_hours integer, best_of integer not null default 3, duel_rules_json text);

CREATE TABLE waitlist_signups (
      id integer primary key autoincrement,
      email text not null unique,
      created_at text not null,
      source text not null,
      user_agent text
    );

CREATE INDEX bug_reports_duel_idx on bug_reports (guild_id, duel_slug, created_at);

CREATE INDEX bug_reports_player_idx on bug_reports (guild_id, player_id, created_at);

CREATE INDEX card_artworks_card_idx on card_artworks (card_id);

CREATE UNIQUE INDEX card_artworks_main_idx
      on card_artworks (card_id) where is_main = 1;

CREATE INDEX card_catalog_normalized_name_type_idx
      on card_catalog (lower(trim(name)), type);

CREATE INDEX draft_cards_pack_idx
    on draft_cards (draft_pack_id, picked_by_player_id, position);

CREATE INDEX draft_cards_unpicked_by_draft_wave
    on draft_cards (draft_id, wave_number)
    where picked_by_player_id is null;

CREATE INDEX draft_packs_holder_idx
    on draft_packs (draft_id, wave_number, current_holder_seat_index);

CREATE UNIQUE INDEX drafts_current_name_unique
    on drafts (guild_id, name)
    where status in ('pending', 'active');

CREATE INDEX duel_invite_grants_player_idx on duel_invite_grants (player_id);

CREATE INDEX duel_series_between_games_idx on duel_series (next_game_at) where status = 'between_games';

CREATE UNIQUE INDEX duel_series_open_tournament_match_idx
      on duel_series (tournament_match_id)
      where tournament_match_id is not null and status in ('active', 'between_games');

CREATE INDEX duels_archive_due_idx on duels (ended_at) where archived_at is null;

CREATE INDEX duels_guild_archived_created_idx on duels (guild_id, archived_at, created_at);

CREATE INDEX duels_guild_status_idx on duels (guild_id, status);

CREATE UNIQUE INDEX duels_invite_code_idx on duels (invite_code) where invite_code is not null;

CREATE INDEX duels_series_idx on duels (series_id, game_number) where series_id is not null;

CREATE UNIQUE INDEX point_awards_match_unique
      on point_awards (match_id, kind) where match_id is not null;

CREATE UNIQUE INDEX point_awards_placement_unique
      on point_awards (tournament_id, player_id, kind) where kind = 'placement';

CREATE UNIQUE INDEX saved_decks_owner_draft_idx
      on saved_decks (guild_id, owner_user_id, draft_id)
      where draft_id is not null;

CREATE INDEX saved_decks_owner_list_idx on saved_decks (guild_id, owner_user_id, updated_at);

CREATE UNIQUE INDEX seasons_one_active
      on seasons (guild_id) where status = 'active';

CREATE UNIQUE INDEX tournaments_current_name_unique
    on tournaments (guild_id, name)
    where status in ('pending', 'active');

CREATE UNIQUE INDEX tournaments_web_slug_unique
    on tournaments (web_slug)
    where web_slug is not null;
