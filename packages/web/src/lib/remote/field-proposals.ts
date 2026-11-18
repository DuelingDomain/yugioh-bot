import {remoteActionError,type RoomMutation} from './room-mutations';
import {OutageGaveUpError,retryThroughOutage,SKIPPED} from './outage';
import type { RemoteActionProposal, RemoteEvent, RemoteSummonKind, TwinCard } from '@yugidraft/shared/remote';
import { fieldZoneLocation, type FieldEvent, type FieldTrack } from '@yugidraft/vision';
// A manual read may finish before the watcher's first identity read. Preserve
// its physical row even when card legality projects it into another virtual row.
const observedZones=new Map<string,FieldTrack['zone']>();
const observationKey=(slug:string,seat:number,ref:string)=>`${slug}:${seat}:${ref}`;
export function rememberFieldObservation(slug:string,seat:number,ref:string,zone:FieldTrack['zone']){
  observedZones.set(observationKey(slug,seat,ref),zone);
  while(observedZones.size>256)observedZones.delete(observedZones.keys().next().value!);
}
export const observedFieldZone=(slug:string,seat:number,ref:string)=>observedZones.get(observationKey(slug,seat,ref));
/** A manual read can identify the reader's current visual cue in place. */
export function fieldReadingPlaceholder(twins:readonly TwinCard[],zone:FieldTrack['zone']):TwinCard|undefined {
  if(['DECK','EXTRA','GY','BANISHED'].includes(zone))return;
  const location=fieldZoneLocation(zone);
  return twins.find(c=>c.ref.startsWith('fw-')&&c.faceUp&&!c.cardId&&!c.passcode&&!c.name&&c.zone===location.zone&&c.slot===location.slot);
}
/** Copy evidence must come from distinct, identified quads in the same frame. */
export function simultaneousFieldCopies(a:FieldTrack,b:FieldTrack,sameIdentity=a.cardId===b.cardId):boolean {
  if(a.id===b.id||!a.cardId||!b.cardId||!sameIdentity||!['identified','prompt'].includes(a.state)||b.state!=='identified'||!a.visible||!b.visible||a.removed||b.removed||a.faceDown||b.faceDown||a.card.kind!=='face-up'||b.card.kind!=='face-up'||a.lastSeen!==b.lastSeen)return false;
  return distinctFieldQuads(a.card.quad,b.card.quad);
}
export function distinctFieldQuads(a:readonly {x:number;y:number}[],b:readonly {x:number;y:number}[]):boolean {
  const box=(quad:readonly {x:number;y:number}[])=>({left:Math.min(...quad.map(p=>p.x)),right:Math.max(...quad.map(p=>p.x)),top:Math.min(...quad.map(p=>p.y)),bottom:Math.max(...quad.map(p=>p.y))});
  const x=box(a),y=box(b),area=Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
  return area/Math.min((x.right-x.left)*(x.bottom-x.top),(y.right-y.left)*(y.bottom-y.top))<.04;
}
/** Physical orientation never makes an illegal face-down Attack Position Set, and a pile card has no battle position (players lay banished cards sideways). */
export function fieldTwinPosition(track:Pick<FieldTrack,'faceDown'|'zone'|'position'>):FieldTrack['position'] {
  return /^(GY|BANISHED|DECK|EXTRA)$/.test(track.zone)?'attack':track.faceDown&&/^M[1-5]$|^EMZ[12]$/.test(track.zone)?'defense':track.faceDown&&/^S[1-5]$|^FIELD$/.test(track.zone)?'attack':track.position;
}
/** A pile card has no battle position (old rows and Synchro/Link materials can still hold `defense`): only a field card compares position. */
export const fieldPositionMatches=(zone:string,stored:string|undefined,wanted:string|undefined)=>/^(graveyard|banished|deck|extra)$/.test(zone)||stored===wanted;
/** A board card and its track may disagree on face this long, on still frames, before the board follows the track. */
export const FIELD_FACE_WAIT_MS=600;
/** A track that speaks for the face of its board card: settled on a field zone, on a box that rests on the mat now. A weak box counts; a front needs its read. */
export function fieldFaceWitness(track:FieldTrack,at:number):boolean {
  return track.state==='identified'&&!track.removed&&!track.under&&track.restSince!==undefined&&at-track.lastSeen<=1500&&/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(track.zone)&&(track.faceDown||!!track.cardId);
}
/** A flip down of an Xyz Monster sends its materials to the GY and a flip up does not bring them back: it needs a clear back. */
export const fieldStrongBack=(track:Partial<Pick<FieldTrack,'card'|'pixelsDown'>>)=>(track.card?.confidence??0)>=.4&&!!track.pixelsDown;
/**
 * One action turns the card over in place: never a removal, never the hand. A face-down flip keeps the name for the owner (the
 * server hides it from the opponent). A face-up flip needs the fresh read of the card. On a card already face-down, a back the
 * camera sees clears an old "Revealed" (never the public identity of a card Set by an effect). Undefined when there is nothing to do.
 */
