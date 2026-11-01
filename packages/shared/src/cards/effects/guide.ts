import type { Interpretation } from "./query.js";

/** One line of an archetype's "How it plays" panel. */
export interface ArchetypeGuideHook {
  label: string;
  /** What in the archetype makes that kind of card work with it. */
  why: string;
  /**
   * What a click can find. `is`: cards that are this kind of card, named in plain words, one ("LIGHT Fiend monster")
   * and many ("LIGHT Fiend monsters"). `support`: cards that help it. A hook may offer both.
   */
  finds: { is: { one: string; many: string } | null; support: boolean };
  /** True when the hook offers at least one of the two. */
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
