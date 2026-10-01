import type { DuelCardInfo } from "./index.js";

/**
 * Structured card search for the deck editor. The duel host runs it over the engine catalog
 * (cards.cdb); the web validates the same shape before it forwards a request.
 */

export type CardKindFilter = "any" | "monster" | "spell" | "trap";
export type CardSearchScope = "all" | "name";
export type CardMatch = "any" | "all";
export type CardPoolFilter = "any" | "tcg" | "ocg";
export type CardLimitStatus = "forbidden" | "limited" | "semi-limited" | "unlimited";
export type CardSort = "match" | "type" | "name" | "level" | "atk" | "def";
export type SortOrder = "asc" | "desc";

export const MONSTER_TYPE_KEYS = [
  "normal",
  "effect",
  "ritual",
  "fusion",
  "synchro",
  "xyz",
  "pendulum",
  "link",
  "tuner",
  "flip",
  "gemini",
  "spirit",
  "toon",
  "union",
] as const;
export type MonsterTypeKey = (typeof MONSTER_TYPE_KEYS)[number];

export const SPELL_TYPE_KEYS = ["normal", "quick-play", "continuous", "equip", "field", "ritual"] as const;
export type SpellTypeKey = (typeof SPELL_TYPE_KEYS)[number];

export const TRAP_TYPE_KEYS = ["normal", "continuous", "counter"] as const;
export type TrapTypeKey = (typeof TRAP_TYPE_KEYS)[number];

export const CARD_LIMIT_KEYS = ["forbidden", "limited", "semi-limited", "unlimited"] as const;

/** Type bits from the core (ocgapi_constants). */
export const CARD_TYPE_BITS = {
  monster: 0x1,
  spell: 0x2,
  trap: 0x4,
  normal: 0x10,
  effect: 0x20,
  fusion: 0x40,
  ritual: 0x80,
  spirit: 0x200,
  union: 0x400,
  gemini: 0x800,
  tuner: 0x1000,
  synchro: 0x2000,
  token: 0x4000,
  quickPlay: 0x10000,
  continuous: 0x20000,
  equip: 0x40000,
  field: 0x80000,
  counter: 0x100000,
  flip: 0x200000,
  toon: 0x400000,
  xyz: 0x800000,
  pendulum: 0x1000000,
  link: 0x4000000,
} as const;

const SPELL_ORDER = [
  CARD_TYPE_BITS.quickPlay,
  CARD_TYPE_BITS.continuous,
  CARD_TYPE_BITS.equip,
  CARD_TYPE_BITS.field,
  CARD_TYPE_BITS.ritual,
];
const TRAP_ORDER = [CARD_TYPE_BITS.continuous, CARD_TYPE_BITS.counter];

/**
 * Deck order rank: Normal, Effect, Ritual, Fusion, Synchro, Xyz and Link Monsters,
 * then Spells (Normal first) and Traps (Normal first).
 */
export function cardTypeRank(type: number): number {
  const T = CARD_TYPE_BITS;
  if (type & T.monster) {
    if (type & T.link) return 6;
    if (type & T.xyz) return 5;
    if (type & T.synchro) return 4;
    if (type & T.fusion) return 3;
    if (type & T.ritual) return 2;
    if ((type & T.normal) && !(type & T.effect)) return 0;
    return 1;
  }
  if (type & T.spell) return 10 + SPELL_ORDER.findIndex((bit) => (type & bit) !== 0) + 1;
  if (type & T.trap) return 20 + TRAP_ORDER.findIndex((bit) => (type & bit) !== 0) + 1;
  return 30;
}

export const MONSTER_TYPE_BITS: Record<MonsterTypeKey, number> = {
  normal: CARD_TYPE_BITS.normal,
  effect: CARD_TYPE_BITS.effect,
  ritual: CARD_TYPE_BITS.ritual,
  fusion: CARD_TYPE_BITS.fusion,
  synchro: CARD_TYPE_BITS.synchro,
  xyz: CARD_TYPE_BITS.xyz,
  pendulum: CARD_TYPE_BITS.pendulum,
  link: CARD_TYPE_BITS.link,
  tuner: CARD_TYPE_BITS.tuner,
  flip: CARD_TYPE_BITS.flip,
  gemini: CARD_TYPE_BITS.gemini,
  spirit: CARD_TYPE_BITS.spirit,
  toon: CARD_TYPE_BITS.toon,
  union: CARD_TYPE_BITS.union,
};

