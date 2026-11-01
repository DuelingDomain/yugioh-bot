import type { RemoteEvent, RemotePosition, RemoteState, RemoteTable } from "./types.js";
import type { RemoteSnapshot } from "./realtime.js";
const hidden = (zone?:string,faceUp=true) => !faceUp || zone==="hand" || zone==="deck" || zone==="extra";
function projectPosition<T extends RemotePosition>(state:T, seats:ReadonlySet<number>):T {
  const next=structuredClone(state);
  next.deckChecks.registrations=Object.fromEntries(Object.entries(next.deckChecks.registrations).filter(([seat])=>seats.has(Number(seat))));
  next.deckChecks.flags=next.deckChecks.flags.filter(f=>!f.private || seats.has(f.seat));
  next.deckChecks.instances=next.deckChecks.instances.filter(i=>seats.has(i.seat) || (i.public && i.zone!=="extra"));
  if(next.identified && !seats.has(next.identified.seat)) {
    const attached=next.identified.cardRef ? next.seats[next.identified.seat].twin.find(c=>c.ref===next.identified!.cardRef) : undefined;
    if(next.identified.private || (attached && hidden(attached.zone,attached.faceUp)) || (hidden(next.identified.zone) && next.identified.zone!==undefined)) next.identified=null;
    else { delete next.identified.notInDecklist; next.identified.addErrors=[]; }
  }
  for(const seat of next.seats) if(!seats.has(seat.seat)) for(const card of seat.twin) if(hidden(card.zone,card.faceUp)) {
    delete card.cardId; delete card.passcode; delete card.name; delete card.race;
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
  if(a.type==="effect.activated" && event.effects?.effect) a.source=structuredClone(event.effects.effect.source);
  if(a.type==="seat.deck" && !seats.has(a.seat)) a.registration=null;
  if(a.type==="table.configured") a.registrations=Object.fromEntries(Object.entries(a.registrations).filter(([seat])=>seats.has(Number(seat))));
  if(!seats.has(actor)) {
    if(a.type==="effect.choose") { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card choice",idempotencyKey:event.id}; delete next.messages; }
    if(a.type==="twin.place" && hidden(a.zone,a.card.faceUp)) { delete a.card.cardId; delete a.card.passcode; delete a.card.name; delete a.card.race; delete next.messages; }
    if(a.type==="card.identified" || a.type==="cards.identified") {
      const sightings=a.type==="card.identified" ? [a] : a.cards;
      const privateSight=event.effects?.privateRecognition || sightings.some(s=>s.zone==="hand" || s.zone==="deck" || s.zone==="extra");
      if(privateSight) { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card",idempotencyKey:event.id}; delete next.messages; }
    }
  }
  return next;
}
export function projectRemoteSnapshot(snapshot:RemoteSnapshot,seats:ReadonlySet<number>=new Set()):RemoteSnapshot {
  return {table:projectRemoteTable(snapshot.table,seats),state:projectRemoteState(snapshot.state,seats),events:snapshot.events.map(e=>projectEvent(e,seats))};
}
