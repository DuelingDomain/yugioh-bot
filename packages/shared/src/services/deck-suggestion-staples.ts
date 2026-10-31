import type { Candidate } from "../cards/effects/synergy.js";
import type { StapleUsage } from "../cards/effects/staples.js";
import { createMainDeckSummonChecker } from "../cards/effects/deck-summon.js";

export function viableSuggestionStaple(candidate: Candidate, extra: readonly Candidate[], main: readonly Candidate[] = []): boolean {
  const fusion = candidate.tags?.effects.some(e => e.actions.some(a => a.verb === "fusion_summon"));
  if (!fusion) return true;
  // Board-breaking Fusion needs a flexible outlet; a named engine Fusion is not one.
  if (!candidate.tags?.roles.includes("board_breaker") && !/using monsters from either (?:side|field)|monsters from either field/i.test(candidate.card.text)) {
    if (!extra.length) return false;
    // Bind the outlet to this candidate; another owned Fusion Spell cannot
    // provide the proof for an incompatible suggested enabler.
    const summon = createMainDeckSummonChecker([...main.filter(c => c.card.kind === "monster"), candidate]);
    return extra.some(c => !!summon(c));
  }
  return extra.some(c => c.card.subtypes.includes("fusion")
    && !/Cannot be (?:Fusion|Special) Summoned|Must (?:first )?be Special Summoned|You do not use "Polymerization"/i.test(c.card.text)
    && /^2 (?:(?:DARK|LIGHT|EARTH|WATER|FIRE|WIND) monsters(?: on the field, except Tokens)?|monsters with the same Type and Attribute, but different names|monsters with the same Attribute but different Types)[.!]?$/i
      .test(c.card.text.replace(/\r\n?/g, "\n").split("\n")[0]!)
    && !!c.tags?.materials.length && c.tags.materials.every(f => !f.names.length && !f.archetypes.length));
}

export function suggestionStapleReason(candidate: Candidate, played: StapleUsage | undefined, label: string): string {
  const actions = candidate.tags?.effects.flatMap(e => e.actions) ?? [], roles = candidate.tags?.roles ?? [];
  const backrow = actions.some(a => ["destroy", "banish", "return_to_hand"].includes(a.verb)
    && a.player !== "you" && a.what.kinds.length > 0 && a.what.kinds.every(k => k === "spell" || k === "trap"));
  const role = backrow ? "backrow removal" : roles.includes("hand_trap") ? "hand trap"
    : roles.includes("board_breaker") ? "board breaker" : roles.includes("negation") ? "negation"
    : roles.includes("draw_power") ? "draw" : roles.includes("recursion") ? "GY recovery"
    : roles.includes("removal") ? "removal" : actions.some(a => a.verb === "fusion_summon") ? "Fusion summon"
    : roles.includes("searcher") ? "searcher" : "interaction";
  return played ? `Format staple: ${role} · ${Math.round(played.playShare * 100)}% of sampled ${label} decks`
    : `Role fallback: ${role} · sampled usage unavailable`;
}