export const CARD_ATTRIBUTES = [
  { bit: 0x20, label: "DARK" },
  { bit: 0x10, label: "LIGHT" },
  { bit: 0x01, label: "EARTH" },
  { bit: 0x02, label: "WATER" },
  { bit: 0x04, label: "FIRE" },
  { bit: 0x08, label: "WIND" },
  { bit: 0x40, label: "DIVINE" },
] as const;

/** Monster Types printed on TCG/OCG cards, by core race bit. */
export const CARD_RACES = [
  { bit: 0x1, label: "Warrior" },
  { bit: 0x2, label: "Spellcaster" },
  { bit: 0x4, label: "Fairy" },
  { bit: 0x8, label: "Fiend" },
  { bit: 0x10, label: "Zombie" },
  { bit: 0x20, label: "Machine" },
  { bit: 0x40, label: "Aqua" },
  { bit: 0x80, label: "Pyro" },
  { bit: 0x100, label: "Rock" },
  { bit: 0x200, label: "Winged Beast" },
  { bit: 0x400, label: "Plant" },
  { bit: 0x800, label: "Insect" },
  { bit: 0x1000, label: "Thunder" },
  { bit: 0x2000, label: "Dragon" },
  { bit: 0x4000, label: "Beast" },
  { bit: 0x8000, label: "Beast-Warrior" },
  { bit: 0x10000, label: "Dinosaur" },
  { bit: 0x20000, label: "Fish" },
  { bit: 0x40000, label: "Sea Serpent" },
  { bit: 0x80000, label: "Reptile" },
  { bit: 0x100000, label: "Psychic" },
  { bit: 0x200000, label: "Divine-Beast" },
  { bit: 0x400000, label: "Creator God" },
  { bit: 0x800000, label: "Wyrm" },
  { bit: 0x1000000, label: "Cyberse" },
  { bit: 0x2000000, label: "Illusion" },
] as const;

/** Link Arrow bits as the core stores them (the card's DEF column). */
export const LINK_ARROWS = [
  { bit: 0x040, label: "Top-Left" },
  { bit: 0x080, label: "Top" },
  { bit: 0x100, label: "Top-Right" },
  { bit: 0x008, label: "Left" },
  { bit: 0x020, label: "Right" },
  { bit: 0x001, label: "Bottom-Left" },
  { bit: 0x002, label: "Bottom" },
  { bit: 0x004, label: "Bottom-Right" },
] as const;
export const LINK_ARROW_MASK = LINK_ARROWS.reduce((mask, arrow) => mask | arrow.bit, 0);

/** ot column bits. */
export const CARD_POOL_OCG = 0x1;
export const CARD_POOL_TCG = 0x2;

export interface CardRange {
  min: number | null;
  max: number | null;
}

export interface CardQuery {
  /** Words must all match; "quoted phrases" stay together; -word excludes. Digits also match passcodes. */
  text: string;
  scope: CardSearchScope;
  kind: CardKindFilter;
  monsterTypes: MonsterTypeKey[];
  monsterTypeMatch: CardMatch;
  spellTypes: SpellTypeKey[];
  trapTypes: TrapTypeKey[];
  attributes: number[];
  races: number[];
  /** Level or Rank. Link Monsters never match. */
  level: CardRange;
  link: CardRange;
  scale: CardRange;
  atk: CardRange;
  def: CardRange;
  /** Link Arrow bits. */
  arrows: number;
  arrowMatch: CardMatch;
  /** strings.conf setcodes. A base code also matches its sub-archetypes. */
  archetypes: number[];
  /** "related" also takes cards whose name or text mentions the archetype. */
  archetypeMode: "member" | "related";
  banlist: string;
  limits: CardLimitStatus[];
  pool: CardPoolFilter;
  sort: CardSort;
  order: SortOrder;
  offset: number;
  limit: number;
}

