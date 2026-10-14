import { log } from "@yugidraft/shared/observability";
import { auth as clerkAuth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { ClerkBackendError } from "@yugidraft/shared/clerk";
import { createUserService, type User } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { syncClerkUser } from "./clerk-sync";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled, verifyE2ESession } from "./e2e-auth";
export interface SessionIdentity {
  userId: number; clerkUserId: string | null; name: string; email: string | null;
  image: string | null; discordUserId: string | null; conflict: "discord_claimed" | "both_have_history" | null;
}
export type SessionResult = { ok: true; identity: SessionIdentity } | { ok: false; status: 401 | 503 };
function identity(user: User, conflict: SessionIdentity["conflict"] = null): SessionResult {
  return { ok: true, identity: { userId: user.id, clerkUserId: user.clerkUserId, name: user.displayName,
    email: user.email, image: null, discordUserId: user.discordUserId, conflict } };
}
export async function resolveSessionIdentity(opts: { forceSync?: boolean } = {}): Promise<SessionResult> {
  const startedAt = performance.now();
  const unavailable = (reason: string): SessionResult => {
    // Emit only fixed reasons and elapsed time. Provider errors can contain private data.
    log("warn", "[web-access] session check unavailable", { reason, durationMs: Math.round(performance.now() - startedAt) });
    return { ok: false, status: 503 };
  };
  if (isE2EAuthEnabled()) {
    const cookie = (await cookies()).get(E2E_SESSION_COOKIE)?.value;
    const userId = verifyE2ESession(cookie, process.env.E2E_AUTH_SECRET ?? "");
    if (userId === null) return { ok: false, status: 401 };
    const user = createUserService(getDb()).findById(userId);
    return user ? identity(user) : { ok: false, status: 401 };
  }
  try {
    const { userId } = await clerkAuth();
    if (!userId) return { ok: false, status: 401 };
    const users = createUserService(getDb());
    const user = users.findByClerkId(userId);
    if (!opts.forceSync && !users.needsSync(user)) return identity(user!);
    const outcome = await syncClerkUser(userId);
    return outcome?.user ? identity(outcome.user, outcome.conflict) : unavailable("missing_user");
  } catch (error) {
    if (error instanceof ClerkBackendError && error.status === 404) return { ok: false, status: 401 };
    const reason = error instanceof ClerkBackendError
      ? error.message === "Clerk request timed out" ? "timeout"
        : error.status === 429 ? "rate_limited"
        : error.status >= 500 ? "provider_unavailable"
        : error.code === "missing_secret" ? "missing_secret" : "provider_check_failed"
      : "session_check_failed";
    return unavailable(reason);
  }
}
