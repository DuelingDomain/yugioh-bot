import { remoteUndoHistory } from "./undo.js";
import type { RemoteEvent, RemotePosition, RemoteState, RemoteTable } from "./types.js";
import type { RemoteSnapshot } from "./realtime.js";
import { remotePublicCard } from "./deck-checks.js";
const hidden = (zone?:string,faceUp=true) => !faceUp || zone==="hand" || zone==="deck" || zone==="extra";
function projectPosition<T extends RemotePosition>(state:T, seats:ReadonlySet<number>):T {
  const next=structuredClone(state);
  if(next.twinConfirmation && !seats.has(next.twinConfirmation.seat)) delete next.twinConfirmation;
  if(next.twinConfirmationQueue)next.twinConfirmationQueue=next.twinConfirmationQueue.filter(flag=>seats.has(flag.seat));
  next.deckChecks.registrations=Object.fromEntries(Object.entries(next.deckChecks.registrations).filter(([seat])=>seats.has(Number(seat))));
  next.deckChecks.flags=next.deckChecks.flags.filter(f=>!f.private || seats.has(f.seat));
  next.deckChecks.instances=next.deckChecks.instances.filter(i=>seats.has(i.seat) || (i.public && i.zone!=="extra"));
  if(next.identified && !seats.has(next.identified.seat)) {
    const attached=next.identified.cardRef ? next.seats[next.identified.seat].twin.find(c=>c.ref===next.identified!.cardRef) : undefined;
    if(next.identified.private || (attached ? !remotePublicCard(attached) : hidden(next.identified.zone) && next.identified.zone!==undefined)) next.identified=null;
    else { delete next.identified.notInDecklist; next.identified.addErrors=[]; }
  }
  for(const seat of next.seats) if(!seats.has(seat.seat)) {
    delete seat.deckCount;
    if(next.showCardsSetFromDeck===false)seat.knownHand=seat.knownHand?.filter(c=>c.source!=='deck'||c.publicIdentity);
  }
  for(const seat of next.seats) if(!seats.has(seat.seat)) for(const card of seat.twin) if(hidden(card.zone,card.faceUp) && !remotePublicCard(card)) {
    delete card.cardId; delete card.passcode; delete card.name; delete card.race; delete card.bestMatch;
  }
  if(next.effectTracking) {
    next.effectTracking.contexts=Object.fromEntries(Object.entries(next.effectTracking.contexts).filter(([seat])=>seats.has(Number(seat))));
    next.effectTracking.origins=next.effectTracking.origins.map(origin=>seats.has(origin.seat) ? origin : {
      id:origin.id,seat:origin.seat,ref:origin.ref,destination:origin.destination,source:origin.source,
      announceRecommended:origin.announceRecommended,derivedFrom:origin.derivedFrom,
      ...(origin.announcedCard ? {announcedCard:origin.announcedCard} : {}),
      ...(origin.revealedCardId ? {revealedCardId:origin.revealedCardId} : {}),
    });
  }
  return next;
}
export function projectRemoteState(state:RemoteState,seats:ReadonlySet<number>):RemoteState {
  const next=projectPosition(state,seats);
  if(next.undo) next.undo.before=projectPosition(next.undo.before,seats);
  if(state.undoHistory) next.undoHistory=[...seats].flatMap(seat=>remoteUndoHistory(state,seat)).sort((a,b)=>b.order-a.order);
  return next;
}
export function projectRemoteTable(table:RemoteTable,seats:ReadonlySet<number>=new Set()):RemoteTable {
  return {...table,seats:table.seats.map(({deck,...seat})=>({...seat,deckRegistered:!!deck,...(seats.has(seat.seat) ? {deck} : {})}))};
}
/** Event replay facts are server-only. Historic private payloads stay private even after a reveal. */
function projectEvent(event:RemoteEvent,seats:ReadonlySet<number>):RemoteEvent {
  const {effects:_effects,...next}=structuredClone(event);
  const a=next.action;
  const actor=event.actorSeat ?? -1;
  if(a.type==='hand.add'&&a.by)a.by.name=event.effects?.facts?.[a.by.cardId]?.name??'Card '+a.by.cardId;
  if(a.type==="effect.activated" && event.effects?.effect) a.source=structuredClone(event.effects.effect.source);
  if(a.type==="seat.deck" && !seats.has(a.seat)) a.registration=null;
  if(a.type==="table.configured") a.registrations=Object.fromEntries(Object.entries(a.registrations).filter(([seat])=>seats.has(Number(seat))));
  if(!seats.has(actor)) {
    if(event.effects?.privateHandIdentity) next.action={type:'log.note',actorSeat:actor,text:a.type==='deck.count'?'Updated a private Deck count':'Updated a private hand card',idempotencyKey:event.id};
    if(a.type==="side.swap") { next.action={type:"log.note",actorSeat:actor,text:"Updated a private side deck",idempotencyKey:event.id}; delete next.messages; }
    if(a.type==="effect.choose" && !event.effects?.publicEffectChoice) { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card choice",idempotencyKey:event.id}; delete next.messages; }
    if(a.type==="twin.place" && hidden(a.zone,a.card.faceUp)) { delete a.card.cardId; delete a.card.passcode; delete a.card.name; delete a.card.race; delete next.messages; }
    if(a.type==="card.identified" || a.type==="cards.identified") {
      const sightings=a.type==="card.identified" ? [a] : a.cards;
      const privateSight=event.effects?.privateRecognition ?? sightings.some(s=>s.zone==="hand" || s.zone==="deck" || s.zone==="extra");
      if(privateSight) { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card",idempotencyKey:event.id}; delete next.messages; }
    }
  }
  return next;
}
/**
 * What a spectator may know. A player sees some cards because the table told that player (a searched card, a reveal, a
 * card once public and now Set). A spectator gets none of that: no hand contents, no face-down names, no notes, no undo or deck data.
 * Allow list for events: a new action type shows as a private line until it is added here.
 */
const SPECTATOR_EVENTS:ReadonlySet<string>=new Set(["table.created","table.configured","table.started","table.ended","idle.warning","seat.joined","seat.left","seat.ready","seat.deck",
  "phase.set","phase.advance","turn.end","lp.change","attack.declare","attack.resolve","player.concede","match.declare","match.confirm","match.continue","match.first","side.ready","side.unready","side.timeout",
  "hand.draw","hand.count","twin.place","twin.move","twin.flip","twin.remove","twin.attach","twin.detach","twin.equip","pile.lift","pile.order","effect.activated"]);
const PUBLIC_ZONE=(card:{zone:string;faceUp?:boolean})=>card.faceUp!==false && !["hand","deck","extra"].includes(card.zone);
function spectatorPosition<T extends RemotePosition>(state:T):T {
  const next=structuredClone(state);
  delete next.twinConfirmation; delete next.twinConfirmationQueue; delete next.effectTracking;
  next.deckChecks.registrations={}; next.deckChecks.flags=[]; next.deckChecks.instances=[];
  for(const seat of next.seats) {
    delete seat.knownHand; delete seat.deckCount;
    seat.twin=seat.twin.filter(card=>card.zone!=="hand" && card.zone!=="deck");
    for(const card of seat.twin) if(!PUBLIC_ZONE(card)) {
      delete card.cardId; delete card.passcode; delete card.name; delete card.race; delete card.bestMatch; delete card.publicIdentity; delete card.setBy;
    }
  }
  const shown=next.identified, on=shown?.cardRef ? next.seats[shown.seat]?.twin.find(card=>card.ref===shown.cardRef) : undefined;
  next.identified=shown && on && PUBLIC_ZONE(on) && !shown.private ? {seat:shown.seat,cardRef:shown.cardRef,cardId:shown.cardId,passcode:shown.passcode,zone:shown.zone,source:shown.source,name:shown.name,addErrors:[]} : null;
  return next;
}
function spectatorEvent(event:RemoteEvent):RemoteEvent {
  const projected=projectEvent(event,new Set());
  delete projected.messages;
  const a=projected.action;
  const actor=event.actorSeat ?? -1;
  if(!SPECTATOR_EVENTS.has(a.type)) return {...projected,action:{type:"log.note",actorSeat:actor,text:a.type==="undo" ? "Undid an action" : "Updated a private card",idempotencyKey:event.id}};
  if(a.type==="twin.flip" && !a.faceUp) { delete a.cardId; }
  if(a.type==="twin.place" && (a.zone==="hand" || a.zone==="deck")) return {...projected,action:{type:"log.note",actorSeat:actor,text:"Updated a private card",idempotencyKey:event.id}};
  return projected;
}
/** The one view of a table that spectators get, from the HTTP route and from the socket. */
export function projectRemoteSpectator(snapshot:RemoteSnapshot):RemoteSnapshot {
  const state=spectatorPosition(snapshot.state);
  return {table:projectRemoteTable(snapshot.table),state:{...state,undo:null,undoHistory:[]},events:snapshot.events.map(spectatorEvent)};
}
export function projectRemoteSnapshot(snapshot:RemoteSnapshot,seats:ReadonlySet<number>=new Set()):RemoteSnapshot {
  return {table:projectRemoteTable(snapshot.table,seats),state:projectRemoteState(snapshot.state,seats),events:snapshot.events.map(e=>projectEvent(e,seats))};
}
