import type { SectionId } from "./types";

export interface SectionDef {
  id: SectionId;
  title: string;
  /** One short line under the heading. */
  blurb: string;
  /** Poll period in ms. External-API sections poll slowly because the server caches them. */
  pollMs: number;
  /** Desktop width in a 12-column grid. Phones stack every panel. */
  span: 4 | 5 | 6 | 7 | 8 | 12;
}

/** Page order = reading order: act first (online, waitlist), then watch, then measure, then health. */
export const SECTIONS: SectionDef[] = [
  { id: "online", title: "Online now", blurb: "Signed-in people seen in the last 2 minutes", pollMs: 10_000, span: 6 },
  { id: "waitlist", title: "Waitlist", blurb: "People waiting for an invite", pollMs: 30_000, span: 6 },
  { id: "live", title: "Live duels and drafts", blurb: "Open tables and running drafts", pollMs: 10_000, span: 12 },
  { id: "stats", title: "Stats", blurb: "Days are UTC", pollMs: 60_000, span: 12 },
  { id: "errors", title: "Errors", blurb: "Latest Sentry issues", pollMs: 60_000, span: 7 },
  { id: "usage", title: "Usage", blurb: "PostHog visitors and views", pollMs: 60_000, span: 5 },
  { id: "system", title: "System", blurb: "Version, card data and services", pollMs: 30_000, span: 12 },
];

export const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s])) as Record<SectionId, SectionDef>;
