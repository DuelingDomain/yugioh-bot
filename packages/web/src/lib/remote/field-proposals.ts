import {remoteActionError,type RoomMutation} from './room-mutations';
import {OutageGaveUpError,retryThroughOutage,SKIPPED} from './outage';
import {RemoteDuelError,REMOTE_TWIN_MOVE_WINDOW_MS,type RemoteActionProposal,type RemoteEvent,type RemoteSummonKind,type TwinCard} from '@yugidraft/shared/remote';
import { FIELD_SET_RETURN_MS,fieldZoneLocation, type FieldEvent, type FieldSnapshot, type FieldTrack } from '@yugidraft/vision';
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
/** Optional evidence from the cell watcher, on the same clock as track samples. */
export type FieldCellEvidence={basis?:'zoom'|'pixel';settledAt?:number;emptyProofAt?:number;destinationHint?:'GY'|'BANISHED'|'DECK'|'EXTRA'};
export const fieldCellEvidence=(event:FieldEvent)=>(event as FieldEvent&{evidence?:FieldCellEvidence}).evidence;
export const fieldEmptyProofs=(snap:FieldSnapshot|undefined)=>(snap as (FieldSnapshot&{emptyProofAt?:Partial<Record<FieldTrack['zone'],number>>})|undefined)?.emptyProofAt;
/** A track that speaks for the face of its board card: settled on a field zone, on a box that rests on the mat now. A weak box counts; a front needs its read. */
export function fieldFaceWitness(track:FieldTrack,at:number):boolean {
  return track.state==='identified'&&!track.removed&&!track.under&&track.restSince!==undefined&&at-track.lastSeen<=1500&&/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(track.zone)&&(track.faceDown||!!track.cardId);
}
/** A flip down of an Xyz Monster sends its materials to the GY and a flip up does not bring them back: it needs a clear back. */
export const fieldStrongBack=(track:Partial<Pick<FieldTrack,'card'|'pixelsDown'>>)=>(track.card?.confidence??0)>=.4&&!!track.pixelsDown;
/**
 * A tracked in-place flip keeps public knowledge. For an already face-down card, a back can clear an old "Revealed",
 * while only an untracked scan back clears "Set (known)". Cards Set by an effect keep their public identity here.
 */
