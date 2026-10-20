import { ClerkBackendError, createClerkBackend } from "@yugidraft/shared/clerk";
import { cachedLoader, failed, notConfigured, ok, type SectionLoader } from "./section";
import type { SectionResult, WaitlistData, WaitlistDecision } from "./types";

const TTL_MS = 45_000;
const LIMIT = 100;
const DECIDED = 5;
const CACHE_KEY = Symbol.for("yugidraft.adminConsole.waitlist");

async function loadFromClerk(): Promise<SectionResult<WaitlistData>> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return notConfigured("Add CLERK_SECRET_KEY to show the waitlist.");
  try {
    const backend = createClerkBackend({ secretKey });
    // The decided list is a nice-to-have: when that call fails, the pending list still shows.
    const [page, latest] = await Promise.all([
      backend.listWaitlistEntries({ status: "pending", orderBy: "-created_at", limit: LIMIT }),
      backend.listWaitlistEntries({ orderBy: "-created_at", limit: 30 }).catch(() => null),
    ]);
    const time = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);
    const entries = page.data
      .filter((e) => e.status === "pending")
      .map((e) => ({ id: e.id, email: e.email_address, status: e.status, createdAt: time(e.created_at) }))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    const decided = latest?.data
      .filter((e): e is typeof e & { status: WaitlistDecision["status"] } => e.status === "invited" || e.status === "rejected" || e.status === "completed")
      .map((e) => ({ id: e.id, email: e.email_address, status: e.status, at: time(e.updated_at) ?? time(e.created_at) }))
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, DECIDED);
    return ok({ pending: Math.max(page.totalCount, entries.length), entries, ...(decided ? { decided } : {}) });
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
