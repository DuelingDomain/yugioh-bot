import Database from "better-sqlite3";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { migrate } from "../../src/db/schema.js";
import * as contracts from "../../src/types/index.js";
import type {
  DraftConfig, DraftLobbyColumns, DraftPlayerReadyColumns, LobbySnapshot, LobbyPlayer,
  DraftDetailResponse, DraftReadyRequest, DraftStartRequest, DraftCompatibilityStartRequest,
  DraftStopStartRequest, DraftAutoStartRequest, DraftUpdateRequest, DraftNudgeRequest,
  DraftLobbyResponse, DraftStartResponse, DraftClaimCubeResponse, DraftReleaseCubeResponse,
  DraftAttachCubeRequest, DraftDetachCubeRequest, DraftAllowedCube, DraftLobbyErrorResponse,
} from "../../src/types/index.js";
import type { AnnouncePayload } from "../../src/notify/announce-payload.js";
import { createAnnouncer } from "../../src/notify/announcer.js";
import { recordingTransport } from "../../src/notify/signed-post.js";

// Artwork backfill is unrelated to lobby columns and probes engine resources.
// Keep this migration suite independent of those resources.
vi.mock("../../src/services/card-artworks.js", () => ({ backfillMainArtworkRows() {} }));

const draftDefaults = {
  lobby_revision: 0,
  lobby_auto_start: 0,
  lobby_auto_held: 0,
  lobby_start_at: null,
  lobby_start_kind: null,
  lobby_start_token: null,
  lobby_start_revision: null,
  lobby_start_setup_hash: null,
  lobby_start_force: 0,
  lobby_start_error: null,
  lobby_nudged_at: null,
};
const playerDefaults = { ready_at: null, ready_setup_hash: null };

// This fixture predates lobby persistence. Do not derive it from migrate(): an
// upgrade test must exercise the old tables, including their populated FKs.
function oldDatabase() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = on");
  db.exec(`
    create table players (
      id integer primary key autoincrement,
      guild_id text not null,
      discord_user_id text not null,
      display_name text not null,
      created_at text not null default current_timestamp,
      unique (guild_id, discord_user_id)
    );
    create table card_catalog (
      ygoprodeck_id integer primary key not null,
      name text not null, type text not null, frame_type text not null,
      image_url text not null, image_url_small text not null,
      card_sets_json text not null, cached_at text not null
    );
    create table cubes (
      id integer primary key autoincrement,
      guild_id text not null, name text not null, archetype text, banlist text,
      config_json text not null default '{}', created_by_user_id text not null,
      created_at text not null default current_timestamp,
      updated_at text not null default current_timestamp,
      unique (guild_id, name)
    );
    create table cube_cards (
      cube_id integer not null references cubes(id) on delete cascade,
      catalog_card_id integer not null references card_catalog(ygoprodeck_id),
      pool text not null, max_copies integer not null default 3, source text,
      primary key (cube_id, catalog_card_id)
    );
    create table drafts (
      id integer primary key autoincrement,
      guild_id text not null, channel_id text not null, name text not null,
      status text not null, created_by_user_id text not null,
      config_json text not null default '{}',
      current_wave_number integer not null default 0,
      current_pick_step integer not null default 0,
      pick_deadline_at text, status_message_id text, web_slug text,
      created_at text not null default current_timestamp, started_at text, ended_at text
    );
    create table draft_players (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      pick_count integer not null default 0, finished_at text, seat_index integer,
      joined_at text not null default current_timestamp,
      primary key (draft_id, player_id)
    );
    create table draft_player_cube (
      draft_id integer not null references drafts(id),
      player_id integer not null references players(id),
      cube_id integer not null references cubes(id),
      primary key (draft_id, player_id)
    );

    insert into players (id, guild_id, discord_user_id, display_name, created_at)
      values (10, 'guild', '900000000000000101', 'Host', '2026-10-01 12:00:00'),
             (20, 'guild', '900000000000000102', 'Guest', '2026-10-01 12:01:00');
    insert into card_catalog values
      (100, 'Main card', 'Effect Monster', 'effect', 'main.png', 'main-small.png', '[]', '2026-10-01'),
      (200, 'Extra card', 'Fusion Monster', 'fusion', 'extra.png', 'extra-small.png', '[]', '2026-10-01');
    insert into cubes (id, guild_id, name, archetype, config_json, created_by_user_id)
      values (30, 'guild', 'Existing cube', 'Dragons', '{"mode":"theme"}', '900000000000000101');
    insert into cube_cards values (30, 100, 'main', 7, 'import'), (30, 200, 'extra', 2, 'manual');
    insert into drafts (id, guild_id, channel_id, name, status, created_by_user_id, config_json,
                        current_wave_number, current_pick_step, pick_deadline_at, web_slug, started_at)
      values (40, 'guild', 'channel', 'Old lobby', 'pending', '900000000000000101',
              '{"mode":"theme","allowedCubeIds":[30],"themeSelection":"player_pick"}',
              0, 0, null, 'old-lobby', null),
             (50, 'guild', 'channel', 'Active draft', 'active', '900000000000000101', '{"packSize":8}',
              2, 3, '2026-10-07T12:00:45.000Z', 'active-draft', '2026-10-07T12:00:00.000Z'),
             (60, 'guild', 'channel', 'Completed draft', 'completed', '900000000000000101', '{}',
              5, 8, null, 'completed-draft', '2026-01-01T12:00:00.000Z');
    insert into draft_players (draft_id, player_id, pick_count, finished_at, seat_index, joined_at)
      values (40, 10, 0, null, null, '2026-10-01 12:00:00'),
             (40, 20, 0, null, null, '2026-10-01 12:01:00'),
             (50, 10, 11, null, 0, '2026-10-01 12:00:00'),
             (60, 20, 40, '2026-01-01 13:00:00', 0, '2026-01-01 12:00:00');
    insert into draft_player_cube values (40, 20, 30);
  `);
  return db;
}

