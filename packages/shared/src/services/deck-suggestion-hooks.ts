import { ATTRIBUTES, MONSTER_TYPES, isExtraDeckCard, type Card } from "../cards/effects/card.js";
import { belongsTo, filterReachesCard, hookQuery, type Candidate, type Hook, type ArchetypeProfile } from "../cards/effects/synergy.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import { matchCard } from "../cards/effects/effect-match.js";
import type { EffectQuery } from "../cards/effects/query.js";
import { NO_FILTER, type CardFilter, type Effect } from "../cards/effects/tags.js";

export interface SuggestionHook { query: EffectQuery; reason: string; phrases: string[] }
const things = (): NonNullable<Hook["card"]> => ({ kinds: [], subtypes: [], types: [], attributes: [], level_min: 0, level_max: 0 });
const typeConditions = MONSTER_TYPES.map(type => ({ type, pattern: new RegExp(`\\b${type} monster`, "i") }));
const attributeConditions = ATTRIBUTES.map(attribute => ({ attribute, pattern: new RegExp(`\\b${attribute} monster`, "i") }));
const coreEligible = ({ tags }: Candidate) => !tags?.roles.includes("hand_trap");

/** A side engine or a hand trap must not supply the deck's primary strategy profiles. */
export function deckSuggestionCore(main: readonly Candidate[], includeMonsterMemberships = false): { anchors: Candidate[]; archetypes: string[] } {
  const eligible = main.filter(coreEligible), counts = new Map<string, number>();
  for (const { card, tags } of eligible) {
    // Generic secondary Spell groups such as "Fusion" must not define an engine.
    const names = new Set([...(card.archetype ? [card.archetype] : []), ...(tags?.supports.archetypes ?? []),
      ...(includeMonsterMemberships && card.kind === "monster" ? card.archetypes ?? [] : [])]);
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const maximum = Math.max(0, ...counts.values());
  const archetypes = [...counts].filter(([, count]) => count >= Math.max(maximum <= 1 ? 1 : 2, maximum * 0.4)).map(([name]) => name);
  return { anchors: eligible, archetypes };
}

/** Copies determine the 30% threshold. No model or network call is used. */
export function deckSuggestionHooks(main: readonly Candidate[], profiles: ReadonlyMap<string, ArchetypeProfile>, extra: readonly Candidate[] = []): SuggestionHook[] {
  const hooks: SuggestionHook[] = [];
  const add = (hook: Hook, archetype = "") => {
    const query = hookQuery(hook, archetype);
    // A prose-only profile is useful in the guide but cannot rank an entire catalog.
    if (!query.does && !query.reactsTo && !query.supports && !hook.card && !hook.phrases.length) return;
    hooks.push({ query, reason: hook.label, phrases: hook.phrases.map(phrase => phrase.toLowerCase()) });
  };
  for (const [archetype, profile] of profiles) for (const hook of profile.hooks) add(hook, archetype);
  const monsters = main.filter(({ card }) => card.kind === "monster" && !isExtraDeckCard(card));
  const base = (label: string): Hook => ({ label, why: label, does: null, reacts_to: null, card: null, supports: null, phrases: [] });
  const action = (label: string, wanted: ReturnType<typeof things>) => {
    // Each operation has its own prevalence count. Combining search, mill and
    // revival would classify three different useful niches as one common hook.
    for (const [verb, zone] of [["add_to_hand", "deck"], ["special_summon", "deck"], ["special_summon", "gy"], ["special_summon", "hand"], ["send_to_gy", "deck"]] as const) {
      const hook = base(label);
      hook.does = { verbs: [verb], from: [zone], player: "you", self: false, what: wanted };
      add(hook);
    }
  };
  for (const field of ["monsterType", "attribute", "level"] as const) {
    const counts = new Map<string | number, number>();
    for (const { card } of monsters) if (card[field] !== undefined) counts.set(card[field]!, (counts.get(card[field]!) ?? 0) + 1);
    for (const [value, count] of counts) {
      if (count < monsters.length * 0.3) continue;
      if (field === "monsterType" || field === "attribute") {
        const hook = base(`Supports your ${value} monsters`);
        hook.supports = { types: field === "monsterType" ? [value as NonNullable<Hook["supports"]>["types"][number]] : [], attributes: field === "attribute" ? [value as NonNullable<Hook["supports"]>["attributes"][number]] : [] };
        add(hook);
        const wanted = { ...things(), kinds: ["monster"] } as NonNullable<Hook["does"]>["what"];
        if (field === "monsterType") wanted.types = [value as typeof wanted.types[number]];
        else wanted.attributes = [value as typeof wanted.attributes[number]];
        action(`Searches, revives or prepares your ${value} monsters`, wanted);
      } else {
        action(`Searches or summons your Level ${value} monsters`, { ...things(), kinds: ["monster"], level_min: Number(value), level_max: Number(value) });
      }
    }
  }
  if (monsters.filter(({ card }) => card.subtypes.includes("normal")).length >= 3) {
    action("Searches or revives your Normal Monsters", { ...things(), kinds: ["monster"], subtypes: ["normal"] });
    const draw = base("Turns your high-Level monsters into draws");
    draw.does = { verbs: ["discard"], from: ["hand"], player: "you", self: false, what: { ...things(), kinds: ["monster"], level_min: 5 } };
    add(draw);
  }
  if (extra.some(({ card }) => card.subtypes.includes("fusion")) && main.some(({ tags }) => tags?.effects.some(effect => effect.actions.some(event => event.verb === "fusion_summon")))) {
    const fusion = base("Fusion Summons with your existing materials");
    fusion.does = { verbs: ["fusion_summon", "special_summon", "reveal_or_look"], from: ["extra_deck"], player: "you", self: false, what: { ...things(), subtypes: ["fusion"] } };
    add(fusion);
  }
  return hooks;
}

/** Match query and effect restrictions against the same actual deck card before counting prevalence. */
export function prepareSuggestionHookMatching(hooks: readonly SuggestionHook[], main: readonly Candidate[], extra: readonly Candidate[]) {
  const unique = [...new Map([...main, ...extra].map(candidate => [candidate.card.id, candidate])).values()];
  const targets = hooks.map(({ query }) => {
    const wanted = query.does?.object;
    if (!wanted) return [];
    const filter: CardFilter = { ...NO_FILTER, kinds: wanted.kinds, subtypes: wanted.subtypes, types: wanted.types as CardFilter["types"], attributes: wanted.attributes,
      archetypes: wanted.archetypes, level_min: wanted.levelMin ?? 0, level_max: wanted.levelMax ?? 0 };
    return unique.filter(({ card }) => filterReachesCard(filter, card));
  });
  const needsPrinted = hooks.some(hook => hook.phrases.length > 0);
  return (candidate: Candidate): number[] => {
    const printed = needsPrinted ? `${candidate.card.pendulumText ?? ""}\n${candidate.card.text}`.toLowerCase() : "";
    const fits: number[] = [];
    // The concrete-target check usually rejects an unrelated/self effect before
    // the general query matcher has to score all of its tagged effects.
    const events = candidate.tags?.effects.flatMap(effect => [...effect.actions, ...effect.costs]) ?? [];
    hooks.forEach((hook, at) => {
      if (!hook.phrases.every(phrase => printed.includes(phrase))) return;
      const demand = hook.query.does;
      if (demand && !demand.self && !events.some(event =>
        demand.verbs.includes(event.verb) && event.player !== "opponent" && !event.what.this_card
        && (!demand.from.length || event.from.some(zone => demand.from.includes(zone)))
        && targets[at]!.some(({ card }) => filterReachesCard(event.what, card)))) return;
      if (matchCard(candidate.card, candidate.tags, hook.query) === null) return;
      fits.push(at);
    });
    return fits;
  };
}

export interface SupportContext {
  main: readonly Candidate[];
  monsters: readonly Candidate[];
  extra: readonly Candidate[];
  fusion: boolean;
  namedMaterials: ReadonlySet<string>;
  importance: ReadonlyMap<number, number>;
  recovery: boolean;
}

export function deckSupportContext(main: readonly Candidate[], extra: readonly Candidate[], archetypes: readonly string[]): SupportContext {
  const monsters = main.filter(({ card }) => card.kind === "monster" && !isExtraDeckCard(card));
  const names = new Map<string, number>();
  for (const { tags } of main) for (const name of tags?.supports.names ?? []) names.set(compactEffectName(name), (names.get(compactEffectName(name)) ?? 0) + 1);
  const importance = new Map<number, number>();
  for (const { card, tags } of monsters) importance.set(card.id, 1 + Math.min(3, names.get(compactEffectName(card.name)) ?? 0)
    + (archetypes.some(name => belongsTo(card, name) || tags?.supports.archetypes.includes(name)) ? 2 : 0));
  const fusion = extra.some(({ card }) => card.subtypes.includes("fusion")) && main.filter(({ tags }) => tags?.effects.some(effect => effect.actions.some(event => event.verb === "fusion_summon"))).length >= 2;
  const namedMaterials = new Set(extra.flatMap(({ tags }) => tags?.materials.flatMap(filter => filter.names.map(compactEffectName)) ?? []));
  const recovery = main.some(({ tags }) => tags?.effects.some(effect => effect.actions.some(event => event.verb === "special_summon" && event.from.includes("gy") && !event.what.this_card)));
  return { main, monsters, extra, fusion, namedMaterials, importance, recovery };
}

/** Only known residual restrictions are accepted; every stat is tested on the same target. */
export function supportFilterReaches(filter: CardFilter, card: Card, context: SupportContext): boolean {
  if (!filter.other) return filterReachesCard(filter, card);
  let other = filter.other;
  let tested = true;
  const consume = (pattern: RegExp, check: (match: RegExpExecArray) => boolean) => {
    const match = pattern.exec(other);
    if (match) { tested &&= check(match); other = other.replace(pattern, " "); }
  };
  consume(/(?:with )?(\d+) (?:or more|or higher) ATK/i, match => card.atk != null && card.atk >= Number(match[1]));
  consume(/(?:with )?(\d+) (?:or less|or lower) ATK/i, match => card.atk != null && card.atk <= Number(match[1]));
  consume(/(?:with )?(\d+) (?:or more|or higher) DEF/i, match => card.def != null && card.def >= Number(match[1]));
  consume(/(?:with )?(\d+) (?:or less|or lower) DEF/i, match => card.def != null && card.def <= Number(match[1]));
  consume(/(?:with )?(\d+) DEF/i, match => card.def === Number(match[1]));
  consume(/non[- ]Tuner/i, () => !card.subtypes.includes("tuner"));
  consume(/(?:whose |a )?name is specifically listed on (?:the|a) (?:revealed )?Fusion Monster/i, () => context.namedMaterials.has(compactEffectName(card.name)));
  other = other.replace(/\b(?:and|up to \d+|face-up|face-down|in (?:face-down )?Defense Position|in Attack Position|on (?:your|the) field)\b/gi, " ").replace(/[,.]/g, "").trim();
  if (!tested || other) return false;
  return filterReachesCard({ ...filter, other: "" }, card);
}

const reaches = supportFilterReaches;

/** Printed activation restrictions apply to every effect; read them once per card. */
function candidatePenalty(candidate: Candidate, context: SupportContext): number | undefined {
  let penalty = candidate.card.kind === "trap" ? 6 : candidate.card.kind === "monster" ? 5 : 0;
  const printed = candidate.card.text;
  const equip = /^Equip only to (?:an? )?"([^"\n]+)" monster/i.exec(printed);
  if (equip && !context.monsters.some(({ card }) => belongsTo(card, equip[1]!))) return;
  const handShuffle = /^Shuffle (\d+) [^.]*from your hand/i.exec(printed);
  if (handShuffle) penalty += Number(handShuffle[1]) * 3;
  if (/chosen by (?:your|the) opponent|opponent can discard[^.]*negate/i.test(printed)) penalty += 12;
  if (/for (?:the )?rest of this turn[^.]*cannot Special Summon/i.test(printed) && !/except/i.test(printed)) penalty += 8;
  if (/excavat|random|opponent (?:declares|chooses|picks)|opponent adds 1 to their hand/i.test(printed)) penalty += 16;
  if (/To activate this card, you must draw/i.test(printed)) penalty += 16;
  if (/to your opponent.s hand/i.test(printed)) penalty += 6;
  if (/opponent (?:can |may )?(?:choose|make)/i.test(printed)) penalty += 12;
  if (/cannot Special Summon.*(?:the rest of this turn|this turn)/i.test(printed) && !/except/i.test(printed)) penalty += 8;
  if (/Link Monster points to/i.test(printed)) {
    if (!context.extra.some(({ card }) => card.subtypes.includes("link"))) return;
    penalty += 4;
  }
  if (/return.*Fusion Monster.*Extra Deck|return.*Synchro Monster.*Extra Deck/i.test(printed)) penalty += 10;
  if (/face-down Defense Position/i.test(printed)) penalty += 6;
  // Activation payments and granted effects can be separate tag entries. They still apply.
  if (/^Activate this card by/i.test(printed)) for (const cost of candidate.tags!.effects[0]!.costs) {
    if (!cost.what.this_card && !context.main.some(({ card }) => reaches(cost.what, card, context))) return;
  }
  return penalty;
}

