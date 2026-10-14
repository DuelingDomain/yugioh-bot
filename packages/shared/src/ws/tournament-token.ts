import { signToken, verifyToken } from "../internal-auth/index.js";

export const TOURNAMENT_ROOM_TOKEN_TTL_MS = 60_000;

export type TournamentRoomTokenClaims = {
  slug: string;
  guildId: string;
  userId: number;
  expiresAt: number;
};

function validClaims(value: unknown): value is TournamentRoomTokenClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return Object.keys(claims).length === 4
    && typeof claims.slug === "string" && claims.slug.length > 0
    && typeof claims.guildId === "string" && claims.guildId.length > 0
    && typeof claims.userId === "number" && Number.isSafeInteger(claims.userId) && claims.userId > 0
    && Number.isSafeInteger(claims.expiresAt);
}

export function createTournamentRoomToken(claims: TournamentRoomTokenClaims, secret: string): string {
  if (!secret) throw new Error("Missing tournament room secret");
  if (!validClaims(claims)) throw new Error("Invalid tournament room claims");
  return signToken("tournament-room", claims, secret);
}

export function verifyTournamentRoomToken(
  token: unknown,
  secret: string,
  expected: { slug: string; userId: number },
  now = Date.now(),
): TournamentRoomTokenClaims | null {
  if (typeof token !== "string") return null;
  return verifyToken("tournament-room", token, secret, (claims) => {
    if (!validClaims(claims) || claims.expiresAt <= now
      || claims.slug !== expected.slug || claims.userId !== expected.userId) return null;
    return claims;
  });
}
