import {
  CARD_ATTRIBUTES,
  CARD_RACES,
  DUEL_BANLIST_OPTIONS,
  LINK_ARROWS,
  emptyCardQuery,
  type CardArchetype,
  type CardLimitStatus,
  type CardQuery,
  type CardRange,
  type CardSort,
  type MonsterTypeKey,
  type SortOrder,
  type SpellTypeKey,
  type TrapTypeKey,
} from "@yugidraft/shared/duels";

export const FRAME_KEYS = ["normal", "effect", "ritual", "fusion", "synchro", "xyz", "pendulum", "link"] as const;
export const ABILITY_KEYS = ["tuner", "flip", "gemini", "spirit", "toon", "union"] as const;

export const MONSTER_TYPE_LABELS: Record<MonsterTypeKey, string> = {
  normal: "Normal",
  effect: "Effect",
  ritual: "Ritual",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  pendulum: "Pendulum",
  link: "Link",
  tuner: "Tuner",
  flip: "Flip",
  gemini: "Gemini",
  spirit: "Spirit",
  toon: "Toon",
  union: "Union",
};

export const SPELL_TYPE_LABELS: Record<SpellTypeKey, string> = {
  normal: "Normal",
  "quick-play": "Quick-Play",
  continuous: "Continuous",
  equip: "Equip",
  field: "Field",
  ritual: "Ritual",
};

export const TRAP_TYPE_LABELS: Record<TrapTypeKey, string> = {
  normal: "Normal",
  continuous: "Continuous",
  counter: "Counter",
};

export const LIMIT_LABELS: Record<CardLimitStatus, string> = {
  forbidden: "Forbidden",
  limited: "Limited",
  "semi-limited": "Semi-Limited",
  unlimited: "Unlimited",
};

export const SORT_CHOICES: readonly { value: CardSort; label: string }[] = [
  { value: "match", label: "Best match" },
  { value: "type", label: "Card type" },
  { value: "name", label: "Name" },
  { value: "level", label: "Level / Rank" },
  { value: "atk", label: "ATK" },
  { value: "def", label: "DEF" },
];

export const BANLIST_CHOICES = DUEL_BANLIST_OPTIONS.map((option) => ({
  value: option.id,
  label: option.id === "none" ? "No banlist" : option.label,
}));

