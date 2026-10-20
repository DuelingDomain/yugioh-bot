/** Adapted from LorenzoWhite/searchygo, commit 9b2d952f8e7c389e13267d4bba6504cc8ea4cb5c.
 * https://github.com/LorenzoWhite/searchygo — see NOTICE for attribution and permission context. */
/**
 * Synergy: which cards from outside an archetype work well with it.
 *
 * A model reads an archetype's cards once (`scripts/profile-archetypes.ts`) and writes an
 * `ArchetypeProfile`: a few hooks, each describing one kind of outside card that helps the deck, in
 * the vocabulary the card tags already use. Finding those cards is then ordinary tag matching, done
 * here, so a synergy search costs nothing to answer.
 */
import * as z from "zod";
import { ATTRIBUTES, CARD_KINDS, MONSTER_TYPES, SUBTYPES, isExtraDeckCard, matchesSubtypes, type Card } from "./card.js";
import { matchCard } from "./effect-match.js";
import type { EffectQuery, EventQuery, ObjectQuery } from "./query.js";
import type { CardTags } from "./tags.js";
import { VERBS, ZONES } from "./vocabulary.js";
import { compactEffectName } from "./name-match.js";
import type { CardFilter } from "./tags.js";

const keys = <T extends Record<string, string>>(record: T) => Object.keys(record) as [keyof T & string, ...(keyof T & string)[]];

/** Which cards something is about. Empty lists and 0 mean "any". */
const Things = z.object({
  kinds: z.array(z.enum(CARD_KINDS)),
  subtypes: z.array(z.enum(SUBTYPES)),
  types: z.array(z.enum(MONSTER_TYPES)),
  attributes: z.array(z.enum(ATTRIBUTES)),
  level_min: z.int(),
  level_max: z.int(),
});
type Things = z.infer<typeof Things>;

const Happening = z.object({
  verbs: z.array(z.enum(keys(VERBS))).describe("Any one of these counts"),
  from: z.array(z.enum(keys(ZONES))).describe("Where the affected cards come from. Empty when it does not matter"),
  player: z.enum(["you", "opponent", "any"]).describe("Whose cards are affected, from the side of the player using the outside card"),
  self: z.boolean().describe("True when the event is about the outside card itself"),
  what: Things,
});
type Happening = z.infer<typeof Happening>;

/** One kind of outside card that helps the deck, and how to recognise it from a card on its own. */
export const Hook = z.object({
  label: z.string().describe("Two to five words naming the kind of card, as a player would say it"),
  why: z.string().describe("One sentence on what in this archetype makes that kind of card good with it"),
  does: Happening.nullable().describe("Something the outside card causes, as an effect or as a cost"),
  reacts_to: Happening.nullable().describe("Something the outside card responds to"),
  card: Things.nullable().describe("What the outside card itself must be"),
  supports: z
    .object({ types: z.array(z.enum(MONSTER_TYPES)), attributes: z.array(z.enum(ATTRIBUTES)) })
    .nullable()
    .describe("Set when the outside card must be support for a monster Type or Attribute"),
  phrases: z.array(z.string()).describe("Game terms that must all appear in the outside card's printed text"),
});
export type Hook = z.infer<typeof Hook>;

export const ArchetypeProfile = z.object({
  plan: z.string().describe("One sentence on what the deck does"),
  hooks: z.array(Hook),
});
export type ArchetypeProfile = z.infer<typeof ArchetypeProfile>;

/** A line of data/synergy/profiles.jsonl. */
export interface ProfiledArchetype {
  archetype: string;
  /** How many cards the archetype had when it was profiled. */
  cards: number;
  model: string;
  effort?: string;
  profile: ArchetypeProfile;
}

export const MAX_HOOKS = 6;
const MIN_PHRASE_LENGTH = 3;

// --- Reading a model's reply -------------------------------------------------------------------

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value == null || value === "" ? [] : [value]);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const whole = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);

/**
 * Matches what a model wrote against a vocabulary, forgiving case and spacing ("wyrm", "Quick-Play").
 * Returns null when any entry is not in the vocabulary: dropping it would quietly widen the hook.
 */
function within<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  const canonical = new Map(allowed.map((term) => [term.toLowerCase().replace(/[-_ ]/g, ""), term]));
  const found: T[] = [];
  for (const item of asList(value)) {
    const term = typeof item === "string" ? canonical.get(item.toLowerCase().replace(/[-_ ]/g, "")) : undefined;
    if (!term) return null;
    found.push(term);
  }
  return found;
}

