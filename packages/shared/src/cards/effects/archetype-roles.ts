import { compactEffectName } from "./name-match.js";
import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import type { CardTags } from "./tags.js";
export type ArchetypeRole = CardTags["roles"][number] | "staples" | "any";
export function hasRole(tags: MatchTags|undefined, role: ArchetypeRole): boolean {
  if (role === "any") return true;
  const roles = role === "staples" ? ["hand_trap", "board_breaker", "negation", "removal", "mass_removal", "backrow_removal"]
    : role === "removal" ? ["removal", "mass_removal", "backrow_removal"]
    : role === "board_breaker" ? ["board_breaker", "mass_removal"] : [role];
  return !!tags?.roles.some(value => roles.includes(value));
}
export function genericRoleCard(card: Pick<Card,"name"|"text">, tags?: MatchTags): boolean {
  return !!tags && !tags.supports.archetypes.length && !tags.supports.names.some(name=>compactEffectName(name)!==compactEffectName(card.name))
    && !/"[^"\n]+"\s+(?:monster|card|spell|trap)|(?:control|tribute|discard|send|summon)[^.\n]{0,50}"[^"\n]+"/i.test(card.text.replaceAll(`"${card.name}"`,"SELF"));
}

export const archetypeMember = (card: Card, archetype: string): boolean =>
  [card.archetype,...card.archetypes??[]].some(value=>value && compactEffectName(value)===compactEffectName(archetype));