function effectPenalty(effect: Effect, candidate: Candidate, context: SupportContext, initial: number): number | undefined {
  let penalty = initial;
  for (const action of effect.actions) {
    if (/granted to/i.test(action.note)) for (const match of action.note.matchAll(/"([^"\n]+)"/g)) {
      if (!context.main.some(({ card }) => belongsTo(card, match[1]!))) return;
    }
    if (action.player !== "opponent" && action.verb === "return_to_deck" && action.from.includes("field")
      && !context.main.some(({ card }) => reaches(action.what, card, context)) && !context.extra.some(({ card }) => reaches(action.what, card, context))) return;
  }
  if (effect.location.length && !effect.location.includes("field") && !effect.location.includes("hand")) penalty += 10;
  for (const trigger of effect.triggers) {
    if (trigger.what.this_card && (trigger.verb === "normal_summon" || trigger.verb === "special_summon")) penalty += 2;
    else penalty += 12;
  }
  for (const condition of effect.conditions) {
    for (const match of condition.matchAll(/"([^"\n]+)"/g)) if (!context.main.some(({ card }) => compactEffectName(card.name) === compactEffectName(match[1]!) || belongsTo(card, match[1]!))) return;
    const level = /Level (\d+)/i.exec(condition);
    if (level && !context.monsters.some(({ card }) => card.level === Number(level[1]))) return;
    for (const { type, pattern } of typeConditions) if (pattern.test(condition) && !context.monsters.some(({ card }) => card.monsterType === type)) return;
    for (const { attribute, pattern } of attributeConditions) if (pattern.test(condition) && !context.monsters.some(({ card }) => card.attribute === attribute)) return;
    penalty += 2;
  }
  for (const cost of effect.costs) {
    if (cost.what.this_card) { if (cost.from.includes("gy")) penalty += 8; continue; }
    if (cost.verb === "pay_lp") { penalty += 2; continue; }
    if (/Fusion Material/i.test(`${cost.what.other} ${cost.note}`) && context.fusion) continue;
    if (cost.from.includes("extra_deck")) {
      if (!context.extra.some(({ card }) => reaches(cost.what, card, context))) return;
    } else if ((cost.what.kinds.length || cost.what.names.length || cost.what.archetypes.length || cost.what.types.length || cost.what.subtypes.length || cost.what.attributes.length || cost.what.level_min || cost.what.level_max || cost.what.other)
      && !context.main.some(({ card }) => reaches(cost.what, card, context))) return;
    if (cost.verb === "discard" || cost.verb === "send_to_gy") penalty += 2;
    else if (cost.verb === "tribute" || cost.verb === "banish" || cost.verb === "return_to_deck") {
      const count = /(?:^|\b)([2-9]) (?:cards|monsters|LIGHT|DARK|FIRE)/i.exec(cost.note);
      penalty += 4 * (count ? Number(count[1]) : 1);
    }
  }
  return penalty;
}

