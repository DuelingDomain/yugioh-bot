import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import { hasRole, genericRoleCard, harmsRoleDeck, type ArchetypeRole, type RoleContext } from "./archetype-roles.js";
import { archetypePlayShare, type FormatStaples } from "./staples.js";
export function rankArchetypeRole(card: Card, tags: MatchTags|undefined, archetype: string, role: ArchetypeRole,
  member: boolean, context: RoleContext, usage: FormatStaples): {score:number;reason:string}|null {
  if (!hasRole(tags,role)) return null;
  if (member) return {score:1_000_000,reason:`${archetype} card`};
  if (!genericRoleCard(card,tags) || harmsRoleDeck(card,tags,context)) return null;
  const share=archetypePlayShare(usage,archetype,card.id);
  if (share && share>0) return {score:10_000+share*1000,reason:`Run in ${Math.round(share*100)}% of ${archetype} decks`};
  const format=usage.cards.get(card.id);
  return format || !usage.cards.size ? {score:1000+(format?.playShare??0)*1000,reason:"Format staple"} : null;
}