function columns(db: Database.Database, table: string) {
  return db.pragma(`table_info(${table})`) as Array<{
    name: string;
    type: string;
    notnull: number;
    dflt_value: string | null;
  }>;
}

// Compare every original column, rather than just row counts or IDs.
function snapshot(db: Database.Database) {
  const tables = ["players", "card_catalog", "cubes", "cube_cards", "drafts", "draft_players", "draft_player_cube"];
  return tables.map((table) => {
    const names = columns(db, table).map(({ name }) => name).join(", ");
    return { table, names, rows: db.prepare(`select ${names} from ${table} order by rowid`).all() };
  });
}

function expectPreserved(db: Database.Database, before: ReturnType<typeof snapshot>) {
  for (const { table, names, rows } of before) {
    const expected = rows.map((row: any) => {
      if (!("created_by_user_id" in row) || typeof row.created_by_user_id !== "string") return row;
      const user = db.prepare("select id from users where discord_user_id = ?").get(row.created_by_user_id) as { id: number };
      return { ...row, created_by_user_id: user.id };
    });
    expect(db.prepare(`select ${names} from ${table} order by rowid`).all()).toEqual(expected);
  }
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
}

function expectColumnDefaults(db: Database.Database, table: string, defaults: Record<string, number | null>) {
  const info = columns(db, table);
  for (const [name, value] of Object.entries(defaults)) {
    expect(info.find((column) => column.name === name)).toEqual(expect.objectContaining({
      type: value === 0 || name === "lobby_start_revision" ? "INTEGER" : "TEXT",
      notnull: value === 0 ? 1 : 0,
      dflt_value: value === 0 ? "0" : null,
    }));
    expect(info.filter((column) => column.name === name)).toHaveLength(1);
  }
}

