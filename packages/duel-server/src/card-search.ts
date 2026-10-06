import {
  CARD_POOL_OCG,
  CARD_POOL_TCG,
  CARD_TYPE_BITS as T,
  CardQueryError,
  MONSTER_TYPE_BITS,
  cardLimit,
  cardTypeRank,
  foldCardText,
  inArchetype,
  parseCardSearchTerms,
  type CardArchetype,
  type CardFacets,
  type CardLimitStatus,
  type CardQuery,
  type CardQueryResult,
  type CardRange,
  type DeckCardInfo,
  type SpellTypeKey,
  type TrapTypeKey,
} from "@yugidraft/shared/duels";
import { BANLIST_NONE_ID, BANLIST_OCG_2026_07_ID, BANLIST_TCG_2026_09_ID, banlistLimitsFor } from "./banlists/index.js";
import { cardArtworkFamily } from "./card-artworks.js";
import type { CardDatabase } from "./cards.js";

type Kind = "monster" | "spell" | "trap" | "other";

interface Entry {
  card: DeckCardInfo;
  name: string;
  text: string;
  code: string;
  kind: Kind;
  /** Raw engine race bits (DuelCardInfo keeps the race as text). */
  race: number;
  subtype: SpellTypeKey | TrapTypeKey | null;
  rank: number;
  /** Tokens and alternate artworks: found by exact passcode only. */
  hidden: boolean;
}

interface Index {
  entries: Entry[];
  byCode: Map<number, Entry>;
  archetypes: CardArchetype[];
}

const indexes = new WeakMap<CardDatabase, Index>();

function kindOf(type: number): Kind {
  if (type & T.monster) return "monster";
  if (type & T.spell) return "spell";
  if (type & T.trap) return "trap";
  return "other";
}

function spellType(type: number): SpellTypeKey {
  if (type & T.quickPlay) return "quick-play";
  if (type & T.continuous) return "continuous";
  if (type & T.equip) return "equip";
  if (type & T.field) return "field";
  if (type & T.ritual) return "ritual";
  return "normal";
}

function trapType(type: number): TrapTypeKey {
  if (type & T.continuous) return "continuous";
  if (type & T.counter) return "counter";
  return "normal";
}

function buildIndex(cards: CardDatabase): Index {
  const entries: Entry[] = [];
  const byCode = new Map<number, Entry>();
  for (const card of cards.all()) {
    const kind = kindOf(card.type);
    // An alternate artwork repeats its original's name and card type. An alias with another name or
    // type (Harpie Lady 2, the Normal Black Luster Soldier) is a separate card and stays listed.
    const family = cardArtworkFamily(cards, card.code)!;
    const altArt = family.passcode !== card.code;
    const data = cards.cardData(card.code);
    const entry: Entry = {
      card,
      name: foldCardText(card.name),
      text: foldCardText(card.description),
      code: String(card.code),
      kind,
      race: data ? Number(BigInt(data.race) & 0xffffffffn) : 0,
      subtype: kind === "spell" ? spellType(card.type) : kind === "trap" ? trapType(card.type) : null,
      rank: cardTypeRank(card.type),
      hidden: altArt || (card.type & T.token) !== 0 || kind === "other",
    };
    entries.push(entry);
    byCode.set(card.code, entry);
  }

  const grouped = new Map<string, number[]>();
  for (const [code, name] of cards.setnames()) {
    const trimmed = name.trim();
    if (!trimmed || code <= 0 || code > 0xffff) continue;
    const codes = grouped.get(trimmed) ?? [];
    codes.push(code);
    grouped.set(trimmed, codes);
  }
  const archetypes: CardArchetype[] = [];
  for (const [name, codes] of grouped) {
    let count = 0;
    for (const entry of entries) {
      if (!entry.hidden && codes.some((code) => inArchetype(entry.card.setcodes, code))) count += 1;
    }
    if (count > 0) archetypes.push({ name, codes, count });
  }
  archetypes.sort((a, b) => a.name.localeCompare(b.name, "en"));
  return { entries, byCode, archetypes };
}

function indexFor(cards: CardDatabase): Index {
  let index = indexes.get(cards);
  if (!index) {
    index = buildIndex(cards);
    indexes.set(cards, index);
  }
  return index;
}

function active(range: CardRange): boolean {
  return range.min != null || range.max != null;
}

function within(value: number, range: CardRange): boolean {
  return (range.min == null || value >= range.min) && (range.max == null || value <= range.max);
}

