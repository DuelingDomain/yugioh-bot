import type Database from "better-sqlite3";
import { ArchetypeProfile, type Candidate, type Hook } from "../cards/effects/synergy.js";
import type { ArchetypeGuide } from "../cards/effects/guide.js";
import { log } from "../observability/index.js";

/** A corrupt optional profile must not prevent card-level suggestions. */
export function readInsightProfiles(
  db: Database.Database,
  cards: readonly Candidate[],
  warn: (message: string) => void = message => log("warn", message),
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

const GUIDE_PLAN_MAX = 900;
const GUIDE_WHY_MAX = 500;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** A hook can be searched when it says what the outside card does, reacts to, supports or prints. */
const searchable = (hook: Hook) => Boolean(hook.supports || hook.does || hook.reacts_to || hook.phrases.length);

function readStoredProfile(db: Database.Database, archetype: string): { archetype: string; profile: ArchetypeProfile } | null {
  const row = db.prepare<[string], { archetype: string; plan: string; hooks_json: string }>("SELECT archetype,plan,hooks_json FROM card_tag_profiles WHERE archetype=? COLLATE NOCASE").get(archetype);
  if (!row) return null;
  try {
    return { archetype: row.archetype, profile: ArchetypeProfile.parse({ plan: row.plan, hooks: JSON.parse(row.hooks_json) }) };
  } catch {
    return null;
  }
}

/** The "How it plays" panel for the first of these archetypes that has a stored profile. Read-only and small. */
export function readArchetypeGuide(db: Database.Database, archetypes: readonly string[]): ArchetypeGuide | null {
  for (const name of archetypes) {
    const stored = readStoredProfile(db, name);
    if (!stored) continue;
    return {
      archetype: stored.archetype,
      plan: clip(stored.profile.plan.trim(), GUIDE_PLAN_MAX),
      hooks: stored.profile.hooks.map(hook => ({ label: hook.label.trim(), why: clip(hook.why.trim(), GUIDE_WHY_MAX), searchable: searchable(hook) })),
    };
  }
  return null;
}

/** One hook of a stored profile, by its position in the panel. */
export function readArchetypeHook(db: Database.Database, archetype: string, index: number): { archetype: string; hook: Hook } | null {
  const stored = readStoredProfile(db, archetype);
  const hook = stored?.profile.hooks[index];
  return stored && hook && searchable(hook) ? { archetype: stored.archetype, hook } : null;
}