export function fieldFaceProposal(card:Pick<TwinCard,'ref'|'zone'|'faceUp'|'materials'|'publicIdentity'|'setBy'|'ownerSeat'>,track:Pick<FieldTrack,'faceDown'|'position'|'bestMatch'>&Partial<Pick<FieldTrack,'card'|'pixelsDown'>>,seat:number,identity?:{cardId:number;name?:string}):Extract<RemoteActionProposal,{type:'twin.flip'}>|undefined {
  // A card another seat controls (a proxy) has no paper card here: the camera never turns it.
  if(card.ownerSeat!==undefined)return;
  const base={type:'twin.flip' as const,source:'auto' as const,actorSeat:seat,seat,cardRef:card.ref};
  if(track.faceDown){
    if(card.faceUp?card.materials?.length&&!fieldStrongBack(track):!card.publicIdentity||card.setBy)return;
    return {...base,faceUp:false,position:['monster','extra-monster'].includes(card.zone)?'defense':'attack'};
  }
  if(card.faceUp)return;
  return identity?{...base,faceUp:true,position:track.position,cardId:identity.cardId,name:identity.name,...(track.bestMatch?{bestMatch:true}:{})}:undefined;
}
/** A new placement records the sighting atomically, so one Undo removes both. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false,fromRef,copyProof,summon,nameCandidates}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean;nameCandidates?:TwinCard['nameCandidates']|null;fromRef?:string;copyProof?:{simultaneousQuads:number;at:number};summon?:{kind:RemoteSummonKind;materialRefs:string[]}}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  if(['DECK','EXTRA'].includes(track.zone))return [];
  if(existing)return faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',cardRef:track.id,...(nameCandidates!==undefined?{nameCandidates}:{}),bestMatch:!!track.bestMatch,...location}]:[];
  return [{type:'twin.place',source:'auto',...(fromRef?{fromRef}:{}),actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(nameCandidates?{nameCandidates}:{}),...(faceUp?{cardId,name,...(track.bestMatch?{bestMatch:true}:{})}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:fieldTwinPosition(track)},...(copyProof?{copyProof}:{}),...(summon?{summon}:{})}];
}

/** A clear lift leaves its public zone once, retaining the physical ref privately. */
export function fieldDepartureStillMissing(card:TwinCard,origin:Pick<TwinCard,'ref'|'zone'|'slot'>,tracks:readonly FieldTrack[]):boolean {
  return ['monster','extra-monster','spell-trap','field','pendulum'].includes(card.zone)&&card.ref===origin.ref&&card.zone===origin.zone&&card.slot===origin.slot&&
    !tracks.some(t=>t.id===card.ref&&t.visible&&!t.removed);
}
/** A fresh, unfinished field read may be the card just seen in the player's hand. */
export function heldFieldReadPending(tracks:readonly FieldTrack[],readAt:number):boolean {
  return tracks.some(t=>t.visible&&!t.removed&&/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(t.zone)&&t.firstSeen>=readAt-800&&
    t.state!=='dismissed'&&(!t.cardId||t.state==='candidate'));
}
/**
 * Where a card goes when the camera saw no pile: a card taken off the field is assumed to be in the hand (Dueling Domain owner rule).
 * An Extra Deck monster (Fusion, Synchro, Xyz, Link) cannot be in the hand: it goes to the Extra Deck, face-down (face-up when it is
 * a Pendulum Monster the camera lost face-up). A face-up Normal or Quick-Play Spell leaves the field for the GY by rule once it has
 * resolved, so it goes there. Otherwise GY or banished only when the camera sees the card arrive there (or the player says
 * so). A token has no hand (the server drops it).
 */