const LIMIT_STATUS: Record<0 | 1 | 2 | 3, CardLimitStatus> = {
  0: "forbidden",
  1: "limited",
  2: "semi-limited",
  3: "unlimited",
};

type Matcher = (entry: Entry) => boolean;

function compile(query: CardQuery, index: Index): Matcher[] {
  const checks: Matcher[] = [];
  if (query.kind !== "any") checks.push((entry) => entry.kind === query.kind);

  const monsterOnly = query.monsterTypes.length > 0 || query.attributes.length > 0 || query.races.length > 0
    || active(query.level) || active(query.link) || active(query.scale) || active(query.atk) || active(query.def)
    || query.arrows !== 0;
  if (monsterOnly) checks.push((entry) => entry.kind === "monster");

  if (query.monsterTypes.length > 0) {
    const bits = query.monsterTypes.map((key) => MONSTER_TYPE_BITS[key]);
    checks.push(query.monsterTypeMatch === "all"
      ? (entry) => bits.every((bit) => (entry.card.type & bit) !== 0)
      : (entry) => bits.some((bit) => (entry.card.type & bit) !== 0));
  }
  if (query.spellTypes.length > 0 || query.trapTypes.length > 0) {
    const spells = new Set<string>(query.spellTypes);
    const traps = new Set<string>(query.trapTypes);
    checks.push((entry) => entry.subtype != null
      && ((entry.kind === "spell" && spells.has(entry.subtype)) || (entry.kind === "trap" && traps.has(entry.subtype))));
  }
  if (query.attributes.length > 0) {
    const mask = query.attributes.reduce((all, bit) => all | bit, 0);
    checks.push((entry) => (entry.card.attribute & mask) !== 0);
  }
  if (query.races.length > 0) {
    const mask = query.races.reduce((all, bit) => all | bit, 0);
    checks.push((entry) => (entry.race & mask) !== 0);
  }
  if (active(query.level)) {
    checks.push((entry) => (entry.card.type & T.link) === 0 && within(entry.card.level, query.level));
  }
  if (active(query.link)) {
    checks.push((entry) => (entry.card.type & T.link) !== 0 && within(entry.card.level, query.link));
  }
  if (active(query.scale)) {
    checks.push((entry) => (entry.card.type & T.pendulum) !== 0 && within(entry.card.lscale, query.scale));
  }
  if (active(query.atk)) checks.push((entry) => entry.card.attack >= 0 && within(entry.card.attack, query.atk));
  if (active(query.def)) {
    checks.push((entry) => (entry.card.type & T.link) === 0 && entry.card.defense >= 0 && within(entry.card.defense, query.def));
  }
  if (query.arrows !== 0) {
    const arrows = query.arrows;
    checks.push(query.arrowMatch === "all"
      ? (entry) => (entry.card.type & T.link) !== 0 && (entry.card.arrows & arrows) === arrows
      : (entry) => (entry.card.type & T.link) !== 0 && (entry.card.arrows & arrows) !== 0);
  }
  if (query.archetypes.length > 0) {
    const codes = query.archetypes;
    const members: Matcher = (entry) => codes.some((code) => inArchetype(entry.card.setcodes, code));
    if (query.archetypeMode === "related") {
      const names = [...new Set(codes.flatMap((code) => {
        const found = index.archetypes.find((archetype) => archetype.codes.includes(code));
        return found ? [foldCardText(found.name)] : [];
      }))].filter(Boolean);
      checks.push((entry) => members(entry) || names.some((name) => entry.name.includes(name) || entry.text.includes(name)));
    } else {
      checks.push(members);
    }
  }
  if (query.pool !== "any") {
    const bit = query.pool === "tcg" ? CARD_POOL_TCG : CARD_POOL_OCG;
    checks.push((entry) => (entry.card.ot & bit) !== 0);
  }
  if (query.limits.length > 0 && query.banlist !== BANLIST_NONE_ID) {
    let limits: ReturnType<typeof banlistLimitsFor>;
    try {
      limits = banlistLimitsFor(query.banlist);
    } catch {
      throw new CardQueryError(`Unknown banlist ${query.banlist}`);
    }
    const wanted = new Set(query.limits);
    checks.push((entry) => wanted.has(LIMIT_STATUS[cardLimit(limits ?? undefined, entry.card)]));
  }

  const terms = parseCardSearchTerms(query.text);
  if (terms.length > 0) {
    const nameOnly = query.scope === "name";
    checks.push((entry) => terms.every((term) => {
      const found = entry.name.includes(term.text)
        || (!nameOnly && entry.text.includes(term.text))
        || (/^\d+$/.test(term.text) && entry.code.includes(term.text));
      return found !== term.negate;
    }));
  }
  return checks;
}

