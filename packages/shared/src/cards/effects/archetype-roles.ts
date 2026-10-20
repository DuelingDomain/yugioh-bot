import { compactEffectName } from "./name-match.js";
import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import type { CardTags } from "./tags.js";
export type ArchetypeRole = CardTags["roles"][number] | "staples";
export interface RoleContext { searchHeavy: boolean; graveyard: boolean }
export function roleContext(cards: Iterable<{ tags?: MatchTags }>): RoleContext {
  let searchers=0, graveyard=false;
  for (const {tags} of cards) {
    if (tags?.effects.some(effect=>effect.actions.some(action=>action.verb==="add_to_hand" && action.from.includes("deck")))) searchers++;
    if (tags?.effects.some(effect=>[...effect.actions,...effect.triggers].some(action=>action.from.includes("gy") || action.verb==="send_to_gy"))) graveyard=true;
  }
  return {searchHeavy:searchers>=2,graveyard};
}
export function hasRole(tags: MatchTags|undefined, role: ArchetypeRole): boolean {
  const roles = role === "staples" ? ["hand_trap", "board_breaker", "negation", "removal", "mass_removal", "backrow_removal"]
    : role === "removal" ? ["removal", "mass_removal", "backrow_removal"]
    : role === "board_breaker" ? ["board_breaker", "mass_removal"] : [role];
  return !!tags?.roles.some(value => roles.includes(value));
}
export function genericRoleCard(card: Pick<Card,"name"|"text">, tags?: MatchTags): boolean {
  return !!tags && !tags.supports.archetypes.length && !tags.supports.names.some(name=>compactEffectName(name)!==compactEffectName(card.name))
    && !/"[^"\n]+"\s+(?:monster|card|spell|trap)|(?:control|tribute|discard|send|summon)[^.\n]{0,50}"[^"\n]+"/i.test(card.text.replaceAll(`"${card.name}"`,"SELF"));
}
export function harmsRoleDeck(card: Pick<Card,"text">, tags: MatchTags|undefined, context: RoleContext): boolean {
  const symmetric=tags?.effects.some(effect=>effect.actions.some(action=>action.player==="either" && ["restrict_other","banish"].includes(action.verb)));
  if (!symmetric) return false;
  return context.searchHeavy && /cards cannot be added from either player|neither player can add/i.test(card.text)
    || context.graveyard && /any card sent to the (?:gy|graveyard) is banished instead/i.test(card.text);
}

export const archetypeMember = (card: Card, archetype: string): boolean =>
  [card.archetype,...card.archetypes??[]].some(value=>value && compactEffectName(value)===compactEffectName(archetype));
