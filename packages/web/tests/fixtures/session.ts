import { parseUserId } from "../../src/lib/user-id";
import type { SessionResult } from "../../src/lib/session-identity";
/** Preserve each route fixture's actor and signed-out cases at the new resolver boundary. */
export function sessionFixture(read: () => unknown) {
  return { resolveSessionIdentity: async (): Promise<SessionResult> => {
    try {
      const session = await read() as { user?: { id?: unknown; name?: string; email?: string | null; image?: string | null; discordUserId?: string | null } } | null;
      const userId = parseUserId(session?.user?.id);
      if (userId === null) return { ok: false, status: 401 };
      return { ok: true, identity: { userId, clerkUserId: null, name: session?.user?.name ?? "Unknown", email: session?.user?.email ?? null, image: session?.user?.image ?? null, discordUserId: session?.user?.discordUserId || null, conflict: null } };
    } catch { return { ok: false, status: 503 }; }
  } };
}
