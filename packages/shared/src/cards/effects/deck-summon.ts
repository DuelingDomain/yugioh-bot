import { ATTRIBUTES, MONSTER_TYPES, SUBTYPES, isExtraDeckCard, type Card } from "./card.js";
import { compactEffectName } from "./name-match.js";
import { filterReachesCard, type Candidate } from "./synergy.js";
import type { CardFilter } from "./tags.js";

interface Requirement {
  min: number;
  max: number;
  differentNames: boolean;
  matches: (card: Card) => boolean;
}

const normalized = (text: string) => text.replace(/[“”]/g, '"').replace(/[‐‑–]/g, "-").replace(/\s+/g, " ").trim();
const whole = (value: number | undefined): value is number => value !== undefined && Number.isInteger(value) && value > 0;
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const attributePatterns = ATTRIBUTES.map(value => [value, new RegExp(`\\b${value}\\b`, "i")] as const);
// Compile the vocabulary once; the parser never changes these expressions or their lastIndex.
const typePatterns = [...MONSTER_TYPES].sort((a, b) => b.length - a.length)
  .map(value => [value, new RegExp(`(?:^|\\s)${escaped(value)}(?:-Type)?(?=\\s|$)`, "i")] as const);
const subtypePatterns = SUBTYPES.map(value => [value, new RegExp(`\\b${escaped(value)}${value === "tuner" ? "s?" : ""}\\b`, "i")] as const);
// Printed archetype spelling matters: "HERO" does not include "Heroic".
// Exact catalog membership also covers names whose English spelling is exceptional.
const materialArchetype = (card: Card, name: string) => card.archetype?.toLowerCase() === name.toLowerCase() || card.name.includes(name);
// Recipes contain only printed restrictions. Their predicates read the current
// material card; this small cache holds no deck, catalog card, or summon proof.
const recipes = new Map<string, Requirement>();

function requirement(raw: string): Requirement | undefined {
  const text = normalized(raw);
  const cached = recipes.get(text);
  if (cached) { recipes.delete(text); recipes.set(text, cached); return cached; }
  const parsed = parseRequirement(text);
  if (parsed && text.length <= 256) {
    recipes.set(text, parsed);
    if (recipes.size > 64) recipes.delete(recipes.keys().next().value!);
  }
  return parsed;
}

/** Deliberately small grammar: every character must be consumed before a restriction is trusted. */
function parseRequirement(text: string): Requirement | undefined {
  const count = /^(\d+)(\+|\s+or more)?(?:\s+|$)/i.exec(text);
  const min = count ? Number(count[1]) : 1;
  if (!whole(min) || min > 60) return;
  const max = count?.[2] ? 60 : min;
  if (count) text = text.slice(count[0].length);
  if (!text) return { min, max, differentNames: false, matches: card => card.kind === "monster" };
  const tests: Array<(card: Card) => boolean> = [];
  let differentNames = false;
  const take = (pattern: RegExp, apply: (match: RegExpMatchArray) => void) => {
    const match = pattern.exec(text);
    if (match) { apply(match); text = text.replace(pattern, " "); }
  };
  take(/\bwith different (?:original )?names\b/i, () => { differentNames = true; });
  take(/,?\s*except Tokens\b/i, () => tests.push(card => !card.subtypes.includes("token")));
  take(/\bnon[- ]Tuner\b/i, () => tests.push(card => !card.subtypes.includes("tuner")));
  take(/\bnon[- ]Link\b/i, () => tests.push(card => !card.subtypes.includes("link")));
  take(/\bLevel (\d+)(?: or (lower|less|higher|more))?\b/i, match => {
    const level = Number(match[1]), bound = match[2]?.toLowerCase();
    tests.push(card => whole(card.level) && (bound === "lower" || bound === "less" ? card.level <= level
      : bound === "higher" || bound === "more" ? card.level >= level : card.level === level));
  });
  // Quoted text followed by "monster(s)" is an archetype; an otherwise bare quoted name is exact.
  take(/"([^"\n]+)"/i, match => {
    const printedName = match[1]!;
    const name = compactEffectName(printedName);
    const archetype = /\bmonsters?\b/i.test(text);
    tests.push(card => archetype ? materialArchetype(card, printedName) : compactEffectName(card.name) === name);
  });
  for (const [attribute, pattern] of attributePatterns) take(pattern, () => tests.push(card => card.attribute === attribute));
  // Long names first prevents "Beast" from consuming "Beast-Warrior" or "Winged Beast".
  for (const [type, pattern] of typePatterns) take(pattern, () => tests.push(card => card.monsterType === type));
  for (const [subtype, pattern] of subtypePatterns) take(pattern, () => tests.push(card => card.subtypes.includes(subtype)));
  text = text.replace(/\bmonsters?\b/gi, " ").trim();
  if (text) return;
  return { min, max, differentNames, matches: card => card.kind === "monster" && tests.every(test => test(card)) };
}