export function fieldDefaultDestination(card:Pick<TwinCard,'faceUp'>&Partial<Pick<TwinCard,'zone'>>,facts?:{type?:string|null;race?:string|null}):{zone:'hand'}|{zone:'graveyard'}|{zone:'extra';faceUp:boolean} {
  const type=facts?.type??'';
  if(card.faceUp&&card.zone==='spell-trap'&&/\bspell\b/i.test(type)&&/^(normal|quick-play)$/i.test(facts?.race??''))return {zone:'graveyard'};
  return /\b(fusion|synchro|xyz|link)\b/i.test(type)?{zone:'extra',faceUp:!!card.faceUp&&/\bpendulum\b/i.test(type)}:{zone:'hand'};
}
/** The destinations a player can pick for a card that left the field (the tag on the moved card). `down`: face-down. */
export const FIELD_LEAVE_DESTINATIONS=[{zone:'graveyard',title:'GY'},{zone:'banished',title:'Banish'},{zone:'banished',down:true,title:'Banish face-down'},{zone:'hand',title:'Hand'},{zone:'deck',title:'Deck'},{zone:'extra',title:'Extra Deck'}] as const;
export const fieldLeaveLabel=(zone:string,faceUp?:boolean)=>zone==='material'?'Under Xyz':FIELD_LEAVE_DESTINATIONS.find(d=>d.zone===zone&&(zone!=='banished'||(('down' in d)===(faceUp===false))))?.title??zone;
/** `destination`: a pile the camera showed, or a choice. Without one, the card is assumed in the hand (fieldDefaultDestination). A card in a pile that leaves it goes to the hand too. */
export function fieldDepartureProposal(card:TwinCard,seat:number,destination?:'deck'|'extra'|{zone:'graveyard'|'banished'|'extra';faceUp?:boolean},facts?:{type?:string|null;race?:string|null}):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  // A token and a card another seat controls have no paper card on this mat: the camera proposes nothing for them.
  if(card.token||card.ownerSeat!==undefined||!['monster','extra-monster','spell-trap','field','pendulum','graveyard','banished'].includes(card.zone))return;
  const pile=['graveyard','banished'].includes(card.zone);
  const to=typeof destination==='string'?{zone:destination}:destination??fieldDefaultDestination(card,facts);
  // Back to the Deck/Extra, or a pile card that leaves its pile, turns face-down. The GY is public, so a card sent there (even a
  // face-down one) is face-up; banished is face-up unless the choice or the camera says face-down.
  const faceUp:boolean|undefined='faceUp' in to&&to.faceUp!==undefined?to.faceUp:pile||typeof destination==='string'?false:to.zone==='graveyard'||to.zone==='banished'?true:undefined;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:to.zone,...(faceUp!==undefined?{faceUp}:{}),...(to.zone==='extra'&&faceUp===true?{pendulum:true}:{}),...(destination!==undefined?{confirmed:true}:{}),source:'auto',...(card.faceUp&&card.name?{name:card.name}:{}),...(card.position==='defense'?{position:'attack' as const}:{})};
}

/**
 * Camera evidence for a card that left the field: a pile card the camera placed within a second before the removal (or after it)
 * and has not named (an unread face-up top, or a face-down card on the banished pile). Exactly one such pile card is evidence; two
 * mean the camera cannot tell them apart. The caller decides which departed card it is (one waiting card: that one; more: the
 * player is asked). An identity read goes the usual way (the pile track finds the departed card by its name).
 */
