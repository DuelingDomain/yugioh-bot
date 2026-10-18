import type Database from "better-sqlite3";
import { ArchetypeProfile, type Candidate } from "../cards/effects/synergy.js";

/** A corrupt optional profile must not prevent card-level suggestions. */
export function readInsightProfiles(
  db: Database.Database,
  cards: readonly Candidate[],
  warn: (message: string) => void = message => console.warn(message),
): ReadonlyMap<string, ArchetypeProfile> {
  const profiles = new Map<string, ArchetypeProfile>();
  const find = db.prepare<[string], { plan: string; hooks_json: string }>("SELECT plan,hooks_json FROM card_tag_profiles WHERE archetype=? COLLATE NOCASE");
  for (const archetype of new Set(cards.flatMap(({ card }) => card.archetype ? [card.archetype] : []))) {
    const row = find.get(archetype);
    if (!row) continue;
    try {
      profiles.set(archetype, ArchetypeProfile.parse({ plan: row.plan, hooks: JSON.parse(row.hooks_json) }));
    } catch {
      warn(`Skipped unreadable synergy profile for ${archetype}.`);
    }
  }
  return profiles;
}