describe("draft lobby schema", () => {
  it("upgrades a populated old schema without phantom readiness, deadlines, or a seat target", () => {
    const db = oldDatabase();
    try {
      const before = snapshot(db);
      migrate(db);
      expectPreserved(db, before);
      expectColumnDefaults(db, "drafts", draftDefaults);
      expectColumnDefaults(db, "draft_players", playerDefaults);
      const drafts = db.prepare("select * from drafts").all() as Record<string, unknown>[];
      for (const draft of drafts) {
        expect(draft).toMatchObject(draftDefaults);
        expect(JSON.parse(draft.config_json as string)).not.toHaveProperty("lobbySeats");
      }
      for (const player of db.prepare("select * from draft_players").all()) {
        expect(player).toMatchObject(playerDefaults);
      }
      migrate(db);
      migrate(db);
      expectPreserved(db, before);
      expect(db.prepare("select * from drafts").all()).toEqual(drafts);
    } finally { db.close(); }
  });

  it("carries an existing redesign lobby through the alpha identity table rebuild", () => {
    const db = oldDatabase();
    try {
      db.exec(`
        alter table drafts add column lobby_revision integer not null default 0;
        alter table drafts add column lobby_auto_start integer not null default 0;
        alter table drafts add column lobby_auto_held integer not null default 0;
        alter table drafts add column lobby_start_at text;
        alter table drafts add column lobby_start_kind text;
        alter table drafts add column lobby_start_token text;
        alter table drafts add column lobby_start_revision integer;
        alter table drafts add column lobby_start_setup_hash text;
        alter table drafts add column lobby_start_force integer not null default 0;
        alter table drafts add column lobby_start_error text;
        alter table drafts add column lobby_nudged_at text;
        alter table draft_players add column ready_at text;
        alter table draft_players add column ready_setup_hash text;
        update drafts set lobby_revision = 12, lobby_auto_start = 1, lobby_auto_held = 1,
          lobby_start_at = '2026-10-07T12:00:10.000Z', lobby_start_kind = 'auto',
          lobby_start_token = 'persisted-token', lobby_start_revision = 12,
          lobby_start_setup_hash = 'persisted-hash', lobby_start_force = 1,
          lobby_start_error = 'Saved error', lobby_nudged_at = '2026-10-07T12:00:00.000Z'
          where id = 40;
        update draft_players set ready_at = '2026-10-07T11:59:00.000Z', ready_setup_hash = 'persisted-hash'
          where draft_id = 40 and player_id = 10;
      `);
      const before = snapshot(db);
      migrate(db);
      migrate(db);
      expectPreserved(db, before);
      expect(db.prepare("select player_id, cube_id from draft_player_cube where draft_id = 40").get())
        .toEqual({ player_id: 20, cube_id: 30 });
      const user = db.prepare("select id from users where discord_user_id = '900000000000000101'").get() as { id: number };
      expect(db.prepare("select user_id from players where id = 10").get()).toEqual({ user_id: user.id });
    } finally { db.close(); }
  });

  it("preserves recorded Ready, Hold, countdown, errors, and Nudge reservations on repeated migration", () => {
    const db = oldDatabase();
    try {
      migrate(db);
      db.exec(`
        update drafts set lobby_revision = 12, lobby_auto_start = 1, lobby_auto_held = 1,
          lobby_start_at = '2026-10-07T12:00:10.000Z', lobby_start_kind = 'auto',
          lobby_start_token = 'schedule-token', lobby_start_revision = 12,
          lobby_start_setup_hash = 'setup-hash', lobby_start_force = 1,
          lobby_start_error = 'A previous start failed', lobby_nudged_at = '2026-10-07T12:00:00.000Z'
          where id = 40;
        update draft_players set ready_at = '2026-10-07T11:59:00.000Z', ready_setup_hash = 'setup-hash'
          where draft_id = 40 and player_id = 10;
      `);
      const before = snapshot(db);
      migrate(db);
      migrate(db);
      expectPreserved(db, before);
      expectColumnDefaults(db, "drafts", draftDefaults);
      expectColumnDefaults(db, "draft_players", playerDefaults);
    } finally { db.close(); }
  });

  it("finishes a partially migrated schema without resetting existing lobby columns", () => {
    const db = oldDatabase();
    try {
      db.exec(`
        alter table drafts add column lobby_revision integer not null default 0;
        alter table draft_players add column ready_at text;
        update drafts set lobby_revision = 9 where id = 40;
        update draft_players set ready_at = '2026-10-07T11:59:00.000Z' where draft_id = 40 and player_id = 20;
      `);
      const before = snapshot(db);
      migrate(db);
      migrate(db);
      expectPreserved(db, before);
      expectColumnDefaults(db, "drafts", draftDefaults);
      expectColumnDefaults(db, "draft_players", playerDefaults);
      expect(db.prepare("select ready_setup_hash from draft_players where draft_id = 40 and player_id = 20").get())
        .toEqual({ ready_setup_hash: null });
    } finally { db.close(); }
  });

  it("defaults new rows to an unscheduled, unready lobby on a fresh database", () => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = on");
      migrate(db);
      migrate(db);
      db.exec(`
        insert into users(id,username,display_name) values (101,'host','Host');
        insert into players (guild_id, user_id, display_name) values ('guild', 101, 'Host');
        insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json)
          values ('guild', 'channel', 'New lobby', 'pending', 101, '{"lobbySeats":4}');
        insert into draft_players (draft_id, player_id) values (1, 1);
      `);
      expect(db.prepare("select * from drafts").get()).toMatchObject(draftDefaults);
      expect(db.prepare("select * from draft_players").get()).toMatchObject(playerDefaults);
      expectColumnDefaults(db, "drafts", draftDefaults);
      expectColumnDefaults(db, "draft_players", playerDefaults);
      expect(db.pragma("foreign_key_check")).toEqual([]);
    } finally { db.close(); }
  });
});