function taggedRequirement(filter: CardFilter): Requirement | undefined {
  if (filter.this_card) return;
  const other = requirement(filter.other);
  if (!other) return;
  const structured = { ...filter, archetypes: [], other: "" };
  return { ...other, matches: card => other.matches(card) && (!filter.archetypes.length || filter.archetypes.some(name => materialArchetype(card, name)))
    && filterReachesCard(structured, card) };
}

/** A '+' inside a quoted card name is not a separator between material groups. */
function printedRequirements(card: Card): Requirement[] | undefined {
  const first = card.text.replace(/\r\n?/g, "\n").split("\n")[0]?.trim();
  if (!first) return;
  const parts: string[] = [];
  let quoted = false, start = 0;
  const line = normalized(first);
  for (let index = 0; index < line.length; index++) {
    if (line[index] === '"') quoted = !quoted;
    if (!quoted && line[index] === "+" && line[index - 1] === " " && line[index + 1] === " ") {
      parts.push(line.slice(start, index).trim()); start = index + 1;
    }
  }
  if (quoted) return;
  parts.push(line.slice(start).trim());
  if (parts.some(part => !/\b(?:monsters?|tuners?)\b|"/i.test(part))) return;
  const groups = parts.map(requirement);
  return groups.every((group): group is Requirement => !!group) ? groups : undefined;
}

function permitsStandardSummon(card: Card, method: string): boolean {
  // Additional mandatory procedures are not proven by the ordinary printed material recipe.
  const rest = normalized(card.text.replace(/\r\n?/g, "\n").split("\n").slice(1).join(" "));
  if (/\bcannot be (?:special|fusion|synchro|xyz|link) summoned\b/i.test(rest)) return false;
  if (/\b(?:can only|cannot|must)\b[^.]*\bsummon this card\b/i.test(rest)
    || /\b(?:summon this card|summoned)\b[^.]*\bunless\b/i.test(rest)) return false;
  for (const match of rest.matchAll(/\bMust (?:first )?be (?:Special|Fusion|Synchro|Xyz|Link) Summoned[^.]*\.?/gi)) {
    const plain = match[0].replace(/\.$/, "");
    if (!new RegExp(`^Must (?:first )?be ${method} Summoned(?: with the above Fusion Materials)?$`, "i").test(plain)) return false;
  }
  return true;
}

interface FusionEffect { name: string; count?: number }
interface PreparedFusionEffect extends FusionEffect { matches: (candidate: Candidate) => boolean }

function fusionEffects(main: readonly Candidate[]): PreparedFusionEffect[] {
  const result: PreparedFusionEffect[] = [];
  for (const enabler of main) {
    if (enabler.card.kind !== "spell" || isExtraDeckCard(enabler.card)) continue;
    // Parsing the actual sentence prevents omitted tag conditions/costs from manufacturing a proof.
    const text = normalized(enabler.card.text);
    const match = /^Fusion Summon 1 (.+?) from your Extra Deck, using (?:(\d+) )?monsters from your (hand or field|hand, Deck, or field|hand, field, or Deck) as Fusion Material\.\s*(.*)$/i.exec(text);
    if (!match) continue;
    let tail = match[4]!;
    tail = tail.replace(/You cannot Special Summon monsters from the Extra Deck, except Fusion Monsters, the turn you activate this card\./i, "");
    tail = tail.replace(/You can only activate 1 "[^"\n]+" per turn\./i, "");
    if (tail.trim()) continue;
    let target = match[1]!;
    const mentions = / that mentions "([^"\n]+)" as material/i.exec(target);
    const named = mentions ? compactEffectName(mentions[1]!) : undefined;
    if (mentions) target = target.replace(mentions[0], "");
    const wanted = requirement(target);
    if (!wanted) continue;
    const targets: Array<(candidate: Candidate) => boolean> = [];
    for (const effect of enabler.tags?.effects ?? []) {
      if (effect.conditions.length || effect.costs.length || effect.triggers.length) continue;
      for (const action of effect.actions) {
        if (action.verb !== "fusion_summon" || action.player !== "you" || !action.from.includes("extra_deck")) continue;
        let filter = action.what;
        const materialName = /^mentions "([^"\n]+)" as material$/i.exec(normalized(filter.other));
        const material = materialName ? compactEffectName(materialName[1]!) : undefined;
        if (materialName) filter = { ...filter, names: [], other: "" };
        const restriction = taggedRequirement(filter);
        if (restriction) targets.push(candidate => restriction.matches(candidate.card)
          && (!material || mentionsMaterial(candidate, material)));
      }
    }
    if (!targets.length) continue;
    const count = match[2] === undefined ? undefined : Number(match[2]);
    if (count !== undefined && !whole(count)) continue;
    result.push({ name: enabler.card.name, count, matches: candidate => wanted.matches(candidate.card)
      && (!named || mentionsMaterial(candidate, named)) && targets.some(matches => matches(candidate)) });
  }
  return result;
}