export function fieldPileEvidence({twins,tracks,lastSeen,owns}:{twins:readonly TwinCard[];tracks:readonly FieldTrack[];lastSeen:number;owns:(track:FieldTrack)=>string}):{twin:TwinCard;zone:'graveyard'|'banished';faceUp:boolean}|undefined {
  const found=twins.filter(c=>['graveyard','banished'].includes(c.zone)&&c.ref.startsWith('fw-')&&!c.cardId&&!c.passcode&&!c.name&&(c.zone==='banished'||c.faceUp)).filter(c=>
    tracks.some(t=>owns(t)===c.ref&&t.zone===(c.zone==='banished'?'BANISHED':'GY')&&t.visible&&!t.removed&&t.firstSeen>=lastSeen-1000));
  return found.length===1?{twin:found[0],zone:found[0].zone as 'graveyard'|'banished',faceUp:found[0].faceUp}:undefined;
}

/**
 * The same evidence before the reader has named the pile card (a slow reader names it a second or more after it settles, and the
 * board has no stand-in for it yet): one resting pile track that first showed up around the removal, with no board card of its own.
 * Not with an unnamed stand-in of the same kind around (fieldPileEvidence decides that case) or two such tracks: then the camera cannot say.
 */
export function fieldPileTrackEvidence({twins,tracks,lastSeen,owns,cardId}:{twins:readonly TwinCard[];tracks:readonly FieldTrack[];lastSeen:number;owns:(track:FieldTrack)=>string;/** The leaving card's camera id: a pile track the reader already named as another card is that card's. */cardId?:string}):{track:FieldTrack;zone:'graveyard'|'banished';faceUp:boolean}|undefined {
  const recent=tracks.filter(t=>/^(GY|BANISHED)$/.test(t.zone)&&!t.removed&&t.state!=='dismissed'&&t.firstSeen>=lastSeen-1000&&(t.zone==='BANISHED'||!t.faceDown)&&(!t.cardId||t.cardId===cardId));
  const standIn=(t:FieldTrack)=>twins.some(c=>c.ref===owns(t)&&['graveyard','banished'].includes(c.zone)&&!c.cardId&&!c.passcode&&!c.name);
  if(recent.some(standIn))return;
  // A resting box only: a hand hovering over the pile is not a card that arrived.
  const found=recent.filter(t=>t.restSince!==undefined&&!twins.some(c=>c.ref===owns(t)));
  return found.length===1?{track:found[0],zone:found[0].zone==='BANISHED'?'banished':'graveyard',faceUp:!found[0].faceDown}:undefined;
}

/** An identified track that was seen this recently still has evidence when a slow tick set `visible` false. */
const VISIBLE_GRACE_MS=1000;
/** The first reason queued evidence no longer fits the live track (undefined: it fits). For the "identification deferred" log. */
export function fieldEvidenceMismatch(event:FieldEvent,current:FieldTrack|undefined,humanChoice=false):string|undefined {
  const human=humanChoice&&event.type==='prompt';
  if(!current)return 'no track';
  if(current.removed)return 'removed';
  const age=performance.now()-current.lastSeen;
  // A slow tick can leave `visible` false for a moment on a card that rests there: an identified track seen within ~1 s still counts, but only while it still rests in the same zone (`restSince` is absent while the card moves or a hand is on it) or lies under another card.
  const seen=event.type==='reading'||!!current.visible||!human&&current.state==='identified'&&age>=0&&age<=VISIBLE_GRACE_MS&&current.zone===event.track.zone&&(current.restSince!==undefined||!!current.under);
  if(human?!(age>=0&&age<=1500):!seen)return human?`not seen for ${Math.round(age)} ms`:`not visible (last seen ${Math.round(age)} ms ago)`;
  if((current.revision??0)!==(event.track.revision??0))return `revision ${current.revision??0} is not ${event.track.revision??0}`;
  if(current.faceDown!==event.track.faceDown)return 'face changed';
  if(event.type==='reading'?current.state!=='candidate':event.type==='prompt'?current.state!=='prompt':current.state!=='identified'||current.cardId!==event.track.cardId)return `state ${current.state}${current.cardId!==event.track.cardId?` name ${current.cardId??'none'} is not ${event.track.cardId??'none'}`:''}`;
  return undefined;
}
/** Queue delays must not attach an old read to replacement pixels. */
export const fieldEvidenceMatches=(event:FieldEvent,current:FieldTrack|undefined,humanChoice=false)=>fieldEvidenceMismatch(event,current,humanChoice)===undefined;

