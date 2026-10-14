import { signToken, verifyToken } from "../internal-auth/index.js";

export const DRAFT_ROOM_TOKEN_TTL_MS = 60_000;

export type DraftRoomTokenClaims = {
  slug: string;
  guildId: string;
  userId: number;
  expiresAt: number;
};

function validClaims(value: unknown): value is DraftRoomTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return Object.keys(claims).length === 4
    && typeof claims.slug === "string" && claims.slug.length > 0
    && typeof claims.guildId === "string" && claims.guildId.length > 0
    && typeof claims.userId === "number" && Number.isSafeInteger(claims.userId) && claims.userId > 0
    && Number.isSafeInteger(claims.expiresAt);
}

export function createDraftRoomToken(claims: DraftRoomTokenClaims, secret: string): string {
  if (!secret) throw new Error("Missing draft room secret");
  if (!validClaims(claims)) throw new Error("Invalid draft room claims");
  return signToken("draft-room", claims, secret);
}

export function verifyDraftRoomToken(
  token: unknown,
  secret: string,
  expected: { slug: string; userId: number },
  now = Date.now(),
): DraftRoomTokenClaims | null {
  if (typeof token !== "string") return null;
  return verifyToken("draft-room", token, secret, (claims) => {
    if (!validClaims(claims) || claims.expiresAt <= now
      || claims.slug !== expected.slug || claims.userId !== expected.userId) return null;
    return claims;
  });
}