const NO_THINGS: Things = { kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 };
const isAnything = (things: Things) =>
  !things.kinds.length && !things.subtypes.length && !things.types.length && !things.attributes.length && !things.level_min && !things.level_max;

function readThings(value: unknown): Things | null {
  const given = asObject(value) ?? {};
  const kinds = within(given.kinds, CARD_KINDS);
  const subtypes = within(given.subtypes, SUBTYPES);
  const types = within(given.types, MONSTER_TYPES);
  const attributes = within(given.attributes, ATTRIBUTES);
  if (!kinds || !subtypes || !types || !attributes) return null;
  return { kinds, subtypes, types, attributes, level_min: whole(given.level_min), level_max: whole(given.level_max) };
}

function readHappening(value: unknown): Happening | null | "invalid" {
  const given = asObject(value);
  if (!given) return null;
  const verbs = within(given.verbs ?? given.verb, keys(VERBS));
  const from = within(given.from, keys(ZONES));
  const what = readThings(given.what);
  if (!verbs?.length || !from || !what) return "invalid";
  const player = given.player === "you" || given.player === "opponent" ? given.player : "any";
  return { verbs, from, player, self: given.self === true, what };
}

/**
 * Reads one hook as a model wrote it. Returns the reason instead when it cannot be used.
 * `checkedElsewhere` is for callers that check something more about the card (a counter's roles),
 * so a hook made of that alone is not refused for saying nothing.
 */
export function readHook(value: unknown, archetype: string, checkedElsewhere = false): Hook | string {
  const given = asObject(value);
  const label = text(given?.label);
  if (!given || !label) return "a hook with no label";

  const does = readHappening(given.does);
  const reactsTo = readHappening(given.reacts_to);
  const card = given.card == null ? null : readThings(given.card);
  const supported = asObject(given.supports);
  const types = within(supported?.types, MONSTER_TYPES);
  const attributes = within(supported?.attributes, ATTRIBUTES);
  if (does === "invalid" || reactsTo === "invalid" || (given.card != null && !card) || !types || !attributes) {
    return `"${label}" uses a term outside the vocabulary`;
  }

  const phrases = asList(given.phrases).map(text).filter(Boolean);
  if (phrases.some((phrase) => phrase.length < MIN_PHRASE_LENGTH)) return `"${label}" has a phrase too short to mean anything`;
  // A hook that names the archetype would only find the archetype's own support, which is not the point.
  if (phrases.some((phrase) => phrase.toLowerCase().includes(archetype.toLowerCase()))) return `"${label}" looks for the archetype's own name`;

  const supports = types.length || attributes.length ? { types, attributes } : null;
  const described = card && !isAnything(card) ? card : null;
  // A hook may be nothing but a kind of card ("Level 4 DARK Winged Beast", "Wyrm Synchro monsters"),
  // which is how a deck's materials are described. Only "any monster" or "any Spell" says too little.
  const particular = described && (described.subtypes.length || described.types.length || described.attributes.length || described.level_min || described.level_max);
  if (!does && !reactsTo && !supports && !phrases.length && !particular && !checkedElsewhere) return `"${label}" says nothing a card can be checked against`;
  return { label, why: text(given.why), does, reacts_to: reactsTo, card: described, supports, phrases };
}

/**
 * Reads a profile from a model's reply, keeping the hooks that can be used and reporting the rest.
 * Returns null when there is no plan or no usable hook.
 */
export function readProfile(reply: unknown, archetype: string): { profile: ArchetypeProfile; dropped: string[] } | null {
  const given = asObject(reply);
  const plan = text(given?.plan);
  if (!given || !plan) return null;

  const hooks: Hook[] = [];
  const dropped: string[] = [];
  for (const raw of asList(given.hooks)) {
    const hook = readHook(raw, archetype);
    if (typeof hook === "string") dropped.push(hook);
    else if (hooks.length < MAX_HOOKS) hooks.push(hook);
  }
  return hooks.length ? { profile: { plan, hooks }, dropped } : null;
}

// --- Finding the cards a profile describes -----------------------------------------------------

const toObject = (things: Things | null): ObjectQuery => {
  const { kinds, subtypes, types, attributes, level_min, level_max } = things ?? NO_THINGS;
  return { kinds, subtypes, types, attributes, archetypes: [], levelMin: level_min || undefined, levelMax: level_max || undefined };
};

