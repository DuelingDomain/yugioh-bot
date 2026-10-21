import type { Interpretation } from "./query.js";

/** One line of an archetype's "How it plays" panel. */
export interface ArchetypeGuideHook {
  label: string;
  /** What in the archetype makes that kind of card work with it. */
  why: string;
  /** True when the hook holds enough data to search for the cards that fit it. */
  searchable: boolean;
}

/** The small payload behind the "How it plays" panel: the game plan and what works with the archetype. */
export interface ArchetypeGuide {
  archetype: string;
  plan: string;
  hooks: ArchetypeGuideHook[];
}

/** The archetypes a reading names, the ones it supports first. */
export function readingArchetypes(reading: Interpretation | null | undefined): string[] {
  if (!reading) return [];
  const intent = (reading.query.intent?.kind === "counters" || reading.query.intent?.kind === "archetype_role") ? [reading.query.intent.archetype] : [];
  return [...new Set([...intent, ...reading.query.supports?.archetypes ?? [], ...reading.query.card.archetypes])];
}
