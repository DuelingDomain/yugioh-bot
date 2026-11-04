import type { Card } from '../cards/effects/card.js';
import type { CardTags } from '../cards/effects/tags.js';
import type { RemoteActionProposal } from './actions.js';
import { deriveRemoteEffectPlans, remoteEffectMatches } from './effect-filters.js';
import type { RemoteState } from './types.js';

export type RemoteSearchCandidate = {cardId: number; name: string; source: 'deck'; by: {cardId: number; name: string}; reason: string};
/** Data-only catalog input: safe in the browser; server readers stay outside the reducer. */
export type RemoteSearchKnowledge = {
  cards: readonly Card[]; tags?: Record<number, CardTags>;
  related?: {links: Record<string, [number, string][]>; aliases?: Record<string, number>; groups?: Record<string, [string, number[]]>; cardGroups?: Record<string, number[]>};
};
/** No state changes or I/O. Three arguments reuse the seat's server-resolved search plans. */
export function searchCandidates(state: RemoteState, seat: number, recentCardId: number, knowledge?: RemoteSearchKnowledge): RemoteSearchCandidate[] {
  if (!state.seats[seat]) return [];
  const deck = state.deckChecks.registrations[seat]?.deck.main;
  const result = new Map<number, RemoteSearchCandidate>();
  const put = (cardId: number, name: string, by: RemoteSearchCandidate['by'], reason: string) => {
    if (!deck || deck.includes(cardId)) result.set(cardId, {cardId, name, source: 'deck', by: {cardId:by.cardId, name:by.name}, reason});
  };
  for (const origin of state.effectTracking?.origins ?? []) if (origin.seat === seat && origin.destination === 'hand' && origin.source.cardId === recentCardId)
    for (const card of origin.candidates ?? origin.pool ?? []) put(card.cardId, card.name, origin.source, 'resolved effect');
  const source = knowledge?.cards.find(c => c.id === recentCardId);
  if (source && knowledge) {
    const plans = deriveRemoteEffectPlans(source, knowledge.tags?.[source.id]).filter(p => p.destination === 'hand');
    const by = {cardId:source.id, name:source.name};
    const related = knowledge.related, canonical = related?.aliases?.[source.id] ?? source.id;
    const linked = new Set([...(related?.links[canonical] ?? []).map(([id]) => id),
      ...(related?.cardGroups?.[canonical] ?? []).flatMap(group => related?.groups?.[group]?.[1] ?? [])]);
    for (const card of knowledge.cards) {
      // A related link is a ranking hint. Printed text or engine effect facts must still match.
      if (plans.some(plan => plan.derivedFrom !== 'fallback' && remoteEffectMatches(plan, card)))
        put(card.id, card.name, by, linked.has(card.id) ? 'related card and search effect' : 'search effect');
    }
  }
  return [...result.values()].sort((a,b) => a.name.localeCompare(b.name) || a.cardId-b.cardId);
}
const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function parseRemoteHandCommand({text, actorSeat, candidates}: {text: string; actorSeat: number; candidates: readonly RemoteSearchCandidate[]}): RemoteActionProposal | null {
  if (text.length > 500) return null;
  const match = text.trim().replace(/[.!?]+$/, '').match(/^(?:search\s+(.+)|add\s+(.+?)\s+to\s+(?:my\s+)?hand)$/i);
  if (!match) return null;
  const query = fold(match[1] ?? match[2]);
  if (!query) return null;
  const exact = candidates.filter(c => fold(c.name) === query);
  const matches = exact.length ? exact : candidates.filter(c => (' '+fold(c.name)+' ').includes(' '+query+' '));
  const unique = [...new Map(matches.map(c => [c.cardId,c])).values()];
  if (unique.length !== 1) return null;
  const {cardId, source, by} = unique[0];
  return {type:'hand.add', actorSeat, cardId, source, by};
}