/** Engine catalog card with the fields the deck editor filters and badges on. */
export interface DeckCardInfo extends DuelCardInfo {
  alias: number;
  setcodes: number[];
  lscale: number;
  rscale: number;
  /** Link Arrow bits; 0 for a monster that is not a Link Monster. */
  arrows: number;
  ot: number;
}

export interface CardQueryResult {
  cards: DeckCardInfo[];
  total: number;
  offset: number;
}

export interface CardArchetype {
  name: string;
  /** Every strings.conf setcode with this name (an anime or Rush copy can share it). */
  codes: number[];
  /** Cards in the archetype (sub-archetypes included), alternate artworks excluded. */
  count: number;
}

export interface CardFacets {
  archetypes: CardArchetype[];
  /** Copy limits (0, 1 or 2) by passcode for each banlist id. Unlisted cards are unlimited. */
  banlists: Record<string, Record<number, 0 | 1 | 2>>;
}

export const CARD_QUERY_PAGE_MAX = 120;
export const CARD_QUERY_TEXT_MAX = 200;

export function emptyCardQuery(): CardQuery {
  return {
    text: "",
    scope: "all",
    kind: "any",
    monsterTypes: [],
    monsterTypeMatch: "any",
    spellTypes: [],
    trapTypes: [],
    attributes: [],
    races: [],
    level: { min: null, max: null },
    link: { min: null, max: null },
    scale: { min: null, max: null },
    atk: { min: null, max: null },
    def: { min: null, max: null },
    arrows: 0,
    arrowMatch: "any",
    archetypes: [],
    archetypeMode: "member",
    banlist: "none",
    limits: [],
    pool: "any",
    sort: "match",
    order: "asc",
    offset: 0,
    limit: 60,
  };
}

export class CardQueryError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T, field: string): T {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new CardQueryError(`Invalid ${field}`);
}

function pickList<T extends string>(value: unknown, allowed: readonly T[], field: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > allowed.length) throw new CardQueryError(`Invalid ${field}`);
  const out = new Set<T>();
  for (const item of value) out.add(pick(item, allowed, allowed[0], field));
  return [...out];
}

function pickBits(value: unknown, allowed: readonly { bit: number }[], field: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > allowed.length) throw new CardQueryError(`Invalid ${field}`);
  const bits = new Set(allowed.map((entry) => entry.bit));
  const out = new Set<number>();
  for (const item of value) {
    if (typeof item !== "number" || !bits.has(item)) throw new CardQueryError(`Invalid ${field}`);
    out.add(item);
  }
  return [...out];
}

function pickInt(value: unknown, min: number, max: number, fallback: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new CardQueryError(`Invalid ${field}`);
  }
  return value;
}

function pickRange(value: unknown, ceiling: number, field: string): CardRange {
  if (value === undefined || value === null) return { min: null, max: null };
  if (!isRecord(value)) throw new CardQueryError(`Invalid ${field}`);
  const bound = (raw: unknown) => (raw === undefined || raw === null ? null : pickInt(raw, 0, ceiling, 0, field));
  const min = bound(value.min);
  const max = bound(value.max);
  if (min != null && max != null && min > max) return { min: max, max: min };
  return { min, max };
}

