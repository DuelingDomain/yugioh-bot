import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import { matchCard } from "./effect-match.js";
import { hookQuery, type ArchetypeProfile, type Hook } from "./synergy.js";

export const SYNERGY_SEARCH_LIMIT = 40;
export const SYNERGY_SCORE_FLOOR = 100;
type Candidate = { card: Card; tags?: MatchTags };

/** Search is deliberately stricter than a profile's exploratory "How it plays" hooks.
 * A material, Type, Attribute, Level, or unrestricted resource is never a partner by itself. */
export function synergyHookMatcher(profile: ArchetypeProfile | undefined, archetype: string) {
  const hooks = profile?.hooks ?? [];
  const normalTraps = hooks.some(hook => hook.card?.kinds.includes("trap") && hook.card.subtypes.includes("normal") && hook.does);
  const trapPlan = hooks.some(hook => hook.does?.verbs.includes("set_spell_trap") && /trap/i.test(hook.why))
    || normalTraps;
  const compiled = hooks.flatMap(hook => {
    const score = strength(hook);
    if (!score) return [];
    const query = hookQuery(hook, archetype);
    // Deck setup is useful; merely paying an arbitrary hand/field send cost is too broad.
    if (query.does && hook.does?.verbs.includes("send_to_gy") && hook.does.what.types.length) query.does.from = ["deck"];
    if ((query.card.levelMin !== undefined || query.card.levelMax !== undefined) && !query.card.subtypes.some(subtype => subtype === "xyz" || subtype === "link")) query.card.levelOnly = true;
    return [{ hook, query, score }];
  });
  return (candidate: Candidate): { score: number; label: string } | undefined => {
    const printed = `${candidate.card.text}\n${candidate.card.pendulumText ?? ""}`.toLowerCase();
    const effects = candidate.tags?.effects.filter(effect => !effect.actions.some(action => action.verb === "negate_activation" || action.verb === "negate_effect")) ?? [];
    // Require a positive Trap engine effect. Negating/destroying an opposing Trap, or
    // merely being a Trap, cannot satisfy this hook. Generic Spell/Trap recovery is too broad.
    const trapText = /normal traps?\b|set traps?\b|face-down traps?\b|(?<!\/)\btrap cards?\b/.test(printed)
      || /(?:if|when|while)[^.:\n]*(?:set (?:spell\/trap|cards?)|face-down cards?)/.test(printed);
    const trapSetup = trapText && effects.some(effect => effect.actions.some(action => ["set_spell_trap", "add_to_hand"].includes(action.verb)
      && action.player !== "opponent" && !action.what.this_card && !action.what.archetypes.length && !action.what.names.length
      && (!normalTraps || !action.what.subtypes.length || action.what.subtypes.includes("normal"))
      && action.from.some(zone => zone === "deck" || zone === "gy")
      && (action.what.kinds.includes("trap") || (action.verb === "set_spell_trap" && /normal traps?/i.test(printed)))));
    const trapPayoff = /normal traps?\b/.test(printed) && effects.some(effect => effect.triggers.some(event => event.verb === "activate" && event.player === "you"
      && event.what.kinds.includes("trap") && event.what.subtypes.includes("normal") && !event.what.archetypes.length && !event.what.names.length)
      && effect.actions.some(action => ["draw", "special_summon", "add_to_hand", "set_spell_trap"].includes(action.verb)));
    let best = trapPlan && (trapSetup || trapPayoff)
      ? { score: 140, label: trapSetup ? "Searches or Sets Traps" : "Pays off Trap activations" } : undefined;
    for (const { hook, query, score } of compiled) {
      if (hook.phrases.some(phrase => !printed.includes(phrase.toLowerCase())) || matchCard(candidate.card, candidate.tags, query) === null) continue;
      // Compact tags omit trigger conditions. Furniture discards pay costs; a
      // Dark World trigger requiring a card effect cannot benefit from that cost.
      if (hook.reacts_to?.verbs.includes("discard") && /cost/i.test(hook.why)
        && /discarded[^:;.]*by[^:;.]*effect/.test(printed)) continue;
      if (hook.does?.verbs.includes("tribute") && /you cannot normal summon/.test(printed)) continue;
      // Token generators that forbid Tribute Summons cannot supply Monarch fodder.
      if (hook.does?.verbs.includes("summon_token") && /cannot be tributed|cannot tribute summon|cannot (?:normal|special) summon.*except/i.test(printed)) continue;
      if (!best || score > best.score) best = { score, label: hook.label };
    }
    return best;
  };
}

function strength(hook: Hook): number {
  // These hooks are common in generated profiles but say nothing about a real engine connection.
  if (hook.supports || (!hook.does && !hook.reacts_to && !hook.phrases.length)) return 0;
  if (hook.does?.verbs.includes("set_spell_trap")) return 0; // Verified Trap setup above.
  if (hook.does?.verbs.some(verb => verb === "change_attribute_or_type" || verb === "destroy") && !hook.card?.kinds.includes("trap")) return 0;
  if (hook.does?.verbs.some(verb => verb === "discard" || verb === "send_to_gy") && hook.does.what.kinds.includes("trap")) return 0;
  if (hook.reacts_to?.verbs.includes("send_to_gy")) return 0; // Any GY trigger is not archetype synergy.
  if (hook.does?.verbs.includes("fusion_summon")) return 0; // Any Fusion enabler is not a specific mechanic.
  if (hook.phrases.length && !hook.does && !hook.reacts_to) {
    // Normal Monster text alone includes opposing hate and incidental Fusion materials.
    return hook.phrases.some(phrase => /tribute summon/i.test(phrase)) ? 110 : 0;
  }
  if (hook.card?.kinds.includes("trap") && hook.card.subtypes.includes("normal") && hook.does) return 130;
  if (hook.phrases.some(phrase => /tribute summon/i.test(phrase))) return 140;
  if (hook.reacts_to?.self && hook.reacts_to.verbs.some(verb => verb === "tribute" || verb === "discard")) return 120;
  if (hook.does?.verbs.some(verb => verb === "tribute" || verb === "summon_token")) return 120;
  // An effect moving the deck's material to a useful zone is a mechanic; merely
  // having that material's printed stats, or supporting its Type, was rejected above.
  if (hook.does?.verbs.includes("send_to_gy") && hook.does.from.includes("deck") && hook.does.what.types.length) return 110;
  return 0; // Unknown/broad hooks fail closed rather than guessing from their prose.
}
