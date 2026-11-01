import { z } from "zod";
import { signToken, verifyToken } from "../internal-auth/index.js";

export const REMOTE_PHONE_PAIR_TTL_MS = 5 * 60_000;
const claims = z.object({
  id: z.string().regex(/^[a-f0-9]{32}$/), slug: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  guildId: z.string().min(1).max(100), userId: z.number().int().positive().safe(),
  seat: z.number().int().min(0).max(3), expiresAt: z.number().int().positive().safe(),
}).strict();
export type RemotePhoneClaims = z.infer<typeof claims>;
export function createRemotePhoneToken(scope: "pair" | "device", value: RemotePhoneClaims, secret: string) {
  return signToken(`remote-phone-${scope}`, claims.parse(value), secret);
}
export function verifyRemotePhoneToken(scope: "pair" | "device", token: string, secret: string, now = Date.now()): RemotePhoneClaims | null {
  return verifyToken(`remote-phone-${scope}`, token, secret, value => {
    const parsed = claims.safeParse(value);
    return parsed.success && parsed.data.expiresAt > now ? parsed.data : null;
  });
}
