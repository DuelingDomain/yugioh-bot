import { seedIdentity, seedUser } from "../helpers/identity.js";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";

function getTableInfo(db: Database.Database, tableName: string) {
  return db.prepare(`pragma table_info(${tableName})`).all() as Array<{
    name: string;
    notnull: number;
    pk: number;
  }>;
}

describe("shared database schema", () => {
  it("adds a reusable expression index used by the held-copy artwork join", () => {
    const db = new Database(":memory:");
    try {
      migrate(db);
      db.exec("drop index if exists card_catalog_normalized_name_type_idx");
      migrate(db);
      migrate(db);

      const plan = db.prepare(`
        explain query plan
        select coalesce(art.ygoprodeck_id, dc.catalog_card_id) as catalog_card_id, count(*) as n
        from draft_picks pk
        inner join draft_cards dc on dc.id = pk.draft_card_id
        left join card_catalog picked on picked.ygoprodeck_id = dc.catalog_card_id
        left join card_catalog art on lower(trim(art.name)) = lower(trim(picked.name)) and art.type = picked.type
        where pk.draft_id = ? and pk.player_id = ?
        group by coalesce(art.ygoprodeck_id, dc.catalog_card_id)
      `).all(1, 1) as Array<{ detail: string }>;
      expect(plan.map((row) => row.detail)).toContainEqual(
        expect.stringMatching(/SEARCH art USING (?:COVERING )?INDEX card_catalog_normalized_name_type_idx \(<expr>=\? AND type=\?\)/),
      );
    } finally { db.close(); }
  });

  it("creates draft tables with the approved column shapes", () => {
    const db = new Database(":memory:");

    migrate(db);

    expect(getTableInfo(db, "drafts").map((column) => column.name)).toEqual([
      "id",
      "guild_id",
      "channel_id",
      "name",
      "status",
      "created_by_user_id",
      "config_json",
      "current_wave_number",
      "current_pick_step",
      "pick_deadline_at",
      "status_message_id",
      "created_at",
      "started_at",
      "ended_at",
      "web_slug",
      "lobby_revision",
      "lobby_auto_start",
      "lobby_auto_held",
      "lobby_start_at",
      "lobby_start_kind",
      "lobby_start_token",
      "lobby_start_revision",
      "lobby_start_setup_hash",
      "lobby_start_force",
      "lobby_start_error",
      "lobby_nudged_at",
      "tournament_id",
      "complete_message_id",
    ]);
    expect(getTableInfo(db, "draft_players").map((column) => column.name)).toEqual([
      "draft_id",
      "player_id",
      "pick_count",
      "finished_at",
      "seat_index",
      "joined_at",
      "deck_saved_at",
      "ready_at",
      "ready_setup_hash",
    ]);
    expect(getTableInfo(db, "draft_cards").map((column) => column.name)).toEqual([
      "id",
      "draft_id",
      "wave_number",
      "draft_pack_id",
      "catalog_card_id",
      "position",
      "picked_by_player_id",
      "picked_at",
      "created_at",
    ]);
    expect(getTableInfo(db, "draft_packs").map((column) => column.name)).toEqual([
      "id",
      "draft_id",
      "wave_number",
      "origin_seat_index",
      "current_holder_seat_index",
      "pass_direction",
      "created_at",
    ]);
    expect(getTableInfo(db, "draft_picks").map((column) => column.name)).toEqual([
      "id",
      "draft_id",
      "player_id",
      "draft_card_id",
      "wave_number",
      "pick_step",
      "pick_method",
      "forced",
      "picked_at",
    ]);
    expect(getTableInfo(db, "draft_passes").map((column) => column.name)).toEqual([
      "id",
      "draft_id",
      "player_id",
      "wave_number",
      "pick_step",
      "passed_at",
    ]);
    expect(getTableInfo(db, "card_catalog").map((column) => column.name)).toEqual([
      "ygoprodeck_id",
      "name",
      "type",
      "frame_type",
      "effect_text",
      "atk",
      "def",
      "attribute",
      "level",
      "image_url",
      "image_url_small",
      "card_sets_json",
      "cached_at",
      "archetype",
    ]);
  });

  it("adds an archetype column to card_catalog", () => {
    const db = new Database(":memory:");
    migrate(db);
    const cols = getTableInfo(db, "card_catalog").map((column) => column.name);
    expect(cols).toContain("archetype");
  });

  it("creates cube tables", () => {
    const db = new Database(":memory:");
    migrate(db);
    const tables = (
      db.prepare("select name from sqlite_master where type='table'").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["cubes", "cube_cards", "draft_player_cube", "archetypes"]),
    );
    expect(tables).not.toContain("themes");
    expect(tables).not.toContain("draft_templates");
  });

  it("enforces the cube_cards primary key and pool", () => {
    const db = new Database(":memory:");
    migrate(db);
    db.prepare(
      "insert into cubes (guild_id, name, created_by_user_id, created_at, updated_at) values ('g','Blue-Eyes',?,'t','t')",
    ).run(seedUser(db, "u").userId);
    db.prepare(
      "insert into card_catalog (ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values (1,'a','t','normal','i','i','[]','t')",
    ).run();
    db.prepare(
      "insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1,1,'main',3)",
    ).run();
    expect(() =>
      db
        .prepare("insert into cube_cards (cube_id, catalog_card_id, pool, max_copies) values (1,1,'main',3)")
        .run(),
    ).toThrow();
  });

  it("adds the card_sets table when migrating an older database", () => {
    const db = new Database(":memory:");

    db.exec(`
      create table players (
        id integer primary key autoincrement,
        guild_id text not null,
        discord_user_id text not null,
        display_name text not null,
        created_at text not null default current_timestamp,
        unique (guild_id, discord_user_id)
      );

      create table tournaments (
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

      create table tournament_participants (
        tournament_id integer not null references tournaments(id),
        player_id integer not null references players(id),
        joined_at text not null default current_timestamp,
        primary key (tournament_id, player_id)
      );

      create table card_catalog (
        ygoprodeck_id integer primary key not null,
        name text not null,
        type text not null,
        frame_type text not null,
        image_url text not null,
        image_url_small text not null,
        card_sets_json text not null,
        cached_at text not null
      );

      create table drafts (
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

      create table draft_players (
        draft_id integer not null references drafts(id),
        player_id integer not null references players(id),
        pick_count integer not null default 0,
        finished_at text,
        seat_index integer,
        joined_at text not null default current_timestamp,
        primary key (draft_id, player_id)
      );

      create table draft_packs (
        id integer primary key autoincrement,
        draft_id integer not null references drafts(id),
        pack_round integer not null,
        origin_seat_index integer not null,
        current_holder_seat_index integer not null,
        pass_direction integer not null,
        created_at text not null default current_timestamp,
        unique (draft_id, pack_round, origin_seat_index)
      );

      create table draft_cards (
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

      create table draft_picks (
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

      create table matches (
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

      create table tournament_matches (
        id integer primary key autoincrement,
        tournament_id integer not null references tournaments(id),
        match_id integer references matches(id),
        player_one_id integer not null references players(id),
        player_two_id integer references players(id),
        round_number integer not null,
        status text not null,
        metadata_json text not null default '{}'
      );
    `);

    migrate(db);

    const cardSetsRow = db
      .prepare("select name from sqlite_master where type = 'table' and name = 'card_sets'")
      .get() as { name: string } | undefined;

    expect(cardSetsRow?.name).toBe("card_sets");
    expect(getTableInfo(db, "card_sets").map((column) => column.name)).toEqual([
      "set_name",
      "synced_at",
      "card_count",
      "set_code",
      "release_date",
    ]);
    expect(getTableInfo(db, "card_catalog").map((column) => column.name)).toEqual([
      "ygoprodeck_id",
      "name",
      "type",
      "frame_type",
      "image_url",
      "image_url_small",
      "card_sets_json",
      "cached_at",
      "effect_text",
      "atk",
      "def",
      "attribute",
      "level",
      "archetype",
    ]);
  });

  it("creates tournaments table with completed_announced_at column", () => {
    const db = new Database(":memory:");

    migrate(db);

    expect(getTableInfo(db, "tournaments").map((column) => column.name)).toContain(
      "completed_announced_at",
    );
  });

  it("adds tournament timing columns", () => {
    const db = new Database(":memory:");

    migrate(db);

    const cols = getTableInfo(db, "tournaments").map((column) => column.name);
    expect(cols).toContain("deadline_at");
    expect(cols).toContain("report_confirm_window_hours");

    db.close();
  });

  it("migrates a legacy draft_cube table to draft_deal, preserving rows", () => {
    const db = new Database(":memory:");
    // minimal legacy shape
    db.exec(readFileSync(new URL("./fixtures/pre-identity.sql", import.meta.url), "utf8"));
    db.exec("insert into drafts(id,guild_id,channel_id,name,status,created_by_user_id) values(1,'g','c','Legacy','pending','900000000000000101'); insert into card_catalog(ygoprodeck_id,name,type,frame_type,image_url,image_url_small,card_sets_json,cached_at) values(1001,'A','Spell Card','spell','','','[]','t'),(1002,'B','Spell Card','spell','','','[]','t')");
    db.exec(`
      create table draft_cube (draft_id integer not null, position integer not null,
        catalog_card_id integer not null, primary key (draft_id, position));
      insert into draft_cube (draft_id, position, catalog_card_id) values (1, 0, 1001), (1, 1, 1002);
    `);
    migrate(db);
    const rows = db.prepare("select position, catalog_card_id from draft_deal where draft_id = 1 order by position").all();
    expect(rows).toEqual([
      { position: 0, catalog_card_id: 1001 },
      { position: 1, catalog_card_id: 1002 },
    ]);
    const oldGone = db.prepare("select 1 from sqlite_master where type='table' and name='draft_cube'").get();
    expect(oldGone).toBeUndefined();
  });

  it("renames legacy draft_packs.pack_round to wave_number, preserving rows", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table draft_packs (id integer primary key autoincrement, draft_id integer not null,
        pack_round integer not null, origin_seat_index integer not null,
        current_holder_seat_index integer not null, pass_direction integer not null);
      insert into draft_packs (draft_id, pack_round, origin_seat_index, current_holder_seat_index, pass_direction)
        values (1, 2, 0, 0, 1);
    `);
    migrate(db);
    const row = db.prepare("select wave_number from draft_packs where draft_id = 1").get();
    expect(row).toEqual({ wave_number: 2 });
  });

  it("backfills web_slug for tournaments that pre-date the column", () => {
    const db = new Database(":memory:");
    // Simulate legacy schema without web_slug
    db.exec(`
      create table tournaments (
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
    `);
    db.prepare(
      "insert into tournaments (guild_id, name, format, status, created_by_user_id) values (?, ?, ?, ?, ?)",
    ).run("g1", "old-event", "round_robin", "completed", "900000000000000101");

    migrate(db);

    const row = db
      .prepare("select web_slug from tournaments where name = ?")
      .get("old-event") as { web_slug: string | null };
    expect(row.web_slug).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("migrate backfills match-win tournament_id", () => {
  it("sets tournament_id on legacy match_win awards that belong to a tournament match", () => {
    const db = new Database(":memory:");
    migrate(db);
    const guild = "g1";
    const seasonId = Number(
      db.prepare("insert into seasons (guild_id, number, status) values (?, 1, 'active')").run(guild).lastInsertRowid,
    );
    const p1 = Number(
      seedIdentity(db, { guildId: guild, userId: 101, playerId: 1, discordUserId: "900000000000000101", name: "A" }).playerId,
    );
    const p2 = Number(
      seedIdentity(db, { guildId: guild, userId: 102, playerId: 2, discordUserId: "900000000000000102", name: "B" }).playerId,
    );
    const matchId = Number(
      db
        .prepare(
          "insert into matches (guild_id, player_one_id, player_two_id, winner_id, reporter_id, status, source) values (?, ?, ?, ?, ?, 'approved', 'tournament')",
        )
        .run(guild, p1, p2, p1, p1).lastInsertRowid,
    );
    const tournamentId = Number(
      db
        .prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) values (?, 'Cup', 'round_robin', 'completed', ?)")
        .run(guild, seedUser(db, "host").userId).lastInsertRowid,
    );
    db.prepare(
      "insert into tournament_matches (tournament_id, match_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, ?, 1, 'completed')",
    ).run(tournamentId, matchId, p1, p2);
    // Legacy award written before tournament_id was stamped.
    db.prepare(
      "insert into point_awards (guild_id, season_id, player_id, kind, match_id, points) values (?, ?, ?, 'match_win', ?, 5)",
    ).run(guild, seasonId, p1, matchId);

    migrate(db); // re-run: the idempotent backfill runs every startup

    const award = db.prepare("select tournament_id from point_awards where match_id = ?").get(matchId) as {
      tournament_id: number | null;
    };
    expect(award.tournament_id).toBe(tournamentId);
  });
});

describe("duel bot seat migration", () => {
  it("rebuilds existing seats as nullable humans and backfills winner_seat", () => {
    const db = new Database(":memory:");
    db.exec(`
      create table players (
        id integer primary key autoincrement,
        guild_id text not null,
        discord_user_id text not null,
        display_name text not null,
        created_at text not null default current_timestamp,
        unique (guild_id, discord_user_id)
      );
      create table duels (
        id integer primary key autoincrement,
        guild_id text not null,
        web_slug text not null unique,
        name text not null,
        organizer_player_id integer not null references players(id),
        mode text not null,
        status text not null,
        seed_json text,
        bundle_version text,
        created_at text not null default current_timestamp,
        ended_at text,
        winner_player_id integer references players(id),
        result_reason text
      );
      create table duel_seats (
        duel_id integer not null references duels(id) on delete cascade,
        seat integer not null,
        player_id integer not null references players(id),
        ready integer not null default 0,
        deck_json text,
        primary key (duel_id, seat),
        unique (duel_id, player_id)
      );
      create table duel_commands (
        id integer primary key autoincrement,
        duel_id integer not null references duels(id) on delete cascade,
        seq integer not null,
        seat integer not null,
        command_json text not null,
        created_at text not null default current_timestamp,
        unique (duel_id, seq)
      );
    `);

    const p1 = Number(
      db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', '900000000000000101', 'Yugi')").run()
        .lastInsertRowid,
    );
    const p2 = Number(
      db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', '900000000000000102', 'Kaiba')").run()
        .lastInsertRowid,
    );
    const duelId = Number(
      db
        .prepare(
          "insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status, winner_player_id, result_reason) values ('g1', 'oldduel1', 'Old', ?, 'normal', 'completed', ?, 'life points')",
        )
        .run(p1, p2).lastInsertRowid,
    );
    db.prepare("insert into duel_seats (duel_id, seat, player_id, ready, deck_json) values (?, 0, ?, 1, ?)").run(
      duelId,
      p1,
      JSON.stringify({ main: [1], extra: [], side: [] }),
    );
    db.prepare("insert into duel_seats (duel_id, seat, player_id, ready, deck_json) values (?, 1, ?, 1, ?)").run(
      duelId,
      p2,
      JSON.stringify({ main: [2], extra: [], side: [] }),
    );
    db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) values (?, 1, 0, ?)").run(
      duelId,
      JSON.stringify({ promptId: "p0-1", revision: 1, answer: { choice: "to_ep" } }),
    );

    migrate(db);

    type SeatCol = { name: string; notnull: number };
    const seatCols = db.pragma("table_info(duel_seats)") as SeatCol[];
    const playerCol = seatCols.find((column) => column.name === "player_id");
    expect(seatCols.some((column) => column.name === "is_bot")).toBe(true);
    expect(playerCol?.notnull).toBe(0);

    const seats = db
      .prepare<[number], { seat: number; player_id: number | null; is_bot: number; ready: number; deck_json: string | null }>(
        "select seat, player_id, is_bot, ready, deck_json from duel_seats where duel_id = ? order by seat",
      )
      .all(duelId);
    expect(seats).toEqual([
      { seat: 0, player_id: p1, is_bot: 0, ready: 1, deck_json: JSON.stringify({ main: [1], extra: [], side: [] }) },
      { seat: 1, player_id: p2, is_bot: 0, ready: 1, deck_json: JSON.stringify({ main: [2], extra: [], side: [] }) },
    ]);

    const command = db
      .prepare<[number], { n: number }>("select count(*) as n from duel_commands where duel_id = ?")
      .get(duelId);
    expect(command?.n).toBe(1);

    const duel = db
      .prepare<[number], { winner_seat: number | null; winner_player_id: number | null }>(
        "select winner_seat, winner_player_id from duels where id = ?",
      )
      .get(duelId);
    expect(duel?.winner_player_id).toBe(p2);
    expect(duel?.winner_seat).toBe(1);

    const duelCols = (db.pragma("table_info(duels)") as Array<{ name: string }>).map((column) => column.name);
    expect(duelCols).toEqual(
      expect.arrayContaining([
        "archived_at",
        "snapshot_public_json",
        "snapshot_seat0_json",
        "snapshot_seat1_json",
        "master_rule",
        "settings_json",
        "clock_json",
        "invite_code",
      ]),
    );
    const snapshots = db
      .prepare<
        [number],
        {
          archived_at: string | null;
          snapshot_public_json: string | null;
          master_rule: number;
          settings_json: string | null;
          clock_json: string | null;
          invite_code: string | null;
        }
      >(
        "select archived_at, snapshot_public_json, master_rule, settings_json, clock_json, invite_code from duels where id = ?",
      )
      .get(duelId);
    expect(snapshots?.archived_at).toBeNull();
    expect(snapshots?.snapshot_public_json).toBeNull();
    expect(snapshots?.master_rule).toBe(5);
    expect(snapshots?.settings_json).toBeNull();
    expect(snapshots?.clock_json).toBeNull();
    expect(snapshots?.invite_code).toBeNull();
    expect(
      db.prepare("select name from sqlite_master where type = 'table' and name = 'duel_invite_grants'").get(),
    ).toEqual({ name: "duel_invite_grants" });

    const lobbyId = Number(
      db
        .prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values ('g1', 'newlobby1', 'New', ?, 'normal', 'lobby')")
        .run(p1).lastInsertRowid,
    );
    db.prepare("insert into duel_seats (duel_id, seat, player_id, is_bot, ready) values (?, 0, ?, 0, 0)").run(lobbyId, p1);
    db.prepare(
      "insert into duel_seats (duel_id, seat, player_id, is_bot, ready, deck_json) values (?, 1, null, 1, 1, ?)",
    ).run(lobbyId, JSON.stringify({ main: Array.from({ length: 40 }, (_, index) => index + 1), extra: [], side: [] }));

    const checkId = Number(
      db
        .prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status) values ('g1', 'checkbot1', 'Check', ?, 'normal', 'lobby')")
        .run(p1).lastInsertRowid,
    );
    expect(() =>
      db.prepare("insert into duel_seats (duel_id, seat, player_id, is_bot, ready) values (?, 1, ?, 1, 1)").run(checkId, p2),
    ).toThrow();
  });
});
