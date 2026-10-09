import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  AUTO_START_DELAY_MS, MANUAL_START_DELAY_MS, MIN_DRAFT_START_PLAYERS, isValidLobbySeats,
  type Draft, type DraftConfig, type DraftLobbyColumns, type DraftPlayerReadyColumns,
  type DraftLobbyResponse, type DraftLobbyTickResult, type DraftStartRequest,
  type DraftAutoStartRequest, type DraftPreflightResponse, type LobbyPlayer,
} from "../types/index.js";
import { createDraftService, themeDraftNumberError } from "./drafts.js";
import { createCubeService } from "./cubes.js";
import { createCardCatalogService } from "./card-catalog.js";
import { isTestBotDiscordId } from "./draft-decks.js";
import { boosterMainRounds, mainDraftPicksPerPlayer } from "./draft-size.js";
import {
  clearDraftLobbyStart, invalidateDraftLobby, DraftLobbyServiceError,
  type DraftLobbyInvalidationOptions,
} from "./draft-lobby-mutations.js";

export { DraftLobbyServiceError } from "./draft-lobby-mutations.js";
export type { DraftLobbyInvalidationOptions } from "./draft-lobby-mutations.js";

type LobbyRow = DraftLobbyColumns & { status: string };
type PlayerRow = DraftPlayerReadyColumns & {
  player_id: number; display_name: string; user_id: number; discord_user_id: string | null; guild_id: string;
  seat_index: number | null; pick_count: number; finished_at: string | null; joined_at: string;
  cube_id: number | null;
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

/**
 * Synchronous, cached-only SQLite authority. Hydrate catalog data before calling
 * scheduleStart; notifications belong to the caller after this service commits.
 * Actors/viewers are application users.id; seats and claims retain players.id.
 */
export function createDraftLobbyService(db: Database.Database) {
  const drafts = createDraftService(db);
  const cubes = createCubeService(db, createCardCatalogService(db));

  const pending = (draftId: number): { draft: Draft; row: LobbyRow } => {
    const row = db.prepare("select * from drafts where id = ?").get(draftId) as LobbyRow | undefined;
    if (!row) throw new DraftLobbyServiceError("Draft not found", "DRAFT_NOT_FOUND");
    if (row.status !== "pending") throw new DraftLobbyServiceError("Draft must be pending", "DRAFT_NOT_PENDING");
    return { draft: drafts.findById(draftId), row };
  };
  const host = (draft: Draft, actorUserId: number) => {
    if (draft.createdByUserId !== actorUserId) throw new DraftLobbyServiceError("Only the host can manage this lobby", "HOST_REQUIRED");
  };
  const roster = (draftId: number): PlayerRow[] => db.prepare(`select dp.*, p.display_name,
    p.user_id, p.discord_user_id, p.guild_id, pc.cube_id from draft_players dp join players p on p.id = dp.player_id
    left join draft_player_cube pc on pc.draft_id = dp.draft_id and pc.player_id = dp.player_id
    where dp.draft_id = ? order by dp.seat_index, dp.joined_at, dp.rowid`).all(draftId) as PlayerRow[];

  const cubeExists = (id: number, guildId: string) => !!db.prepare("select 1 from cubes where id = ? and guild_id = ?").get(id, guildId);
  const validClaim = (draft: Draft, player: PlayerRow) => player.cube_id !== null
    && (draft.config.allowedCubeIds ?? []).includes(player.cube_id) && cubeExists(player.cube_id, draft.guildId);
  // Test bots receive a random theme from the draft kernel when it starts.
  const isUnclaimedHuman = (draft: Draft, player: PlayerRow) => !isTestBotDiscordId(player.discord_user_id)
    && !validClaim(draft, player);

  const setupHash = (draft: Draft): string => {
    // Assignment acknowledgement is per seat: removing one assignment cannot
    // erase everyone else's Ready. Names and cube metadata are cosmetic.
    const { themeAssignments: _assignments, poolSource, draftType: _metadata, ...rules } = draft.config;
    const config = { ...rules, ...(poolSource ? { poolSource: { cubeId: poolSource.cubeId } } : {}) };
    for (const key of ["allowedCubeIds", "cubeCardIds", "poolCardIds", "customCardIds", "customExtraCardIds"] as const) {
      if (config[key]) config[key] = config[key].slice().sort((a, b) => a - b);
    }
    for (const key of ["setNames", "includeNames", "excludeNames"] as const) {
      if (config[key]) config[key] = config[key].slice().sort();
    }
    const ids = [...new Set([...(draft.config.mode === "theme" ? draft.config.allowedCubeIds ?? [] : []),
      ...(poolSource ? [poolSource.cubeId] : [])])].sort((a, b) => a - b);
    const referenced = ids.map((id) => ({ id,
      guildId: (db.prepare("select guild_id from cubes where id = ?").get(id) as { guild_id: string } | undefined)?.guild_id ?? null,
      pools: db.prepare("select catalog_card_id, pool, max_copies from cube_cards where cube_id = ? order by catalog_card_id, pool, max_copies").all(id),
    }));
    // Acknowledge authored config/set selections and cube pools. Catalog sync
    // may change resolved cards; preflight still validates those at start time.
    return hash({ config, referenced });
  };
  const acknowledgementHash = (draft: Draft, player: PlayerRow, setup: string) => hash({ setup,
    cube: draft.config.mode !== "theme" ? null : draft.config.themeSelection === "host_assigned"
      ? draft.config.themeAssignments?.[String(player.player_id)] ?? null
      : draft.config.themeSelection === "player_pick" ? player.cube_id : null,
  });
  const isReady = (draft: Draft, player: PlayerRow, setup: string) => isTestBotDiscordId(player.discord_user_id)
    || !!(player.ready_at && player.ready_setup_hash === acknowledgementHash(draft, player, setup)
      && (draft.config.mode !== "theme" || draft.config.themeSelection !== "player_pick" || validClaim(draft, player)));
  // Pressing manual Start acknowledges the host's seat for this countdown only.
  const isReadyToStart = (player: LobbyPlayer, kind: "manual" | "auto" | null) => player.ready
    || (kind === "manual" && player.isHost);
  const scheduleHash = (draft: Draft, players: PlayerRow[], setup: string) => hash({ setup,
    assignments: draft.config.themeSelection === "host_assigned" ? draft.config.themeAssignments : undefined,
    claims: draft.config.themeSelection === "player_pick" ? players.map((p) => [p.player_id, p.cube_id]) : undefined,
  });

  const preflight = (draft: Draft, players: PlayerRow[]): DraftPreflightResponse => {
    const errors: string[] = [], warnings: string[] = [];
    const config = draft.config;
    if (players.length < MIN_DRAFT_START_PLAYERS) errors.push("Draft requires at least two players to start");
    if (config.lobbySeats !== undefined && !isValidLobbySeats(config.lobbySeats)) errors.push("Lobby seats must be a whole number from 2 to 8");
    if (config.lobbySeats !== undefined && config.lobbySeats < players.length) errors.push("Lobby target is smaller than the joined roster");
    if (players.some((p) => p.guild_id !== draft.guildId)) errors.push("All players must belong to the draft's guild");
    if (config.mode !== undefined && config.mode !== "theme" && config.mode !== "booster") errors.push("Unknown draft mode");
    if (!Number.isFinite(config.pickSeconds) || (config.pickSeconds ?? 0) <= 0) errors.push("Pick timer must be positive");
    if (config.poolSource && !cubeExists(config.poolSource.cubeId, draft.guildId)) errors.push("Source cube must exist in the draft's guild");
    if (config.mode !== "theme") {
      for (const [label, value] of [["Pack size", config.packSize], ["Packs per player", boosterMainRounds(config)],
        ["Cards per player", mainDraftPicksPerPlayer(config)]] as const) {
        if (!Number.isInteger(value) || (value ?? 0) < 1) errors.push(`${label} must be a positive whole number`);
      }
      const analysis = drafts.analyzeBoosterDraft(config, players.length, draft.guildId);
      errors.push(...analysis.errors);
      warnings.push(...analysis.warnings);
      const ids = [...drafts.resolveCubeCardIds(config), ...drafts.resolveExtraCardIds(config, draft.guildId)];
      const find = db.prepare("select 1 from card_catalog where ygoprodeck_id = ?");
      if (ids.some((id) => !find.get(id))) errors.push("Draft pool contains cards missing from the cached catalog");
      return { errors, warnings };
    }
    const numberError = themeDraftNumberError(config);
    if (numberError) errors.push(numberError);
    const selection = config.themeSelection ?? "player_pick";
    if (!["player_pick", "host_assigned", "random"].includes(selection)) errors.push("Unknown theme selection mode");
    const requested = [...new Set(config.allowedCubeIds ?? [])];
    const allowed = requested.filter((id) => cubeExists(id, draft.guildId));
    if (!allowed.length) errors.push("Theme draft requires at least one allowed theme");
    if (requested.some((id) => {
      const cube = db.prepare("select guild_id from cubes where id = ?").get(id) as { guild_id: string } | undefined;
      return !Number.isSafeInteger(id) || (cube && cube.guild_id !== draft.guildId);
    })) errors.push("Allowed cubes must belong to the draft's guild");
    if (config.uniqueThemes !== false && allowed.length < players.length) errors.push(`Theme draft needs at least ${players.length} allowed cubes when uniqueThemes is on`);
    let analyzed = allowed;
    if (selection === "host_assigned") {
      const assigned = players.map((p) => config.themeAssignments?.[String(p.player_id)]);
      if (assigned.some((id) => id === undefined || !allowed.includes(id))) errors.push("Host-assigned themes require an allowed theme assignment for every player");
      if (config.uniqueThemes !== false && new Set(assigned).size !== assigned.length) errors.push("Host-assigned themes must be distinct when uniqueThemes is enabled");
      analyzed = [...new Set(assigned.filter((id): id is number => id !== undefined))];
    } else if (selection === "player_pick") {
      const claimed = players.filter((p) => p.cube_id !== null);
      if (claimed.some((p) => !validClaim(draft, p))) errors.push("Player claims must reference allowed cubes in the draft's guild");
      if (config.uniqueThemes !== false && new Set(claimed.map((p) => p.cube_id)).size !== claimed.length) errors.push("Player claims must be distinct when uniqueThemes is enabled");
    }
    if (!numberError) for (const id of analyzed) {
      if (!cubeExists(id, draft.guildId)) continue;
      const analysis = cubes.analyzeCubePools(id, {
        cardsPerPlayer: mainDraftPicksPerPlayer(config), themePackSize: config.themePackSize ?? 3,
        extraDeckSize: config.extraDeckSize ?? 15, extraDeckEnabled: config.extraDeckEnabled ?? true,
        burnUnpicked: config.burnUnpicked ?? false, copyLimit: config.copyLimit,
      });
      errors.push(...analysis.errors.map((message) => `Cube ${id}: ${message}`));
      warnings.push(...analysis.warnings.map((message) => `Cube ${id}: ${message}`));
    }
    return { errors, warnings };
  };

  const project = (draftId: number, viewerUserId: number | undefined, now: Date): DraftLobbyResponse => {
    const { draft, row } = pending(draftId);
    const rows = roster(draftId), setup = setupHash(draft);
    const players: LobbyPlayer[] = rows.map((player) => {
      const isBot = isTestBotDiscordId(player.discord_user_id);
      const ready = isReady(draft, player, setup);
      return { playerId: player.player_id, displayName: player.display_name,
        ...(player.seat_index === null ? {} : { seatIndex: player.seat_index }), pickCount: player.pick_count,
        ...(player.finished_at === null ? {} : { finishedAt: player.finished_at }), joinedAt: player.joined_at,
        isHost: player.user_id === draft.createdByUserId, isYou: player.user_id === viewerUserId,
        isBot, ready, readyAt: ready && !isBot ? player.ready_at : null,
        cubeId: draft.config.mode !== "theme" ? null : draft.config.themeSelection === "player_pick" ? player.cube_id
          : draft.config.themeSelection === "host_assigned" && viewerUserId === draft.createdByUserId
            ? draft.config.themeAssignments?.[String(player.player_id)] ?? null : null,
      };
    });
    const analysis = preflight(draft, rows), targetSeats = draft.config.lobbySeats ?? null;
    const ready = players.filter((p) => p.ready).length, allReady = ready === players.length;
    // Pool/assignment diagnostics include private identities. Public viewers still
    // see blockers, but no host-assigned cube IDs, names or assignment maps.
    const hideAssigned = draft.config.themeSelection === "host_assigned" && viewerUserId !== draft.createdByUserId;
    return { players, lobby: { revision: row.lobby_revision, serverNow: now.toISOString(), targetSeats,
      joined: players.length, ready, allReady, autoStart: { enabled: row.lobby_auto_start === 1,
        held: row.lobby_auto_held === 1, eligible: targetSeats !== null && players.length === targetSeats && allReady
          && analysis.errors.length === 0 && !(draft.config.mode === "theme" && draft.config.themeSelection === "player_pick"
            && rows.some((p) => isUnclaimedHuman(draft, p))) },
      start: row.lobby_start_token && row.lobby_start_at && row.lobby_start_kind
        ? { token: row.lobby_start_token, kind: row.lobby_start_kind, startsAt: row.lobby_start_at } : null,
      errors: hideAssigned && analysis.errors.length ? ["Host-assigned setup needs host attention"] : analysis.errors,
      warnings: hideAssigned && analysis.warnings.length ? ["Host-assigned pools have preflight warnings"] : analysis.warnings,
      lastStartError: hideAssigned && row.lobby_start_error ? "Start failed; host attention required" : row.lobby_start_error,
    } };
  };

  const arm = (draftId: number, kind: "manual" | "auto", force: boolean, now: Date) => {
    const { draft } = pending(draftId);
    const players = roster(draftId), setup = setupHash(draft);
    const startsAt = new Date(now.getTime() + (kind === "manual" ? MANUAL_START_DELAY_MS : AUTO_START_DELAY_MS)).toISOString();
    db.prepare(`update drafts set lobby_revision = lobby_revision + 1, lobby_start_at = ?, lobby_start_kind = ?,
      lobby_start_token = ?, lobby_start_revision = lobby_revision + 1, lobby_start_setup_hash = ?,
      lobby_start_force = ?, lobby_start_error = null where id = ?`)
      .run(startsAt, kind, randomUUID(), scheduleHash(draft, players, setup), force ? 1 : 0, draftId);
  };
  const checkRevision = (row: LobbyRow, revision: number) => {
    if (!Number.isSafeInteger(revision) || revision < 0) throw new DraftLobbyServiceError("Revision must be a nonnegative integer", "INVALID_BODY");
    if (row.lobby_revision !== revision) throw new DraftLobbyServiceError("Lobby changed; refresh before retrying", "STALE_LOBBY");
  };
  const checkPreflight = (draft: Draft, players: PlayerRow[]) => {
    if (players.length < MIN_DRAFT_START_PLAYERS) throw new DraftLobbyServiceError("Draft requires at least two players to start", "TOO_FEW_PLAYERS");
    const analysis = preflight(draft, players);
    if (analysis.errors.length) throw new DraftLobbyServiceError(analysis.errors.join(" "), "PREFLIGHT_FAILED", analysis);
  };

  const removeSeat = (draft: Draft, playerId: number) => {
    db.prepare("delete from draft_player_cube where draft_id = ? and player_id = ?").run(draft.id, playerId);
    db.prepare("delete from draft_players where draft_id = ? and player_id = ?").run(draft.id, playerId);
    if (draft.config.themeAssignments && String(playerId) in draft.config.themeAssignments) {
      const themeAssignments = { ...draft.config.themeAssignments };
      delete themeAssignments[String(playerId)];
      db.prepare("update drafts set config_json = ? where id = ?").run(JSON.stringify({ ...draft.config, themeAssignments }), draft.id);
    }
    invalidateDraftLobby(db, draft.id);
  };

  return {
    read(draftId: number, viewerUserId?: number, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => project(draftId, viewerUserId, now))();
    },
    setReady(draftId: number, actorUserId: number, ready: boolean, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        if (typeof ready !== "boolean") throw new DraftLobbyServiceError("Ready must be a boolean", "INVALID_BODY");
        const { draft } = pending(draftId);
        const player = roster(draftId).find((p) => p.user_id === actorUserId && p.guild_id === draft.guildId);
        if (!player) throw new DraftLobbyServiceError("Player has not joined this draft", "NOT_JOINED");
        if (isTestBotDiscordId(player.discord_user_id)) return project(draftId, actorUserId, now);
        if (ready && draft.config.mode === "theme" && draft.config.themeSelection === "player_pick" && !validClaim(draft, player)) {
          throw new DraftLobbyServiceError("Claim an allowed cube before becoming Ready", "CLAIM_REQUIRED");
        }
        const setup = acknowledgementHash(draft, player, setupHash(draft));
        if (ready ? player.ready_at !== null && player.ready_setup_hash === setup : player.ready_at === null && player.ready_setup_hash === null) {
          return project(draftId, actorUserId, now);
        }
        db.prepare("update draft_players set ready_at = ?, ready_setup_hash = ? where draft_id = ? and player_id = ?")
          .run(ready ? now.toISOString() : null, ready ? setup : null, draftId, player.player_id);
        invalidateDraftLobby(db, draftId);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    removePlayer(draftId: number, actorUserId: number, playerId: number, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        const { draft } = pending(draftId);
        host(draft, actorUserId);
        const player = roster(draftId).find((p) => p.player_id === playerId);
        if (!player) throw new DraftLobbyServiceError("Player not found in this draft", "PLAYER_NOT_FOUND");
        if (player.user_id === actorUserId) throw new DraftLobbyServiceError("Use Leave to remove your own seat", "SELF_REMOVAL");
        removeSeat(draft, playerId);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    leave(draftId: number, actorUserId: number, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        const { draft } = pending(draftId);
        const player = roster(draftId).find((p) => p.user_id === actorUserId && p.guild_id === draft.guildId);
        if (player) removeSeat(draft, player.player_id);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    scheduleStart(draftId: number, actorUserId: number, request: DraftStartRequest, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        const { draft, row } = pending(draftId);
        host(draft, actorUserId);
        if (!request || (request.force !== undefined && typeof request.force !== "boolean")) throw new DraftLobbyServiceError("Invalid start request", "INVALID_BODY");
        const players = roster(draftId);
        const sameSchedule = row.lobby_start_kind === "manual" && row.lobby_start_token && row.lobby_start_revision === row.lobby_revision
          && (request.revision === row.lobby_revision || request.revision === row.lobby_revision - 1)
          && row.lobby_start_force === (request.force ? 1 : 0)
          && row.lobby_start_setup_hash === scheduleHash(draft, players, setupHash(draft));
        if (sameSchedule) return project(draftId, actorUserId, now);
        checkRevision(row, request.revision);
        checkPreflight(draft, players);
        const state = project(draftId, actorUserId, now);
        const notReadyPlayerIds = state.players.filter((p) => !isReadyToStart(p, "manual")).map((p) => p.playerId);
        const unclaimedPlayerIds = draft.config.mode === "theme" && draft.config.themeSelection === "player_pick"
          ? players.filter((p) => isUnclaimedHuman(draft, p)).map((p) => p.player_id) : undefined;
        if (!request.force && (notReadyPlayerIds.length || unclaimedPlayerIds?.length)) {
          throw new DraftLobbyServiceError("Players must be Ready before starting", "NOT_READY", {
            notReadyPlayerIds, ...(unclaimedPlayerIds ? { unclaimedPlayerIds } : {}),
          });
        }
        arm(draftId, "manual", request.force === true, now);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    stopStart(draftId: number, actorUserId: number, token: string, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        const { draft, row } = pending(draftId);
        host(draft, actorUserId);
        if (row.lobby_start_token === null) return project(draftId, actorUserId, now);
        if (!token || token !== row.lobby_start_token) throw new DraftLobbyServiceError("Start token does not match the current countdown", "START_TOKEN_MISMATCH");
        clearDraftLobbyStart(db, draftId);
        db.prepare("update drafts set lobby_revision = lobby_revision + 1, lobby_auto_held = lobby_auto_start where id = ?").run(draftId);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    setAutoStart(draftId: number, actorUserId: number, request: DraftAutoStartRequest, now = new Date()): DraftLobbyResponse {
      return db.transaction(() => {
        const { draft, row } = pending(draftId);
        host(draft, actorUserId);
        if (!request || typeof request.enabled !== "boolean" || (request.held !== undefined && typeof request.held !== "boolean")) {
          throw new DraftLobbyServiceError("Invalid auto-start request", "INVALID_BODY");
        }
        checkRevision(row, request.revision);
        const held = request.enabled && (request.held ?? false);
        if (row.lobby_start_kind === "auto" && (!request.enabled || held)) clearDraftLobbyStart(db, draftId);
        db.prepare(`update drafts set lobby_revision = lobby_revision + 1, lobby_auto_start = ?, lobby_auto_held = ?,
          lobby_start_revision = case when lobby_start_token is null then null else lobby_revision + 1 end,
          lobby_start_error = null where id = ?`).run(request.enabled ? 1 : 0, held ? 1 : 0, draftId);
        const state = project(draftId, actorUserId, now);
        if (request.enabled && !held && state.lobby.autoStart.eligible && !state.lobby.start) arm(draftId, "auto", false, now);
        return project(draftId, actorUserId, now);
      }).immediate();
    },
    invalidate(draftId: number, options: DraftLobbyInvalidationOptions = {}): void {
      db.transaction(() => invalidateDraftLobby(db, draftId, options)).immediate();
    },
    tick(now = new Date(), draftId?: number): DraftLobbyTickResult {
      // Idle and held lobbies need no write lock, catalog analysis or pool hash.
      const candidates = db.prepare(`select id, lobby_start_token, lobby_start_at, lobby_start_revision, lobby_revision
        from drafts where status = 'pending' and (lobby_start_token is not null
          or (lobby_auto_start = 1 and lobby_auto_held = 0))
        ${draftId === undefined ? "" : "and id = ?"} order by id`)
        .all(...(draftId === undefined ? [] : [draftId])) as Array<{
          id: number; lobby_start_token: string | null; lobby_start_at: string | null;
          lobby_start_revision: number | null; lobby_revision: number;
        }>;
      const result: DraftLobbyTickResult = { started: [], changedSlugs: [] };
      for (const candidate of candidates) {
        const { id } = candidate;
        try {
          const scheduledAt = candidate.lobby_start_at ? Date.parse(candidate.lobby_start_at) : NaN;
          if (candidate.lobby_start_token && candidate.lobby_start_revision === candidate.lobby_revision
            && now.getTime() < scheduledAt) continue;
          const transition = db.transaction((): { started?: Draft; changed?: string } => {
            // Another connection may Stop/Hold/start after the candidate read.
            const current = db.prepare("select status, lobby_start_token, lobby_auto_start, lobby_auto_held from drafts where id = ?")
              .get(id) as LobbyRow | undefined;
            if (current?.status !== "pending" || (!current.lobby_start_token
              && !(current.lobby_auto_start === 1 && current.lobby_auto_held === 0))) return {};
            const { draft, row } = pending(id);
            const changed = draft.webSlug;
            const fail = (message: string) => {
              clearDraftLobbyStart(db, id);
              db.prepare(`update drafts set lobby_revision = lobby_revision + 1, lobby_auto_held = lobby_auto_start,
                lobby_start_error = ? where id = ?`).run(message, id);
              return { changed };
            };
            if (!row.lobby_start_token) {
              const players = roster(id);
              if (draft.config.lobbySeats === undefined || players.length !== draft.config.lobbySeats
                || players.length < MIN_DRAFT_START_PLAYERS) return {};
              const setup = setupHash(draft);
              if (!players.every((player) => isReady(draft, player, setup))) return {};
              const state = project(id, draft.createdByUserId, now);
              if (state.lobby.autoStart.eligible) {
                arm(id, "auto", false, now);
                return { changed };
              }
              if (state.lobby.errors.length) return fail(state.lobby.errors.join(" "));
              return {};
            }
            if (row.lobby_start_revision !== row.lobby_revision) {
              return fail("Lobby setup changed during the countdown; review it before starting again");
            }
            const deadline = row.lobby_start_at ? Date.parse(row.lobby_start_at) : NaN;
            if (!Number.isFinite(deadline)) return fail("Lobby start deadline is invalid");
            if (now.getTime() < deadline) return {};
            const players = roster(id);
            if (row.lobby_start_setup_hash !== scheduleHash(draft, players, setupHash(draft))) {
              return fail("Lobby setup changed during the countdown; review it before starting again");
            }
            const state = project(id, draft.createdByUserId, now);
            if (state.lobby.errors.length) return fail(state.lobby.errors.join(" "));
            if (!row.lobby_start_force && (!state.players.every((p) => isReadyToStart(p, row.lobby_start_kind))
              || (draft.config.mode === "theme" && draft.config.themeSelection === "player_pick" && players.some((p) => isUnclaimedHuman(draft, p))))) {
              return fail("Players are no longer Ready for this setup");
            }
            if (row.lobby_start_kind === "auto" && (!row.lobby_auto_start || row.lobby_auto_held || !state.lobby.autoStart.eligible)) {
              return fail("Lobby is no longer eligible for auto-start");
            }
            try {
              // start uses a nested savepoint: a kernel failure rolls its partial
              // assignment/deal back before the failure and Hold are committed.
              return { started: drafts.start(id, now, { scheduleToken: row.lobby_start_token }), changed };
            } catch (error) {
              console.warn("[draft-lobby] start failed", id, error);
              return fail(error instanceof Error ? error.message : "Draft start failed");
            }
          }).immediate();
          if (transition.started) result.started.push(transition.started);
          if (transition.changed) result.changedSlugs.push(transition.changed);
        } catch (error) {
          console.warn("[draft-lobby] tick failed", id, error);
          try {
            const changed = db.transaction(() => {
              const current = db.prepare("select web_slug from drafts where id = ? and status = 'pending'")
                .get(id) as { web_slug: string | null } | undefined;
              if (!current) return null;
              clearDraftLobbyStart(db, id);
              db.prepare(`update drafts set lobby_revision = lobby_revision + 1, lobby_auto_held = lobby_auto_start,
                lobby_start_error = ? where id = ?`).run(error instanceof Error ? error.message : "Lobby tick failed", id);
              return current.web_slug;
            }).immediate();
            if (changed) result.changedSlugs.push(changed);
          } catch (recoveryError) {
            console.warn("[draft-lobby] failed to record tick error", id, recoveryError);
          }
        }
      }
      return result;
    },
  };
}

export type DraftLobbyService = ReturnType<typeof createDraftLobbyService>;
