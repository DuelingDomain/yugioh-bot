import { createClerkBackend, ClerkBackendError, profileFromClerkUser } from "@yugidraft/shared/clerk";
import { createUserService, type LinkOutcome } from "@yugidraft/shared/services";
import { getDb } from "./db";
const inFlight = new Map<string, Promise<LinkOutcome>>();
export async function settleClerkSync(clerkUserId: string): Promise<void> {
  try { await inFlight.get(clerkUserId); } catch {}
}
export function syncClerkUser(clerkUserId: string): Promise<LinkOutcome> {
  const pending = inFlight.get(clerkUserId);
  if (pending) return pending;
  const promise = (async () => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new ClerkBackendError("Clerk secret is unavailable", 0, "missing_secret", null);
    const backend = createClerkBackend({ secretKey });
    // Remote I/O must finish before the shared service acquires SQLite's writer lock.
    const json = await backend.getUser(clerkUserId);
    if (!json || json.id !== clerkUserId) throw new ClerkBackendError("Clerk user is unavailable", 0, "missing_user", null);
    const outcome = createUserService(getDb()).resolveClerkProfile(profileFromClerkUser(json));
    if (outcome.foldedUserId !== null || json.external_id !== String(outcome.user.id)) {
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await backend.updateUserExternalId(clerkUserId, String(outcome.user.id)); break; }
          catch { if (attempt === 2) console.warn("[clerk-sync] External identity repair failed"); }
        }
      })().catch(() => {});
    }
    return outcome;
  })();
  inFlight.set(clerkUserId, promise);
  void promise.finally(() => { if (inFlight.get(clerkUserId) === promise) inFlight.delete(clerkUserId); }).catch(() => {});
  return promise;
}
