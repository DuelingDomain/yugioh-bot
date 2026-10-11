import type Database from "better-sqlite3";
import { DEFAULT_DUEL_KIND, isDuelKind, isDuelKindSetup, isReplayFork, type DuelKind } from "../duels/duel-kind.js";
import { REPLAY_SOURCE_SLUG_MAX_LENGTH, type ReplayForkSetup } from "../duels/replay-fork.js";

/** Local NextAuth user IDs (Discord IDs), kept as text. Read at each authorization; empty denies all. */
export function ownerUserIds(): Set<string> {
  const ids = new Set<string>();
  for (const part of (process.env.OWNER_USER_IDS ?? "").split(",")) {
    const id = part.trim();
    if (/^[1-9]\d{0,24}$/.test(id)) ids.add(id);
  }
  return ids;
}

export function isOwnerUser(userId: string): boolean {
  return typeof userId === "string" && ownerUserIds().has(userId);
}

export interface OwnerPlayerActor {
  guildId: string;
  playerId: number;
  /** An assertion from the web session, never an authority. The database mapping must match. */
  userId?: string;
}

export interface ResolvedOwnerActor extends OwnerPlayerActor {
  userId: string;
}

/**
 * For trusted server actors only. The host must verify the internal signature first.
 * Host/service callers can supply a trusted player ID without a user ID. The stored
 * mapping and current allowlist determine access; request flags grant no authority.
 */
export function resolveOwnerPlayer(db: Database.Database, actor: OwnerPlayerActor): ResolvedOwnerActor | null {
  if (typeof actor.guildId !== "string" || !actor.guildId
    || !Number.isSafeInteger(actor.playerId) || actor.playerId <= 0
    || (actor.userId !== undefined && (typeof actor.userId !== "string" || !/^[1-9]\d{0,24}$/.test(actor.userId)))) return null;
  const row = readAccess(() => db.prepare<[number, string], { discord_user_id: string }>(`
    select p.discord_user_id from players p
    where p.id = ? and p.guild_id = ?
  `).get(actor.playerId, actor.guildId));
  if (!row || (actor.userId !== undefined && row.discord_user_id !== actor.userId) || !isOwnerUser(row.discord_user_id)) return null;
  return { guildId: actor.guildId, playerId: actor.playerId, userId: row.discord_user_id };
}

export class ReplayAccessError extends Error {
  readonly code: "ACCESS_DENIED" | "ACCESS_UNAVAILABLE";

  constructor(readonly status: 404 | 503 = 404) {
    super(status === 503 ? "Replay access is unavailable" : "Not found");
    this.name = "ReplayAccessError";
    this.code = status === 503 ? "ACCESS_UNAVAILABLE" : "ACCESS_DENIED";
  }
}

function readAccess<T>(read: () => T): T {
  try {
    return read();
  } catch {
    throw new ReplayAccessError(503);
  }
}

/** Server-only access metadata. This reference is not an access grant; recheck on each request and retry. */
export interface ReplayDuelAccess {
  id: number;
  slug: string;
  guildId: string;
  kind: DuelKind;
  sandbox: boolean;
  ownerUserId: string | null;
}

function requireOwnerPlayer(db: Database.Database, actor: OwnerPlayerActor): ResolvedOwnerActor {
  const owner = resolveOwnerPlayer(db, actor);
  if (!owner) throw new ReplayAccessError();
  return owner;
}

function storedDuelAccess(db: Database.Database, slug: string, guildId: string): ReplayDuelAccess {
  if (typeof slug !== "string" || !slug || slug.length > REPLAY_SOURCE_SLUG_MAX_LENGTH
    || typeof guildId !== "string" || !guildId) throw new ReplayAccessError();
  const row = readAccess(() => db.prepare<[string, string], {
    id: number; web_slug: string; guild_id: string; kind?: unknown; sandbox?: number; setup_json: string | null;
  }>("select * from duels where web_slug = ? and guild_id = ?").get(slug, guildId));
  if (!row) throw new ReplayAccessError();
  // P0 predates B3's kind column. Only a row with no column uses the old play default.
  const kind = Object.hasOwn(row, "kind") ? row.kind : DEFAULT_DUEL_KIND;
  let setup: unknown;
  try {
    setup = row.setup_json === null ? undefined : JSON.parse(row.setup_json);
  } catch {
    throw new ReplayAccessError();
  }
  if (!isDuelKind(kind) || !isDuelKindSetup(kind, setup)) throw new ReplayAccessError();
  return {
    id: row.id, slug: row.web_slug, guildId: row.guild_id, kind,
    sandbox: row.sandbox === 1 || (typeof setup === "object" && setup !== null && !!(setup as { sandbox?: unknown }).sandbox),
    ownerUserId: isReplayFork({ kind }) ? (setup as { replayFork: ReplayForkSetup }).replayFork.ownerUserId : null,
  };
}

function assertCreator(source: ReplayDuelAccess, owner: ResolvedOwnerActor): void {
  if (isReplayFork(source) && source.ownerUserId !== owner.userId) throw new ReplayAccessError();
}

/**
 * Narrow diagnostic access to a play source in the trusted actor's guild, even without
 * a source seat or invite. A fork source still requires its creator. No writes or I/O.
 * Call before loading decks, journals, private snapshots, caches or retry results.
 */
export function assertOwnerReplaySourceAccess(db: Database.Database, slug: string, actor: OwnerPlayerActor): ReplayDuelAccess {
  const owner = requireOwnerPlayer(db, actor);
  const source = storedDuelAccess(db, slug, owner.guildId);
  // Local sandboxes retain their creator and Discord allowlist gate on ordinary replay routes.
  if (source.sandbox) throw new ReplayAccessError();
  assertCreator(source, owner);
  return source;
}

/** Dedicated fork paths reject play sources as well as unauthorized creators. */
export function assertReplayForkAccess(db: Database.Database, slug: string, actor: OwnerPlayerActor): ReplayDuelAccess {
  const source = assertOwnerReplaySourceAccess(db, slug, actor);
  if (!isReplayFork(source)) throw new ReplayAccessError();
  return source;
}

/**
 * Guard existing duel routes before data, actions or tokens. For play duels this adds
 * no access right: the caller must keep its normal room/action checks. For forks it
 * checks the current allowlist and stored creator, independent of seats and grants.
 */
export function assertDuelForkAccess(db: Database.Database, slug: string, actor: OwnerPlayerActor): ReplayDuelAccess {
  const source = storedDuelAccess(db, slug, actor.guildId);
  if (isReplayFork(source)) assertCreator(source, requireOwnerPlayer(db, actor));
  return source;
}