/** Validates an untrusted query. Missing fields take their defaults; wrong ones throw CardQueryError. */
export function parseCardQuery(raw: unknown): CardQuery {
  if (!isRecord(raw)) throw new CardQueryError("Invalid card query");
  const base = emptyCardQuery();
  const text = raw.text === undefined ? "" : raw.text;
  if (typeof text !== "string" || text.length > CARD_QUERY_TEXT_MAX) throw new CardQueryError("Invalid search text");
  const archetypes = raw.archetypes === undefined ? [] : raw.archetypes;
  if (!Array.isArray(archetypes) || archetypes.length > 20
    || archetypes.some((code) => typeof code !== "number" || !Number.isSafeInteger(code) || code <= 0 || code > 0xffff)) {
    throw new CardQueryError("Invalid archetypes");
  }
  const banlist = raw.banlist === undefined ? base.banlist : raw.banlist;
  if (typeof banlist !== "string" || banlist.length > 40 || !/^[a-z0-9-]+$/.test(banlist)) {
    throw new CardQueryError("Invalid banlist");
  }
  return {
    text,
    scope: pick(raw.scope, ["all", "name"] as const, base.scope, "scope"),
    kind: pick(raw.kind, ["any", "monster", "spell", "trap"] as const, base.kind, "card kind"),
    monsterTypes: pickList(raw.monsterTypes, MONSTER_TYPE_KEYS, "monster types"),
    monsterTypeMatch: pick(raw.monsterTypeMatch, ["any", "all"] as const, base.monsterTypeMatch, "monster type match"),
    spellTypes: pickList(raw.spellTypes, SPELL_TYPE_KEYS, "Spell types"),
    trapTypes: pickList(raw.trapTypes, TRAP_TYPE_KEYS, "Trap types"),
    attributes: pickBits(raw.attributes, CARD_ATTRIBUTES, "attributes"),
    races: pickBits(raw.races, CARD_RACES, "monster Types"),
    level: pickRange(raw.level, 13, "Level"),
    link: pickRange(raw.link, 8, "Link Rating"),
    scale: pickRange(raw.scale, 13, "Pendulum Scale"),
    atk: pickRange(raw.atk, 100000, "ATK"),
    def: pickRange(raw.def, 100000, "DEF"),
    arrows: pickInt(raw.arrows, 0, LINK_ARROW_MASK, 0, "Link Arrows") & LINK_ARROW_MASK,
    arrowMatch: pick(raw.arrowMatch, ["any", "all"] as const, base.arrowMatch, "Link Arrow match"),
    archetypes: [...new Set(archetypes as number[])],
    archetypeMode: pick(raw.archetypeMode, ["member", "related"] as const, base.archetypeMode, "archetype mode"),
    banlist,
    limits: pickList(raw.limits, CARD_LIMIT_KEYS, "limit status"),
    pool: pick(raw.pool, ["any", "tcg", "ocg"] as const, base.pool, "card pool"),
    sort: pick(raw.sort, ["match", "type", "name", "level", "atk", "def"] as const, base.sort, "sort"),
    order: pick(raw.order, ["asc", "desc"] as const, base.order, "sort order"),
    offset: pickInt(raw.offset, 0, 100000, 0, "offset"),
    limit: pickInt(raw.limit, 1, CARD_QUERY_PAGE_MAX, base.limit, "page size"),
  };
}

/** Whether a card with these setcodes is in the archetype (the core's IsSetCard rule). */
export function inArchetype(setcodes: readonly number[], archetype: number): boolean {
  return setcodes.some((code) => (code & 0xfff) === (archetype & 0xfff) && (code & archetype) === archetype);
}

/** Copy limit of a card under a banlist: an alternate artwork shares its original's entry. */
export function cardLimit(
  limits: Readonly<Record<number, 0 | 1 | 2>> | undefined,
  card: { code: number; alias?: number },
): 0 | 1 | 2 | 3 {
  if (!limits) return 3;
  let limit: 0 | 1 | 2 | 3 = 3;
  for (const code of [card.code, card.alias ?? 0]) {
    if (!code || !Object.hasOwn(limits, code)) continue;
    const listed = limits[code];
    if (listed < limit) limit = listed;
  }
  return limit;
}

/** Lower-case, accent-free text with punctuation turned to spaces, so "blue eyes" finds "Blue-Eyes". */
export function foldCardText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .trim();
}

export interface CardSearchTerm {
  text: string;
  negate: boolean;
}

/** Splits search text into folded terms. "quoted phrases" stay whole; a leading - excludes the term. */
export function parseCardSearchTerms(text: string): CardSearchTerm[] {
  const terms: CardSearchTerm[] = [];
  const pattern = /(-?)"([^"]*)"|(\S+)/g;
  for (const match of text.matchAll(pattern)) {
    let negate = match[1] === "-";
    let raw = match[2] ?? match[3] ?? "";
    if (match[3] !== undefined && raw.startsWith("-") && raw.length > 1) {
      negate = true;
      raw = raw.slice(1);
    }
    const folded = foldCardText(raw);
    if (folded) terms.push({ text: folded, negate });
  }
  return terms;
}