export function fieldFaceProposal(card:Pick<TwinCard,'ref'|'zone'|'faceUp'|'materials'|'publicIdentity'|'knownFaceDown'|'setBy'|'ownerSeat'>,track:Pick<FieldTrack,'faceDown'|'position'|'bestMatch'>&Partial<Pick<FieldTrack,'card'|'pixelsDown'>>&{identityUncertain?:true},seat:number,identity?:{cardId:number;name?:string}):Extract<RemoteActionProposal,{type:'twin.flip'}>|undefined {
  // A card another seat controls (a proxy) has no paper card here: the camera never turns it.
  if(card.ownerSeat!==undefined)return;
  const base={type:'twin.flip' as const,source:'auto' as const,actorSeat:seat,seat,cardRef:card.ref};
  if(track.faceDown){
    if(card.faceUp ? card.materials?.length&&!fieldStrongBack(track) : !card.publicIdentity||card.setBy||card.knownFaceDown&&!track.identityUncertain)return;
    return {...base,faceUp:false,position:['monster','extra-monster'].includes(card.zone)?'defense':'attack',
      ...(!card.faceUp||track.identityUncertain ? {identityUncertain:true} : {})};
  }
  if(card.faceUp)return;
  return identity?{...base,faceUp:true,position:track.position,cardId:identity.cardId,name:identity.name,...(track.bestMatch?{bestMatch:true}:{})}:undefined;
}
type FieldSetMove = Extract<RemoteActionProposal, {type:'twin.move'}> & {faceUp:false};
/** Report a change of zone and face together so the reducer can distinguish it from an in-place flip. */
export function fieldSetMove(card: Pick<TwinCard, 'ref'|'zone'|'slot'> & Partial<Pick<TwinCard, 'ownerSeat'>>, track: Pick<FieldTrack, 'zone'|'faceDown'|'position'>, seat: number, physicalZoneChanged = false): FieldSetMove | undefined {
  const location = fieldZoneLocation(track.zone);
  const sameSlot = card.zone === location.zone && card.slot === location.slot;
  // A card another seat controls (a proxy) has no paper card here: the camera never moves it.
  if (card.ownerSeat !== undefined || !track.faceDown || sameSlot && !physicalZoneChanged) return;
  return {type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...location,position:fieldTwinPosition(track),faceUp:false,
    ...(sameSlot && physicalZoneChanged ? {physicalZoneChanged:true} : {})};
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

/** A card that left the field while a hand worked a pile, with no sign of it elsewhere, is in that pile (GY unless only the banished pile moved), not in the hand. Several cards of one carry all go there. */
export function fieldPileDepartureProposal(proposal:Extract<RemoteActionProposal,{type:'twin.move'}>,pile:'GY'|'BANISHED'):Extract<RemoteActionProposal,{type:'twin.move'}> {
  return proposal.zone==='hand'?{...proposal,zone:pile==='GY'?'graveyard':'banished',faceUp:true}:proposal;
}

/** The pile order (oldest first) that puts a card with no evidence directly under the camera's named top card, or undefined when it already lies there or lower. */
export function fieldPileUnderTop(order:readonly string[],cardRef:string,topRef:string):string[]|undefined {
  if(cardRef===topRef||order.indexOf(topRef)<0||order.indexOf(cardRef)<order.indexOf(topRef))return;
  const rest=order.filter(r=>r!==cardRef);rest.splice(rest.indexOf(topRef),0,cardRef);return rest;
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
export function fieldPileTrackEvidence({twins,tracks,lastSeen,owns,cardId,pileContactAt}:{twins:readonly TwinCard[];tracks:readonly FieldTrack[];lastSeen:number;owns:(track:FieldTrack)=>string;/** The leaving card's camera id: a pile track the reader already named as another card is that card's. */cardId?:string;pileContactAt?:FieldSnapshot['pileContactAt']}):{track:FieldTrack;zone:'graveyard'|'banished';faceUp:boolean}|undefined {
  const recent=tracks.filter(t=>/^(GY|BANISHED)$/.test(t.zone)&&!t.removed&&!t.under&&t.state!=='dismissed'&&
    t.firstSeen>=lastSeen-1000&&!t.card.partial&&!t.card.covered&&(t.zone==='BANISHED'||!t.faceDown)&&(!t.cardId||t.cardId===cardId));
  const standIn=(t:FieldTrack)=>twins.some(c=>c.ref===owns(t)&&['graveyard','banished'].includes(c.zone)&&!c.cardId&&!c.passcode&&!c.name);
  if(recent.some(standIn))return;
  const found=recent.filter(t=>{
    if(t.restSince===undefined||twins.some(c=>c.ref===owns(t)))return false;
    const zone=t.zone==='GY'?'graveyard':'banished';
    const top=twins.filter(c=>c.zone===zone).at(-1);
    // The tracker can withhold visibility while reading a changed top. The old
    // bound outline must have just been replaced, with contact ending before rest.
    const contact=pileContactAt?.[t.zone as 'GY'|'BANISHED'];
    const replaced=top&&tracks.some(old=>owns(old)===top.ref&&old.zone===t.zone&&old.removed&&old.lastSeen>=t.firstSeen-1000);
    const settledReplacement=replaced&&t.state==='candidate'&&contact!==undefined&&contact>=lastSeen&&contact<=t.restSince;
    // A new outline can inherit its rest from a populated pile.
    return (t.restSince>=lastSeen-1000||!!top)&&(t.visible||settledReplacement);
  });
  return found.length===1?{track:found[0],zone:found[0].zone==='BANISHED'?'banished':'graveyard',faceUp:!found[0].faceDown}:undefined;
}

const committedSet=(track:Pick<FieldTrack,'faceDown'|'setEvidence'>)=>track.faceDown===true&&track.setEvidence?.decision==='committed';
export function recentCommittedSet(track:FieldTrack,at=performance.now()):boolean {
  const age=at-track.lastSeen;
  return track.state==='identified'&&!track.removed&&committedSet(track)&&age>=0&&age<=3000;
}
export const fieldSetRebind=(event:FieldEvent)=>event.track.faceDown&&(event.type==='flipped'||event.type==='moved');

/** A named, settled front with an unflagged catalog read. */
export function fieldSureSetRead(track:FieldTrack,result:FieldEvent['result']):boolean {
  const top=result?.candidates[0];
  return !!track.visible&&!track.under&&!track.faceDown&&track.restSince!==undefined&&
    !track.card?.partial&&!track.card?.covered&&!track.nameCandidates?.length&&
    result?.tier==='sure'&&!!top&&top.cardId===track.cardId&&top.score>=.84&&
    !result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown;
}

/** A sure, settled read can reveal its bound Set through the atomic placement path. */
export function fieldSureSetReveal(event:FieldEvent,track:FieldTrack,card:Pick<TwinCard,'ref'|'zone'|'slot'|'faceUp'|'ownerSeat'>):boolean {
  const location=fieldZoneLocation(track.zone);
  return event.type==='placed'&&event.track.zone===track.zone&&card.ref===track.id&&!card.faceUp&&card.ownerSeat===undefined&&
    card.zone===location.zone&&card.slot===location.slot&&fieldSureSetRead(track,event.result);
}

/** An identified track that was seen this recently still has evidence when a slow tick set `visible` false. */
const VISIBLE_GRACE_MS=1000;
/** The first reason queued evidence no longer fits the live track (undefined: it fits). For the "identification deferred" log. */
export function fieldEvidenceMismatch(event:FieldEvent,current:FieldTrack|undefined,humanChoice=false,returningSet=false):string|undefined {
  const human=humanChoice&&event.type==='prompt';
  if(!current)return 'no track';
  if(current.removed)return 'removed';
  const at=performance.now(),age=at-current.lastSeen;
  // A slow tick can leave `visible` false for a moment on a card that rests there: an identified track seen within ~1 s still counts, but only for a card covered by another card in the same zone (`under`): a card that moves, has a hand on it or was swapped never counts.
  const seen=returningSet?fieldSetRebind(event)&&committedSet(event.track)&&committedSet(current)&&current.zone===event.track.zone:
    human?age>=0&&age<=1500:event.type==='reading'||!!current.visible||recentCommittedSet(current,at)||
      current.state==='identified'&&age>=0&&age<=VISIBLE_GRACE_MS&&current.zone===event.track.zone&&!!current.under;
  if(!seen)return human?`not seen for ${Math.round(age)} ms`:`not visible (last seen ${Math.round(age)} ms ago)`;
  if((current.revision??0)!==(event.track.revision??0))return `revision ${current.revision??0} is not ${event.track.revision??0}`;
  if(current.faceDown!==event.track.faceDown)return 'face changed';
  // Glare choices can appear while the automatic reader is still working.
  if(human&&event.track.glare)return current.glare&&!current.cardId&&current.zone===event.track.zone&&current.position===event.track.position?undefined:'glare choice expired';
  if(event.type==='reading'?current.state!=='candidate':event.type==='prompt'?current.state!=='prompt':current.state!=='identified'||current.cardId!==event.track.cardId)return `state ${current.state}${current.cardId!==event.track.cardId?` name ${current.cardId??'none'} is not ${event.track.cardId??'none'}`:''}`;
  return undefined;
}
/** Queue delays must not attach an old read to replacement pixels. */
export const fieldEvidenceMatches=(event:FieldEvent,current:FieldTrack|undefined,humanChoice=false,returningSet=false)=>fieldEvidenceMismatch(event,current,humanChoice,returningSet)===undefined;

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
export async function applyFieldFaceFlip(track:FieldTrack,current:()=>FieldTrack|undefined,act:RoomMutation,proposal:Extract<RemoteActionProposal,{type:'twin.flip'}>|FieldSetMove,hadMaterials=false) {
  const same=()=>{const now=current();return !!now&&!now.removed&&now.state===track.state&&now.zone===track.zone&&(now.revision??0)===(track.revision??0)&&now.faceDown===track.faceDown&&now.cardId===track.cardId;};
  if(!same())return null;
  const actionId=crypto.randomUUID(),updated=await act(proposal,actionId);
  if(!updated||same())return updated;
  if(proposal.type==='twin.flip'&&proposal.faceUp&&proposal.cardId!==undefined||!proposal.faceUp&&hadMaterials){
    let undone=false;try{if(updated.state.undo?.actionId===actionId)undone=!!await act({type:'undo',actorSeat:proposal.actorSeat,targetActionId:actionId});}catch{/* The caller reports it. */}
    if(!undone)throw new Error(proposal.faceUp?'The card changed during reveal. Undo the reveal before continuing.':'The card changed during the flip. Undo the flip before continuing.');
  }
  return null;
}

const MAIN_FIELD_SLOT=/^[MS][1-5]$/;
type RemovedFieldTrack=FieldTrack&{removedAt:number};
export const FIELD_SET_SLIDE_MS=1800;
export const FIELD_FLIP_SETTLE_MS=2000;
const FIELD_DEPARTURE_MAX_MS=6000;
const SET_SLIDE_MATCH_MS=3000;

const fieldActivityRow=(zone:string)=>zone==='FIELD'?'M':zone.replace(/\d$/,'');

/** The window starts after activity in the source row. Pile work has a separate cap. */
export function fieldDepartureActivityAt(zone:FieldTrack['zone'],snap:FieldSnapshot|undefined):number {
  const row=fieldActivityRow(zone);
  let activityAt=-Infinity;
  for(const [cell,at] of Object.entries(snap?.lastFieldActivityAtByZone??{})){
    if(fieldActivityRow(cell)===row)activityAt=Math.max(activityAt,at);
  }
  return activityAt;
}

/** Give the action time to finish, with a fixed limit for continuous motion. */
export function fieldDepartureDeadline(event:FieldEvent,removedAt:number,activityAt=-Infinity,settleMs=FIELD_FLIP_SETTLE_MS):number {
  const firstMiss=Math.min(event.track.removedFrameAt??removedAt,removedAt);
  return Math.min(firstMiss+FIELD_DEPARTURE_MAX_MS,Math.max(firstMiss,activityAt)+settleMs);
}

/** A confirmed Set can wait for slide evidence up to the departure deadline. */
export function fieldSetSlideDeadline(event:FieldEvent,removedAt:number,otherSleeve=false,activityAt?:number):number {
  const firstMiss=Math.min(event.track.removedFrameAt??removedAt,removedAt);
  const settled=committedSet(event.track);
  const deadline=fieldDepartureDeadline(event,removedAt,activityAt,settled||otherSleeve?FIELD_FLIP_SETTLE_MS:FIELD_SET_SLIDE_MS);
  return settled?Math.max(deadline,firstMiss+SET_SLIDE_MATCH_MS):deadline;
}

/** A still-observed pile top can disprove a touch while the hand sweeps past it. */
export function fieldSetSlidePileActivity(snap:FieldSnapshot|undefined):Record<'GY'|'BANISHED',number> {
  const activity={GY:-Infinity,BANISHED:-Infinity};
  for(const zone of ['GY','BANISHED'] as const){
    const touched=snap?.pileTouchedAt?.[zone]??-Infinity,contact=snap?.pileContactAt?.[zone]??-Infinity;
    activity[zone]=Math.max(touched,contact);
    if(!snap||!snap.pileContactAt||snap.missingPiles?.includes(zone)||snap.pileClearSince?.[zone]!==undefined)continue;
    const top=snap.tracks.find(t=>t.zone===zone&&!t.removed&&t.firstSeen<=touched);
    if(!top)continue;
    const lastActivity=Math.max(touched,contact);
    const unchanged=top.state==='identified'&&top.visible&&top.restSince!==undefined&&
      top.restSince<=lastActivity&&top.lastSeen>lastActivity;
    activity[zone]=unchanged?-Infinity:contact;
  }
  return activity;
}

export const fieldBackCandidate=(track:FieldTrack)=>!track.removed&&track.state!=='dismissed'&&
  (track.faceDown||track.state==='candidate'&&track.card.kind==='face-down')&&!track.card.partial&&!track.card.covered;

/** A new back or sleeve can keep a departure pending until the source is proven empty. */
export function fieldDepartureHasBack(event:FieldEvent,snap:FieldSnapshot|undefined):boolean {
  if(!snap||fieldCellEvidence(event)?.emptyProofAt!==undefined)return false;
  const {id,zone,lastSeen,removedFrameAt}=event.track;
  const since=removedFrameAt??event.removedAt??lastSeen;
  const sleeve=snap.blindZones?.includes(zone)&&(snap.blindSleeveAt?.[zone]??-Infinity)>=since;
  return !!sleeve||snap.tracks.some(t=>t.id!==id&&t.zone===zone&&t.firstSeen>=lastSeen-1000&&fieldBackCandidate(t));
}

/** Time left for a zoom check or a pending back to settle in the vacated slot. */
export function fieldFlipDepartureWait(event:FieldEvent,snap:FieldSnapshot|undefined,removedAt:number,now:number,faceUp=!event.track.faceDown):number {
  const {id,zone,lastSeen,removedFrameAt}=event.track;
  const left=fieldDepartureDeadline(event,removedAt,fieldDepartureActivityAt(zone,snap))-now;
  if(left<=0||!snap||!MAIN_FIELD_SLOT.test(zone))return 0;
  const looked=(snap.zoomCheckedAt?.[zone]??-Infinity)>removedAt;
  const fullAt=snap.lastFullAt,blind=snap.blindZones?.includes(zone);
  // Pixel-only removal can prove the cell clear between full scans.
  const hand=!looked&&snap.handZones?.includes(zone)&&
    (event.reason!=='empty'||(fullAt??-Infinity)>(removedFrameAt??removedAt));
  const replacements=snap.tracks.filter(t=>t.id!==id&&!t.removed&&t.zone===zone);
  const freshBack=replacements.some(t=>fieldBackCandidate(t)&&t.firstSeen>=lastSeen-1000||
    t.card.kind==='face-down'&&t.state==='identified'&&!t.card.partial&&!t.card.covered&&t.lastSeen>=Math.max(removedAt,fullAt??-Infinity));
  const occupied=blind||hand||replacements.length>0;
  if(freshBack||(snap.blindSleeveAt?.[zone]??-Infinity)>=removedAt)return left;
  const emptyAtRemoval=faceUp&&!occupied&&(event.reason==='empty'||zone.startsWith('M')&&
    removedFrameAt!==undefined&&fullAt!==undefined&&fullAt>=removedFrameAt);
  if(emptyAtRemoval)return 0;
  if(!looked&&(snap.zoomPendingZones?.includes(zone)||snap.zoomDeparturePending?.includes(zone)))return left;
  if(!looked&&event.removedAt!==undefined&&(fullAt===undefined||fullAt<=removedAt))return left;
  if(fullAt!==undefined&&replacements.some(t=>t.firstSeen>=lastSeen-1000&&t.visible&&!t.faceDown&&t.card.kind==='face-up'&&t.lastSeen>=fullAt))return 0;
  return hand||faceUp&&occupied&&event.removedAt!==undefined?left:0;
}

type SetSlideInput={
  track:FieldTrack;twins:readonly TwinCard[];tracks:readonly FieldTrack[];owns:(track:FieldTrack)=>string;
  zoneOf:(card:TwinCard)=>FieldTrack['zone']|undefined;now:number;pileTouched?:Partial<Record<'GY'|'BANISHED',number>>;
  blindSleeveSince?:FieldSnapshot['blindSleeveSince'];
  lastFieldActivityAtByZone?:FieldSnapshot['lastFieldActivityAtByZone'];
  seenOffField:(card:TwinCard,removedAt:number)=>boolean;
};
function setSlideSources({track,twins,tracks,owns,zoneOf}:SetSlideInput) {
  if(!fieldBackCandidate(track)||!MAIN_FIELD_SLOT.test(track.zone)||twins.some(c=>c.ref===owns(track)))return [];
  if(twins.some(card=>zoneOf(card)===track.zone))return [];
  return twins.flatMap(card=>{
    const zone=zoneOf(card);
    if(card.faceUp!==false||card.token||card.ownerSeat!==undefined||card.materials?.length||
      !zone||zone===track.zone||zone[0]!==track.zone[0]||!MAIN_FIELD_SLOT.test(zone))return [];
    return [{card,zone,owned:tracks.filter(t=>owns(t)===card.ref)}];
  });
}

/** A destination back can be admitted before the source's absence is confirmed. */
export function fieldSetSlidePending(input:SetSlideInput,snap:FieldSnapshot|undefined):boolean {
  const since=input.track.restSince??input.track.firstSeen;
  if(Object.values(input.pileTouched??{}).some(at=>at>=since-1500))return false;
  return setSlideSources(input).some(({card,zone,owned})=>!input.seenOffField(card,since)&&owned.some(t=>
    !t.removed&&t.zone===zone&&(!t.visible||snap?.handZones?.includes(zone)||snap?.missingSetLooks?.includes(t.id))));
}

/** A Set can follow one new back in its row while the departure is still pending. */
export function fieldSetSlide(input:SetSlideInput):{card:TwinCard;from:RemovedFieldTrack}|undefined {
  const {track,twins,tracks,owns,now,pileTouched,blindSleeveSince,lastFieldActivityAtByZone,seenOffField}=input;
  const sources=setSlideSources(input).flatMap(({card,zone,owned})=>{
    if(owned.some(t=>!t.removed))return [];
    const from=owned.find((t):t is RemovedFieldTrack=>t.removed&&t.zone===zone&&t.removedAt!==undefined);
    if(!from)return [];
    const since=from.removedFrameAt??from.removedAt;
    // Date the arrival from the first stable sleeve witness, even if the
    // full scans or the zoom detector confirm the outline later.
    const inSlideWindow=(back:FieldTrack)=>{
      const sleeveAt=blindSleeveSince?.[back.zone]??(back.setEvidence?.basis==='zoom'?back.restSince:undefined);
      const arrivedAt=sleeveAt!==undefined&&sleeveAt>=since&&sleeveAt<=back.firstSeen?sleeveAt:back.firstSeen;
      const motionAt=lastFieldActivityAtByZone?.[back.zone];
      const continued=sleeveAt!==undefined&&motionAt!==undefined&&motionAt>=since&&motionAt<=sleeveAt&&sleeveAt-motionAt<=1000;
      const startedAt=continued?Math.min(motionAt,arrivedAt):arrivedAt;
      return startedAt>=since-1000&&startedAt-since<=SET_SLIDE_MATCH_MS;
    };
    if(!inSlideWindow(track)||
      now-from.removedAt>FIELD_SET_RETURN_MS||seenOffField(card,since))return [];
    if(Object.values(pileTouched??{}).some(at=>at>=since-1500)||
      tracks.some(t=>/^(GY|BANISHED)$/.test(t.zone)&&!t.removed&&t.firstSeen>=since&&
        (t.state==='identified'||t.state==='candidate'&&t.restSince!==undefined&&t.restSince>=since)))return [];
    if(tracks.some(t=>t.id!==track.id&&MAIN_FIELD_SLOT.test(t.zone)&&t.zone[0]===zone[0]&&t.zone!==zone&&fieldBackCandidate(t)&&
      (t.state==='identified'||t.restSince!==undefined)&&inSlideWindow(t)&&!twins.some(c=>c.ref===owns(t))))return [];
    return [{card,from}];
  });
  if(sources.length===1)return sources[0];
}

/** A Set can reclaim a missing card only while the physical removal is recent. */
export function fieldSetReturn({track,twins,tracks,owns,events,seat,at,now,pileTouched,seenOffField,zoomBack,zoneOf}:{track:Pick<FieldTrack,'id'|'zone'|'faceDown'|'firstSeen'|'lastSeen'|'setEvidence'>;twins:readonly TwinCard[];tracks:readonly FieldTrack[];owns:(track:FieldTrack)=>string;events:readonly Pick<RemoteEvent,'at'|'action'>[];seat:number;/** Server clock. */at:number;/** Watcher clock. */now:number;pileTouched?:Partial<Record<'GY'|'BANISHED',number>>;seenOffField?:(card:TwinCard,removedAt:number)=>boolean;zoomBack?:boolean;zoneOf?:(card:TwinCard)=>FieldTrack['zone']|undefined}):{kind:'flip'|'return'|'move';card:TwinCard}|undefined {
  if(!track.faceDown||!MAIN_FIELD_SLOT.test(track.zone))return;
  const cell=fieldZoneLocation(track.zone);
  const there=(c:Pick<TwinCard,'zone'|'slot'>)=>c.zone===cell.zone&&(c.slot??0)===(cell.slot??0);
  const origin=(card:TwinCard)=>{
    const seen=tracks.filter(t=>owns(t)===card.ref);
    if(seen.some(t=>!t.removed))return;
    const from=seen.filter((t):t is RemovedFieldTrack=>t.removedAt!==undefined).sort((a,b)=>b.removedAt-a.removedAt)[0];
    if(!from)return;
    const removedAt=from.removedAt,age=now-removedAt;
    if(age<0||age>FIELD_SET_RETURN_MS||seenOffField?.(card,removedAt))return;
    if(tracks.some(t=>/^(GY|BANISHED)$/.test(t.zone)&&t.firstSeen>=removedAt)||
      (pileTouched?.GY??-Infinity)>=removedAt-1500||(pileTouched?.BANISHED??-Infinity)>=removedAt-1500)return;
    return from;
  };
  const inPlace=(from:RemovedFieldTrack,windowMs=3000)=>{
    // A front outline may predate the removal and turn over without starting a new track.
    const backAt=track.firstSeen<from.lastSeen-1000&&committedSet(track)?track.lastSeen:track.firstSeen;
    return backAt>=from.lastSeen-1000&&backAt<=from.removedAt+windowMs;
  };
  const handOrigin=(c:TwinCard)=>c.zone==='hand'&&c.departedFrom?.auto&&c.departedFrom.at!==undefined&&c.departedFrom.at<=at?c.departedFrom:undefined;
  const sized=(c:TwinCard,since:number)=>events.some(e=>e.at>=since&&(e.action.type==='hand.draw'||e.action.type==='hand.count'||e.action.type==='hand.add'||e.action.type==='twin.move'&&e.action.zone==='hand'&&e.action.cardRef!==c.ref)&&('seat' in e.action?e.action.seat:e.action.actorSeat)===seat);
  const occupant=twins.find(c=>zoneOf?zoneOf(c)===track.zone:there(c));
  if(occupant){
    if(!occupant.faceUp||occupant.token||occupant.ownerSeat!==undefined||!(occupant.cardId||occupant.passcode))return;
    if(zoomBack){
      // The settled back occupies the old front's physical cell. The tracker can still retain an invisible front.
      const owned=tracks.filter(t=>owns(t)===occupant.ref);
      const front=owned.find(t=>t.zone===track.zone&&!t.faceDown&&t.lastSeen<track.lastSeen&&
        t.lastSeen>=track.firstSeen-3000&&!seenOffField?.(occupant,t.lastSeen));
      if(front&&!owned.some(t=>!t.removed&&t.visible))return {kind:'flip',card:occupant};
    }
    if(occupant.materials?.length)return;
    const from=origin(occupant);
    return from&&inPlace(from)?{kind:'flip',card:occupant}:undefined;
  }
  const departed=twins.filter(c=>!c.token&&c.ownerSeat===undefined&&(c.zone===cell.zone||handOrigin(c)?.zone===cell.zone));
  const returned=departed.filter(c=>handOrigin(c)&&there(c.departedFrom!)).sort((a,b)=>b.departedFrom!.at!-a.departedFrom!.at!)[0];
  if(returned){
    const from=origin(returned);
    return from&&from.zone===track.zone&&inPlace(from,FIELD_SET_RETURN_MS)&&!sized(returned,returned.departedFrom!.at!)?{kind:'return',card:returned}:undefined;
  }
  // Legacy recovery for an unnamed Set the camera already sent to the hand.
  const arrivals=tracks.filter(t=>t.faceDown&&!t.removed&&t.visible&&MAIN_FIELD_SLOT.test(t.zone)&&fieldZoneLocation(t.zone).zone===cell.zone&&!twins.some(c=>c.ref===owns(t)));
  if(arrivals.length!==1||arrivals[0].id!==track.id)return;
  const sources=departed.filter(c=>{
    if(c.faceUp||c.cardId||c.passcode||c.name)return false;
    const hand=handOrigin(c);
    if(!hand||twins.some(other=>other.zone===hand.zone&&(other.slot??0)===(hand.slot??0)))return false;
    const from=origin(c);
    return from&&from.zone!==track.zone&&Math.abs(track.firstSeen-from.removedAt)<=REMOTE_TWIN_MOVE_WINDOW_MS&&
      !sized(c,at-(now-from.removedAt));
  });
  if(sources.length===1)return {kind:'move',card:sources[0]};
}

/** A virtual occupant without a current physical witness cannot reserve a slot. */
export function staleFieldOccupant(twins:readonly TwinCard[],tracks:readonly FieldTrack[],zone:FieldTrack['zone'],incomingRef:string,at=Math.max(-Infinity,...tracks.map(track=>track.lastSeen).filter(Number.isFinite))):TwinCard|undefined {
  const location=fieldZoneLocation(zone);
  if(!['monster','extra-monster','spell-trap','field'].includes(location.zone))return;
  // Tokens and controlled cards reserve their cell without a physical card on this mat.
  return twins.find(card=>!card.token&&card.ownerSeat===undefined&&card.ref!==incomingRef&&card.zone===location.zone&&card.slot===location.slot&&
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
    const before=remoteActionError();
    let updated:Awaited<ReturnType<RoomMutation>>=null;
    try{
      const sent=await retryThroughOutage(()=>act(proposal,id),{valid,patient:!options.quiet});
      if(sent===SKIPPED)return null;
      updated=sent;
    }catch(error){
      if(error instanceof RemoteDuelError&&error.code==='ACTIVATION_LIMIT')throw error;
      if(error instanceof OutageGaveUpError){
        if(options.quiet)throw error;
        throw new Error(`Could not save the field update (${proposal.type}: no connection). Use Retry field update.`);
      }
      failed(error);reason=error instanceof Error?error.message:String(error);if(attempt===attempts-1)throw error;
    }
    if(updated)return updated;
    const server=remoteActionError();
    if(server&&server!==before){
      if(server.code==='ACTIVATION_LIMIT')throw new RemoteDuelError(server.message,409,server.code);
      reason=server.message;
    }
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