export class StaleFieldPlacementError extends Error {
  constructor(readonly placement:Extract<RemoteActionProposal,{type:'twin.place'}>){super('The card changed during save. Remove the stale placement to continue.');}
}
/** A card may change during HTTP, after the preflight evidence check. */
export async function applyVerifiedFieldMutation(event:FieldEvent,current:()=>FieldTrack|undefined,act:RoomMutation,proposal:RemoteActionProposal,humanChoice=false) {
  if(!fieldEvidenceMatches(event,current(),humanChoice))return null;
  const actionId=crypto.randomUUID();
  const updated=await act(proposal,actionId);
  if(!updated)return null;
  // An explicit recent choice owns the identity even if the next frame is bad.
  if(humanChoice&&event.type==='prompt')return updated;
  if(!fieldEvidenceMatches(event,current())){
    if(proposal.type==='card.identified'||proposal.type==='twin.place'||proposal.type==='twin.flip'&&proposal.faceUp&&proposal.cardId!==undefined){
      let undone=false;try{if(updated.state.undo?.actionId===actionId)undone=!!await act({type:'undo',actorSeat:proposal.actorSeat,targetActionId:updated.state.undo.actionId});}catch{/* Explicit recovery also covers a failed refresh/network. */}
      if(!undone){if(proposal.type==='twin.place')throw new StaleFieldPlacementError(proposal);throw new Error('The card changed during reveal. Undo the reveal before continuing.');}
    }
    return null;
  }
  return updated;
}

/** The face check's write: the track must be the same before and after it. A reveal whose card changed during the save is undone, like any stale reveal, and so is a flip down that sent materials to the GY. */
export async function applyFieldFaceFlip(track:FieldTrack,current:()=>FieldTrack|undefined,act:RoomMutation,proposal:Extract<RemoteActionProposal,{type:'twin.flip'}>,hadMaterials=false) {
  const same=()=>{const now=current();return !!now&&!now.removed&&now.state===track.state&&(now.revision??0)===(track.revision??0)&&now.faceDown===track.faceDown&&now.cardId===track.cardId;};
  if(!same())return null;
  const actionId=crypto.randomUUID(),updated=await act(proposal,actionId);
  if(!updated||same())return updated;
  if(proposal.faceUp&&proposal.cardId!==undefined||!proposal.faceUp&&hadMaterials){
    let undone=false;try{if(updated.state.undo?.actionId===actionId)undone=!!await act({type:'undo',actorSeat:proposal.actorSeat,targetActionId:actionId});}catch{/* The caller reports it. */}
    if(!undone)throw new Error(proposal.faceUp?'The card changed during reveal. Undo the reveal before continuing.':'The card changed during the flip. Undo the flip before continuing.');
  }
  return null;
}

/** How long after a card left a cell its Set back can still be placed (the placement can wait on the reader); the back itself must show at once, see FIELD_SET_SEEN_MS. */
export const FIELD_LEFT_SET_MS=15_000;
/** The back must be first seen within this long of the card leaving (the departure write, about 0.8 s after the track is removed): a later back is another card put there. */
export const FIELD_SET_SEEN_MS=3000;
/**
 * A face-down back that settles where a card just left may be that card turned over or slid to another zone.
 *  - flip: the cell still holds a known face-up card whose track was removed and no departure was written yet (the board turns it over in place);
 *  - return: that card already went to the hand (an auto departure from this same cell); it comes back Set;
 *  - move: exactly one UNNAMED Set card left another zone of the row, exactly this one new Set settles in a free zone of it: the same card moved.
 * Nothing applies when a GY/banished pile track or a hand over a pile is newer than the card's last sighting (the card really went to a pile),
 * when the back was first seen more than FIELD_SET_SEEN_MS after the departure, or when the hand changed size since (return and move).
 * Any other reading (two candidates, a manual move, an occupied cell) is undefined: the caller places a new Set as before.
 */
