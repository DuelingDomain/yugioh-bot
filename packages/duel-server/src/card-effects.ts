import type Database from "better-sqlite3";
import {
  buildArchetypeMatcher, engineInsightCard, interpret, matchCard, omitReadingChips, mayReadEffect,
  compactEffectName,
  type ReleaseDates,
  type CardTags, type Interpretation, type MatchEvent, type MatchFilter, type MatchTags,
} from "@yugidraft/shared/cards/effects";
import type { CardDatabase } from "./cards.js";
import { cardArtworkFamily } from "./card-artworks.js";

export interface CardEffectIndex {
  size: number;
  release(code: number): ReleaseDates;
  readQuery(text: string, omitted?: readonly string[]): Interpretation | null;
  match(code: number, reading: Interpretation): number | null;
  popularity(code: number): number;
}

const indexes = new WeakMap<CardDatabase, CardEffectIndex>();

/** Missing upstream artwork IDs can bridge by one unambiguous printed engine name. */
export function createCanonicalEffectResolver(cards: CardDatabase): (passcode: number, name?: string) => number {
  const byName = new Map<string, number | null>();
  for (const card of cards.all()) {
    if (card.type & 0x4000) continue;
    const canonical = cardArtworkFamily(cards, card.code)?.passcode ?? card.code;
    const key = compactEffectName(card.name);
    if (!byName.has(key)) byName.set(key, canonical);
    else if (byName.get(key) !== canonical) byName.set(key, null);
  }
  return (passcode, name) => cardArtworkFamily(cards, passcode)?.passcode
    ?? (name ? byName.get(compactEffectName(name)) : undefined) ?? passcode;
}

/** Intern empty/repeated arrays and filters; discard summaries, notes and conditions after each SQL row. */
export function createCardEffectIndex(db: Database.Database, cards: CardDatabase): CardEffectIndex {
  const arrays = new Map<string, string[]>();
  const filters = new Map<string, MatchFilter>();
  const intern = <T extends string>(values: T[]): T[] => {
    const key = JSON.stringify(values);
    let result = arrays.get(key);
    if (!result) { result = values; arrays.set(key, result); }
    return result as T[];
  };
  const filter = (what: CardTags["materials"][number]): MatchFilter => {
    const result: MatchFilter = {
      this_card: what.this_card, kinds: intern(what.kinds), subtypes: intern(what.subtypes), types: intern(what.types),
      attributes: intern(what.attributes), archetypes: intern(what.archetypes), names: intern(what.names),
      level_min: what.level_min, level_max: what.level_max,
    };
    const key = JSON.stringify(result);
    const existing = filters.get(key);
    if (existing) return existing;
    filters.set(key, result);
    return result;
  };
  const event = (value: CardTags["effects"][number]["actions"][number]): MatchEvent => ({
    verb: value.verb, player: value.player, from: intern(value.from), what: filter(value.what),
  });
  const facets = new Map<number, { tags: MatchTags; popularity: number }>();
  for (const raw of db.prepare("SELECT passcode,tags_json,popularity FROM card_tags").iterate() as Iterable<{ passcode: number; tags_json: string; popularity: number }>) {
    const tags = JSON.parse(raw.tags_json) as CardTags;
    facets.set(raw.passcode, { popularity: raw.popularity, tags: {
      roles: intern(tags.roles),
      supports: { archetypes: intern(tags.supports.archetypes), names: intern(tags.supports.names), types: intern(tags.supports.types), attributes: intern(tags.supports.attributes), subtypes: intern(tags.supports.subtypes) },
      effects: tags.effects.map(effect => ({ timing: effect.timing, location: intern(effect.location),
        actions: effect.actions.map(event), costs: effect.costs.map(event), triggers: effect.triggers.map(event) })),
    } });
  }
  const metadata = new Map([...cards.all()].map(card => [card.code, engineInsightCard(card)]));
  const releases = new Map((db.prepare("SELECT passcode,tcg_date,ocg_date FROM card_release").all() as { passcode: number; tcg_date: string | null; ocg_date: string | null }[])
    .map(row => [row.passcode, { ...(row.tcg_date ? { tcgDate: row.tcg_date } : {}), ...(row.ocg_date ? { ocgDate: row.ocg_date } : {}) }]));
  for (const card of metadata.values()) Object.assign(card, releases.get(card.id));
  const archetypes = new Set([...cards.setnames().values()]);
  for (const row of db.prepare("SELECT archetype FROM card_tag_profiles").iterate() as Iterable<{ archetype: string }>) archetypes.add(row.archetype);
  const findArchetypes = buildArchetypeMatcher(archetypes);
  const names = new Set([...metadata.values()].map(card => compactEffectName(card.name)));
  const index: CardEffectIndex = {
    size: facets.size,
    release: code => releases.get(metadata.get(code)?.id ?? code) ?? {},
    readQuery: (text, omitted) => {
      if (!mayReadEffect(text) || names.has(compactEffectName(text))) return null;
      const reading = interpret(text, findArchetypes);
      return reading ? omitReadingChips(reading, omitted) : null;
    },
    match: (code, reading) => {
      const card = metadata.get(code);
      return card ? matchCard(card, facets.get(card.id)?.tags, reading.query) : null;
    },
    popularity: code => facets.get(metadata.get(code)?.id ?? code)?.popularity ?? 0,
  };
  // These construction maps retain duplicate JSON keys; keep only the actual interned values.
  arrays.clear(); filters.clear();
  indexes.set(cards, index);
  return index;
}

export function cardEffectIndex(cards: CardDatabase): CardEffectIndex | undefined {
  return indexes.get(cards);
}
