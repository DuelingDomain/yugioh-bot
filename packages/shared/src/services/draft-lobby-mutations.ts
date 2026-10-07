import type Database from "better-sqlite3";
import {
  DRAFT_LOBBY_ERROR_STATUS, isValidLobbySeats,
  type DraftConfig, type DraftLobbyErrorCode,
} from "../types/index.js";

/** Coded failures can be mapped directly to the T01 HTTP error contract. */
export class DraftLobbyServiceError extends Error {
  readonly status: number;
  readonly notReadyPlayerIds?: number[];
  readonly unclaimedPlayerIds?: number[];
  readonly errors?: string[];
  readonly warnings?: string[];

  constructor(message: string, readonly code: DraftLobbyErrorCode, readonly details: {
    notReadyPlayerIds?: number[]; unclaimedPlayerIds?: number[]; errors?: string[]; warnings?: string[];
  } = {}) {
    super(message);
    this.name = "DraftLobbyServiceError";
    this.status = DRAFT_LOBBY_ERROR_STATUS[code];
    Object.assign(this, details);
  }
}

export interface DraftLobbyInvalidationOptions {
  /** Rules/pool edits clear all acknowledgements; roster edits preserve them. */
  clearReady?: boolean;
  /** Claim/assignment changes clear only these joined seats. */
  playerIds?: readonly number[];
  /** Use inside the same immediate transaction as the caller's config/claim write. */
  expectedRevision?: number;
}

export function assertLobbySeatTarget(config: DraftConfig, joined?: number): void {
  if (config.lobbySeats === undefined) return;
  if (!isValidLobbySeats(config.lobbySeats)) {
    throw new DraftLobbyServiceError("Lobby seats must be a whole number from 2 to 8", "INVALID_LOBBY_SEATS");
  }
  if (joined !== undefined && config.lobbySeats < joined) {
    throw new DraftLobbyServiceError("Lobby target cannot be smaller than the joined roster", "SEAT_TARGET_TOO_SMALL");
  }
}

/** No factory dependency: join/cancel/start and route transactions share this helper. */
export function clearDraftLobbyStart(db: Database.Database, draftId: number, terminal = false): void {
  db.prepare(`update drafts set lobby_start_at = null, lobby_start_kind = null,
    lobby_start_token = null, lobby_start_revision = null, lobby_start_setup_hash = null,
    lobby_start_force = 0${terminal ? ", lobby_auto_start = 0, lobby_auto_held = 0, lobby_start_error = null" : ""}
    where id = ?`).run(draftId);
}

/** Caller holds the write transaction. This never arms a replacement countdown. */
export function invalidateDraftLobby(
  db: Database.Database, draftId: number, options: DraftLobbyInvalidationOptions = {},
): void {
  const row = db.prepare("select status, config_json, lobby_revision from drafts where id = ?").get(draftId) as
    { status: string; config_json: string; lobby_revision: number } | undefined;
  if (!row) throw new DraftLobbyServiceError("Draft not found", "DRAFT_NOT_FOUND");
  if (row.status !== "pending") throw new DraftLobbyServiceError("Draft must be pending", "DRAFT_NOT_PENDING");
  if (options.expectedRevision !== undefined && options.expectedRevision !== row.lobby_revision) {
    throw new DraftLobbyServiceError("Lobby changed; refresh before retrying", "STALE_LOBBY");
  }
  const joined = (db.prepare("select count(*) as n from draft_players where draft_id = ?").get(draftId) as { n: number }).n;
  assertLobbySeatTarget(JSON.parse(row.config_json) as DraftConfig, joined);
  if (options.clearReady) {
    db.prepare("update draft_players set ready_at = null, ready_setup_hash = null where draft_id = ?").run(draftId);
  } else if (options.playerIds) {
    const clear = db.prepare("update draft_players set ready_at = null, ready_setup_hash = null where draft_id = ? and player_id = ?");
    for (const id of options.playerIds) clear.run(draftId, id);
  }
  clearDraftLobbyStart(db, draftId);
  db.prepare("update drafts set lobby_revision = lobby_revision + 1, lobby_start_error = null where id = ?").run(draftId);
}