export function fieldSetReturn({track,twins,tracks,owns,events,seat,at,now,pileTouched}:{track:Pick<FieldTrack,'id'|'zone'|'faceDown'|'firstSeen'>;twins:readonly TwinCard[];tracks:readonly FieldTrack[];owns:(track:FieldTrack)=>string;events:readonly Pick<RemoteEvent,'at'|'action'>[];seat:number;/** Server clock. */at:number;/** The camera clock of the track times. */now:number;/** When a hand was last over each pile (camera clock). */pileTouched?:Partial<Record<'GY'|'BANISHED',number>>}):{kind:'flip'|'return'|'move';card:TwinCard}|undefined {
  if(!track.faceDown||!/^(M[1-5]|S[1-5])$/.test(track.zone))return;
  const cell=fieldZoneLocation(track.zone),backAt=at-(now-track.firstSeen);
  const there=(c:Pick<TwinCard,'zone'|'slot'>)=>c.zone===cell.zone&&(c.slot??0)===(cell.slot??0);
  const toPile=(since:number)=>tracks.some(t=>/^(GY|BANISHED)$/.test(t.zone)&&t.firstSeen>=since)||[pileTouched?.GY,pileTouched?.BANISHED].some(touched=>touched!==undefined&&touched>=since);
  const occupant=twins.find(there);
  if(occupant){
    if(!occupant.faceUp||occupant.token||occupant.ownerSeat!==undefined||occupant.materials?.length||!(occupant.cardId||occupant.passcode))return;
    const seen=tracks.filter(t=>owns(t)===occupant.ref);
    // A hidden but not removed track is a card under an arm: it has not gone.
    if(!seen.length||seen.some(t=>!t.removed))return;
    const lastSeen=Math.max(...seen.map(t=>t.lastSeen));
    return now-lastSeen<=FIELD_LEFT_SET_MS&&track.firstSeen>=lastSeen-1000&&track.firstSeen<=lastSeen+FIELD_SET_SEEN_MS+2000&&!toPile(lastSeen-1000)?{kind:'flip',card:occupant}:undefined;
  }
  // A card the camera lifted to the hand, newest first. A manual move has no `auto` mark and never counts.
  const left=twins.filter(c=>c.zone==='hand'&&c.ownerSeat===undefined&&c.departedFrom?.auto&&c.departedFrom.at!==undefined&&at-c.departedFrom.at<=FIELD_LEFT_SET_MS&&backAt>=c.departedFrom.at-1500&&backAt<=c.departedFrom.at+FIELD_SET_SEEN_MS).sort((a,b)=>b.departedFrom!.at!-a.departedFrom!.at!);
  const gone=(c:TwinCard)=>{const seen=tracks.filter(t=>owns(t)===c.ref);return toPile((seen.length?Math.max(...seen.map(t=>t.lastSeen)):now-(at-c.departedFrom!.at!))-1000);};
  const sized=(c:TwinCard)=>events.some(e=>e.at>=c.departedFrom!.at!&&(e.action.type==='hand.draw'||e.action.type==='hand.count'||e.action.type==='hand.add'||e.action.type==='twin.move'&&e.action.zone==='hand'&&e.action.cardRef!==c.ref)&&('seat' in e.action?e.action.seat:e.action.actorSeat)===seat);
  const back=left.find(c=>there(c.departedFrom!));
  if(back)return gone(back)||sized(back)?undefined:{kind:'return',card:back};
  // Moved to another zone: one unnamed Set left, one new Set arrived, and the hand did not change size.
  const row=cell.zone,sets=left.filter(c=>!c.faceUp&&c.departedFrom!.zone===row);
  if(sets.length!==1||left.some(c=>c!==sets[0]&&c.departedFrom!.zone===row&&!c.faceUp))return;
  const card=sets[0],departure=card.departedFrom!;
  if(card.cardId||card.passcode||card.name)return;
  if(twins.some(c=>c.zone===departure.zone&&(c.slot??0)===(departure.slot??0)))return;
  const arrivals=tracks.filter(t=>t.faceDown&&!t.removed&&t.visible&&/^(M[1-5]|S[1-5])$/.test(t.zone)&&fieldZoneLocation(t.zone).zone===row&&!twins.some(c=>c.ref===owns(t)));
  if(arrivals.length!==1||arrivals[0].id!==track.id)return;
  return gone(card)||sized(card)?undefined:{kind:'move',card};
}