/** Lower is a better text match: exact name, name prefix, name has every word, text only. */
function textScore(entry: Entry, phrase: string, positive: string[]): number {
  if (!phrase) return 0;
  if (entry.name === phrase || entry.code === phrase) return 0;
  if (entry.name.startsWith(phrase)) return 1;
  if (entry.name.includes(phrase)) return 2;
  if (positive.every((term) => entry.name.includes(term))) return 3;
  return 4;
}

function statFor(entry: Entry, sort: CardQuery["sort"]): number | null {
  if (entry.kind !== "monster") return null;
  if (sort === "level") return entry.card.level;
  if (sort === "atk") return entry.card.attack < 0 ? -1 : entry.card.attack;
  if (entry.card.type & T.link) return null;
  return entry.card.defense < 0 ? -1 : entry.card.defense;
}

function sortEntries(found: Entry[], query: CardQuery, member: Matcher | null): Entry[] {
  const direction = query.order === "desc" ? -1 : 1;
  const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.card.code - b.card.code);
  const byType = (a: Entry, b: Entry) => a.rank - b.rank || b.card.level - a.card.level || b.card.attack - a.card.attack || byName(a, b);
  const terms = parseCardSearchTerms(query.text).filter((term) => !term.negate).map((term) => term.text);
  const phrase = terms.join(" ");

  if (query.sort === "match" && (phrase || member)) {
    // Archetype members lead cards that only mention the archetype; then the best name match.
    const scores = new Map(found.map((entry) => [
      entry,
      (member && !member(entry) ? 10 : 0) + textScore(entry, phrase, terms),
    ]));
    return found.sort((a, b) => direction * ((scores.get(a) ?? 0) - (scores.get(b) ?? 0)) || byType(a, b));
  }
  if (query.sort === "match" || query.sort === "type") {
    return found.sort((a, b) => direction * (a.rank - b.rank) || b.card.level - a.card.level || b.card.attack - a.card.attack || byName(a, b));
  }
  if (query.sort === "name") return found.sort((a, b) => direction * byName(a, b));
  return found.sort((a, b) => {
    const left = statFor(a, query.sort);
    const right = statFor(b, query.sort);
    // Cards without the stat always go last, whatever the order.
    if (left == null || right == null) return left == null && right == null ? byType(a, b) : left == null ? 1 : -1;
    return direction * (left - right) || byName(a, b);
  });
}

/** Runs a validated deck-editor query over the engine catalog. */
export function queryCards(cards: CardDatabase, query: CardQuery): CardQueryResult {
  const index = indexFor(cards);
  const checks = compile(query, index);
  const passes = (entry: Entry) => checks.every((check) => check(entry));

  const trimmed = query.text.trim();
  const exact = /^\d+$/.test(trimmed) ? index.byCode.get(Number(trimmed)) : undefined;
  const exactPasses = exact != null && compile({ ...query, text: "" }, index).every((check) => check(exact));

  const found: Entry[] = [];
  for (const entry of index.entries) {
    if (entry.hidden || entry === exact) continue;
    if (passes(entry)) found.push(entry);
  }
  const member: Matcher | null = query.archetypeMode === "related" && query.archetypes.length > 0
    ? (entry) => query.archetypes.some((code) => inArchetype(entry.card.setcodes, code))
    : null;
  const sorted = sortEntries(found, query, member);
  // An exact passcode leads, even for an alternate artwork that the list otherwise hides.
  if (exact && exactPasses) sorted.unshift(exact);
  return {
    cards: sorted.slice(query.offset, query.offset + query.limit).map((entry) => ({ ...entry.card, altArtCount: cardArtworkFamily(cards, entry.card.code)!.artworks.length - 1 })),
    total: sorted.length,
    offset: query.offset,
  };
}

export function cardFacets(cards: CardDatabase): CardFacets {
  const banlists: CardFacets["banlists"] = {};
  for (const id of [BANLIST_TCG_2026_09_ID, BANLIST_OCG_2026_07_ID]) {
    const limits = banlistLimitsFor(id);
    if (limits) banlists[id] = limits;
  }
  return { archetypes: indexFor(cards).archetypes, banlists };
}
