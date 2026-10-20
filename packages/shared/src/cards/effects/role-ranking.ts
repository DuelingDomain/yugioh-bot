import type { Card } from "./card.js";
import type { MatchTags } from "./effect-match.js";
import { hasRole, genericRoleCard, type ArchetypeRole } from "./archetype-roles.js";
import { archetypePlayShare, type FormatStaples } from "./staples.js";
export function rankArchetypeRole(card: Card, tags: MatchTags|undefined, archetype: string, role: ArchetypeRole,
  member: boolean, usage: FormatStaples): {score:number;reason:string}|null {
  if (!hasRole(tags,role)) return null;
  if (member) return {score:1_000_000,reason:`${archetype} card`};
  if (role === "any") return null;
  if (!genericRoleCard(card,tags)) return null;
  const formatShare=usage.cards.get(card.id)?.playShare??0;
  const share=archetypePlayShare(usage,archetype,card.id);
  // A format tie-break stays below the smallest archetype-share step in the bounded cohorts.
  if (share && share>0) return {score:10_000+share*1000+formatShare/100,reason:`Run in ${Math.round(share*100)}% of ${archetype} decks`};
  const format=usage.cards.get(card.id);
  return format || !usage.cards.size ? {score:1000+(format?.playShare??0)*1000,reason:"Format staple"} : null;
}
