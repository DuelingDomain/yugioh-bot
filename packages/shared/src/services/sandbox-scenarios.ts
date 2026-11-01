import type Database from "better-sqlite3";
import type { DuelFormat, DuelMode } from "../duels/index.js";
import {
  parseSandboxBoard,
  parseSandboxRun,
  SandboxBoardError,
  type SandboxBoard,
  type SandboxRun,
} from "../duels/sandbox-board.js";

export const SANDBOX_SCENARIO_LIMIT = 200;
const MAX_NAME_LENGTH = 80;

export class SandboxScenarioServiceError extends Error {
  constructor(message: string, public readonly status: number, public readonly path?: string) {
    super(message);
    this.name = "SandboxScenarioServiceError";
  }
}

export interface SandboxScenario {
  id: number;
  guildId: string;
  ownerPlayerId: number;
  name: string;
  format: DuelFormat;
  mode: DuelMode;
  board: SandboxBoard;
  run: SandboxRun;
  createdAt: string;
  updatedAt: string;
}

/** Full replacement on update. Format and mode come from the parsed board. */
export interface SandboxScenarioWrite {
  name: unknown;
  board: unknown;
  run: unknown;
}

/** Callers must first require a guild admin, in local and production environments. */
export interface SandboxScenarioService {
  /** All owners in the guild, newest update first; id breaks timestamp ties. */
  list(guildId: string): SandboxScenario[];
  get(id: number, guildId: string): SandboxScenario;
  /** ownerPlayerId is players.id, not a Discord user id. */
  create(guildId: string, ownerPlayerId: number, input: SandboxScenarioWrite): SandboxScenario;
  /** Another guild owner's scenario returns 403; missing/wrong guild returns 404. */
  update(id: number, guildId: string, ownerPlayerId: number, input: SandboxScenarioWrite): SandboxScenario;
  delete(id: number, guildId: string, ownerPlayerId: number): void;
}

interface ScenarioRow {
  id: number;
  guild_id: string;
  owner_player_id: number;
  name: string;
  format: DuelFormat;
  mode: DuelMode;
  board_json: string;
  run_json: string;
  created_at: string;
  updated_at: string;
}

function normalize(input: SandboxScenarioWrite) {
  if (typeof input.name !== "string" || !input.name.trim()) {
    throw new SandboxScenarioServiceError("Scenario name is required", 400);
  }
  const name = input.name.trim();
  if (name.length > MAX_NAME_LENGTH) {
    throw new SandboxScenarioServiceError(`Scenario name must be at most ${MAX_NAME_LENGTH} characters`, 400);
  }
  try {
    // B1 is the single source for structural validation, defaults, and JSON byte limits.
    const board = parseSandboxBoard(input.board);
    const run = parseSandboxRun(input.run);
    return { name, board, run };
  } catch (error) {
    if (error instanceof SandboxBoardError) {
      throw new SandboxScenarioServiceError(error.message, 400, error.path);
    }
    throw error;
  }
}

function mapScenario(row: ScenarioRow): SandboxScenario {
  return {
    id: row.id,
    guildId: row.guild_id,
    ownerPlayerId: row.owner_player_id,
    name: row.name,
    format: row.format,
    mode: row.mode,
    board: JSON.parse(row.board_json) as SandboxBoard,
    run: JSON.parse(row.run_json) as SandboxRun,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createSandboxScenarioService(db: Database.Database): SandboxScenarioService {
  const selectOne = db.prepare<[number, string], ScenarioRow>(
    "select * from sandbox_scenarios where id = ? and guild_id = ?",
  );
  const selectList = db.prepare<[string], ScenarioRow>(
    "select * from sandbox_scenarios where guild_id = ? order by updated_at desc, id desc",
  );
  const selectOwner = db.prepare<[number, string]>("select 1 from players where id = ? and guild_id = ?");
  const countOwned = db.prepare<[string, number], { count: number }>(
    "select count(*) as count from sandbox_scenarios where guild_id = ? and owner_player_id = ?",
  );
  const insertRow = db.prepare(`
    insert into sandbox_scenarios (guild_id, owner_player_id, name, format, mode, board_json, run_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `);
  const updateRow = db.prepare(`
    update sandbox_scenarios
    set name = ?, format = ?, mode = ?, board_json = ?, run_json = ?, updated_at = current_timestamp
    where id = ? and guild_id = ? and owner_player_id = ?
  `);
  const deleteRow = db.prepare(
    "delete from sandbox_scenarios where id = ? and guild_id = ? and owner_player_id = ?",
  );

  function load(id: number, guildId: string): ScenarioRow {
    const row = selectOne.get(id, guildId);
    if (!row) throw new SandboxScenarioServiceError("Scenario not found", 404);
    return row;
  }

  function requireOwner(id: number, guildId: string, ownerPlayerId: number): void {
    if (load(id, guildId).owner_player_id !== ownerPlayerId) {
      throw new SandboxScenarioServiceError("Only the scenario owner can change or delete it. Save as copy instead.", 403);
    }
  }

  const create = db.transaction((guildId: string, ownerPlayerId: number, input: SandboxScenarioWrite) => {
    if (!selectOwner.get(ownerPlayerId, guildId)) throw new SandboxScenarioServiceError("Player not found", 404);
    const { name, board, run } = normalize(input);
    if (countOwned.get(guildId, ownerPlayerId)!.count >= SANDBOX_SCENARIO_LIMIT) {
      throw new SandboxScenarioServiceError(`You can save at most ${SANDBOX_SCENARIO_LIMIT} scenarios per guild`, 409);
    }
    const result = insertRow.run(
      guildId, ownerPlayerId, name, board.format!, board.mode!, JSON.stringify(board), JSON.stringify(run),
    );
    return mapScenario(load(Number(result.lastInsertRowid), guildId));
  });

  const update = db.transaction((id: number, guildId: string, ownerPlayerId: number, input: SandboxScenarioWrite) => {
    requireOwner(id, guildId, ownerPlayerId);
    const { name, board, run } = normalize(input);
    updateRow.run(name, board.format!, board.mode!, JSON.stringify(board), JSON.stringify(run), id, guildId, ownerPlayerId);
    return mapScenario(load(id, guildId));
  });

  const remove = db.transaction((id: number, guildId: string, ownerPlayerId: number) => {
    requireOwner(id, guildId, ownerPlayerId);
    deleteRow.run(id, guildId, ownerPlayerId);
  });

  return {
    list: (guildId) => selectList.all(guildId).map(mapScenario),
    get: (id, guildId) => mapScenario(load(id, guildId)),
    // The write lock covers the limit check and insert across all app processes.
    create: (guildId, ownerPlayerId, input) => create.immediate(guildId, ownerPlayerId, input),
    update: (id, guildId, ownerPlayerId, input) => update.immediate(id, guildId, ownerPlayerId, input),
    delete: (id, guildId, ownerPlayerId) => remove.immediate(id, guildId, ownerPlayerId),
  };
}
