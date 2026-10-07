import { resolveSessionIdentity } from "./session-identity";
export { isE2EAuthEnabled } from "./e2e-auth";
export class SessionUnavailableError extends Error {
  constructor() { super("Session unavailable"); this.name = "SessionUnavailableError"; }
}
export type Session = { user: { id: string; name: string; email: string | null; image: string | null; discordUserId: string | null }; expires: string };
export async function auth(): Promise<Session | null> {
  const result = await resolveSessionIdentity();
  if (!result.ok) { if (result.status === 503) throw new SessionUnavailableError(); return null; }
  const user = result.identity;
  return { user: { id: String(user.userId), name: user.name, email: user.email, image: user.image, discordUserId: user.discordUserId },
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() };
}