/** An actionable effect on a real core card outweighs coincidental matches to several profiles. */
export function scoreDeckSupport(candidate: Candidate, context: SupportContext): { score: number; reason: string; linkedCards: number } | undefined {
  const { card, tags } = candidate;
  if (!tags) return;
  if (card.subtypes.includes("ritual") && !context.main.some(({ tags }) => tags?.effects.some(effect => effect.actions.some(event => event.verb === "ritual_summon" && reaches(event.what, card, context))))) return;
  const effects = tags.effects.filter(effect => effect.actions.some(event =>
    event.verb === "draw" && event.player === "you"
    || event.player !== "opponent" && !event.what.this_card
      && (event.verb === "add_to_hand" || event.verb === "special_summon" || event.verb === "send_to_gy" || event.verb === "fusion_summon")));
  if (!effects.length) return;
  const initialPenalty = candidatePenalty(candidate, context);
  if (initialPenalty === undefined) return;
  let best: { score: number; reason: string; linkedCards: number } | undefined;
  const consider = (score: number, reason: string, linkedCards: number) => { if (!best || score > best.score) best = { score, reason, linkedCards }; };
  for (const effect of effects) {
    const penalty = effectPenalty(effect, candidate, context, initialPenalty);
    if (penalty === undefined) continue;
    for (const event of effect.actions) {
      if (event.player === "opponent" || event.what.this_card) continue;
      const description = `${event.what.other} ${event.note}`;
      const previous = effect.actions.slice(0, effect.actions.indexOf(event));
      if (/same monster just added|Fusion Material Monsters listed on that Fusion Monster/i.test(description)
        && previous.some(action => ["add_to_hand", "return_to_deck"].includes(action.verb)
          && !context.main.some(({ card }) => reaches(action.what, card, context)) && !context.extra.some(({ card }) => reaches(action.what, card, context)))) continue;
      if (/then/i.test(card.text) && !/Activate 1 of these effects/i.test(card.text)
        && previous.some(action => ["add_to_hand", "special_summon"].includes(action.verb)
          && !context.main.some(({ card }) => reaches(action.what, card, context)))) continue;
      if (context.fusion && (event.verb === "fusion_summon" || (event.verb === "special_summon" && event.from.includes("extra_deck") && event.what.subtypes.includes("fusion")))) {
        const targets = context.extra.filter(({ card }) => card.subtypes.includes("fusion") && reaches(event.what, card, context));
        const materials = description;
        const fusionSentence = card.text.match(/Fusion Summon 1[^.]*\./i)?.[0] ?? description;
        const materialRule = `${fusionSentence} ${description}`;
        const requiredArchetype = /including (?:(?:an?|1) )?"([^"\n]+)"(?: monster)?/i.exec(materialRule);
        if (requiredArchetype && !context.monsters.some(({ card }) => belongsTo(card, requiredArchetype[1]!))) continue;
        const referencedMonster = /(?:target|mentions|that lists|specifically lists) (?:1 )?"([^"\n]+)"/i.exec(`${card.text} ${description}`);
        if (referencedMonster && !context.monsters.some(({ card }) => belongsTo(card, referencedMonster[1]!))) continue;
        if (/including (?:an? |1 )?(Zombie|Cyberse|Beast-Warrior|Warrior|Spellcaster|Dragon) monster/i.test(materialRule)) {
          const type = /including (?:an? |1 )?(Zombie|Cyberse|Beast-Warrior|Warrior|Spellcaster|Dragon) monster/i.exec(materialRule)![1]!;
          if (!context.monsters.some(({ card }) => card.monsterType === type)) continue;
        }
        if (/same Level as/i.test(description)) continue;
        if (/Only Pendulum Monsters can be used/i.test(card.text) && context.monsters.filter(({ card }) => card.subtypes.includes("pendulum")).length < 2) continue;
        const gyMaterials = /(?:from|in) your (?:field or )?GY|from your field or GY/i.test(materialRule)
          && !/If Summoning an? "[^"\n]+"/i.test(materialRule);
        const limitedMaterials = /using monsters from your hand as|using (?:2 )?monsters (?:you control|from your field)/i.test(materials);
        const recycles = tags.effects.some(effect => effect.actions.some(action => action.verb === "special_summon" && /Fusion Materials/i.test(action.note)));
        if (targets.length) consider(30 + Math.min(3, targets.length) * 3 + (gyMaterials ? 6 : 0) + (recycles ? 3 : 0) - (limitedMaterials ? 5 : 0) - penalty, `Fusion Summons ${targets[0]!.card.name}`, targets.length);
        continue;
      }
      if (!["add_to_hand", "special_summon", "send_to_gy"].includes(event.verb) || event.from.includes("extra_deck")) continue;
      if (event.verb === "send_to_gy" && (!event.from.includes("deck") || /top|random|excavat/i.test(description))) continue;
      if (/must share exactly|higher ATK|same Type, Attribute, Level/i.test(description)) continue;
      const linkAttributes = /(\d+) Attributes/i.exec(description);
      if (linkAttributes && new Set(context.extra.filter(({ card }) => card.subtypes.includes("link")).map(({ card }) => card.attribute)).size < Number(linkAttributes[1])) continue;
      const materialSearch = /Fusion Material.*(?:name|listed)|name.*(?:listed|Fusion Monster)/i.test(description);
      if (materialSearch && !context.namedMaterials.size) continue;
      const targets = context.main.filter(({ card: target }) => reaches(event.what, target, context)
        && (!materialSearch || context.namedMaterials.has(compactEffectName(target.name))));
      if (!targets.length) continue;
      const distinct = [...new Map(targets.map(target => [target.card.id, target])).values()];
      const target = distinct.reduce((best, next) => (context.importance.get(next.card.id) ?? 0) > (context.importance.get(best.card.id) ?? 0) ? next : best);
      const deckLimited = /from Deck only if Level (\d+) or lower/i.exec(description);
      const canUseDeck = event.from.includes("deck") && (!deckLimited || distinct.some(({ card }) => card.level !== undefined && card.level <= Number(deckLimited[1])));
      let base = event.verb === "add_to_hand" ? (canUseDeck ? 25 : 15)
        : event.verb === "special_summon" ? (canUseDeck ? 27 : event.from.includes("gy") ? 24 : 14) : 21;
      if (event.verb === "send_to_gy") {
        const payoff = distinct.some(({ tags }) => tags?.effects.some(effect => effect.location.includes("gy") || effect.triggers.some(trigger => trigger.what.this_card && trigger.verb === "send_to_gy")));
        if (!payoff && !context.recovery) continue;
        if (payoff) base += 3;
      }
      if (materialSearch && context.fusion) base += 10;
      if (/negate.*effects|effects (?:are |will be )?negated/i.test(`${description} ${card.text}`)) base -= 8;
      if (previous.some(action => action.verb === "destroy" && action.player === "you")) base -= 4;
      if (previous.some(action => action.verb === "return_to_deck" && action.player === "you")) base -= 4;
      const specificity = (event.what.types.length ? 2 : 0) + (event.what.attributes.length ? 2 : 0) + (event.what.subtypes.length ? 2 : 0) + (event.what.level_min || event.what.level_max ? 2 : 0) + (event.what.other ? 2 : 0);
      const importance = context.importance.get(target.card.id) ?? 0;
      // A frequently named engine piece matters more than incidental monsters of
      // the same Type/Attribute. The bonus is capped so a large pile cannot dominate.
      const centrality = Math.min(3, Math.max(0, importance - 3));
      const score = base + specificity + Math.min(6, targets.length) + importance + centrality - penalty;
      consider(score, `${event.verb === "add_to_hand" ? "Searches" : event.verb === "send_to_gy" ? "Prepares the GY with" : "Summons"} ${target.card.name}`, distinct.length);
    }
    if (effect.actions.some(event => event.verb === "draw" && event.player === "you")) {
      for (const cost of effect.costs) {
        if (cost.verb !== "discard" || !(cost.what.level_min || cost.what.level_max || cost.what.types.length || cost.what.attributes.length || cost.what.subtypes.length)) continue;
        const target = context.monsters.find(({ card }) => reaches(cost.what, card, context));
        if (target) consider(34 + (context.importance.get(target.card.id) ?? 0) - penalty, `Turns ${target.card.name} into draws`, 1);
      }
    }
  }
  return best && best.score > 0 ? best : undefined;
}
