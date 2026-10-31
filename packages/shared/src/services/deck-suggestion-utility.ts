import { isExtraDeckCard, type Card } from "../cards/effects/card.js";
import type { CardFilter, Effect, GameEvent } from "../cards/effects/tags.js";
import { type Candidate } from "../cards/effects/synergy.js";
import { archetypePlayShare, type FormatStaples } from "../cards/effects/staples.js";
import { supportFilterReaches, type SupportContext } from "./deck-suggestion-hooks.js";
import { compositionalProofs } from "./deck-suggestion-combos.js";

/** Internal witness, shared by discovery, admission, ordering and explanation. */
export interface UtilityProof {
  effect: Effect;
  action: GameEvent;
  targets: readonly Candidate[];
  payoff: readonly Candidate[];
  requirements: readonly string[];
  reason: string;
  /** Access/consistency > efficient extension > conditional recovery. */
  utility: number;
  friction: number;
  /** A compositional proof establishes its own bounded relevance. */
  compositional?: boolean;
}
export interface OutsideUtility {
  score: number;
  reason: string;
  linkedCards: number;
  role: number;
  playShare: number;
  proof: UtilityProof;
  selectivity?: CardFilter;
}
export const distinctCandidates = (cards: readonly Candidate[]) => [...new Map(cards.map(c => [c.card.id, c])).values()];
export const usefulTarget = (c: Candidate, context: SupportContext) => !c.tags?.roles.includes("hand_trap")
  && [...c.card.text.matchAll(/(?:show|reveal) (\d+) "([^"]+)"/gi)].every(match =>
    context.main.filter(target => target.card.name.toLowerCase() === match[2]!.toLowerCase()).length >= Number(match[1]))
  && ((context.importance.get(c.card.id) ?? 0) >= 3 || c.card.kind !== "monster");
export const reachesSupport = (filter: CardFilter, c: Candidate, context: SupportContext) => {
  // API categories include support cards (e.g. White Stone under Blue-Eyes).
  // Printed action membership uses the engine's actual setcodes when available.
  if (filter.archetypes.length && !filter.archetypes.some(name => (c.card.archetypes ?? [c.card.archetype])
    .some(member => member?.toLowerCase() === name.toLowerCase()))) return false;
  return supportFilterReaches(filter.archetypes.length ? { ...filter, archetypes: [] } : filter, c.card, context);
};
const dimensionality = (filter: CardFilter) => [filter.subtypes.length, filter.types.length, filter.attributes.length,
  filter.level_min || filter.level_max, filter.other].filter(Boolean).length;
const named = (filter: CardFilter) => !!(filter.names.length || filter.archetypes.length);

/** Unknown conditions and costs fail closed. State requirements remain visible. */
function practicalRequirements(candidate: Candidate, effect: Effect, context: SupportContext): { requirements: string[]; friction: number } | undefined {
  if (candidate.card.kind === "monster" || effect.triggers.length || effect.location.some(zone => zone !== "field" && zone !== "hand")) return;
  const requirements: string[] = [];
  let friction = candidate.card.kind === "trap" ? 5 : 0;
  if (candidate.card.kind === "trap") requirements.push("after setting this Trap");
  for (const condition of effect.conditions) {
    if (/^(?:if )?you control no monsters$/i.test(condition)) { requirements.push("with no monsters"); friction += 2; }
    else return;
  }
  for (const cost of effect.costs) {
    if (cost.player !== "you" || cost.what.this_card || !["discard", "pay_lp"].includes(cost.verb)) return;
    if (cost.verb === "pay_lp") {
      const amount = /^(\d+) LP$/i.exec(cost.note);
      if (!amount || Number(amount[1]) > 2000) return;
      requirements.push(`pay ${amount[1]} LP`); friction += 3;
    } else {
      if (!cost.from.includes("hand") || /[2-9]|all|random|another|different/i.test(cost.note)) return;
      const available = context.main.filter(c => reachesSupport(cost.what, c, context));
      if (available.length < 4) return;
      requirements.push("discard 1 card"); friction += 5;
    }
  }
  const text = candidate.card.text;
  // A static list cannot establish relational material history or proper summons.
  if (/materials? (?:used|that were used)|used (?:as|for).*material|that (?:was|were) used.*Summon|opponent's GY|opponent's Graveyard/i.test(text)) return;
  if (/cannot Normal Summon|cannot activate.*effects|cannot Special Summon/i.test(text)) return;
  if (/excavat|random|your opponent (?:chooses|picks|declares)|Equip only|To activate this card, you must/i.test(text)) return;
  return { requirements, friction };
}