/**
 * An event done to the deck's cards has to be able to reach them. Asking for the archetype by name
 * rules out an outside card whose effect only works on some other archetype's cards ("send 1
 * 'Shaddoll' card from your Deck to the GY"), while leaving every effect that names nobody.
 */
const toEvent = (happening: Happening | null, archetype: string): EventQuery | undefined =>
  happening
    ? {
        verbs: happening.verbs,
        from: happening.from,
        player: happening.player === "any" ? undefined : happening.player,
        self: happening.self,
        object: { ...toObject(happening.what), archetypes: happening.self ? [] : [archetype] },
      }
    : undefined;

/** The hook as the effect query the tag matcher answers. Its phrases are checked separately. */
export const hookQuery = (hook: Hook, archetype: string): EffectQuery => ({
  card: toObject(hook.card),
  roles: [],
  does: toEvent(hook.does, archetype),
  reactsTo: toEvent(hook.reacts_to, archetype),
  supports: hook.supports ? { ...toObject(null), ...hook.supports } : undefined,
  quick: false,
  text: "",
});

export interface Candidate {
  card: Card;
  tags?: CardTags;
}

/** A hook that fits more than this share of all cards describes nothing in particular, and is not used. */
const TOO_COMMON_SHARE = 0.05;

export interface HookResult {
  hook: Hook;
  /** How many outside cards fit it. */
  matches: number;
  /** Fits so many cards that it says nothing about any of them; it is left out of the search. */
  ignored: boolean;
}

export interface Partner {
  /** Position of the card in the list that was searched. */
  index: number;
  /** Positions in `hooks` of the hooks this card fits, in the profile's order. */
  fits: number[];
}

export const belongsTo = (card: Card, archetype: string) =>
  card.archetype?.toLowerCase() === archetype.toLowerCase() || card.name.toLowerCase().includes(archetype.toLowerCase());

/**
 * Finds the cards outside an archetype that its profile describes.
 *
 * Cards that fit several hooks come first. After them the hooks take turns, each giving its next
 * best card, so the first page shows something for every reason a card might fit instead of a
 * hundred cards for the commonest reason. Within a hook the cards that name the same thing the hook
 * does come before the ones that merely allow it, and the well-known before the obscure.
 */
export function findPartners(profile: ArchetypeProfile, archetype: string, candidates: readonly Candidate[]): { hooks: HookResult[]; partners: Partner[] } {
  const printed = candidates.map(({ card }) => `${card.pendulumText ?? ""}\n${card.text}`.toLowerCase());
  const outside = candidates.map(({ card }) => !belongsTo(card, archetype));
  const views = (index: number) => candidates[index]!.card.views;

  const fitting = profile.hooks.map((hook) => {
    const query = hookQuery(hook, archetype);
    const phrases = hook.phrases.map((phrase) => phrase.toLowerCase());
    const found: { index: number; specificity: number }[] = [];
    candidates.forEach(({ card, tags }, index) => {
      if (!outside[index] || !phrases.every((phrase) => printed[index]!.includes(phrase))) return;
      const specificity = matchCard(card, tags, query);
      if (specificity !== null) found.push({ index, specificity });
    });
    return found.sort((a, b) => b.specificity - a.specificity || views(b.index) - views(a.index));
  });

  const hooks: HookResult[] = profile.hooks.map((hook, at) => ({
    hook,
    matches: fitting[at]!.length,
    ignored: fitting[at]!.length > candidates.length * TOO_COMMON_SHARE,
  }));
  // When every hook is that common, the narrowest one is still better than no answer.
  if (hooks.every(({ ignored, matches }) => ignored || !matches)) {
    const narrowest = hooks.filter(({ matches }) => matches).sort((a, b) => a.matches - b.matches)[0];
    if (narrowest) narrowest.ignored = false;
  }

  const fitsOf = new Map<number, number[]>();
  hooks.forEach(({ ignored }, at) => {
    if (ignored) return;
    for (const { index } of fitting[at]!) fitsOf.set(index, [...(fitsOf.get(index) ?? []), at]);
  });

  const partners: Partner[] = [...fitsOf]
    .filter(([, fits]) => fits.length > 1)
    .sort(([a, fitsA], [b, fitsB]) => fitsB.length - fitsA.length || views(b) - views(a))
    .map(([index, fits]) => ({ index, fits }));

  const queues = hooks.map(({ ignored }, at) => (ignored ? [] : fitting[at]!.filter(({ index }) => fitsOf.get(index)!.length === 1)));
  for (let turn = 0; queues.some((queue) => turn < queue.length); turn++) {
    queues.forEach((queue, at) => {
      if (queue[turn]) partners.push({ index: queue[turn]!.index, fits: [at] });
    });
  }
  return { hooks, partners };
}

