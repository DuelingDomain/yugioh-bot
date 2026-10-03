import { createHmac, timingSafeEqual } from "node:crypto";

export const DRAFT_ROOM_TOKEN_TTL_MS = 60_000;

export type DraftRoomTokenClaims = {
  slug: string;
  guildId: string;
  userId: string;
  expiresAt: number;
};

function validClaims(value: unknown): value is DraftRoomTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return Object.keys(claims).length === 4
    && typeof claims.slug === "string" && claims.slug.length > 0
    && typeof claims.guildId === "string" && claims.guildId.length > 0
    && typeof claims.userId === "string" && claims.userId.length > 0
    && Number.isSafeInteger(claims.expiresAt);
}

function signature(payload: Buffer, secret: string): Buffer {
  // Domain separation prevents room tokens from being used as internal HTTP signatures.
  const key = createHmac("sha256", secret).update("yugidraft:draft-room:v1").digest();
  return createHmac("sha256", key).update(payload).digest();
}

export function createDraftRoomToken(claims: DraftRoomTokenClaims, secret: string): string {
  if (!secret) throw new Error("Missing draft room secret");
  if (!validClaims(claims)) throw new Error("Invalid draft room claims");
  const payload = Buffer.from(JSON.stringify(claims));
  return `${payload.toString("base64url")}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyDraftRoomToken(
  token: unknown,
  secret: string,
  expected: { slug: string; userId: string },
  now = Date.now(),
): DraftRoomTokenClaims | null {
  if (!secret || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
  const payload = Buffer.from(parts[0], "base64url");
  const received = Buffer.from(parts[1], "base64url");
  const digest = signature(payload, secret);
  if (received.length !== digest.length || !timingSafeEqual(received, digest)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(payload.toString("utf8"));
  } catch {
    return null;
  }
  if (!validClaims(claims) || claims.expiresAt <= now
    || claims.slug !== expected.slug || claims.userId !== expected.userId) return null;
  return claims;
}