const mentionsMaterial = (candidate: Candidate, name: string) => candidate.tags?.materials.some(filter => filter.names.some(value => compactEffectName(value) === name)) ?? false;

interface MainContext {
  monsters: Card[];
  byLevel: Map<number, Card[]>;
  synchros: Map<number, Card[] | undefined>;
  fusion: PreparedFusionEffect[];
}

function mainContext(main: readonly Candidate[]): MainContext {
  const monsters = main.map(item => item.card).filter(material => material.kind === "monster" && !isExtraDeckCard(material)
    && !material.subtypes.includes("token") && !/\b(?:cannot|can't|can only)\b[^.!?\n]*\b(?:material|used for[^.!?\n]*summon)\b/i.test(material.text));
  const byLevel = new Map<number, Card[]>();
  for (const card of monsters) if (whole(card.level)) {
    const cards = byLevel.get(card.level);
    if (cards) cards.push(card);
    else byLevel.set(card.level, [card]);
  }
  return { monsters, byLevel, synchros: new Map(), fusion: fusionEffects(main) };
}

/** Cheap necessary subset-sum check shared by every recipe at this Synchro Level. */
function synchroMonsters(context: MainContext, level: number): Card[] | undefined {
  if (context.synchros.has(level)) return context.synchros.get(level);
  const monsters = context.monsters.filter(card => whole(card.level) && card.level < level);
  let possible = monsters.length >= 2 && monsters.some(card => card.subtypes.includes("tuner"))
    && monsters.some(card => !card.subtypes.includes("tuner")) && monsters.reduce((sum, card) => sum + card.level!, 0) >= level;
  if (possible) {
    // Each bit records a reachable Tuner/non-Tuner combination, with each copy used at most once.
    const sums = new Uint8Array(level + 1);
    sums[0] = 1;
    for (const card of monsters) for (let sum = level - card.level!; sum >= 0; sum--) {
      const states = sums[sum]!;
      const flag = card.subtypes.includes("tuner") ? 1 : 2;
      for (let state = 0; state < 4; state++) if (states & (1 << state)) sums[sum + card.level!]! |= 1 << (state | flag);
    }
    possible = (sums[level]! & (1 << 3)) !== 0;
  }
  const value = possible ? monsters : undefined;
  context.synchros.set(level, value);
  return value;
}

interface Stock {
  count: number;
  level: number;
  tuner: boolean;
  printed: boolean[];
  tagged: boolean[];
}

/** Assign each physical copy once; equivalent matching copies share a bounded stock counter. */
function materialStock(groups: Requirement[], tags: Requirement[], monsters: readonly Card[]): Stock[] {
  const stock = new Map<string, Stock>();
  for (const card of monsters) {
    const printed = groups.map(group => group.matches(card));
    const tagged = tags.map(group => group.matches(card));
    if (!printed.some(Boolean) || !tagged.some(Boolean)) continue;
    const level = card.level ?? 0, tuner = card.subtypes.includes("tuner");
    const key = `${level}:${Number(tuner)}:${printed.map(Number).join("")}:${tagged.map(Number).join("")}`;
    const row = stock.get(key);
    if (row) row.count++;
    else stock.set(key, { count: 1, level, tuner, printed, tagged });
  }
  return [...stock.values()];
}

function assign(available: Stock[], tags: Requirement[], counts: number[], targetLevel?: number): boolean {
  const slots = counts.flatMap((count, group) => Array<number>(count).fill(group))
    .sort((a, b) => available.filter(row => row.printed[a]).length - available.filter(row => row.printed[b]).length);
  const needs = tags.map(group => group.min);
  if (needs.reduce((sum, count) => sum + count, 0) > slots.length) return false;
  const failed = new Set<string>();
  const visit = (index: number, level: number, tuner: boolean, nonTuner: boolean): boolean => {
    if (index === slots.length) return needs.every(count => count === 0)
      && (targetLevel === undefined || level === targetLevel && tuner && nonTuner);
    if (targetLevel !== undefined && level + slots.length - index > targetLevel) return false;
    if (needs.reduce((sum, count) => sum + count, 0) > slots.length - index) return false;
    const key = `${index}:${level}:${Number(tuner)}${Number(nonTuner)}:${needs.join(",")}:${available.map(row => row.count).join(",")}`;
    if (failed.has(key)) return false;
    const slot = slots[index]!;
    for (const row of available) {
      if (!row.count || !row.printed[slot] || targetLevel !== undefined && (!whole(row.level) || level + row.level > targetLevel)) continue;
      row.count--;
      // A satisfied tag can absorb further copies, but equal satisfied tag choices are equivalent.
      let triedSatisfied = false;
      for (let tag = 0; tag < tags.length; tag++) {
        if (!row.tagged[tag]) continue;
        const needed = needs[tag]! > 0;
        if (!needed && triedSatisfied) continue;
        if (!needed) triedSatisfied = true;
        if (needed) needs[tag]!--;
        if (visit(index + 1, level + row.level, tuner || row.tuner, nonTuner || !row.tuner)) return true;
        if (needed) needs[tag]!++;
      }
      row.count++;
    }
    failed.add(key);
    return false;
  };
  return visit(0, 0, false, false);
}

/** Returns an explanation only when complete ordinary materials and any Fusion effect are proven. */
export function canSummonFromMain(candidate: Candidate, main: readonly Candidate[]): string | undefined {
  return summon(candidate, mainContext(main));
}

/** A request owns this prepared Main Deck snapshot; no global cache retains decks or mutable arrays. */
export function createMainDeckSummonChecker(main: readonly Candidate[]): (candidate: Candidate) => string | undefined {
  const context = mainContext(main);
  return candidate => summon(candidate, context);
}

function summon(candidate: Candidate, context: MainContext): string | undefined {
  const { card, tags } = candidate;
  const method = (["xyz", "synchro", "fusion", "link"] as const).find(type => card.subtypes.includes(type));
  if (card.kind !== "monster" || !method || !tags?.materials.length || tags.materials.length > 16) return;
  if (method === "xyz" && !whole(card.rank) || method === "synchro" && !whole(card.level) || method === "link" && !whole(card.linkRating)) return;
  let monsters = method === "xyz" ? context.byLevel.get(card.rank!) : method === "synchro" ? synchroMonsters(context, card.level!) : context.monsters;
  if (!monsters?.length || method === "xyz" && monsters.length < 2 || method === "link" && monsters.length < card.linkRating!
    || method === "fusion" && !context.fusion.length) return;
  const groups = printedRequirements(card), tagged = tags.materials.map(taggedRequirement);
  if (!groups?.length || !tagged.every((group): group is Requirement => !!group) || !permitsStandardSummon(card, method)) return;
  if ([...groups, ...tagged].some(group => group.differentNames)) {
    const names = new Set<string>();
    monsters = monsters.filter(material => {
      const name = compactEffectName(material.name);
      if (names.has(name)) return false;
      names.add(name); return true;
    });
  }
  const enablers = method === "fusion" ? context.fusion.filter(effect => effect.matches(candidate)) : [];
  if (method === "fusion" && !enablers.length) return;
  const minimum = groups.reduce((sum, group) => sum + group.min, 0);
  const maximum = Math.min(monsters.length, groups.reduce((sum, group) => sum + group.max, 0), method === "synchro" ? card.level! : 60);
  const counts: number[] = [];
  const stock = materialStock(groups, tagged, monsters);
  if (!stock.length) return;
  const distribution = (group: number, remaining: number): boolean => {
    if (group === groups.length) return remaining === 0 && assign(stock, tagged, counts, method === "synchro" ? card.level : undefined);
    const requirement = groups[group]!;
    const rest = groups.slice(group + 1).reduce((sum, item) => sum + item.min, 0);
    for (let count = requirement.min; count <= Math.min(requirement.max, remaining - rest); count++) {
      counts[group] = count;
      if (distribution(group + 1, remaining - count)) return true;
    }
    return false;
  };
  for (let count = minimum; count <= maximum; count++) {
    if (method === "link" && count !== card.linkRating || method === "xyz" && count < 2) continue;
    const fusion = method === "fusion" ? enablers.find(effect => effect.count === undefined || effect.count === count) : undefined;
    if (method === "fusion" && !fusion) continue;
    if (!distribution(0, count)) continue;
    if (method === "xyz") return `Makes Rank ${card.rank} with ${count} Level ${card.rank} monsters`;
    if (method === "synchro") return `Makes Level ${card.level} with ${count} Tuner and non-Tuner materials`;
    if (method === "link") return `Makes Link-${card.linkRating} with ${count} Main Deck monsters`;
    return `Has all ${count} Fusion Materials and ${fusion!.name}`;
  }
  return;
}