export interface CardLink {
  score: number;
  reason: string;
  reasons: string[];
}

/** Snapshot-only acceleration. Ordinary callers keep their mutable-record semantics. */
interface PreparedCard {
  name: string;
  lowerName: string;
  archetype: string;
  lowerArchetype: string;
}
interface PreparedFilter {
  names: ReadonlySet<string>;
  archetypes: readonly string[];
  subtypeGroups: readonly (readonly string[])[];
  subtypeAll: readonly string[];
  nonTuner: boolean;
  attackMax?: number;
}
interface PreparedCandidate {
  names: ReadonlySet<string>;
  events: CardTags["effects"][number]["actions"];
  actions: CardTags["effects"][number]["actions"];
  triggers: CardTags["effects"][number]["triggers"];
}
const preparedCards = new WeakMap<Card, PreparedCard>();
const preparedFilters = new WeakMap<CardFilter, PreparedFilter>();
const preparedCandidates = new WeakMap<Candidate, PreparedCandidate>();

/** Call only for a caller-owned immutable catalog snapshot, never for live mutable records. */
export function prepareSynergyCandidates(candidates: readonly Candidate[]): void {
  const alternatives = [["normal", "effect"], ["ritual", "fusion", "synchro", "xyz", "link"], ["field", "equip", "continuous", "quick_play", "counter"]];
  const prepareFilter = (filter: CardFilter) => {
    if (preparedFilters.has(filter)) return;
    const subtypeGroups = alternatives.map(group => filter.subtypes.filter(type => group.includes(type))).filter(group => group.length);
    const classified = new Set(subtypeGroups.flat());
    const attack = filter.other.match(/(\d+)\s*(?:or less|or lower)\s*atk/i);
    preparedFilters.set(filter, {
      names: new Set(filter.names.map(compactEffectName)), archetypes: filter.archetypes.map(value => value.toLowerCase()),
      subtypeGroups, subtypeAll: filter.subtypes.filter(type => !classified.has(type)),
      nonTuner: /non[- ]tuner/i.test(filter.other), ...(attack ? { attackMax: Number(attack[1]) } : {}),
    });
  };
  for (const candidate of candidates) {
    const { card, tags } = candidate;
    preparedCards.set(card, { name: compactEffectName(card.name), lowerName: card.name.toLowerCase(), archetype: compactEffectName(card.archetype ?? ""), lowerArchetype: card.archetype?.toLowerCase() ?? "" });
    if (!tags) continue;
    const events = tags.effects.flatMap(effect => [...effect.actions, ...effect.costs]);
    const actions = tags.effects.flatMap(effect => effect.actions);
    const triggers = tags.effects.flatMap(effect => effect.triggers);
    const names = [...tags.supports.names, ...[...events, ...triggers].flatMap(event => event.what.names), ...tags.materials.flatMap(filter => filter.names),
      ...[...`${card.pendulumText ?? ""}\n${card.text}`.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]!)];
    for (const filter of [...tags.materials, ...[...events, ...triggers].map(event => event.what)]) prepareFilter(filter);
    preparedCandidates.set(candidate, { names: new Set(names.map(compactEffectName)), events, actions, triggers });
  }
}

/** Does a material/effect requirement reach this particular card? All stated restrictions apply. */
export function filterReachesCard(filter: CardFilter, card: Card): boolean {
  if (filter.this_card) return false;
  if (filter.kinds.length && !filter.kinds.includes(card.kind)) return false;
  if (filter.types.length && !filter.types.includes(card.monsterType as typeof filter.types[number])) return false;
  if (filter.attributes.length && !filter.attributes.includes(card.attribute!)) return false;
  const prepared = preparedFilters.get(filter), target = preparedCards.get(card);
  if (prepared ? prepared.subtypeGroups.some(group => !group.some(type => (card.subtypes as string[]).includes(type)))
    || !prepared.subtypeAll.every(type => (card.subtypes as string[]).includes(type)) : !matchesSubtypes(card, filter.subtypes)) return false;
  if (filter.names.length) {
    const name = target?.name ?? compactEffectName(card.name);
    if (!(prepared ? prepared.names.has(name) : filter.names.some(value => compactEffectName(value) === name))) return false;
  }
  if (filter.archetypes.length && !(prepared && target
    ? prepared.archetypes.some(value => target.lowerArchetype === value || target.lowerName.includes(value))
    : filter.archetypes.some(value => belongsTo(card, value)))) return false;
  // Generic links with unstructured ATK/non-Tuner/Rank requirements need evidence in the card metadata.
  if ((prepared?.nonTuner ?? /non[- ]tuner/i.test(filter.other)) && card.subtypes.includes("tuner")) return false;
  const attackMax = prepared ? prepared.attackMax : Number(filter.other.match(/(\d+)\s*(?:or less|or lower)\s*atk/i)?.[1]);
  if (attackMax !== undefined && Number.isFinite(attackMax) && (card.atk == null || card.atk > attackMax)) return false;
  // A Rank or Link Rating cannot satisfy a printed Level restriction.
  const level = card.level;
  if (filter.level_min && (level == null || level < filter.level_min)) return false;
  if (filter.level_max && (level == null || level > filter.level_max)) return false;
  return true;
}