describe("frozen draft lobby contracts", () => {
  it("exports the agreed seat, countdown, cooldown, and recovery-poll constants", () => {
    expect(contracts).toMatchObject({
      DEFAULT_LOBBY_SEATS: 4, MIN_LOBBY_SEATS: 2, MAX_LOBBY_SEATS: 8,
      MIN_DRAFT_START_PLAYERS: 2, MANUAL_START_DELAY_MS: 5_000, AUTO_START_DELAY_MS: 10_000,
      NUDGE_COOLDOWN_MS: 60_000, LOBBY_IDLE_POLL_MS: 10_000, LOBBY_COUNTDOWN_POLL_MS: 1_000,
    });
    expect(contracts.DRAFT_LOBBY_ERROR_CODES).toMatchObject({
      STALE_LOBBY: "STALE_LOBBY", NOT_READY: "NOT_READY", NUDGE_COOLDOWN: "NUDGE_COOLDOWN",
      LOBBY_FULL: "LOBBY_FULL", SEAT_TARGET_TOO_SMALL: "SEAT_TARGET_TOO_SMALL",
      DRAFT_NOT_PENDING: "DRAFT_NOT_PENDING", START_TOKEN_MISMATCH: "START_TOKEN_MISMATCH",
      PREFLIGHT_FAILED: "PREFLIGHT_FAILED", CLAIM_REQUIRED: "CLAIM_REQUIRED",
      CUBE_TAKEN: "CUBE_TAKEN", CUBE_ATTACH_CONFLICT: "CUBE_ATTACH_CONFLICT",
    });
    for (const [code, value] of Object.entries(contracts.DRAFT_LOBBY_ERROR_CODES)) {
      expect(value).toBe(code);
      expect(contracts.DRAFT_LOBBY_ERROR_STATUS[code as contracts.DraftLobbyErrorCode]).toBeGreaterThanOrEqual(400);
    }
    expect(contracts.DRAFT_LOBBY_ERROR_STATUS).toMatchObject({
      STALE_LOBBY: 409, NOT_READY: 409, NUDGE_COOLDOWN: 429, NUDGE_FAILED: 502,
      INVALID_BODY: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, DRAFT_NOT_FOUND: 404,
      GUILD_ACCESS_UNAVAILABLE: 503,
    });
  });

  it("validates integer seat targets without coercion or a legacy default", () => {
    expect(typeof contracts.isValidLobbySeats).toBe("function");
    for (const value of [2, 3, 4, 5, 6, 7, 8]) expect(contracts.isValidLobbySeats(value)).toBe(true);
    for (const value of [undefined, null, 0, 1, 9, 2.5, "4", true, [], {}, NaN, Infinity, -Infinity]) {
      expect(contracts.isValidLobbySeats(value)).toBe(false);
    }
  });

  it("keeps the read model exact and separates it from persisted columns and private identity", () => {
    expectTypeOf<DraftConfig["lobbySeats"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LobbySnapshot>().toEqualTypeOf<{
      revision: number; serverNow: string; targetSeats: number | null;
      joined: number; ready: number; allReady: boolean;
      autoStart: { enabled: boolean; held: boolean; eligible: boolean };
      start: null | { token: string; kind: "manual" | "auto"; startsAt: string };
      errors: string[]; warnings: string[]; lastStartError: string | null;
    }>();
    expectTypeOf<Pick<LobbyPlayer, "isHost" | "isYou" | "isBot" | "ready" | "readyAt" | "cubeId">>()
      .toEqualTypeOf<{
        isHost: boolean; isYou: boolean; isBot: boolean; ready: boolean;
        readyAt: string | null; cubeId: number | null;
      }>();
    expectTypeOf<Extract<keyof LobbyPlayer, "discordUserId" | "discordId" | "discord_user_id" | "readySetupHash" | "ready_setup_hash">>()
      .toEqualTypeOf<never>();
    expectTypeOf<Extract<DraftDetailResponse, { status: "pending" }>["lobby"]>().toEqualTypeOf<LobbySnapshot>();
    expectTypeOf<Exclude<DraftDetailResponse, { status: "pending" }>["lobby"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Exclude<DraftDetailResponse, { status: "pending" }>["players"][number]["cubeId"]>()
      .toEqualTypeOf<undefined>();
    expectTypeOf<DraftLobbyColumns["lobby_start_kind"]>().toEqualTypeOf<"manual" | "auto" | null>();
    expectTypeOf<DraftLobbyColumns["lobby_auto_held"]>().toEqualTypeOf<0 | 1>();
    expectTypeOf<DraftPlayerReadyColumns>().toEqualTypeOf<{ ready_at: string | null; ready_setup_hash: string | null }>();
    expectTypeOf<Pick<DraftAllowedCube, "mainCount" | "extraCount" | "mainDistinct" | "extraDistinct" | "mainCopies" | "extraCopies">>()
      .toEqualTypeOf<{
        mainCount: number; extraCount: number; mainDistinct: number; extraDistinct: number;
        mainCopies: number; extraCopies: number;
      }>();
  });

  it("requires explicit sets/revisions/tokens and preserves special success/error bodies", () => {
    expectTypeOf<DraftReadyRequest>().toEqualTypeOf<{ ready: boolean }>();
    expectTypeOf<DraftStartRequest>().toEqualTypeOf<{ revision: number; force?: boolean }>();
    expectTypeOf<DraftCompatibilityStartRequest>().toEqualTypeOf<{ revision?: number; force?: boolean } | undefined>();
    expectTypeOf<DraftStopStartRequest>().toEqualTypeOf<{ token: string }>();
    expectTypeOf<DraftAutoStartRequest>().toEqualTypeOf<{ enabled: boolean; held?: boolean; revision: number }>();
    expectTypeOf<DraftUpdateRequest>().toEqualTypeOf<{ name?: string; config?: Partial<DraftConfig>; revision?: number }>();
    expectTypeOf<DraftNudgeRequest>().toEqualTypeOf<{ playerId?: number }>();
    expectTypeOf<contracts.DraftNudgeResponse>().toEqualTypeOf<{ ok: true; channelId: string; nextAllowedAt: string }>();
    expectTypeOf<DraftLobbyResponse>().toEqualTypeOf<{ lobby: LobbySnapshot; players: LobbyPlayer[] }>();
    expectTypeOf<DraftStartResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftReadyResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftLeaveResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftRemovePlayerResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftStopStartResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftAutoStartResponse>().toEqualTypeOf<DraftLobbyResponse>();
    expectTypeOf<contracts.DraftLeaveRequest | contracts.DraftRemovePlayerRequest | contracts.DraftReleaseCubeRequest>()
      .toEqualTypeOf<undefined>();
    expectTypeOf<DraftClaimCubeResponse>().toEqualTypeOf<{ ok: true; cubeId: number }>();
    expectTypeOf<DraftReleaseCubeResponse>().toEqualTypeOf<{ ok: true; cubeId: null }>();
    expectTypeOf<DraftAttachCubeRequest>().toEqualTypeOf<
      { kind: "archetype"; archetype: string } | { kind: "blank"; name: string } | { kind: "existing"; cubeId: number }
    >();
    expectTypeOf<contracts.DraftAttachCubeResponse>().toEqualTypeOf<{ cube: contracts.DraftCubeSummary; allowedCubeIds: number[] }>();
    expectTypeOf<DraftDetachCubeRequest>().toEqualTypeOf<{ cubeId: number }>();
    expectTypeOf<contracts.DraftDetachCubeResponse>().toEqualTypeOf<{ ok: true; allowedCubeIds: number[] }>();
    expectTypeOf<contracts.DraftUpdateResponse>().toEqualTypeOf<{
      id: number; name: string; status: "pending"; webSlug?: string; config: DraftConfig;
      warnings: string[]; errors: string[]; lobby: LobbySnapshot; lookupLimited?: boolean; unknownIds?: number[];
    }>();
    expectTypeOf<Extract<DraftLobbyErrorResponse, { code: "NOT_READY" }>>().toEqualTypeOf<{
      error: string; code: "NOT_READY"; notReadyPlayerIds: number[]; unclaimedPlayerIds?: number[];
    }>();
    expectTypeOf<Extract<DraftLobbyErrorResponse, { code: "NUDGE_COOLDOWN" }>>().toEqualTypeOf<{
      error: string; code: "NUDGE_COOLDOWN"; retryAfterSeconds: number;
    }>();
    expectTypeOf<Extract<DraftLobbyErrorResponse, { code: "CUBE_ATTACH_CONFLICT" }>>().toEqualTypeOf<{
      error: string; code: "CUBE_ATTACH_CONFLICT"; savedCubeId: number;
    }>();
  });

  it("declares and posts draft-nudge on the existing signed transport without kind in the body", async () => {
    const payload: Extract<AnnouncePayload, { kind: "draft-nudge" }> = {
      kind: "draft-nudge", draftId: 40, channelId: "channel", name: "Old lobby",
      webSlug: "old-lobby", mentionUserIds: ["guest"],
    };
    expectTypeOf<typeof payload>().toEqualTypeOf<{
      kind: "draft-nudge"; draftId: number; channelId: string; name: string; webSlug: string; mentionUserIds: string[];
    }>();
    const { calls, transport } = recordingTransport();
    expect(await createAnnouncer(transport).announce(payload)).toEqual({ ok: true });
    expect(calls).toEqual([{
      path: "/internal/announce/draft-nudge",
      body: JSON.stringify({ draftId: 40, channelId: "channel", name: "Old lobby", webSlug: "old-lobby", mentionUserIds: ["guest"] }),
    }]);
  });
});