export function banlistLabel(id: string): string {
  return DUEL_BANLIST_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

const EMPTY_RANGE: CardRange = { min: null, max: null };

export function rangeActive(range: CardRange): boolean {
  return range.min != null || range.max != null;
}

export function rangeLabel(name: string, range: CardRange): string {
  const { min, max } = range;
  if (min != null && max != null) return min === max ? `${name} ${min}` : `${name} ${min}–${max}`;
  if (min != null) return `${name} ${min}+`;
  return `${name} ≤ ${max}`;
}

export function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function archetypeFor(code: number, archetypes: readonly CardArchetype[]): CardArchetype | undefined {
  return archetypes.find((archetype) => archetype.codes.includes(code));
}

/** Archetypes a card belongs to, by its own setcodes (no base-code widening, so the chips stay precise). */
export function cardArchetypes(setcodes: readonly number[] | undefined, archetypes: readonly CardArchetype[]): CardArchetype[] {
  const found: CardArchetype[] = [];
  for (const code of setcodes ?? []) {
    const archetype = archetypeFor(code, archetypes);
    if (archetype && !found.includes(archetype)) found.push(archetype);
  }
  return found;
}

export interface FilterChip {
  key: string;
  label: string;
  clear: (query: CardQuery) => CardQuery;
}

/** One removable chip per active filter value. Text, sort and the banlist itself are not chips. */
export function filterChips(query: CardQuery, archetypes: readonly CardArchetype[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (query.kind !== "any") {
    const label = query.kind === "monster" ? "Monsters" : query.kind === "spell" ? "Spells" : "Traps";
    chips.push({ key: "kind", label, clear: (q) => ({ ...q, kind: "any" }) });
  }
  const all = query.monsterTypeMatch === "all" && query.monsterTypes.length > 1;
  for (const key of query.monsterTypes) {
    chips.push({
      key: `monster-${key}`,
      label: all ? `${MONSTER_TYPE_LABELS[key]} (all)` : MONSTER_TYPE_LABELS[key],
      clear: (q) => ({ ...q, monsterTypes: q.monsterTypes.filter((item) => item !== key) }),
    });
  }
  for (const key of query.spellTypes) {
    chips.push({
      key: `spell-${key}`,
      label: `${SPELL_TYPE_LABELS[key]} Spell`,
      clear: (q) => ({ ...q, spellTypes: q.spellTypes.filter((item) => item !== key) }),
    });
  }
  for (const key of query.trapTypes) {
    chips.push({
      key: `trap-${key}`,
      label: `${TRAP_TYPE_LABELS[key]} Trap`,
      clear: (q) => ({ ...q, trapTypes: q.trapTypes.filter((item) => item !== key) }),
    });
  }
  for (const bit of query.attributes) {
    chips.push({
      key: `attribute-${bit}`,
      label: CARD_ATTRIBUTES.find((entry) => entry.bit === bit)?.label ?? `Attribute ${bit}`,
      clear: (q) => ({ ...q, attributes: q.attributes.filter((item) => item !== bit) }),
    });
  }
  for (const bit of query.races) {
    chips.push({
      key: `race-${bit}`,
      label: CARD_RACES.find((entry) => entry.bit === bit)?.label ?? `Type ${bit}`,
      clear: (q) => ({ ...q, races: q.races.filter((item) => item !== bit) }),
    });
  }
  const ranges = [
    ["level", "Level/Rank"],
    ["link", "Link"],
    ["scale", "Scale"],
    ["atk", "ATK"],
    ["def", "DEF"],
  ] as const;
  for (const [key, name] of ranges) {
    if (!rangeActive(query[key])) continue;
    chips.push({ key, label: rangeLabel(name, query[key]), clear: (q) => ({ ...q, [key]: EMPTY_RANGE }) });
  }
  if (query.arrows !== 0) {
    const names = LINK_ARROWS.filter((arrow) => (query.arrows & arrow.bit) !== 0).map((arrow) => arrow.label);
    const suffix = names.length > 1 ? (query.arrowMatch === "all" ? " (all)" : " (any)") : "";
    chips.push({ key: "arrows", label: `Arrows: ${names.join(", ")}${suffix}`, clear: (q) => ({ ...q, arrows: 0 }) });
  }
  const seen = new Set<string>();
  for (const code of query.archetypes) {
    const archetype = archetypeFor(code, archetypes);
    const name = archetype?.name ?? `Archetype 0x${code.toString(16)}`;
    // One archetype can own several setcodes; show it once.
    if (seen.has(name)) continue;
    seen.add(name);
    const codes = archetype?.codes ?? [code];
    chips.push({
      key: `archetype-${code}`,
      label: query.archetypeMode === "related" ? `${name} + related` : name,
      clear: (q) => ({ ...q, archetypes: q.archetypes.filter((item) => !codes.includes(item)) }),
    });
  }
  for (const key of query.limits) {
    chips.push({
      key: `limit-${key}`,
      label: LIMIT_LABELS[key],
      clear: (q) => ({ ...q, limits: q.limits.filter((item) => item !== key) }),
    });
  }
  if (query.pool !== "any") {
    chips.push({
      key: "pool",
      label: query.pool === "tcg" ? "TCG cards" : "OCG cards",
      clear: (q) => ({ ...q, pool: "any" }),
    });
  }
  return chips;
}

/** Resets every filter, but keeps the search text, sort and banlist. */
export function clearFilters(query: CardQuery): CardQuery {
  return {
    ...emptyCardQuery(),
    text: query.text,
    scope: query.scope,
    sort: query.sort,
    order: query.order,
    banlist: query.banlist,
    limit: query.limit,
  };
}

/** The part of a query that changes the result set (paging excluded). */
export function queryKey(query: CardQuery): string {
  const { offset: _offset, limit: _limit, ...rest } = query;
  return JSON.stringify(rest);
}

export type BrowserView = "grid" | "list";

export interface EditorPrefs {
  sort: CardSort;
  order: SortOrder;
  view: BrowserView;
  banlist: string;
  scope: CardQuery["scope"];
}

const PREFS_KEY = "yugidraft.deck-editor.v1";

export function loadEditorPrefs(): Partial<EditorPrefs> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const prefs = parsed as Record<string, unknown>;
    const out: Partial<EditorPrefs> = {};
    if (SORT_CHOICES.some((choice) => choice.value === prefs.sort)) out.sort = prefs.sort as CardSort;
    if (prefs.order === "asc" || prefs.order === "desc") out.order = prefs.order;
    if (prefs.view === "grid" || prefs.view === "list") out.view = prefs.view;
    if (typeof prefs.banlist === "string" && DUEL_BANLIST_OPTIONS.some((option) => option.id === prefs.banlist)) {
      out.banlist = prefs.banlist;
    }
    if (prefs.scope === "all" || prefs.scope === "name") out.scope = prefs.scope;
    return out;
  } catch {
    return {};
  }
}

export function saveEditorPrefs(prefs: EditorPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private windows and blocked storage: the editor still works without saved preferences.
  }
}
