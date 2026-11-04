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
export function reduceRemoteHandAction(state: RemoteState, action: Extract<RemoteAction, {type: 'hand.add' | 'hand.reveal' | 'hand.forget' | 'hand.count'}>): void {
  const seat = action.actorSeat, s = state.seats[seat];
  if (action.type === 'hand.count') {
    const value = action.value ?? (s.handCount ?? state.deckChecks.format.settings.startingHand) + action.delta!;
    remoteAssert(value >= 0 && value <= 999999, 'Hand count is outside the supported range', 409);
    s.handCount = value; return;
  }
  if (action.type === 'hand.forget') {
    remoteAssert(s.knownHand?.some(c => c.id === action.id), 'Unknown known hand card', 409);
    s.knownHand = s.knownHand!.filter(c => c.id !== action.id); return;
  }
  if (action.type === 'hand.reveal') {
    const origins=(state.effectTracking?.origins??[]).filter(origin=>origin.seat===seat&&origin.destination==='hand'&&
      s.twin.some(t=>t.ref===origin.ref&&t.zone==='hand'&&(codeOf(t)===action.cardId||origin.chosenCardId===action.cardId||!codeOf(t)&&origin.pool?.some(c=>c.cardId===action.cardId))));
    const origin=origins.length===1?origins[0]:undefined;
    if (!s.knownHand?.some(c => c.cardId === action.cardId)) remember(state, seat, action.cardId, origin?'deck':'unknown', action.idempotencyKey, origin?.source);
    if(origin) {
      const twin=s.twin.find(t=>t.ref===origin.ref)!;
      twin.cardId=action.cardId;
      origin.chosenCardId=action.cardId;
      origin.announcedCard={cardId:action.cardId,name:origin.pool?.find(c=>c.cardId===action.cardId)?.name??twin.name??'Card '+action.cardId};
      origin.revealedCardId=action.cardId;origin.handRecorded=true;
    }
    return;
  }
  const zone = {deck: 'deck', gy: 'graveyard', banish: 'banished', extra: 'extra'}[action.source as 'deck' | 'gy' | 'banish' | 'extra'];
  const card = zone ? [...s.twin].reverse().find(c => c.zone === zone && codeOf(c) === action.cardId) :
    action.source === 'field' ? s.twin.find(c => remoteFieldZone(c.zone) && codeOf(c) === action.cardId) : undefined;
  remoteAssert(action.source === 'deck' || !zone && action.source !== 'field' || card, 'Card is no longer in the source pile or field', 409);
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
      }
    }
    for (const card of old.twin) if (card.zone === 'hand') {
      const moved = s.twin.find(c => c.ref === card.ref);
      if (!moved || moved.zone !== 'hand') {
        forgetCopy(next, s.seat, codeOf(card));
        counts(next, s.seat).handCount = Math.max(0, s.handCount! - 1);
      }
    }
    // Count direct returns to Deck as well as known hand departures.
    if (s.deckCount !== undefined) for (const card of s.twin) {
      const previous=old.twin.find(c=>c.ref===card.ref);
      if(card.zone==='deck'&&previous?.zone!=='deck')s.deckCount++;
      else if(previous?.zone==='deck'&&card.zone!=='deck'&&action.type!=='hand.add')s.deckCount=Math.max(0,s.deckCount-1);
    }
    // A new field twin defaults to a play from hand. Pile and field origins were handled above.
    if (action.type === 'twin.place' && action.seat === s.seat && (remoteFieldZone(action.zone) || ['graveyard','banished'].includes(action.zone) && s.knownHand?.some(c=>c.cardId===(action.card.cardId??action.card.passcode))) &&
        s.twin.some(c => c.ref === action.card.ref) && !old.twin.some(c => c.ref === action.card.ref)) {
      forgetCopy(next, s.seat, action.card.cardId ?? action.card.passcode);
      counts(next, s.seat).handCount = Math.max(0, s.handCount! - 1);
    }
    if (s.eliminated) s.knownHand = [];
  }
  // A held-card/voice addition completes the same pending search as the picker.
  if (action.type === 'hand.add' && action.source === 'deck' && action.by) {
    const origin=[...(next.effectTracking?.origins??[])].reverse().find(o=>o.seat===action.actorSeat&&o.destination==='hand'&&o.source.cardId===action.by!.cardId&&!o.handCounted);
    const twin=next.seats[action.actorSeat].twin.find(c=>c.zone==='hand'&&codeOf(c)===action.cardId&&
      !before.seats[action.actorSeat].twin.some(old=>old.ref===c.ref&&old.zone==='hand'));
    if(origin&&twin) {
      origin.ref=twin.ref;origin.chosenCardId=action.cardId;
      origin.announcedCard={cardId:action.cardId,name:context?.facts?.[action.cardId]?.name??origin.pool?.find(c=>c.cardId===action.cardId)?.name??'Card '+action.cardId};
      origin.revealedCardId=action.cardId;origin.handCounted=true;origin.handRecorded=true;
    }
  }
  for (const origin of next.effectTracking?.origins ?? []) {
    if (origin.destination !== 'hand') continue;
    const twin = next.seats[origin.seat].twin.find(c => c.ref === origin.ref && c.zone === 'hand');
    const affected = (action.type === 'effect.choose' || action.type === 'effect.announce') && action.originId === origin.id ||
      action.type === 'twin.place' && action.card.ref === origin.ref ||
      action.type === 'card.identified' && action.cardRef === origin.ref ||
      action.type === 'cards.identified' && action.cards.some(c => c.cardRef === origin.ref);
    if (!twin || !affected) continue;
    if (!origin.handCounted) {
      const s=counts(next,origin.seat);origin.handCounted=true;
      if(s.deckCount!==undefined)s.deckCount=Math.max(0,s.deckCount-1);
    }
    if (!origin.handRecorded && codeOf(twin) && (origin.announcedCard || origin.revealedCardId)) {
      remember(next, origin.seat, codeOf(twin)!, 'deck', action.idempotencyKey, origin.source);
      origin.handRecorded=true;
    }
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
