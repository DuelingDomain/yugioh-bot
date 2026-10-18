import type Database from "better-sqlite3";
import type { CardTags, MatchEffect, MatchEvent, MatchFilter, MatchTags, ReleaseDates } from "@yugidraft/shared/cards/effects";

export interface CardEffectFacets {
  facets: Map<number, MatchTags & { popularity: number }>;
  releases: Map<number, ReleaseDates>;
  archetypes: string[];
}

/** Pure SQL preparation, shared by synchronous fixtures and the disposable startup process. */
export function buildCardEffectFacets(db: Database.Database, flush?: (facets: CardEffectFacets["facets"]) => void): CardEffectFacets {
  const arrays = new Map<string, string[]>();
  const filters = new Map<string, MatchFilter>();
  const events = new Map<string, MatchEvent>();
  const eventArrays = new Map<string, MatchEvent[]>();
  const effects = new Map<string, MatchEffect>();
  const effectArrays = new Map<string, MatchEffect[]>();
  const supportSets = new Map<string, MatchTags["supports"]>();
  let identities = new WeakMap<object, number>();
  let nextIdentity = 0;
  const identity = (value: object) => {
    let key = identities.get(value);
    if (key === undefined) { key = nextIdentity++; identities.set(value, key); }
    return key;
  };
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
    const key = `${Number(result.this_card)}:${identity(result.kinds)}:${identity(result.subtypes)}:${identity(result.types)}:${identity(result.attributes)}:${identity(result.archetypes)}:${identity(result.names)}:${result.level_min}:${result.level_max}`;
    const existing = filters.get(key);
    if (existing) return existing;
    filters.set(key, result);
    return result;
  };
  const event = (value: CardTags["effects"][number]["actions"][number]): MatchEvent => {
    const from = intern(value.from), what = filter(value.what);
    const key = `${value.verb}:${value.player}:${identity(from)}:${identity(what)}`;
    let result = events.get(key);
    if (!result) { result = { verb: value.verb, player: value.player, from, what }; events.set(key, result); }
    return result;
  };
  const eventArray = (values: CardTags["effects"][number]["actions"]): MatchEvent[] => {
    const result = values.map(event), key = result.map(identity).join(",");
    const existing = eventArrays.get(key);
    if (existing) return existing;
    eventArrays.set(key, result);
    return result;
  };
  const effectArray = (values: CardTags["effects"]): MatchEffect[] => {
    const result = values.map(value => {
      const location = intern(value.location), actions = eventArray(value.actions), costs = eventArray(value.costs), triggers = eventArray(value.triggers);
      const key = `${value.timing}:${identity(location)}:${identity(actions)}:${identity(costs)}:${identity(triggers)}`;
      let effect = effects.get(key);
      if (!effect) { effect = { timing: value.timing, location, actions, costs, triggers }; effects.set(key, effect); }
      return effect;
    });
    const key = result.map(identity).join(","), existing = effectArrays.get(key);
    if (existing) return existing;
    effectArrays.set(key, result);
    return result;
  };
  const supports = (value: CardTags["supports"]): MatchTags["supports"] => {
    const result = { archetypes: intern(value.archetypes), names: intern(value.names), types: intern(value.types), attributes: intern(value.attributes), subtypes: intern(value.subtypes) };
    const key = Object.values(result).map(identity).join(","), existing = supportSets.get(key);
    if (existing) return existing;
    supportSets.set(key, result);
    return result;
  };
  let facets = new Map<number, MatchTags & { popularity: number }>();
  const flushFacets = () => {
    if (!flush) return;
    const chunk = facets;
    facets = new Map();
    flush(chunk);
  };
  let rows = 0;
  for (const raw of db.prepare(`SELECT passcode,popularity,json_object(
    'roles',json_extract(tags_json,'$.roles'),
    'supports',json_extract(tags_json,'$.supports'),
    'effects',json_extract(tags_json,'$.effects')) AS tags_json FROM card_tags`).iterate() as Iterable<{ passcode: number; tags_json: string; popularity: number }>) {
    const tags = JSON.parse(raw.tags_json) as CardTags;
    facets.set(raw.passcode, { popularity: raw.popularity,
      roles: intern(tags.roles),
      supports: supports(tags.supports), effects: effectArray(tags.effects),
    });
    // Bound construction keys independently of catalog size. Previously
    // interned values remain immutable and owned by their retained facets.
    if (++rows % 1024 === 0) {
      arrays.clear(); filters.clear(); events.clear(); eventArrays.clear(); effects.clear(); effectArrays.clear(); supportSets.clear();
      identities = new WeakMap(); nextIdentity = 0;
      flushFacets();
    }
  }
  const releases = new Map<number, ReleaseDates>(), releasePairs = new Map<string, ReleaseDates>();
  for (const row of db.prepare("SELECT passcode,tcg_date,ocg_date FROM card_release").iterate() as Iterable<{ passcode: number; tcg_date: string | null; ocg_date: string | null }>) {
    const key = `${row.tcg_date ?? ""}:${row.ocg_date ?? ""}`;
    let value = releasePairs.get(key);
    if (!value) { value = { ...(row.tcg_date ? { tcgDate: row.tcg_date } : {}), ...(row.ocg_date ? { ocgDate: row.ocg_date } : {}) }; releasePairs.set(key, value); }
    releases.set(row.passcode, value);
  }
  const archetypes = (db.prepare("SELECT archetype FROM card_tag_profiles").all() as { archetype: string }[]).map(row => row.archetype);
  return { facets, releases, archetypes };
}
