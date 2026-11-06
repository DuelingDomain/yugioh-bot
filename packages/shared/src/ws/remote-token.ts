import { z } from "zod";
import { signToken, verifyToken } from "../internal-auth/index.js";
export const REMOTE_CONNECTION_TTL_MS = 5 * 60_000;
const claimsSchema = z.strictObject({
  slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), guildId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  userId: z.number().int().positive().safe(), seat: z.number().int().min(0).max(3), expiresAt: z.number().int().nonnegative().safe(),
});
export type RemoteConnectionTokenClaims = z.infer<typeof claimsSchema>;
export function createRemoteConnectionToken(claims: RemoteConnectionTokenClaims, secret: string): string {
  return signToken("remote-room", claimsSchema.parse(claims), secret);
}
export function verifyRemoteConnectionToken(token: string, secret: string, now = Date.now()): RemoteConnectionTokenClaims | null {
  return verifyToken("remote-room", token, secret, value => {
    const parsed = claimsSchema.safeParse(value);
    return parsed.success && parsed.data.expiresAt > now ? parsed.data : null;
  });
}
