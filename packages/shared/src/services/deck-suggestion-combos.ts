import { createMainDeckSummonChecker } from "../cards/effects/deck-summon.js";
import { sharedSmallWorldStats } from "../cards/effects/bridge-text.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import type { Candidate } from "../cards/effects/synergy.js";
import type { Effect, GameEvent } from "../cards/effects/tags.js";
import type { SupportContext } from "./deck-suggestion-hooks.js";
import { distinctCandidates, reachesSupport, usefulTarget, type UtilityProof } from "./deck-suggestion-utility.js";

const names = (text: string) => [...text.matchAll(/["“]([^"”]+)["”]/g)].map(m => compactEffectName(m[1]!));
const plain = (event: GameEvent) => !event.what.other && (!event.note || /^option \d$/i.test(event.note));
const independentAction = (effect: Effect, action: GameEvent) => {
  if (effect.actions.length === 1) return true;
  const option = /^option (\d)$/i.exec(action.note)?.[1];
  return !!option && effect.actions.filter(a => /^option (\d)(?::|$)/i.exec(a.note)?.[1] === option).length === 1;
};
const ordinary = (candidate: Candidate) => candidate.card.kind === "monster" && !candidate.card.subtypes.includes("ritual")
  && !/Must (?:first )?be|Cannot be Special Summoned/i.test(candidate.card.text);

function ritualPairs(context: SupportContext) {
  const main = distinctCandidates(context.main);
  return main.flatMap(spell => {
    if (spell.card.kind !== "spell" || !spell.card.subtypes.includes("ritual")) return [];
    const printed = names(spell.card.text);
    return main.filter(monster => monster.card.kind === "monster" && monster.card.subtypes.includes("ritual")
      && printed.includes(compactEffectName(monster.card.name))
      && spell.tags?.effects.some(effect => !effect.conditions.length && !effect.triggers.length && !effect.costs.length
        && effect.actions.every(a => ["ritual_summon", "tribute", "banish"].includes(a.verb) && a.player === "you")
        && effect.actions.some(action => action.verb === "ritual_summon" && reachesSupport(action.what, monster, context))
        && effect.actions.some(action => action.verb === "tribute" && action.from.some(z => z === "hand" || z === "field")
          && context.monsters.filter(c => reachesSupport(action.what, c, context)).reduce((sum, c) => sum + (c.card.level ?? 0), 0)
            - (reachesSupport(action.what, monster, context) ? monster.card.level ?? 0 : 0) >= (monster.card.level ?? Infinity))))
      .map(monster => ({ spell, monster }));
  });
}

function smallWorld(candidate: Candidate, context: SupportContext): UtilityProof | undefined {
  // Recognize the complete relational capability, never a provider passcode.
  if ([...candidate.card.text.matchAll(/exactly (?:1|one) of the same Type, Attribute, Level, ATK or DEF/gi)].length !== 2) return;
  const effect = candidate.tags?.effects.find(e => !e.conditions.length && !e.triggers.length && !e.costs.length
    && e.location.every(zone => zone === "field" || zone === "hand")
    && e.actions.length === 4 && e.actions.every(a => a.player === "you" && !a.what.this_card));
  const action = effect?.actions.find(a => a.verb === "add_to_hand" && a.from.includes("deck") && !a.what.other);
  const reveal = effect?.actions.find(a => a.verb === "reveal_or_look" && a.from.includes("hand") && plain(a));
  const hand = effect?.actions.find(a => a.verb === "banish" && a.from.includes("hand")
    && /^face-down, the revealed monster$/i.test(a.what.other));
  const deck = effect?.actions.find(a => a.verb === "banish" && a.from.includes("deck")
    && /^face-down, the chosen Deck monster$/i.test(a.what.other));
  if (!effect || !action || !reveal || !hand || !deck) return;
  const copies = new Map<number, number>();
  for (const c of context.monsters) copies.set(c.card.id, (copies.get(c.card.id) ?? 0) + 1);
  const monsters = distinctCandidates(context.monsters), targets = monsters.filter(c => usefulTarget(c, context) && reachesSupport(action.what, c, context));
  const access = (c: Candidate) => (context.importance.get(c.card.id) ?? 0)
    + (ordinary(c) && c.tags?.roles.some(r => r === "searcher" || r === "draw_power") ? 3 : 0);
  targets.sort((a, b) => access(b) - access(a) || a.card.id - b.card.id);
  // At most 60 submitted copies, never a catalog-wide middle-card search.
  for (const target of targets) for (const middle of monsters) {
    if (!reachesSupport({ ...deck.what, other: "" }, middle, context) || sharedSmallWorldStats(middle.card, target.card) !== 1) continue;
    for (const source of monsters) {
      if (!reachesSupport(reveal.what, source, context) || !reachesSupport({ ...hand.what, other: "" }, source, context)
        || sharedSmallWorldStats(source.card, middle.card) !== 1) continue;
      const used = new Map<number, number>();
      for (const c of [source, middle, target]) used.set(c.card.id, (used.get(c.card.id) ?? 0) + 1);
      if ([...used].some(([id, count]) => count > copies.get(id)!)) continue;
      return { effect, action, targets: [source, middle, target], payoff: [target], utility: 4, friction: 5, compositional: true,
        requirements: [`banish ${source.card.name} from hand and ${middle.card.name} from Deck face-down`],
        reason: `Banish 2: searches ${target.card.name} via ${middle.card.name}` };
    }
  }
}

function fieldPayoff(field: Candidate, context: SupportContext): Candidate | undefined {
  // On normal activation, a Field Spell must immediately reach existing useful
  // engine cards. Merely sharing the Field subtype is not a deck utility proof.
  for (const effect of field.tags?.effects ?? []) {
    if (effect.conditions.length || effect.costs.length || effect.triggers.some(t => t.verb !== "activate" || !t.what.this_card)) continue;
    for (const action of effect.actions) {
      if (action.player !== "you" || !action.from.includes("deck") || !["add_to_hand", "set_spell_trap", "special_summon"].includes(action.verb)
        || !plain(action) || !independentAction(effect, action) || !action.what.names.length && !action.what.archetypes.length) continue;
      const target = context.main.find(c => c.card.id !== field.card.id && reachesSupport(action.what, c, context) && usefulTarget(c, context));
      if (target) return target;
    }
  }
}

/** A searched card must have an evaluated use, not just a matching name. */
function handPayoff(target: Candidate, context: SupportContext): { payoff: Candidate; requirement?: string } | undefined {
  if (!usefulTarget(target, context)) return;
  if (target.card.subtypes.includes("field")) {
    const payoff = fieldPayoff(target, context);
    return payoff && { payoff };
  }
  if (target.card.subtypes.includes("ritual")) {
    const pair = ritualPairs(context).find(pair => pair.monster.card.id === target.card.id || pair.spell.card.id === target.card.id);
    return pair && { payoff: pair.monster, requirement: "use the owned Ritual pair and materials" };
  }
  if (ordinary(target) && (target.card.level ?? Infinity) <= 4) return { payoff: target };
  // High-Level hand searches need an owned, usable hand-summon enabler.
  const enabler = ordinary(target) && context.main.find(provider => provider.card.kind === "spell" && provider.tags?.effects.some(e =>
    !e.conditions.length && !e.triggers.length && !e.costs.length && e.actions.length === 1
    && e.location.every(zone => zone === "field" || zone === "hand")
    && e.actions[0]!.verb === "special_summon" && e.actions[0]!.player === "you" && e.actions[0]!.from.length === 1
    && e.actions[0]!.from[0] === "hand" && plain(e.actions[0]!) && reachesSupport(e.actions[0]!.what, target, context)));
  if (enabler) return { payoff: target, requirement: `${enabler.card.name} in hand` };
}

function millPayoff(target: Candidate, context: SupportContext): { payoff: Candidate[]; reason: string; requirements: string[]; friction: number } | undefined {
  for (const effect of target.tags?.effects ?? []) {
    if (!effect.location.includes("gy")) continue;
    const sent = effect.triggers.length === 1 && effect.triggers[0]!.verb === "send_to_gy" && effect.triggers[0]!.what.this_card
      && effect.triggers[0]!.player === "you" && !effect.triggers[0]!.note
      && (!effect.triggers[0]!.from.length || effect.triggers[0]!.from.includes("deck"));
    if (sent && !effect.conditions.length) {
      const ritualCost = effect.costs.length === 1 && effect.costs[0]!.verb === "send_to_gy" && effect.costs[0]!.from.includes("deck")
        && effect.costs[0]!.what.subtypes.includes("ritual");
      const ritualSearch = effect.actions.length === 1 && effect.actions[0]!.verb === "add_to_hand" && effect.actions[0]!.player === "you"
        && effect.actions[0]!.from.includes("deck") && /name.*mentioned on.*sent Ritual Spell/i.test(effect.actions[0]!.what.other);
      if (ritualCost && ritualSearch) {
        const pair = ritualPairs(context).find(pair => reachesSupport(effect.costs[0]!.what, pair.spell, context));
        if (pair) return { payoff: [pair.spell, pair.monster], reason: `Sends ${target.card.name} for named Ritual access`,
          requirements: [`send ${pair.spell.card.name} from Deck to search ${pair.monster.card.name}`], friction: 3 };
      }
      // Follow any simple sent-trigger search/summon through a supported terminal
      // payoff. Exclude the already-sent copy from the remaining Deck/hand proof.
      if (!effect.costs.length && effect.actions.length === 1) {
        const action = effect.actions[0]!;
        const remaining = [...context.main], at = remaining.findIndex(c => c.card.id === target.card.id);
        if (at >= 0) remaining.splice(at, 1);
        const next = { ...context, main: remaining, monsters: remaining.filter(c => c.card.kind === "monster") };
        if (action.player === "you" && action.from.length === 1 && action.from[0] === "deck" && !action.what.this_card && plain(action)) {
          for (const searched of distinctCandidates(remaining.filter(c => reachesSupport(action.what, c, context)))) {
            const result = action.verb === "add_to_hand" ? handPayoff(searched, next)
              : action.verb === "special_summon" && ordinary(searched) && usefulTarget(searched, next) ? { payoff: searched } : undefined;
            if (result) return { payoff: [searched, result.payoff],
              reason: result.requirement ? `Needs ${result.requirement}: ${target.card.name} → ${searched.card.name}`
                : `Sends ${target.card.name}; ${action.verb === "add_to_hand" ? "searches" : "summons"} ${searched.card.name}`,
              requirements: result.requirement ? [result.requirement] : [], friction: action.verb === "add_to_hand" ? 3 : 0 };
          }
        }
      }
    }
    const endPhase = effect.triggers.length === 1 && effect.triggers[0]!.verb === "phase" && /^End Phase$/i.test(effect.triggers[0]!.note)
      && effect.conditions.length === 1 && /^this card is in the GY because it was sent there this turn$/i.test(effect.conditions[0]!);
    if (endPhase && !effect.costs.length && effect.actions.length === 1) {
      const action = effect.actions[0]!;
      if (action.verb !== "special_summon" || action.player !== "you" || !action.from.includes("deck") || !plain(action)) continue;
      const payoff = context.monsters.find(c => ordinary(c) && reachesSupport(action.what, c, context) && usefulTarget(c, context)
        && (c.card.id !== target.card.id || context.main.filter(copy => copy.card.id === target.card.id).length >= 2));
      if (payoff) return { payoff: [payoff], reason: `Sends ${target.card.name}; summons in End Phase`, requirements: ["wait until End Phase"], friction: 7 };
    }
    // Self + related-card recovery is conditional on a distinct owned enabler.
    if (effect.triggers.length || effect.conditions.length || effect.costs.length || effect.actions.length !== 2) continue;
    const self = effect.actions.find(a => a.verb === "add_to_hand" && a.player === "you" && a.from.includes("gy") && a.what.this_card);
    const other = effect.actions.find(a => a.verb === "add_to_hand" && a.player === "you" && a.from.includes("gy") && !a.what.this_card);
    const mention = other && /^1 other card that mentions "([^"]+)"$/i.exec(other.what.other);
    if (!self || !mention || !ritualPairs(context).some(pair => pair.spell.card.id === target.card.id)) continue;
    const enabler = context.main.find(c => c.card.id !== target.card.id && names(c.card.text).includes(compactEffectName(mention[1]!)));
    if (enabler) return { payoff: [target, enabler], reason: `Needs related card in GY: sends ${target.card.name} to recover`,
      requirements: [`${enabler.card.name} already in GY`], friction: 10 };
  }
}