const particularFilter = (filter: CardFilter) => filter.names.length || filter.archetypes.length
  || filter.types.length || filter.attributes.length || filter.subtypes.length || filter.level_min || filter.level_max;

function reachableFrom(event: CardTags["effects"][number]["actions"][number], card: Card): boolean {
  if (!event.from.length) return true;
  return event.from.some(zone => zone === "deck" ? !isExtraDeckCard(card)
    : zone === "extra_deck" ? isExtraDeckCard(card) : true);
}

function feasibleMaterial(source: Candidate, target: Candidate, filter: CardFilter): boolean {
  if (!filterReachesCard(filter, target.card)) return false;
  if (source.card.subtypes.includes("synchro")) {
    const other = source.tags!.materials.filter(value => value !== filter).reduce((sum, value) => sum + Math.max(1, value.level_min), 0);
    if (source.card.level == null || target.card.level == null || target.card.level + Math.max(1, other) > source.card.level) return false;
  }
  if (source.card.subtypes.includes("xyz") && source.card.rank != null && !filter.level_min && !filter.level_max
    && !filter.names.length && !filter.archetypes.length && target.card.level !== source.card.rank) return false;
  return true;
}

/** Explainable mechanical links; popularity is only used later as a ranking tie-break. */
export function cardSynergy(anchor: Candidate, candidate: Candidate): CardLink {
  if (anchor.card.id === candidate.card.id) return { score: 0, reason: "", reasons: [] };
  const reasons = new Map<string, number>();
  const add = (reason: string, score: number) => reasons.set(reason, Math.max(score, reasons.get(reason) ?? 0));
  const directs = (source: Candidate, target: Candidate) => {
    const { card, tags } = source;
    if (!tags) return;
    const prepared = preparedCandidates.get(source);
    const key = preparedCards.get(target.card)?.name ?? compactEffectName(target.card.name);
    const namesTarget = prepared ? prepared.names.has(key) : [
      ...tags.supports.names,
      ...tags.effects.flatMap(effect => [...effect.actions, ...effect.costs, ...effect.triggers].flatMap(event => event.what.names)),
      ...tags.materials.flatMap(filter => filter.names),
      ...[...`${card.pendulumText ?? ""}\n${card.text}`.matchAll(/["“]([^"”]+)["”]/g)].map(match => match[1]!),
    ].some(name => compactEffectName(name) === key);
    if (namesTarget) add(`${card.name} names ${target.card.name}`, 12);
    for (const filter of tags.materials) {
      if (particularFilter(filter) && feasibleMaterial(source, target, filter)) add(`${target.card.name} supplies material for ${card.name}`, 4);
    }
    for (const event of prepared?.events ?? tags.effects.flatMap(effect => [...effect.actions, ...effect.costs])) {
        if (event.player === "opponent" || !particularFilter(event.what) || !reachableFrom(event, target.card) || !filterReachesCard(event.what, target.card)) continue;
        const detail = event.what.names.length || event.what.archetypes.length ? 6 : 2;
        add(`${card.name}: ${event.verb.replaceAll("_", " ")} for ${target.card.name}`, detail);
    }
    if (tags.supports.archetypes.some(name => belongsTo(target.card, name))) add(`${card.name} supports ${target.card.archetype ?? target.card.name}`, 5);
    // A stated Type or Attribute is useful only when combined restrictions can all be met.
    const supports = tags.supports;
    if ((supports.types.length || supports.attributes.length || supports.subtypes.length)
      && (!supports.types.length || supports.types.includes(target.card.monsterType as typeof supports.types[number]))
      && (!supports.attributes.length || supports.attributes.includes(target.card.attribute!))
      && matchesSubtypes(target.card, supports.subtypes)) {
      add(`${card.name} supports ${[...supports.types, ...supports.attributes, ...supports.subtypes].join("/")}`, 2);
    }
    // Event producer/consumer: milling a card whose own trigger benefits from being sent to the GY.
    for (const event of prepared?.actions ?? tags.effects.flatMap(effect => effect.actions)) {
      if (event.player === "opponent" || !reachableFrom(event, target.card) || !filterReachesCard(event.what, target.card)) continue;
      const triggers = preparedCandidates.get(target)?.triggers ?? target.tags?.effects.flatMap(effect => effect.triggers);
      if (triggers?.some(trigger => trigger.what.this_card
        && trigger.verb === event.verb && (!trigger.from.length || trigger.from.some(zone => event.from.includes(zone))))) {
        add(`${card.name} enables ${target.card.name}'s ${event.verb.replaceAll("_", " ")} trigger`, 4);
      }
    }
  };
  directs(candidate, anchor);
  directs(anchor, candidate);
  if (anchor.card.archetype && candidate.card.archetype && (preparedCards.get(anchor.card)?.archetype ?? compactEffectName(anchor.card.archetype)) === (preparedCards.get(candidate.card)?.archetype ?? compactEffectName(candidate.card.archetype))) {
    add(`Shares ${anchor.card.archetype}`, 5);
  }
  const sorted = [...reasons].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { score: sorted.reduce((sum, [, score]) => sum + score, 0), reason: sorted[0]?.[0] ?? "", reasons: sorted.map(([reason]) => reason) };
}

export interface RankedInsightCard {
  release?: import("./releases.js").CardReleaseInfo;
  passcode: number;
  name: string;
  score: number;
  linkedCards: number;
  reason: string;
  deckMasterFit?: boolean;
}

export function scoreForDeck(candidate: Candidate, deck: readonly Candidate[], profiles: ReadonlyMap<string, ArchetypeProfile> = new Map()): RankedInsightCard {
  let score = 0;
  let linkedCards = 0;
  let best: CardLink = { score: 0, reason: "", reasons: [] };
  const seen = new Set<number>();
  const seenProfiles = new Set<string>();
  for (const anchor of deck) {
    if (seen.has(anchor.card.id)) continue;
    seen.add(anchor.card.id);
    const link = cardSynergy(anchor, candidate);
    if (link.score > 0) {
      linkedCards++;
      score += link.score;
      if (link.score > best.score) best = link;
    }
    const archetype = anchor.card.archetype;
    if (!archetype || seenProfiles.has(archetype) || belongsTo(candidate.card, archetype)) continue;
    seenProfiles.add(archetype);
    const profile = profiles.get(archetype);
    for (const hook of profile?.hooks ?? []) {
      if (!hook.phrases.every(phrase => candidate.card.text.toLowerCase().includes(phrase.toLowerCase()))) continue;
      if (matchCard(candidate.card, candidate.tags, hookQuery(hook, archetype)) === null) continue;
      score += 1;
      if (!best.reason) best = { score: 1, reason: `${hook.label}: ${hook.why}`, reasons: [hook.label] };
    }
  }
  return { passcode: candidate.card.id, name: candidate.card.name, score, linkedCards, reason: best.reason };
}

/** Candidates are already scoped by the caller's pool and legality constraints. */
export function rankForDeck(deck: readonly Candidate[], candidates: Iterable<Candidate>, options: { limit?: number; profiles?: ReadonlyMap<string, ArchetypeProfile>; deckMaster?: Candidate } = {}): RankedInsightCard[] {
  const owned = new Set(deck.map(({ card }) => card.id));
  const ranked: Array<RankedInsightCard & { popularity: number }> = [];
  for (const candidate of candidates) {
    if (owned.has(candidate.card.id)) continue;
    const result = scoreForDeck(candidate, deck, options.profiles);
    if (result.score <= 0) continue;
    ranked.push({ ...result, popularity: candidate.card.views,
      ...(options.deckMaster ? { deckMasterFit: cardSynergy(options.deckMaster, candidate).score > 0 } : {}) });
  }
  return ranked.sort((a, b) => b.linkedCards - a.linkedCards || b.score - a.score || b.popularity - a.popularity || a.passcode - b.passcode)
    .slice(0, Math.max(1, Math.min(120, options.limit ?? 30))).map(({ popularity: _popularity, ...card }) => card);
}
