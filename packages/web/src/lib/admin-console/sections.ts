import type { SectionId } from "./types";

/** Poll period per section, in ms. External-API sections poll slowly because the server caches them. */
export const POLL_MS: Record<SectionId, number> = {
  online: 10_000,
  live: 10_000,
  today: 15_000,
  waitlist: 30_000,
  system: 30_000,
  stats: 60_000,
  errors: 60_000,
  usage: 60_000,
  creators: 30_000,
  vision: 30_000,
  bridges: 60_000,
};