/** Small, understood compositions. Unsupported relations never become empty filters. */
export function compositionalProofs(candidate: Candidate, context: SupportContext): UtilityProof[] {
  if (!candidate.tags || candidate.card.kind === "monster") return [];
  const world = smallWorld(candidate, context);
  if (world) return [world];
  const proofs: UtilityProof[] = [];
  for (const effect of candidate.tags.effects) {
    if (effect.triggers.length || effect.location.some(zone => zone !== "field" && zone !== "hand")) continue;
    // Paired Ritual access verifies the same Spell's printed named monster.
    if (candidate.card.id === 13048472 && effect.costs.length === 0 && effect.conditions.length === 0) {
      const pair = ritualPairs(context)[0], action = effect.actions.find(a => a.verb === "add_to_hand" && a.what.kinds.includes("spell"));
      if (pair && action) proofs.push({ effect, action, targets: [pair.spell, pair.monster], payoff: [pair.monster], requirements: [],
        compositional: true, utility: 5, friction: 0, reason: `Searches ${pair.spell.card.name} and its named Ritual Monster` });
      continue;
    }
    for (const action of effect.actions) {
      if (action.what.this_card || action.player === "opponent") continue;
      const noSetup = !effect.conditions.length && !effect.costs.length;
      if (noSetup && action.from.includes("deck")
        && ["add_to_hand", "set_spell_trap"].includes(action.verb)) {
        const fields = distinctCandidates(context.main.filter(c => c.card.kind === "spell" && c.card.subtypes.includes("field") && reachesSupport(action.what, c, context)));
        const field = fields.find(c => fieldPayoff(c, context));
        if (!field) continue;
        const payoff = fieldPayoff(field, context)!;
        const pair = /^2 with different names: 1 on your field and 1 on your opponent's field$/i.test(action.note);
        if (!independentAction(effect, action) || action.what.other || !pair && (!plain(action) || action.player !== "you")) continue;
        if (pair && action.verb === "set_spell_trap" && new Set(fields.map(c => compactEffectName(c.card.name))).size >= 2
          && /neither player can activate or Set other Field Spells/i.test(candidate.card.text)) proofs.push({ effect, action, targets: fields, payoff: [field, payoff],
          requirements: ["two differently named Field Spells in Deck", "opposing Set Field Spell locks further Field access"], compositional: true,
          utility: 3, friction: 6, reason: `Field lock: Sets ${field.card.name} using 2 different Fields` });
        if (!pair) proofs.push({ effect, action, targets: [field], payoff: [field, payoff],
          requirements: [...(candidate.card.kind === "trap" ? ["set this Trap first"] : []), "later normal activation"],
          compositional: true, utility: candidate.card.kind === "trap" || action.verb === "set_spell_trap" ? 3 : 4,
          friction: candidate.card.kind === "trap" ? 5 : 0,
          reason: `${action.verb === "add_to_hand" ? "Searches" : "Sets"} ${field.card.name} for later activation` });
      }
      // Count discardable copies only for draw density, never generic support rank.
      if (action.verb === "draw" && action.player === "you" && /^2 cards$/i.test(action.note) && effect.costs.length === 1
        && effect.actions.length === 1 && !effect.conditions.length) {
        const cost = effect.costs[0]!;
        if (cost.verb !== "discard" || cost.player !== "you" || !cost.from.includes("hand") || cost.what.this_card || !plain(cost)
          || !cost.what.level_min && !cost.what.level_max && !cost.what.types.length && !cost.what.attributes.length) continue;
        const targets = context.monsters.filter(c => reachesSupport(cost.what, c, context));
        if (targets.length >= Math.max(4, context.main.length * 0.08)) proofs.push({ effect, action, targets, payoff: distinctCandidates(targets),
          requirements: ["discard 1 matching monster"], compositional: true, utility: 3.5, friction: 3,
          reason: `Discard 1 to draw 2; ${targets.length} matching Main Deck copies` });
      }
      if (action.verb === "send_to_gy" && action.player === "you" && action.from.includes("deck") && plain(action)
        && !effect.conditions.length && (effect.actions.length === 1 || /^option \d$/i.test(action.note))) {
        const discard = effect.costs.length === 1 && effect.costs[0]!.verb === "discard" && effect.costs[0]!.player === "you"
          && effect.costs[0]!.from.includes("hand") && plain(effect.costs[0]!) && !effect.costs[0]!.what.this_card
          && !effect.costs[0]!.what.kinds.length && !effect.costs[0]!.what.types.length && !effect.costs[0]!.what.names.length;
        if (effect.costs.length && !discard) continue;
        for (const target of distinctCandidates(context.main.filter(c => reachesSupport(action.what, c, context)))) {
          const route = millPayoff(target, context);
          if (!route) continue;
          proofs.push({ effect, action, targets: [target], payoff: route.payoff, compositional: true,
            requirements: [...(discard ? ["discard 1 card"] : []), ...route.requirements], utility: route.friction >= 7 ? 2 : 3,
            friction: route.friction + (discard ? 4 : 0), reason: `${discard ? "Discard 1; " : ""}${route.reason}` });
        }
      }
      // Complete, ordinary two-material Fusion recipe; no assumed Extra Deck material history.
      if (action.verb === "fusion_summon" && noSetup === false && !effect.conditions.length && effect.actions.length === 1
        && action.player === "you" && action.from.includes("extra_deck") && plain(action) && action.what.types.length
        && effect.costs.length === 1 && effect.costs[0]!.verb === "banish" && effect.costs[0]!.player === "you"
        && /Fusion Materials listed on the Fusion Monster/i.test(effect.costs[0]!.what.other)
        && effect.costs[0]!.from.every(zone => zone === "field" || zone === "gy")) {
        for (const fusion of context.extra) {
          if (!reachesSupport(action.what, fusion, context) || fusion.tags?.materials.length !== 2) continue;
          // This bounded grammar proves the complete printed recipe as well as
          // the tags. Extra Deck materials and unspecified counts stay unknown.
          const line = fusion.card.text.replace(/\r\n?/g, "\n").split("\n")[0]!;
          const recipe = /^"([^"]+)" \+ 1 ([A-Za-z-]+) monster$/i.exec(line);
          if (!recipe || /Cannot be Fusion Summoned|Must be Special Summoned|Must (?:first )?be Fusion Summoned (?:using|with)/i.test(fusion.card.text)) continue;
          const [one, two] = fusion.tags.materials;
          const materials = context.monsters.flatMap(a => context.monsters.filter(b => a !== b
            && compactEffectName(a.card.name) === compactEffectName(recipe[1]!) && b.card.monsterType?.toLowerCase() === recipe[2]!.toLowerCase()
            && !/cannot be used.*(?:Fusion )?Material/i.test(`${a.card.text} ${b.card.text}`)
            && reachesSupport(one!, a, context) && reachesSupport(two!, b, context)).map(b => [a, b]));
          if (!materials.length) continue;
          proofs.push({ effect, action, targets: materials[0]!, payoff: [fusion], requirements: ["banish both materials from field/GY"],
            compositional: true, utility: 2, friction: 7, reason: `Banish field/GY materials: Fusion Summons ${fusion.card.name}` });
          break;
        }
      }
      if (candidate.card.id === 911883 && action.verb === "special_summon" && action.player === "you" && action.from.includes("deck")
        && !effect.costs.length && effect.conditions.length === 1 && /^you control no monsters$/i.test(effect.conditions[0]!)) {
        for (const tuner of distinctCandidates(context.monsters.filter(c => c.card.subtypes.includes("tuner") && reachesSupport(action.what, c, context)))) {
          const yoa = context.monsters.find(c => c.card.id === 1710647 && /Special Summon this card.*revealing 1 face-down card.*returning it to the hand or Extra Deck/i.test(c.card.text));
          if (!yoa || !context.main.some(c => c.card.kind !== "monster")) continue;
          const checker = createMainDeckSummonChecker([tuner, yoa]);
          const synchro = context.extra.find(c => c.card.subtypes.includes("synchro") && checker(c));
          if (!synchro) continue;
          const lode = context.main.some(c => c.card.id === 56506740);
          proofs.push({ effect, action, targets: [tuner, yoa], payoff: [synchro], compositional: true, utility: 2.8, friction: 5,
            requirements: ["no monsters", "Yoa in hand and a Set Spell/Trap to return", ...(lode ? ["before Primite Lordly Lode's lock"] : [])],
            reason: `No monsters; Yoa/Set card${lode ? " before Lode" : ""}: ${tuner.card.name} → Lv${synchro.card.level}` });
        }
      }
    }
  }
  return proofs;
}