/** A virtual occupant without a current physical witness cannot reserve a slot. */
export function staleFieldOccupant(twins:readonly TwinCard[],tracks:readonly FieldTrack[],zone:FieldTrack['zone'],incomingRef:string,at=Math.max(-Infinity,...tracks.map(track=>track.lastSeen).filter(Number.isFinite))):TwinCard|undefined {
  const location=fieldZoneLocation(zone);
  if(!['monster','extra-monster','spell-trap','field'].includes(location.zone))return;
  // A token has no physical card, so it is never stale: only the player removes it.
  return twins.find(card=>!card.token&&card.ref!==incomingRef&&card.zone===location.zone&&card.slot===location.slot&&
    !tracks.some(track=>track.id===card.ref&&!track.removed&&(track.visible||track.lastSeen>=at)));
}

/**
 * Retry the same operation after the room controller refreshes its sequence.
 * A lost connection (a server restart) is not a refusal: the write waits and tries again with the SAME key and valid() checked before
 * each try (see retryThroughOutage), with no error text; `quiet` background work gives up at once and is tried again by its own cycle.
 */
export async function retryFieldMutation(act:RoomMutation,proposal:RemoteActionProposal,id:string,valid:()=>boolean,failed:(error:unknown)=>void,options:{quiet?:boolean}={}) {
  // A stale sequence refreshes the room between attempts; a busy table can need
  // more than one refresh. The same idempotency key keeps the write single.
  const attempts=3;let reason='';
  for(let attempt=0;attempt<attempts;attempt++){
    if(!valid())return null;
    const before=remoteActionError()?.at;
    let updated:Awaited<ReturnType<RoomMutation>>=null;
    try{
      const sent=await retryThroughOutage(()=>act(proposal,id),{valid,patient:!options.quiet});
      if(sent===SKIPPED)return null;
      updated=sent;
    }catch(error){
      if(error instanceof OutageGaveUpError){
        if(options.quiet)throw error;
        throw new Error(`Could not save the field update (${proposal.type}: no connection). Use Retry field update.`);
      }
      failed(error);reason=error instanceof Error?error.message:String(error);if(attempt===attempts-1)throw error;
    }
    if(updated)return updated;
    const server=remoteActionError();if(server&&server.at!==before)reason=server.message;
    failed(new Error(`Could not save ${proposal.type}${reason?`: ${reason}`:''}. Retrying the field update.`));
    if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
  }
  throw new Error(`Could not save the field update (${proposal.type}${reason?`: ${reason}`:''}). Use Retry field update.`);
}

/**
 * Xyz Monsters a card that just left the field can go under (the "Attach to" tag): every face-up Xyz Monster on the field, either side.
 * Those whose text attaches cards (the attach_material vocabulary verb; the same word rule as the effect search) come first.
 */
export function xyzAttachTargets(seats:readonly {seat:number;twin:readonly TwinCard[]}[],facts:(card:TwinCard)=>{type?:string;effectText?:string}|undefined,exclude?:string):{seat:number;ref:string;name:string;hint:boolean}[] {
  const found=seats.flatMap(({seat,twin})=>twin.filter(c=>c.ref!==exclude&&c.faceUp&&['monster','extra-monster'].includes(c.zone)&&!c.token&&/\bxyz\b/i.test(facts(c)?.type??'')).map(c=>({seat,ref:c.ref,name:c.name??facts(c)?.type??'Xyz Monster',hint:/\battach\w*/i.test(facts(c)?.effectText??'')})));
  return found.sort((a,b)=>Number(b.hint)-Number(a.hint));
}
