import { signToken, verifyToken } from "../internal-auth/index.js";

export const DUEL_CONNECTION_TTL_MS = 5 * 60 * 1000;

export type DuelConnectionTokenClaims = {
  slug: string;
  guildId: string;
  playerId: number;
  /** Stored connection identity. A fork always uses creator seat 0, never its acting seat. */
  seat: number | null;
  expiresAt: number;
};

export type DuelConnectionResponse = {
  token: string;
  guildId: string;
  expiresAt: number;
};

export type DuelJoinAck =
  | { ok: true; onlineSeats: number[]; spectatorCount: number }
  | { ok: false; error: string };

export type DuelChangedPayload = {
  slug: string;
};

export type DuelPresencePayload = {
  slug: string;
  /** Seats with at least one connected, visible duel tab; observers do not count. */
  onlineSeats: number[];
  spectatorCount: number;
};

export type DuelSubscriptionExpiredPayload = {
  slug: string;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isDuelConnectionTokenClaims(v: unknown): v is DuelConnectionTokenClaims {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== 5) return false;
  if (!("slug" in o) || !("guildId" in o) || !("playerId" in o) || !("seat" in o) || !("expiresAt" in o)) {
    return false;
  }
  if (!isNonEmptyString(o.slug) || !isNonEmptyString(o.guildId)) return false;
  if (typeof o.playerId !== "number" || !Number.isSafeInteger(o.playerId) || o.playerId <= 0) return false;
  if (o.seat !== null) {
    if (typeof o.seat !== "number" || !Number.isInteger(o.seat) || o.seat < 0 || o.seat > 3) return false;
  }
  if (typeof o.expiresAt !== "number" || !Number.isInteger(o.expiresAt) || !Number.isFinite(o.expiresAt)) {
    return false;
  }
  return true;
}

export function createDuelConnectionToken(claims: DuelConnectionTokenClaims, secret: string): string {
  if (!secret) throw new Error("Missing duel connection secret");
  if (!isDuelConnectionTokenClaims(claims)) throw new Error("Invalid duel connection claims");
  return signToken("duel-room", {
    slug: claims.slug,
    guildId: claims.guildId,
    playerId: claims.playerId,
    seat: claims.seat,
    expiresAt: claims.expiresAt,
  }, secret);
}

export function verifyDuelConnectionToken(
  token: string,
  secret: string,
  now: number = Date.now(),
): DuelConnectionTokenClaims | null {
  return verifyToken("duel-room", token, secret, (parsed) => {
    if (!isDuelConnectionTokenClaims(parsed) || parsed.expiresAt <= now) return null;
    return parsed;
  });
}
