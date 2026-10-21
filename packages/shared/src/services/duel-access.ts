import Database from "better-sqlite3";
import { isOwnerUser, ReplayAccessError } from "../access/owner-access.js";
import { isDuelKind, isDuelKindSetup, isReplayFork, isDuelFormat, type DuelKind, type ReplayForkSetup } from "../duels/index.js";
import { parseStoredDuelSettings } from "../duels/settings.js";
import type { DuelConnectionTokenClaims } from "../ws/duel-token.js";
import { isDuelInviteReference } from "../notify/announce-payload.js";
import { DuelServiceError } from "./duels.js";
import { resolveDraftDatabasePath } from "./draft-access.js";

export interface DuelEventTarget {
  id: number;
  slug: string;
  guildId: string;
  kind: DuelKind;
  ownerUserId: number | null;
}

type AccessRow = { id: number; web_slug: string; guild_id: string; kind: unknown; setup_json: string | null;
  format: unknown; settings_json: string | null; organizer_player_id: number; status: string };

function prepareAccessStatements(db: Database.Database) {
  return {
    target: db.prepare<[string, string], AccessRow>(
      "select id,web_slug,guild_id,kind,setup_json,format,settings_json,organizer_player_id,status from duels where web_slug=? and guild_id=?"),
    player: db.prepare<[number, string], { user_id: number }>(
      "select p.user_id from players p join users u on u.id=p.user_id where p.id=? and p.guild_id=?"),
    seat: db.prepare<[number, number], { seat: number }>(
      "select seat from duel_seats where duel_id=? and player_id=?"),
    grant: db.prepare<[number, number], { allowed: number }>(
      "select 1 as allowed from duel_invite_grants where duel_id=? and player_id=?"),
    kicked: db.prepare<[number, number]>("select 1 from duel_kicked_players where duel_id=? and player_id=?"),
  };
}

const accessStatements = new WeakMap<Database.Database, ReturnType<typeof prepareAccessStatements>>();
function statements(db: Database.Database) {
  let cached = accessStatements.get(db);
  if (!cached) { cached = prepareAccessStatements(db); accessStatements.set(db, cached); }
  return cached;
}

function loadTarget(db: Database.Database, slug: string, guildId: string): { row: AccessRow; target: DuelEventTarget } | null {
  if (typeof slug !== "string" || !slug || typeof guildId !== "string" || !guildId) return null;
  const row = statements(db).target.get(slug, guildId);
  if (!row || !isDuelKind(row.kind) || !isDuelFormat(row.format)) return null;
  let setup: unknown;
  try { setup = row.setup_json === null ? undefined : JSON.parse(row.setup_json); } catch { return null; }
  if (!isDuelKindSetup(row.kind, setup, row.format)) return null;
  return { row, target: { id: row.id, slug: row.web_slug, guildId: row.guild_id, kind: row.kind,
    ownerUserId: isReplayFork(row) ? (setup as { replayFork: ReplayForkSetup }).replayFork.ownerUserId : null } };
}

/** Server-only event routing metadata. A stored reference never grants read access. */
export function findDuelEventTarget(db: Database.Database, slug: string, guildId: string): DuelEventTarget | null {
  try { return loadTarget(db, slug, guildId)?.target ?? null; } catch { throw new ReplayAccessError(503); }
}

/** Recheck persisted identity and access on join and before each broadcast. Never trust an acting seat. */
export function canReadDuel(db: Database.Database, claims: Pick<DuelConnectionTokenClaims, "slug" | "guildId" | "playerId" | "seat">): boolean {
  try {
    if (!Number.isSafeInteger(claims.playerId) || claims.playerId <= 0
      || (claims.seat !== null && (!Number.isInteger(claims.seat) || claims.seat < 0 || claims.seat > 3))) return false;
    const stored = loadTarget(db, claims.slug, claims.guildId);
    if (!stored) return false;
    const { row, target } = stored;
    const queries = statements(db);
    const player = queries.player.get(claims.playerId, claims.guildId);
    if (!player) return false;
    const seat = queries.seat.get(row.id, claims.playerId);
    const terminalPlayerRead = row.kind === "play" && ["completed", "interrupted", "cancelled"].includes(row.status) && seat !== undefined;
    if (!terminalPlayerRead && queries.kicked.get(row.id, claims.playerId)) return false;
    if (isReplayFork(target)) return claims.seat === 0 && seat?.seat === 0
      && row.organizer_player_id === claims.playerId && target.ownerUserId === player.user_id && isOwnerUser(player.user_id);
    // Ordinary openings can reorder seats while this identity's token is still valid.
    // The token seat is not an acting-seat grant; keep requiring a current seat.
    if (claims.seat !== null && seat === undefined) return false;
    const settings = parseStoredDuelSettings(row.settings_json);
    if (settings.visibility === "public") return true;
    return (isOwnerUser(player.user_id) && ["completed", "interrupted", "cancelled"].includes(row.status))
      || row.organizer_player_id === claims.playerId || seat !== undefined
      || !!queries.grant.get(row.id, claims.playerId);
  } catch { return false; }
}

/** A policy refusal, mapped by invite senders and sinks to HTTP 409. */
export class DuelInviteRefusalError extends DuelServiceError {
  readonly code = "DUEL_INVITE_REFUSED";
  constructor(message = "Duel invites are unavailable") {
    super(message, 409);
    this.name = "DuelInviteRefusalError";
  }
}

/** Both invite senders and the bot sink bind the signed reference to one ordinary stored duel. */
export function assertDuelInviteTarget(db: Database.Database, reference: unknown): DuelEventTarget {
  if (!isDuelInviteReference(reference)) throw new DuelInviteRefusalError("Invalid duel invite reference");
  const target = findDuelEventTarget(db, reference.slug, reference.guildId);
  if (!target || target.id !== reference.duelId || isReplayFork(target)) throw new DuelInviteRefusalError();
  return target;
}

/** Lazy readonly access to the database mounted by ws and bot. Missing data fails closed; event routing distinguishes outages from absent targets. */
export function createDuelAccessReader(databasePath = process.env.DATABASE_PATH ?? "./data/bot.sqlite") {
  const path = resolveDraftDatabasePath(databasePath);
  let db: Database.Database | undefined;
  function read<T>(work: (database: Database.Database) => T): T {
    try { db ??= new Database(path, { readonly: true, fileMustExist: true }); return work(db); }
    catch { throw new ReplayAccessError(503); }
  }
  return {
    canReadDuel: (claims: DuelConnectionTokenClaims) => {
      try { return read(database => canReadDuel(database, claims)); } catch { return false; }
    },
    findDuelEventTarget: (slug: string, guildId: string) => read(database => findDuelEventTarget(database, slug, guildId)),
    close() { db?.close(); db = undefined; },
  };
}
