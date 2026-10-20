import { cachedLoader, notConfigured, type SectionLoader } from "./section";
import type { SectionResult, WaitlistData } from "./types";

const CACHE_KEY = Symbol.for("yugidraft.adminConsole.waitlist");

/** The local build signs in with Discord only. The waitlist lives in Clerk, which this build does not include. */
async function loadWaitlistEntries(): Promise<SectionResult<WaitlistData>> {
  return notConfigured("The waitlist needs Clerk, which this local build does not use.");
}

type Holder = { [CACHE_KEY]?: ReturnType<typeof cachedLoader<WaitlistData>> };
const holder = globalThis as Holder;
const cache = () => (holder[CACHE_KEY] ??= cachedLoader(45_000, loadWaitlistEntries));

/** Drop the cached list. Kept so the approve and reject route matches the main branch. */
export function bustWaitlistCache(): void {
  holder[CACHE_KEY] = undefined;
}

export const loadWaitlist: SectionLoader<"waitlist"> = async ({ now }) => {
  const result = await cache()();
  return { ...result, updatedAt: now };
};

