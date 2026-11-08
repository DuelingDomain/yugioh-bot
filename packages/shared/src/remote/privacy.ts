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
/** Clone a state without its undo data: that data is about 90% of the size and every caller replaces or drops it. The placeholders keep the key order. */
function withoutUndo<T extends RemoteState>(state:T):T {
  const shell:Record<string,unknown>={...state};
  if("undo" in shell)shell.undo=null;
  if("undoHistory" in shell)shell.undoHistory=null;
  return shell as T;
}
/** `allUndoReasons` runs the slow restore check for every history entry, not only the newest of each seat. */
export function projectRemoteState(state:RemoteState,seats:ReadonlySet<number>,options:{allUndoReasons?:boolean}={}):RemoteState {
  const next=projectPosition(withoutUndo(state),seats);
  // Clients use only the id and time of the last action; the position before it stays on the server (the cast hides the missing `before`).
  if("undo" in state)next.undo=state.undo ? {actionId:state.undo.actionId,at:state.undo.at} as RemoteState["undo"] : state.undo;
  if("undoHistory" in state)next.undoHistory=state.undoHistory ? [...seats].flatMap(seat=>remoteUndoHistory(state,seat,options.allUndoReasons?"all":"newest")).sort((a,b)=>b.order-a.order) : state.undoHistory;
  return next;
}
export function projectRemoteTable(table:RemoteTable,seats:ReadonlySet<number>=new Set()):RemoteTable {
  return {...table,seats:table.seats.map(({deck,...seat})=>({...seat,deckRegistered:!!deck,...(seats.has(seat.seat) ? {deck} : {})}))};
}
/** Event replay facts are server-only. Historic private payloads stay private even after a reveal. */
function projectEvent(event:RemoteEvent,seats:ReadonlySet<number>):RemoteEvent {
  const {effects,...rest}=event, next=structuredClone(rest);
  const a=next.action;
  const actor=event.actorSeat ?? -1;
  if(a.type==='hand.add'&&a.by)a.by.name=effects?.facts?.[a.by.cardId]?.name??'Card '+a.by.cardId;
  if(a.type==="effect.activated" && effects?.effect) a.source=structuredClone(effects.effect.source);
  if(a.type==="seat.deck" && !seats.has(a.seat)) a.registration=null;
  if(a.type==="table.configured") a.registrations=Object.fromEntries(Object.entries(a.registrations).filter(([seat])=>seats.has(Number(seat))));
  if(!seats.has(actor)) {
    if(effects?.privateHandIdentity) next.action={type:'log.note',actorSeat:actor,text:a.type==='deck.count'?'Updated a private Deck count':'Updated a private hand card',idempotencyKey:event.id};
    if(a.type==="side.swap") { next.action={type:"log.note",actorSeat:actor,text:"Updated a private side deck",idempotencyKey:event.id}; delete next.messages; }
    if(a.type==="effect.choose" && !effects?.publicEffectChoice) { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card choice",idempotencyKey:event.id}; delete next.messages; }
    if(a.type==="twin.place" && hidden(a.zone,a.card.faceUp)) { delete a.card.cardId; delete a.card.passcode; delete a.card.name; delete a.card.race; delete next.messages; }
    if(a.type==="card.identified" || a.type==="cards.identified") {
      const sightings=a.type==="card.identified" ? [a] : a.cards;
      const privateSight=effects?.privateRecognition ?? sightings.some(s=>s.zone==="hand" || s.zone==="deck" || s.zone==="extra");
      if(privateSight) { next.action={type:"log.note",actorSeat:actor,text:"Updated a private card",idempotencyKey:event.id}; delete next.messages; }
    }
  }
  return next;
}
/**
 * What a spectator may know. A player sees some cards because the table told that player (a searched card, a reveal, a
 * card once public and now Set). A spectator gets none of that, except the revealed / returned-to-hand cards (public table
 * knowledge, filtered like a player's view): no other hand contents, no face-down names, no notes, no undo or deck data.
 * Allow list for events: a new action type shows as a private line until it is added here.
 */
const SPECTATOR_EVENTS:ReadonlySet<string>=new Set(["table.created","table.configured","table.started","table.ended","idle.warning","admin.watching","seat.joined","seat.left","seat.ready","seat.deck",
  "phase.set","phase.advance","turn.end","lp.change","detection.mode","attack.declare","attack.resolve","player.concede","match.declare","match.confirm","match.continue","match.first","side.ready","side.unready","side.timeout",
  "hand.draw","hand.count","twin.place","twin.move","twin.flip","twin.remove","twin.attach","twin.detach","twin.equip","twin.control","pile.lift","pile.order","effect.activated"]);
const PUBLIC_ZONE=(card:{zone:string;faceUp?:boolean})=>card.faceUp!==false && !["hand","deck","extra"].includes(card.zone);
/** Twin refs can hold the card id ("c0-<id>-..."). A ref that is not of a card public now becomes a name with no meaning for one snapshot. */
function spectatorRefs(state:RemotePosition) {
  const open=new Set(state.seats.flatMap(seat=>seat.twin.filter(PUBLIC_ZONE).map(card=>card.ref))), names=new Map<string,string>();
  const hide=(ref:string)=>{
    if(open.has(ref)) return ref;
    if(!names.has(ref)) names.set(ref,`private-card-${names.size+1}`);
    return names.get(ref)!;
  };
  return {open,hide};
}
type SpectatorRefs=ReturnType<typeof spectatorRefs>;
/** Renames every field that holds a twin ref (ref, cardRef, materialRefs, materials, materialOf...), at any depth. */
function renameRefs(value:unknown,hide:(ref:string)=>string):void {
  if(Array.isArray(value)) { value.forEach(item=>renameRefs(item,hide)); return; }
  if(!value || typeof value!=="object") return;
  const object=value as Record<string,unknown>;
  for(const [key,item] of Object.entries(object)) {
    if(typeof item==="string" && (/ref$/i.test(key) || key==="materialOf")) object[key]=hide(item);
    else if(Array.isArray(item) && (/refs$/i.test(key) || key==="materials") && item.every(entry=>typeof entry==="string")) object[key]=item.map(entry=>hide(entry as string));
    else renameRefs(item,hide);
  }
}
const CARD_IDENTITY=["cardId","passcode","name","race","bestMatch","publicIdentity","setBy","zoneRule"] as const;
function spectatorPosition<T extends RemotePosition>(state:T,refs:SpectatorRefs):T {
  const next=structuredClone(withoutUndo(state as unknown as RemoteState)) as unknown as T;
  delete next.twinConfirmation; delete next.twinConfirmationQueue; delete next.effectTracking;
  next.deckChecks.registrations={}; next.deckChecks.flags=[]; next.deckChecks.instances=[];
  for(const seat of next.seats) {
    delete seat.deckCount;
    // Revealed and returned-to-hand cards are public table knowledge: same filter as for players.
    if(next.showCardsSetFromDeck===false)seat.knownHand=seat.knownHand?.filter(c=>c.source!=='deck'||c.publicIdentity);
    seat.twin=seat.twin.filter(card=>card.zone!=="hand" && card.zone!=="deck");
    for(const card of seat.twin) if(!PUBLIC_ZONE(card)) {
      delete card.cardId; delete card.passcode; delete card.name; delete card.race; delete card.bestMatch; delete card.publicIdentity; delete card.setBy;
    }
  }
  const shown=next.identified, on=shown?.cardRef ? next.seats[shown.seat]?.twin.find(card=>card.ref===shown.cardRef) : undefined;
  next.identified=shown && on && PUBLIC_ZONE(on) && !shown.private ? {seat:shown.seat,cardRef:shown.cardRef,cardId:shown.cardId,passcode:shown.passcode,zone:shown.zone,source:shown.source,name:shown.name,addErrors:[]} : null;
  return next;
}
function spectatorEvent(event:RemoteEvent,refs:SpectatorRefs):RemoteEvent {
  const projected=projectEvent(event,new Set());
  delete projected.messages;
  const a=projected.action;
  const actor=event.actorSeat ?? -1;
  if(!SPECTATOR_EVENTS.has(a.type)) return {...projected,action:{type:"log.note",actorSeat:actor,text:a.type==="undo" ? "Undid an action" : "Updated a private card",idempotencyKey:event.id}};
  if(a.type==="twin.flip" && !a.faceUp) { delete a.cardId; }
  if(a.type==="twin.place" && (a.zone==="hand" || a.zone==="deck")) return {...projected,action:{type:"log.note",actorSeat:actor,text:"Updated a private card",idempotencyKey:event.id}};
  // An old event must not name a card that is not public now: Set again, back in the hand or Deck, or removed.
  const subject=(a.type==="twin.place" ? a.card : a.type==="effect.activated" ? a.source : a) as unknown as Record<string,unknown>, subjectRef=a.type==="twin.place" ? a.card.ref : "cardRef" in subject ? subject.cardRef : undefined;
  if(typeof subjectRef==="string" && !refs.open.has(subjectRef)) {
    for(const key of CARD_IDENTITY) delete subject[key];
    delete (a as Record<string,unknown>).name; delete (a as Record<string,unknown>).zoneRule;
  }
  renameRefs(a,refs.hide);
  return projected;
}
/** The one view of a table that spectators get, from the HTTP route and from the socket. */
export function projectRemoteSpectator(snapshot:RemoteSnapshot):RemoteSnapshot {
  const refs=spectatorRefs(snapshot.state), state={...spectatorPosition(snapshot.state,refs),undo:null,undoHistory:[]};
  renameRefs(state,refs.hide);
  return {table:projectRemoteTable(snapshot.table),state,events:snapshot.events.map(event=>spectatorEvent(event,refs))};
}
export function projectRemoteSnapshot(snapshot:RemoteSnapshot,seats:ReadonlySet<number>=new Set()):RemoteSnapshot {
  return {table:projectRemoteTable(snapshot.table,seats),state:projectRemoteState(snapshot.state,seats),events:snapshot.events.map(e=>projectEvent(e,seats))};
}
