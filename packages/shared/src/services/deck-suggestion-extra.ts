import { isExtraDeckCard } from "../cards/effects/card.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import { belongsTo, type Candidate } from "../cards/effects/synergy.js";

/** Ranking is separate from the complete material proof. Hand traps do not define a deck's profile. */
export function extraDeckRanking(main: readonly Candidate[], archetypes: readonly string[], extra: readonly Candidate[]) {
  const monsters = main.filter(({ card, tags }) => card.kind === "monster" && !isExtraDeckCard(card) && !tags?.roles.includes("hand_trap"));
  const members = monsters.filter(({ card }) => archetypes.some(archetype => belongsTo(card, archetype)));
  const profileMonsters = members.length >= 2 ? members : monsters;
  const names = new Set(monsters.map(({ card }) => compactEffectName(card.name)));
  const fusionOnly = extra.length > 0 && extra.every(({ card }) => card.subtypes.includes("fusion"))
    && main.some(({ card }) => /cannot Special Summon (?:monsters )?from (?:the|your) Extra Deck, except Fusion Monsters/i.test(card.text));
  const dominant = (field: "level" | "attribute" | "monsterType", value: unknown) => value !== undefined
    && profileMonsters.filter(({ card }) => card[field] === value).length >= Math.max(2, profileMonsters.length * 0.3);
  return ({ card, tags }: Candidate): { score: number; linkedCards: number; generic: boolean } => {
    const materials = tags?.materials ?? [];
    const named = materials.flatMap(filter => filter.names).filter(name => names.has(compactEffectName(name)));
    const member = archetypes.some(archetype => belongsTo(card, archetype));
    const linked = new Set(monsters.filter(({ card: material }) => named.some(name => compactEffectName(material.name) === compactEffectName(name))
      || materials.some(filter => filter.attributes.some(attribute => attribute === material.attribute) || filter.types.some(type => type === material.monsterType)
        || filter.archetypes.some(archetype => belongsTo(material, archetype)))).map(({ card }) => card.id)).size;
    if (member || named.length) return { score: 300, linkedCards: linked, generic: false };
    const profile = card.subtypes.includes("fusion") || !fusionOnly && (
      card.subtypes.includes("synchro") && extra.some(({ card }) => card.subtypes.includes("synchro"))
      || card.subtypes.includes("xyz") && dominant("level", card.rank)
      || card.subtypes.includes("link") && materials.some(filter => filter.attributes.some(value => dominant("attribute", value))
        || filter.types.some(value => dominant("monsterType", value)) || filter.archetypes.some(value => archetypes.includes(value)))
      || card.subtypes.includes("link") && (tags?.supports.attributes.some(value => dominant("attribute", value))
        || tags?.supports.types.some(value => dominant("monsterType", value))
        || tags?.effects.some(effect => effect.actions.some(action => !action.what.this_card && action.player !== "opponent"
          && action.what.attributes.some(value => dominant("attribute", value))))));
    return { score: profile ? 200 : 100, linkedCards: linked, generic: !profile };
  };
}
