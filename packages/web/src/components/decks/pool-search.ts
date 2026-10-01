import {
  CARD_POOL_OCG,
  CARD_POOL_TCG,
  CARD_RACES,
  CARD_TYPE_BITS as T,
  MONSTER_TYPE_BITS,
  cardTypeRank,
  foldCardText,
  inArchetype,
  parseCardSearchTerms,
  type CardQuery,
  type CardRange,
  type DeckCardInfo,
  type SpellTypeKey,
  type TrapTypeKey,
} from "@yugidraft/shared/duels";

/**
 * Client-side version of the duel host's card search (packages/duel-server/src/card-search.ts),
 * run over the few cards of a draft pool. The same filters and search words apply; the banlist and
 * limit filters do not, because a draft deck has no banlist.
 */

type Kind = "monster" | "spell" | "trap" | "other";

interface Entry {
  card: DeckCardInfo;
  name: string;
  text: string;
  code: string;
  kind: Kind;
  /** Race bits, found from the card's race text. */
  race: number;
  subtype: SpellTypeKey | TrapTypeKey | null;
  rank: number;
}

const RACE_BITS = new Map(CARD_RACES.map((race) => [foldCardText(race.label), race.bit]));

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

function entryFor(card: DeckCardInfo): Entry {
  const kind = kindOf(card.type);
  return {
    card,
    name: foldCardText(card.name),
    text: foldCardText(card.description),
    code: String(card.code),
    kind,
    race: kind === "monster" ? RACE_BITS.get(foldCardText(card.race)) ?? 0 : 0,
    subtype: kind === "spell" ? spellType(card.type) : kind === "trap" ? trapType(card.type) : null,
    rank: cardTypeRank(card.type),
  };
}

function active(range: CardRange): boolean {
  return range.min != null || range.max != null;
}

function within(value: number, range: CardRange): boolean {
  return (range.min == null || value >= range.min) && (range.max == null || value <= range.max);
}

type Matcher = (entry: Entry) => boolean;

function compile(query: CardQuery, archetypeNames: (code: number) => string | undefined): Matcher[] {
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
        const found = archetypeNames(code);
        return found ? [foldCardText(found)] : [];
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

function sortEntries(found: Entry[], query: CardQuery): Entry[] {
  const direction = query.order === "desc" ? -1 : 1;
  const byName = (a: Entry, b: Entry) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.card.code - b.card.code);
  const byType = (a: Entry, b: Entry) => a.rank - b.rank || b.card.level - a.card.level || b.card.attack - a.card.attack || byName(a, b);
  const terms = parseCardSearchTerms(query.text).filter((term) => !term.negate).map((term) => term.text);
  const phrase = terms.join(" ");

  if (query.sort === "match" && phrase) {
    const scores = new Map(found.map((entry) => [entry, textScore(entry, phrase, terms)]));
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

/**
 * The pool cards that match a deck-editor query, in the order the host search would give them.
 * `archetypeNames` maps a setcode to its name for the "related" archetype mode.
 */
export function queryPoolCards(
  cards: readonly DeckCardInfo[],
  query: CardQuery,
  archetypeNames: (code: number) => string | undefined = () => undefined,
): DeckCardInfo[] {
  const checks = compile(query, archetypeNames);
  const found = cards.map(entryFor).filter((entry) => checks.every((check) => check(entry)));
  return sortEntries(found, query).map((entry) => entry.card);
}
