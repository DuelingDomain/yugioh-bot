import type { Card } from "../cards/effects/card.js";
import { compactEffectName } from "../cards/effects/name-match.js";
import { belongsTo, type Candidate } from "../cards/effects/synergy.js";
import { scoreDeckSupport } from "./deck-suggestion-hooks.js";

/** Suggestions use exact setcode/API membership, not substrings of unrelated names. */
export const suggestionMember = (card: Card, archetype: string) => [card.archetype, ...(card.archetypes ?? [])]
  .some(name => name?.toLowerCase() === archetype.toLowerCase());

interface ArchetypeRank { score: number; reason: string; linkedCards: number }
interface ArchetypeFit { claimed: boolean; rank?: ArchetypeRank }

export function archetypeDeckRanking(main: readonly Candidate[], archetypes: readonly string[], context: Parameters<typeof scoreDeckSupport>[1]) {
  const unique = [...new Map(main.map(candidate => [candidate.card.id, candidate])).values()];
  const same = (name: string) => archetypes.some(archetype => name.toLowerCase() === archetype.toLowerCase());
  const primary = unique.filter(({ card, tags }) => !tags?.roles.includes("hand_trap")
    && (archetypes.some(archetype => suggestionMember(card, archetype)) || tags?.supports.archetypes.some(same)));
  const mentions = new Map<string, Set<number>>();
  for (const candidate of primary) for (const name of candidate.tags?.supports.names ?? []) {
    const key = compactEffectName(name);
    const sources = mentions.get(key) ?? new Set<number>();
    sources.add(candidate.card.id); mentions.set(key, sources);
  }
  const core = unique.filter(candidate => primary.includes(candidate) || (mentions.get(compactEffectName(candidate.card.name))?.size ?? 0) >= 2);
  const names = new Map(unique.map(candidate => [compactEffectName(candidate.card.name), candidate]));
  const coreIds = new Set(core.map(({ card }) => card.id));
  const years = primary.map(({ card }) => Number(card.tcgDate?.slice(0, 4))).filter(year => year > 0).sort((a, b) => a - b);
  const era = years[Math.floor(years.length / 2)] ?? 0;
  const ritual = main.some(({ tags }) => tags?.effects.some(effect => effect.actions.some(action => action.verb === "ritual_summon")));
  return (candidate: Candidate): ArchetypeFit => {
    const { card, tags } = candidate;
    const member = archetypes.find(archetype => suggestionMember(card, archetype));
    const support = tags?.supports.archetypes.find(same);
    const printedNames = new Set((tags?.supports.names ?? []).map(compactEffectName));
    for (const match of card.text.matchAll(/["“]([^"”]+)["”]/g)) printedNames.add(compactEffectName(match[1]!));
    const named = [...printedNames].flatMap(name => { const found = names.get(name); return found ? [found] : []; });
    // Keep rejected former Archetype matches out of the unchanged Outside queues.
    const claimed = !!member || !!support || !!named.length || archetypes.some(archetype => belongsTo(card, archetype));
    if (!claimed || card.subtypes.includes("ritual") && !ritual) return { claimed };
    const linked = new Map<number, Candidate>();
    for (const target of core) if (named.includes(target) || [member, support].some(archetype => archetype && suggestionMember(target.card, archetype))) linked.set(target.card.id, target);
    const coreNamed = named.filter(({ card }) => coreIds.has(card.id));
    if (!member && !support && (!coreNamed.length || !scoreDeckSupport(candidate, context))) return { claimed };
    const year = Number(card.tcgDate?.slice(0, 4));
    const age = era && year ? Math.max(0, era - year - 2) : 0;
    const popularity = Math.round(Math.log10(Math.max(1, card.views)) * 8);
    const score = (member || support ? 3000 : 1000) + Math.min(12, linked.size) * 8 + popularity - Math.min(40, age * 3);
    const reason = member || support ? `Supports ${member ?? support}` : `Names ${coreNamed[0]!.card.name}`;
    return { claimed, rank: { score, reason, linkedCards: linked.size } };
  };
}
