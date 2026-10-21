import { signToken, verifyToken } from "../internal-auth/index.js";

export const ADMIN_SPECTATE_TTL_MS = 60_000;
export type AdminSpectateClaims = {
  role: "admin-spectator";
  kind: "duel" | "draft";
  slug: string;
  guildId: string;
  userId: number;
  expiresAt: number;
};
function valid(value: unknown): value is AdminSpectateClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).length === 6 && c.role === "admin-spectator" && (c.kind === "duel" || c.kind === "draft")
    && typeof c.slug === "string" && c.slug.length > 0 && c.slug.length <= 200
    && typeof c.guildId === "string" && c.guildId.length > 0
    && Number.isSafeInteger(c.userId) && (c.userId as number) > 0 && Number.isSafeInteger(c.expiresAt);
}
/** Separate signing purpose: this token grants no player subscription or action authority. */
export function createAdminSpectateToken(claims: AdminSpectateClaims, secret: string): string {
  if (!secret || !valid(claims)) throw new Error("Invalid admin spectator credentials");
  return signToken("admin-spectate", claims, secret);
}
export function verifyAdminSpectateToken(token: unknown, secret: string, now = Date.now()): AdminSpectateClaims | null {
  if (typeof token !== "string") return null;
  return verifyToken("admin-spectate", token, secret, c => valid(c) && c.expiresAt > now ? c : null);
}
