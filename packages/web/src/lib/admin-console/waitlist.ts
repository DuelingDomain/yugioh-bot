import { ClerkBackendError, createClerkBackend } from "@yugidraft/shared/clerk";
import { cachedLoader, failed, notConfigured, ok, type SectionLoader } from "./section";
import type { SectionResult, WaitlistData } from "./types";

const TTL_MS = 45_000;
const LIMIT = 100;
const CACHE_KEY = Symbol.for("yugidraft.adminConsole.waitlist");

async function loadFromClerk(): Promise<SectionResult<WaitlistData>> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return notConfigured("Add CLERK_SECRET_KEY to show the waitlist.");
  try {
    const page = await createClerkBackend({ secretKey }).listWaitlistEntries({ status: "pending", orderBy: "-created_at", limit: LIMIT });
    const entries = page.data
      .filter((e) => e.status === "pending")
      .map((e) => ({ id: e.id, email: e.email_address, status: e.status, createdAt: typeof e.created_at === "number" ? e.created_at : null }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    return ok({ pending: Math.max(page.totalCount, entries.length), entries });
  } catch (error) {
    return failed(error instanceof ClerkBackendError && error.status === 429 ? "Clerk is busy. Try again in a minute." : "The waitlist could not be loaded from Clerk.");
  }
}

type Holder = { [CACHE_KEY]?: ReturnType<typeof cachedLoader<WaitlistData>> };
const holder = globalThis as Holder;
const cache = () => (holder[CACHE_KEY] ??= cachedLoader(TTL_MS, loadFromClerk));

/** Drop the cached list. Call it after an approve or reject so the next read is fresh. Shared across route bundles. */
export function bustWaitlistCache(): void {
  holder[CACHE_KEY] = undefined;
}

export const loadWaitlist: SectionLoader<"waitlist"> = async ({ now }) => {
  const result = await cache()();
  return { ...result, updatedAt: now };
};
