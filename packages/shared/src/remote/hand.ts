import { remoteAssert, type RemoteAction, type RemoteActionProposal, type TwinCard } from './actions.js';
import type { RemoteReductionContext } from './deck-checks.js';
import { remoteFieldZone } from './twin-placement.js';
import type { RemoteKnownHandCard, RemoteState } from './types.js';

/** Shared physical exit for hand.add and pile.lift. */
export function moveRemoteCardToHand(card: TwinCard): void {
  delete card.slot; delete card.departedFrom; delete card.publicIdentity;
  card.zone = 'hand'; card.faceUp = false;
}
const codeOf = (card: TwinCard) => card.cardId ?? card.passcode;
function counts(state: RemoteState, seat: number) {
  const s = state.seats[seat];
  s.handCount ??= state.deckChecks.format.settings.startingHand;
  const main = state.deckChecks.registrations[seat]?.deck.main;
  if (main) s.deckCount ??= Math.max(0, main.length - state.deckChecks.format.settings.startingHand);
  return s;
}
function remember(state: RemoteState, seat: number, cardId: number, source: RemoteKnownHandCard['source'], id: string, by?: RemoteKnownHandCard['by']) {
  (state.seats[seat].knownHand ??= []).push({id, cardId, source, ...(by ? {by: structuredClone(by)} : {}), at: state.updatedAt, revealed: true});
}
function forgetCopy(state: RemoteState, seat: number, code?: number) {
  const known = state.seats[seat].knownHand;
  const index = known?.findIndex(c => c.cardId === code) ?? -1;
  if (index >= 0) known!.splice(index, 1);
}
export function reduceRemoteHandAction(state: RemoteState, action: Extract<RemoteAction, {type: 'hand.add' | 'hand.reveal' | 'hand.forget'}>): void {
  const seat = action.actorSeat, s = state.seats[seat];
  if (action.type === 'hand.forget') {
    remoteAssert(s.knownHand?.some(c => c.id === action.id), 'Unknown known hand card', 409);
    s.knownHand = s.knownHand!.filter(c => c.id !== action.id); return;
  }
  if (action.type === 'hand.reveal') {
    if (!s.knownHand?.some(c => c.cardId === action.cardId)) remember(state, seat, action.cardId, 'unknown', action.idempotencyKey);
    return;
  }
  const zone = {gy: 'graveyard', banish: 'banished', extra: 'extra'}[action.source as 'gy' | 'banish' | 'extra'];
  const card = zone ? [...s.twin].reverse().find(c => c.zone === zone && codeOf(c) === action.cardId) :
    action.source === 'field' ? s.twin.find(c => remoteFieldZone(c.zone) && codeOf(c) === action.cardId) : undefined;
  remoteAssert(!zone && action.source !== 'field' || card, 'Card is no longer in the source pile or field', 409);
  remoteAssert(card || s.twin.length < 100, 'Field is full', 409);
  // A field source retains its departure so later field reads can reconnect it.
  if (action.source === 'field') {
    remoteAssert(card, 'Field source is unavailable', 409);
    card.departedFrom = {zone: card.zone, ...(card.slot ? {slot: card.slot} : {}), at: state.updatedAt};
    delete card.slot; delete card.publicIdentity; card.zone = 'hand'; card.faceUp = false;
  } else if (card) moveRemoteCardToHand(card);
  else s.twin.push({ref: 'hand-' + action.idempotencyKey.slice(0, 95), cardId: action.cardId, zone: 'hand', faceUp: false, position: 'attack'});
  if (action.source === 'deck') {
    counts(state, seat);
    if (s.deckCount !== undefined) { remoteAssert(s.deckCount > 0, 'Deck is empty', 409); s.deckCount--; }
  }
  remember(state, seat, action.cardId, action.source, action.idempotencyKey, action.by);
}
/** Compare physical exits once, after the board and deck checks have updated. */
export function applyRemoteHand(next: RemoteState, before: RemoteState, action: RemoteAction, context?: RemoteReductionContext): void {
  if (context?.replay && context.handKnowledge !== 1) return;
  for (const s of next.seats) {
    const old = before.seats[s.seat];
    for (const card of s.twin) {
      const previous = old.twin.find(c => c.ref === card.ref);
      if (card.zone === 'hand' && previous?.zone !== 'hand') {
        counts(next, s.seat).handCount!++;
        if (action.type !== 'hand.add' && previous && remoteFieldZone(previous.zone) && codeOf(card))
          remember(next, s.seat, codeOf(card)!, 'field', action.idempotencyKey);
        // A resolved search uses the same public knowledge contract as hand.add.
        if (action.type === 'effect.choose' && !previous && codeOf(card)) {
          const origin = next.effectTracking?.origins.find(o => o.id === action.originId && o.destination === 'hand');
          if (origin) {
            if (origin.announcedCard || origin.revealedCardId) remember(next, s.seat, codeOf(card)!, 'deck', origin.id, origin.source);
            if (s.deckCount !== undefined) s.deckCount = Math.max(0, s.deckCount - 1);
          }
        }
      }
    }
    for (const card of old.twin) if (card.zone === 'hand') {
      const moved = s.twin.find(c => c.ref === card.ref);
      if (!moved || moved.zone !== 'hand') {
        forgetCopy(next, s.seat, codeOf(card));
        counts(next, s.seat).handCount = Math.max(0, s.handCount! - 1);
        if (moved?.zone === 'deck' && s.deckCount !== undefined) s.deckCount++;
      }
    }
    if (action.type === 'effect.announce' && action.actorSeat === s.seat) {
      const origin = next.effectTracking?.origins.find(o => o.id === action.originId && o.destination === 'hand');
      if (origin?.announcedCard && !s.knownHand?.some(c => c.id === origin.id))
        remember(next, s.seat, origin.announcedCard.cardId, 'deck', origin.id, origin.source);
    }
    // A new field twin defaults to a play from hand. Pile and field origins were handled above.
    if (action.type === 'twin.place' && action.seat === s.seat && (remoteFieldZone(action.zone) || ['graveyard','banished'].includes(action.zone) && s.knownHand?.some(c=>c.cardId===(action.card.cardId??action.card.passcode))) &&
        s.twin.some(c => c.ref === action.card.ref) && !old.twin.some(c => c.ref === action.card.ref)) {
      forgetCopy(next, s.seat, action.card.cardId ?? action.card.passcode);
      counts(next, s.seat).handCount = Math.max(0, s.handCount! - 1);
    }
    if (s.eliminated) s.knownHand = [];
  }
  if (next.turn !== before.turn && next.revealedHand === 'one-turn') next.seats[before.turnSeat].knownHand = [];
}

/** UI adapters can forward the held-card read without retaining source pixels. */
export type RemoteHandVisionEvent = {
  cardId: number; mode: 'add' | 'reveal'; source?: RemoteKnownHandCard['source']; by?: RemoteKnownHandCard['by'];
};
export function remoteHandActionFromVision(event: RemoteHandVisionEvent, actorSeat: number): RemoteActionProposal {
  return event.mode === 'reveal' ? {type: 'hand.reveal', actorSeat, cardId: event.cardId} :
    {type: 'hand.add', actorSeat, cardId: event.cardId, source: event.source ?? 'unknown', ...(event.by ? {by:event.by} : {})};
}
