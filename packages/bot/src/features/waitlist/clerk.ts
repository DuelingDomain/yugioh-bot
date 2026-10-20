import { createClerkBackend, type ClerkBackend, type ClerkWaitlistEntryJson } from "@yugidraft/shared/clerk";
import { normalizeEmail } from "./presentation.js";

export class WaitlistInputError extends Error {}
export function clerkBackend(): ClerkBackend {
  if (!process.env.CLERK_SECRET_KEY) throw new WaitlistInputError("Clerk is not configured. Ask the owner to set CLERK_SECRET_KEY.");
  return createClerkBackend({ secretKey: process.env.CLERK_SECRET_KEY, timeoutMs: 3000 });
}

/** Clerk query is a partial match. Never decide a different entry returned by it. */
export async function findEntry(backend: ClerkBackend, reference: string): Promise<ClerkWaitlistEntryJson | null> {
  const exact: ClerkWaitlistEntryJson[] = [];
  let offset = 0;
  for (let pageNumber = 0; pageNumber < 5; pageNumber++) {
    const page = await backend.listWaitlistEntries({ query: reference, limit: 100, offset });
    exact.push(...page.data.filter(entry => entry.id === reference || normalizeEmail(entry.email_address) === normalizeEmail(reference)));
    offset += page.data.length;
    if (offset >= page.totalCount) {
      const pending = exact.filter(entry => entry.status === "pending");
      if (pending.length === 1) return pending[0];
      if (exact.length === 1) return exact[0];
      if (exact.length === 0) return null;
      break;
    }
    if (page.data.length === 0) break;
  }
  throw new WaitlistInputError("The entry is ambiguous. Use its Clerk entry ID.");
}
