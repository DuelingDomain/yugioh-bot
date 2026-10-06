import type { DuelFormat, DuelMode } from "@yugidraft/shared/duels";

export const FORMAT_LABELS: Record<DuelFormat, string> = { "1v1": "1v1", ffa3: "3-way", ffa4: "4-way", tag: "Tag" };
export const MODE_LABELS: Record<DuelMode, string> = { normal: "Normal", domain: "Domain" };

const MAX_NAME = 80;
const COPY_SUFFIX = " (copy)";

/** Name for "Save as copy": the old name plus " (copy)", cut so it still fits the 80 character limit. */
export function copyName(name: string): string {
  const base = name.trim();
  if (base.endsWith(COPY_SUFFIX) && base.length <= MAX_NAME) return base;
  return `${base.slice(0, MAX_NAME - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

/** The day part of a SQLite UTC stamp ("2026-10-05 14:03:00" -> "2026-10-05"). Same text on server and browser. */
export function updatedDay(stamp: string): string {
  return stamp.slice(0, 10);
}

export function playHref(id: number): string {
  return `/sandbox/${id}?play=1`;
}

/** Full share link for a saved scenario. It starts the duel at once for any developer who opens it. */
export function shareUrl(origin: string, id: number): string {
  return `${origin}${playHref(id)}`;
}