function narrowProofs(candidate: Candidate, context: SupportContext): UtilityProof[] {
  const proofs: UtilityProof[] = [];
  for (const effect of candidate.tags?.effects ?? []) {
    const actions = effect.actions.filter(a => a.player === "you" && !a.what.this_card
      && ["add_to_hand", "special_summon"].includes(a.verb));
    if (!actions.length) continue;
    const practical = practicalRequirements(candidate, effect, context);
    if (!practical) continue;
    for (const action of actions) {
      // Multiple mandatory actions need a compositional witness. Options are independent.
      if (effect.actions.length > 1 && (!/^option \d$/i.test(action.note)
        || effect.actions.filter(other => other.note === action.note).length > 1)) continue;
      if (action.note && !/^option \d$/i.test(action.note)) continue;
      if (/Fusion Material|listed on.*Fusion/i.test(action.what.other)) continue;
      if (action.from.includes("extra_deck") || !action.from.some(zone => ["deck", "hand", "gy"].includes(zone))) continue;
      if (!named(action.what) && dimensionality(action.what) < 2) continue;
      let targets = distinctCandidates(context.main.filter(c => reachesSupport(action.what, c, context) && usefulTarget(c, context)));
      if (action.verb === "special_summon") targets = targets.filter(c => c.card.kind === "monster"
        && !c.card.subtypes.includes("ritual") && !/Must (?:first )?be|Cannot be Special Summoned/i.test(c.card.text));
      if (!targets.length) continue;
      // A paid generic tutor needs enough live targets to justify its extra card.
      if (effect.costs.some(c => c.verb === "discard") && !named(action.what)
        && context.main.filter(c => reachesSupport(action.what, c, context)).length < 3) continue;
      targets.sort((a, b) => (context.importance.get(b.card.id) ?? 0) - (context.importance.get(a.card.id) ?? 0) || a.card.id - b.card.id);
      const target = targets[0]!;
      const fromDeck = action.from.includes("deck"), fromGY = action.from.includes("gy") && !fromDeck;
      const requirements = [...practical.requirements, ...(fromGY ? [action.from.includes("hand") ? "from hand/GY" : "requires it in GY"] : [])];
      const verb = action.verb === "add_to_hand" ? (fromDeck ? "Searches" : "Recovers") : "Summons";
      // Put prerequisites first so shortening cannot hide an activation cost.
      const prefix = requirements.length ? `${requirements.join("; ")}: ` : "";
      proofs.push({ effect, action, targets, payoff: [target], requirements,
        reason: `${prefix}${verb} ${target.card.name}`, utility: fromDeck && action.verb === "add_to_hand" ? (practical.friction >= 5 ? 2.5 : 4) : fromDeck ? 3 : 2,
        friction: practical.friction + (fromGY ? 5 : 0) });
    }
  }
  return proofs;
}

/** No catalog-wide pair search: compositional work is bounded by 60 Main Deck copies. */
export function outsideUtilityEvaluator(context: SupportContext, usage: FormatStaples, archetypes: readonly string[]) {
  return (candidate: Candidate): OutsideUtility | undefined => {
    // No launch proof establishes an outside monster provider's own summon or
    // access from hand, so avoid evaluating their unusable field/GY effects.
    if (!candidate.tags || candidate.card.kind === "monster" || isExtraDeckCard(candidate.card) || candidate.tags.roles.includes("hand_trap")) return;
    const proofs = [...compositionalProofs(candidate, context), ...narrowProofs(candidate, context)];
    let best: OutsideUtility | undefined;
    for (const proof of proofs) {
      if (proof.utility < 2 || proof.friction > 12) continue;
      const importance = Math.min(6, Math.max(0, ...proof.payoff.map(c => context.importance.get(c.card.id) ?? 0)));
      const score = proof.utility * 100 + importance * 2 + Math.min(4, distinctCandidates(proof.targets).length) - proof.friction * 3;
      const role = candidate.tags.roles.some(r => ["searcher", "draw_power", "extender", "recursion", "removal", "board_breaker"].includes(r)) ? 1 : 0;
      const playShare = Math.max(usage.playShares.get(candidate.card.id) ?? 0,
        ...archetypes.map(archetype => archetypePlayShare(usage, archetype, candidate.card.id) ?? 0));
      const fit: OutsideUtility = { score, reason: proof.reason, linkedCards: distinctCandidates(proof.targets).length, role, playShare, proof,
        ...(!proof.compositional && !named(proof.action.what) ? { selectivity: proof.action.what } : {}) };
      if (!best || fit.score > best.score) best = fit;
    }
    return best;
  };
}

/** Selectivity is target breadth in the admitted format catalog, never provider prevalence. */
export function utilitySelectivity() {
  const filters = new Map<string, { filter: CardFilter; count?: number }>();
  // A frequency table of stat shapes avoids decoding the catalog's effect JSON
  // twice. No card text, tags, identities, or route graph is retained here.
  const shapes = new Map<string, { card: Card; copies: number }>();
  let legalCards = 0;
  return {
    key(filter?: CardFilter) {
      if (!filter) return "proved";
      const key = JSON.stringify(filter);
      if (!filters.has(key)) filters.set(key, { filter });
      return key;
    },
    observe(candidate: Candidate) {
      legalCards++;
      const { kind, subtypes, monsterType, attribute, level, atk, def } = candidate.card;
      const key = JSON.stringify([kind, subtypes, monsterType, attribute, level, atk, def]);
      const old = shapes.get(key);
      if (old) old.copies++;
      else shapes.set(key, { copies: 1, card: { id: 0, name: "", kind, subtypes, monsterType, attribute, level, atk, def,
        text: "", typeLine: "", formats: [], views: 0, url: "" } });
    },
    accepts(key: string, context: SupportContext) {
      if (key === "proved") return true;
      const summary = filters.get(key)!;
      summary.count ??= [...shapes.values()].reduce((count, shape) => count + (reachesSupport(summary.filter, { card: shape.card }, context) ? shape.copies : 0), 0);
      // Two evaluated dimensions are already required. Small integration catalogs
      // retain the same concrete proof without pretending their share is measured.
      return summary.count <= Math.max(3, legalCards * 0.06);
    },
  };
}
