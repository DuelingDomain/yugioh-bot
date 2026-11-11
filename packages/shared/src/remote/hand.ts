import { cloneRemoteCurrent } from "./position.js";
import { remoteAssert, type RemoteAction, type RemoteActionProposal, type TwinCard } from './actions.js';
import {remotePublicCard, type RemoteReductionContext} from './deck-checks.js';
import {searchCandidates} from './search-candidates.js';
import { remoteFieldZone } from './twin-placement.js';
import type { RemoteKnownHandCard, RemoteState } from './types.js';

/** Shared physical exit for hand.add and pile.lift. */
export function moveRemoteCardToHand(card: TwinCard): void {
  delete card.slot; delete card.departedFrom; delete card.publicIdentity;
  card.zone = 'hand'; card.faceUp = false;
}
const codeOf = (card: TwinCard) => card.cardId ?? card.passcode;
function openingDrawOf(state: RemoteState, seat: number, reviewed: boolean) {
  const settings=state.deckChecks.format.settings;
  return reviewed&&state.turn===1&&seat===state.turnSeat&&state.seatCount>2&&state.deckChecks.format.mode==='domain'&&settings.firstTurnDraw!==false ? settings.drawPerTurn : 0;
}
/** Cards of this turn's automatic draw that no voice or manual draw has used yet. */
function unusedTurnDraw(state: RemoteState, seat: number, reviewed: boolean) {
  if (!reviewed||seat!==state.turnSeat||state.phase!=='draw') return 0;
  const drawn=state.turnDraw;
  if (drawn&&drawn.turn===state.turn&&drawn.seat===seat) return drawn.used ? 0 : state.deckChecks.format.settings.drawPerTurn;
  return drawn ? 0 : openingDrawOf(state,seat,reviewed);
}
function counts(state: RemoteState, seat: number, reviewed=true) {
  const s = state.seats[seat];
  const settings=state.deckChecks.format.settings;
  const openingDraw=openingDrawOf(state,seat,reviewed);
  s.handCount ??= settings.startingHand+openingDraw;
  const main = state.deckChecks.registrations[seat]?.deck.main;
  if (main) s.deckCount ??= Math.max(0, main.length - settings.startingHand-openingDraw);
  return s;
}
/** Establish opening counts before any play or turn change; an unknown Deck stays unknown. */
export function initializeRemoteHandCounts(state: RemoteState): void {
  for (const seat of state.seats) counts(state,seat.seat);
}
function remember(state: RemoteState, seat: number, cardId: number, source: RemoteKnownHandCard['source'], id: string, by?: RemoteKnownHandCard['by']) {
  (state.seats[seat].knownHand ??= []).push({id, cardId, source, ...(by ? {by: structuredClone(by)} : {}), at: state.updatedAt, revealed: true});
}
function forgetCopy(state: RemoteState, seat: number, code?: number) {
  const known = state.seats[seat].knownHand;
  const index = known?.findIndex(c => c.cardId === code) ?? -1;
  if (index >= 0) known!.splice(index, 1);
}
export function reduceRemoteHandAction(state: RemoteState, action: Extract<RemoteAction, {type: 'hand.add' | 'hand.reveal' | 'hand.forget' | 'hand.count' | 'hand.draw' | 'deck.count'}>, context?:RemoteReductionContext): boolean {
  const seat = action.actorSeat, s = state.seats[seat],reviewed=!context?.replay||context.handReview===1;
  if(action.type==='hand.draw') {
    counts(state,seat,reviewed);
    // The turn change or the opening hand already counted this turn's draw. The first "draw" in the Draw Phase is that draw.
    const credit=unusedTurnDraw(state,seat,reviewed);
    if(credit)state.turnDraw={turn:state.turn,seat,used:true};
    const count=Math.max(0,action.count-credit);
    remoteAssert(s.handCount!+count<=999999,'Hand count is outside the supported range',409);
    s.handCount!+=count;
    if(s.deckCount!==undefined)s.deckCount=Math.max(0,s.deckCount-count);
    return true;
  }
  if(action.type==='deck.count') {
    counts(state,seat,reviewed);
    const old=s.deckCount;
    const value=action.value??(old??0)+action.delta!;
    remoteAssert(value>=0&&value<=999999,'Deck count is outside the supported range',409);
    const previous=old??s.deckCount;
    s.deckCount=value;
    if(action.cause!=='other'&&previous!==undefined&&value<previous)counts(state,seat,reviewed).handCount!+=previous-value;
    remoteAssert((s.handCount??0)<=999999,'Hand count is outside the supported range',409);
    return true;
  }
  if (action.type === 'hand.count') {
    const value = action.value ?? (s.handCount ?? state.deckChecks.format.settings.startingHand) + action.delta!;
    remoteAssert(value >= 0 && value <= 999999, 'Hand count is outside the supported range', 409);
    s.handCount = value; return true;
  }
  if (action.type === 'hand.forget') {
    remoteAssert(s.knownHand?.some(c => c.id === action.id), 'Unknown known hand card', 409);
    s.knownHand = s.knownHand!.filter(c => c.id !== action.id); return true;
  }
  if (action.type === 'hand.reveal') {
    const known=s.knownHand?.find(c=>c.cardId===action.cardId);
    if(reviewed&&known&&(state.showCardsSetFromDeck!==false||known.source!=='deck'||known.publicIdentity))return false;
    const origins=(state.effectTracking?.origins??[]).filter(origin=>origin.seat===seat&&origin.destination==='hand'&&
      s.twin.some(t=>t.ref===origin.ref&&t.zone==='hand'&&(codeOf(t)===action.cardId||origin.chosenCardId===action.cardId||!codeOf(t)&&origin.pool?.some(c=>c.cardId===action.cardId))));
    const origin=origins.length===1?origins[0]:undefined;
    if (!s.knownHand?.some(c => c.cardId === action.cardId)) remember(state, seat, action.cardId, origin?origin.searchSource??'deck':'unknown', action.idempotencyKey, origin?.source);
    if(reviewed&&state.showCardsSetFromDeck===false)s.knownHand!.find(c=>c.cardId===action.cardId)!.publicIdentity=true;
    if(origin) {
      const twin=s.twin.find(t=>t.ref===origin.ref)!;
      twin.cardId=action.cardId;
      origin.chosenCardId=action.cardId;
      origin.announcedCard={cardId:action.cardId,name:origin.pool?.find(c=>c.cardId===action.cardId)?.name??twin.name??'Card '+action.cardId};
      origin.revealedCardId=action.cardId;origin.handRecorded=true;
    }
    return true;
  }
  if(reviewed&&['deck','gy','banish'].includes(action.source)&&action.by) {
    const origins=state.effectTracking?.origins.filter(o=>o.seat===seat&&o.destination==='hand'&&o.source.cardId===action.by!.cardId)??[];
    // Historical non-Deck adds were not linked to search origins.
    if(action.source==='deck'||origins.some(o=>o.searchSource!==undefined))
      remoteAssert(!origins.length||origins.some(o=>(o.searchSource??'deck')===action.source&&!o.handCounted&&(o.chosenCardId===undefined||o.chosenCardId===action.cardId)&&
        (o.pool??o.candidates??[]).some(c=>c.cardId===action.cardId)), 'Search was already counted or does not match this card',409);
  }
  const zone = {deck: 'deck', gy: 'graveyard', banish: 'banished', extra: 'extra'}[action.source as 'deck' | 'gy' | 'banish' | 'extra'];
  const card = zone ? [...s.twin].reverse().find(c => (c.zone === zone || c.zone==='hand'&&c.inspectionFrom===zone) && codeOf(c) === action.cardId) :
    action.source === 'field' ? s.twin.find(c => remoteFieldZone(c.zone) && codeOf(c) === action.cardId) : undefined;
  remoteAssert(action.source === 'deck' || !zone && action.source !== 'field' || card, 'Card is no longer in the source pile or field', 409);
  remoteAssert(card || s.twin.length < 100, 'Field is full', 409);
  const privateField=action.source==='field'&&card&&!card.faceUp;
  // A field source retains its departure so later field reads can reconnect it.
  if (action.source === 'field') {
    remoteAssert(card, 'Field source is unavailable', 409);
    card.departedFrom = {zone: card.zone, ...(card.slot ? {slot: card.slot} : {}), at: state.updatedAt};
    delete card.slot; delete card.publicIdentity; card.zone = 'hand'; card.faceUp = false;
  } else if (card) {moveRemoteCardToHand(card);delete card.inspectionFrom;}
  else s.twin.push({ref: 'hand-' + action.idempotencyKey.slice(0, 95), cardId: action.cardId, zone: 'hand', faceUp: false, position: 'attack'});
  if (action.source === 'deck') {
    counts(state, seat,reviewed);
    if (s.deckCount !== undefined) { remoteAssert(s.deckCount > 0, 'Deck is empty', 409); s.deckCount--; }
  }
  if(!reviewed||!privateField) remember(state, seat, action.cardId, action.source, action.idempotencyKey, action.by ?
    reviewed?{cardId:action.by.cardId,name:context?.facts?.[action.by.cardId]?.name??state.effectTracking?.origins.find(o=>o.source.cardId===action.by!.cardId)?.source.name??'Card '+action.by.cardId}:action.by:undefined);
  return true;
}
/** Compare physical exits once, after the board and deck checks have updated. */
export function applyRemoteHand(next: RemoteState, before: RemoteState, action: RemoteAction, context?: RemoteReductionContext): void {
  if (context?.replay && context.handKnowledge !== 1) return;
  const reviewed=!context?.replay||context.handReview===1;
  if(reviewed&&next.turn!==before.turn) {
    const opening=cloneRemoteCurrent(before);
    for(const s of next.seats)if(!s.eliminated){
      const prior=counts(opening,s.seat);
      s.handCount??=prior.handCount;s.deckCount??=prior.deckCount;
    }
    next.turnDraw={turn:next.turn,seat:next.turnSeat};
    const s=counts(next,next.turnSeat),draw=next.deckChecks.format.settings.drawPerTurn;
    s.handCount!+=draw;if(s.deckCount!==undefined)s.deckCount=Math.max(0,s.deckCount-draw);
  }
  for (const s of next.seats) {
    const old = before.seats[s.seat];
    // The camera deletes an unread face-up placeholder when it resolves a move to an existing ref.
    // That cancels the implicit play from hand. A Set or an identified field removal is a real exit.
    if ((!context?.replay || context.handCountCorrections===1) && action.type==='twin.remove' && action.seat===s.seat &&
      old.twin.some(c=>c.ref===action.cardRef && remoteFieldZone(c.zone) && c.faceUp && !codeOf(c) && !c.name))
      counts(next,s.seat,reviewed).handCount!++;
    for (const card of s.twin) {
      const previous = old.twin.find(c => c.ref === card.ref);
      if (card.zone === 'hand' && !card.inspectionFrom && (previous?.zone !== 'hand'||previous.inspectionFrom)) {
        counts(next, s.seat,reviewed).handCount!++;
        if (action.type !== 'hand.add' && previous && remoteFieldZone(previous.zone) && (!reviewed||previous.faceUp&&remotePublicCard(previous)) && codeOf(card))
          remember(next, s.seat, codeOf(card)!, 'field', action.idempotencyKey);
      }
    }
    for (const card of old.twin) if (card.zone === 'hand' && !card.inspectionFrom) {
      const moved = s.twin.find(c => c.ref === card.ref);
      if (!moved || moved.zone !== 'hand') {
        forgetCopy(next, s.seat, codeOf(card));
        counts(next, s.seat,reviewed).handCount = Math.max(0, s.handCount! - 1);
      }
    }
    // Count direct returns to Deck as well as known hand departures.
    if (s.deckCount !== undefined) for (const card of s.twin) {
      const previous=old.twin.find(c=>c.ref===card.ref);
      if(card.zone==='deck'&&previous?.zone!=='deck')s.deckCount++;
      else if(previous?.zone==='deck'&&card.zone!=='deck'&&action.type!=='hand.add')s.deckCount=Math.max(0,s.deckCount-1);
    }
    // A new field twin defaults to a play from hand. Pile and field origins were handled above.
    const placementCode=action.type==='twin.place' ? action.card.cardId??action.card.passcode : undefined;
    const fact=placementCode ? context?.facts?.[placementCode] : undefined;
    const fromOutsideHand=reviewed&&action.type==='twin.place'&&!s.knownHand?.some(c=>c.cardId===placementCode)&&
      (!!action.summon||action.zone==='extra-monster'||fact?.section==='extra'||!!(fact?.type&&fact.type&(0x40|0x2000|0x800000|0x4000000|0x4000)));
    if (action.type === 'twin.place' && !fromOutsideHand && action.seat === s.seat && (remoteFieldZone(action.zone) || ['graveyard','banished'].includes(action.zone) && s.knownHand?.some(c=>c.cardId===(action.card.cardId??action.card.passcode))) &&
        s.twin.some(c => c.ref === action.card.ref) && !old.twin.some(c => c.ref === action.card.ref)) {
      forgetCopy(next, s.seat, action.card.cardId ?? action.card.passcode);
      counts(next, s.seat,reviewed).handCount = Math.max(0, s.handCount! - 1);
    }
    // An anonymous Set keeps its possible hand identity private until it turns face-up.
    if(reviewed)for(const card of s.twin)if(card.faceUp&&remoteFieldZone(card.zone)&&codeOf(card)&&
      old.twin.some(c=>c.ref===card.ref&&!c.faceUp&&!codeOf(c))) {
      const hand=s.twin.find(c=>c.zone==='hand'&&!c.inspectionFrom&&codeOf(c)===codeOf(card));
      if(hand&&s.knownHand?.some(c=>c.cardId===codeOf(card))) {
        forgetCopy(next,s.seat,codeOf(card));s.twin.splice(s.twin.indexOf(hand),1);
      }
    }
    for(const card of s.twin)if(card.zone!=='hand')delete card.inspectionFrom;
    if (s.eliminated) s.knownHand = [];
  }
  // A card held up from the hand becomes public and stays in the hand, so a later play or discard from it counts exactly.
  if (action.type === 'effect.activated' && action.fromHand && action.source.cardId !== undefined) {
    const own = next.seats[action.actorSeat];
    if (own && !own.knownHand?.some(c => c.cardId === action.source.cardId)) remember(next, action.actorSeat, action.source.cardId, 'unknown', action.idempotencyKey);
  }
  // A held-card/voice addition completes the same pending search as the picker.
  if (action.type === 'hand.add' && (action.source==='deck'||reviewed&&['gy','banish'].includes(action.source)) && action.by) {
    const origin=[...(next.effectTracking?.origins??[])].reverse().find(o=>o.seat===action.actorSeat&&o.destination==='hand'&&o.source.cardId===action.by!.cardId&&!o.handCounted&&
      (!reviewed||(o.searchSource??'deck')===action.source&&(o.chosenCardId===undefined||o.chosenCardId===action.cardId)&&(o.pool??o.candidates??[]).some(c=>c.cardId===action.cardId)));
    const twin=next.seats[action.actorSeat].twin.find(c=>c.zone==='hand'&&codeOf(c)===action.cardId&&
      !before.seats[action.actorSeat].twin.some(old=>old.ref===c.ref&&old.zone==='hand'&&!old.inspectionFrom));
    if(origin&&twin) {
      origin.ref=twin.ref;origin.chosenCardId=action.cardId;
      if(!reviewed||action.source!=='deck'||next.showCardsSetFromDeck!==false){
        origin.announcedCard={cardId:action.cardId,name:context?.facts?.[action.cardId]?.name??origin.pool?.find(c=>c.cardId===action.cardId)?.name??'Card '+action.cardId};
        origin.revealedCardId=action.cardId;
      }
      origin.handCounted=true;origin.handRecorded=true;
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
      const s=counts(next,origin.seat,reviewed);origin.handCounted=true;
      if((origin.searchSource??'deck')==='deck'&&s.deckCount!==undefined)s.deckCount=Math.max(0,s.deckCount-1);
    }
    if (!origin.handRecorded && codeOf(twin) && (origin.announcedCard || origin.revealedCardId)) {
      remember(next, origin.seat, codeOf(twin)!, origin.searchSource??'deck', action.idempotencyKey, origin.source);
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

/** Local camera suggestion. This is not a server action and must never be POSTed. */
export type RemoteHandSuggestionEvent = {type:'hand.suggest';actorSeat:number;cardId:number;id:string;at:number};
/** The held card was activated by voice a moment ago: nothing is recorded, the UI offers a tap. */
export type RemoteHandDuplicateEvent = {type:'hand.duplicate';actorSeat:number;cardId:number;id:string;at:number};
export const REMOTE_HAND_SUGGESTION_EVENT='remote:hand-suggestion';
/** The table asks the field watcher to take a spoken "undo" when the newest action is one it can undo with its own chain. Cancelled by `detail.handled=true`. */
export const REMOTE_VOICE_UNDO_EVENT='remote:voice-undo';
export type RemoteVoiceUndoEvent={slug:string;actionId:string;handled:boolean};
/** The same card was just recorded as an activation by the other source (the camera's held-card read, or a spoken effect): the second one must not record it again. */
export const REMOTE_ACTIVATION_DEDUPE_MS=6000;
export function remoteRecentActivation(state:RemoteState,actorSeat:number,cardId:number|undefined,now:number,byCamera:boolean):boolean {
  if(cardId===undefined)return false;
  return (state.undoHistory??[]).some(e=>!e.undone&&e.actorSeat===actorSeat&&e.action.type==='effect.activated'&&!!e.action.fromHand===byCamera&&
    e.action.source.cardId===cardId&&now-e.at<=REMOTE_ACTIVATION_DEDUPE_MS&&now>=e.at-REMOTE_ACTIVATION_DEDUPE_MS);
}
/** Call after the held episode ends and a further 800 ms shows no play of this card. */
export function remoteHandReadDecision(state:RemoteState,actorSeat:number,read:{cardId:number;id:string;at:number},fieldReadPending=false):RemoteActionProposal|RemoteHandSuggestionEvent|undefined {
  const own=state.seats[actorSeat];
  if(!own||own.knownHand?.some(c=>c.cardId===read.cardId)||own.twin.some(c=>codeOf(c)===read.cardId&&(remoteFieldZone(c.zone)||c.zone==='hand'&&c.departedFrom)))return;
  const origins=[...(state.effectTracking?.origins??[])].reverse().filter(o=>o.seat===actorSeat&&o.destination==='hand'&&!o.handCounted&&
    o.at!==undefined&&read.at>=o.at&&read.at-o.at<=60_000&&(o.chosenCardId===undefined||o.chosenCardId===read.cardId)&&
    searchCandidates(state,actorSeat,o.source.cardId).some(c=>c.cardId===read.cardId&&c.source===(o.searchSource??'deck')));
  const origin=origins[0];
  if(origin&&!fieldReadPending&&new Set(origins.map(o=>o.searchSource??'deck')).size===1)
    return {type:'hand.add',actorSeat,cardId:read.cardId,source:origin.searchSource??'deck',by:{cardId:origin.source.cardId,name:origin.source.name}};
  return {type:'hand.suggest',actorSeat,...read};
}
/**
 * The decision for a sure read of a card held up to the camera, taken at once (not after the episode ends).
 * A matching search plan adds the card. Any other card of the registered Deck is shown to the table as an activation from the
 * hand. A card that cannot be activated (`activatable:false`: a Normal or Extra Deck monster) or is not in the Deck keeps the
 * one-tap suggestion. Nothing comes back when the card is already on the field, was just played, or is already public in the hand.
 */
export function remoteHandActivationDecision(state:RemoteState,actorSeat:number,read:{cardId:number;id:string;at:number},opts:{fieldReadPending?:boolean;activatable?:boolean;duplicateOk?:boolean}={}):RemoteActionProposal|RemoteHandSuggestionEvent|RemoteHandDuplicateEvent|undefined {
  const decision=remoteHandReadDecision(state,actorSeat,read,opts.fieldReadPending);
  if(!decision||decision.type!=='hand.suggest'||opts.fieldReadPending)return decision;
  // A spoken effect for this card was just recorded: the held card is probably the same activation. The UI says so and offers a tap to record it anyway.
  if(!opts.duplicateOk&&remoteRecentActivation(state,actorSeat,read.cardId,read.at,false))return {type:'hand.duplicate',actorSeat,...read};
  const main=state.deckChecks.registrations[actorSeat]?.deck.main;
  if(opts.activatable===false||main&&!main.includes(read.cardId))return decision;
  return {type:'effect.activated',actorSeat,source:{cardId:read.cardId},fromHand:true};
}
