import {remoteActionError,type RoomMutation} from './room-mutations';
import type { RemoteActionProposal, RemoteSummonKind, TwinCard } from '@yugidraft/shared/remote';
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
/** Physical orientation never makes an illegal face-down Attack Position Set. */
export function fieldTwinPosition(track:Pick<FieldTrack,'faceDown'|'zone'|'position'>):FieldTrack['position'] {
  return track.faceDown&&/^M[1-5]$|^EMZ[12]$/.test(track.zone)?'defense':track.faceDown&&/^S[1-5]$|^FIELD$/.test(track.zone)?'attack':track.position;
}
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
export function fieldFaceProposal(card:Pick<TwinCard,'ref'|'zone'|'faceUp'|'materials'|'publicIdentity'|'setBy'>,track:Pick<FieldTrack,'faceDown'|'position'|'bestMatch'>&Partial<Pick<FieldTrack,'card'|'pixelsDown'>>,seat:number,identity?:{cardId:number;name?:string}):Extract<RemoteActionProposal,{type:'twin.flip'}>|undefined {
  const base={type:'twin.flip' as const,source:'auto' as const,actorSeat:seat,seat,cardRef:card.ref};
  if(track.faceDown){
    if(card.faceUp?card.materials?.length&&!fieldStrongBack(track):!card.publicIdentity||card.setBy)return;
    return {...base,faceUp:false,position:['monster','extra-monster'].includes(card.zone)?'defense':'attack'};
  }
  if(card.faceUp)return;
  return identity?{...base,faceUp:true,position:track.position,cardId:identity.cardId,name:identity.name,...(track.bestMatch?{bestMatch:true}:{})}:undefined;
}
/** A new placement records the sighting atomically, so one Undo removes both. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false,fromRef,copyProof,summon}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean;fromRef?:string;copyProof?:{simultaneousQuads:number;at:number};summon?:{kind:RemoteSummonKind;materialRefs:string[]}}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  if(['DECK','EXTRA'].includes(track.zone))return [];
  if(existing)return faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',cardRef:track.id,...(track.bestMatch?{bestMatch:true}:{}),...location}]:[];
  return [{type:'twin.place',source:'auto',...(fromRef?{fromRef}:{}),actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(faceUp?{cardId,name,...(track.bestMatch?{bestMatch:true}:{})}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:fieldTwinPosition(track)},...(copyProof?{copyProof}:{}),...(summon?{summon}:{})}];
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
 * Where a card goes when the camera saw nothing: the rules, never the hand (a card returns to the hand or Deck only by the
 * camera or the player's choice). A face-up Pendulum Monster leaving a Monster Zone is added to the Extra Deck face-up; the
 * rest go to the Graveyard. A token has no pile (the server drops it) and an Xyz Monster's materials follow it to the GY.
 */
export function fieldDefaultDestination(card:Pick<TwinCard,'zone'|'faceUp'|'slot'>,facts?:{type?:string}):{zone:'graveyard'|'extra';faceUp?:true} {
  // Monster Zones, or a Pendulum Zone (the 'pendulum' row, or Spell/Trap Zone 1 or 5).
  const where=['monster','extra-monster','pendulum'].includes(card.zone)||card.zone==='spell-trap'&&(card.slot===1||card.slot===5);
  return card.faceUp&&where&&/\bpendulum\b/i.test(facts?.type??'')?{zone:'extra',faceUp:true}:{zone:'graveyard'};
}
/** The destinations a player can pick for a card that left the field (the tag on the moved card). `down`: face-down. */
export const FIELD_LEAVE_DESTINATIONS=[{zone:'graveyard',title:'GY'},{zone:'banished',title:'Banish'},{zone:'banished',down:true,title:'Banish face-down'},{zone:'hand',title:'Hand'},{zone:'deck',title:'Deck'},{zone:'extra',title:'Extra Deck'}] as const;
export const fieldLeaveLabel=(zone:string,faceUp?:boolean)=>FIELD_LEAVE_DESTINATIONS.find(d=>d.zone===zone&&(zone!=='banished'||(('down' in d)===(faceUp===false))))?.title??zone;
/** `destination`: a pile the camera showed, or a choice. Without one, the rules decide (fieldDefaultDestination). A card in a pile that leaves it still goes to the hand. */
export function fieldDepartureProposal(card:TwinCard,seat:number,destination?:'deck'|'extra'|{zone:'graveyard'|'banished'|'extra';faceUp?:boolean},facts?:{type?:string}):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  if(card.token||!['monster','extra-monster','spell-trap','field','pendulum','graveyard','banished'].includes(card.zone))return;
  const pile=['graveyard','banished'].includes(card.zone);
  const to=typeof destination==='string'?{zone:destination}:destination??(pile?{zone:'hand' as const}:fieldDefaultDestination(card,facts));
  // Back to the Deck/Extra, or a pile card that leaves its pile, turns face-down. The GY is public, so a card sent there (even a
  // face-down one) is face-up; banished is face-up unless the choice or the camera says face-down.
  const faceUp:boolean|undefined='faceUp' in to&&to.faceUp!==undefined?to.faceUp:pile||typeof destination==='string'?false:to.zone==='graveyard'||to.zone==='banished'?true:undefined;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:to.zone,...(faceUp!==undefined?{faceUp}:{}),...(to.zone==='extra'&&faceUp===true?{pendulum:true}:{}),source:'auto',...(card.faceUp&&card.name?{name:card.name}:{}),...(card.position==='defense'?{position:'attack' as const}:{})};
}

/**
 * Camera evidence for a card that left the field: a pile card the camera placed within a second before the removal (or after it) and has not named (an unread
 * face-up top, or a face-down card on the banished pile) is that card. It needs exactly one such pile card and exactly one
 * departure waiting; two of either is a guess, and the rules decide. An identity read goes the usual way (the pile track
 * finds the departed card by its name).
 */
export function fieldPileEvidence({twins,tracks,lastSeen,owns,departures}:{twins:readonly TwinCard[];tracks:readonly FieldTrack[];lastSeen:number;owns:(track:FieldTrack)=>string;departures:number}):{twin:TwinCard;zone:'graveyard'|'banished';faceUp:boolean}|undefined {
  if(departures!==1)return;
  const found=twins.filter(c=>['graveyard','banished'].includes(c.zone)&&c.ref.startsWith('fw-')&&!c.cardId&&!c.passcode&&!c.name&&(c.zone==='banished'||c.faceUp)).filter(c=>
    tracks.some(t=>owns(t)===c.ref&&t.zone===(c.zone==='banished'?'BANISHED':'GY')&&t.visible&&!t.removed&&t.firstSeen>=lastSeen-1000));
  return found.length===1?{twin:found[0],zone:found[0].zone as 'graveyard'|'banished',faceUp:found[0].faceUp}:undefined;
}

/** Queue delays must not attach an old read to replacement pixels. */
export function fieldEvidenceMatches(event:FieldEvent,current:FieldTrack|undefined,humanChoice=false) {
  const human=humanChoice&&event.type==='prompt';
  const age=current?performance.now()-current.lastSeen:Infinity;
  return !!current&&!current.removed&&(human?age>=0&&age<=1500:event.type==='reading'||!!current.visible)&&(current.revision??0)===(event.track.revision??0)&&current.faceDown===event.track.faceDown&&
    (event.type==='reading'?current.state==='candidate':event.type==='prompt'?current.state==='prompt':current.state==='identified'&&current.cardId===event.track.cardId);
}

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

/** A virtual occupant without a current physical witness cannot reserve a slot. */
export function staleFieldOccupant(twins:readonly TwinCard[],tracks:readonly FieldTrack[],zone:FieldTrack['zone'],incomingRef:string,at=Math.max(-Infinity,...tracks.map(track=>track.lastSeen).filter(Number.isFinite))):TwinCard|undefined {
  const location=fieldZoneLocation(zone);
  if(!['monster','extra-monster','spell-trap','field'].includes(location.zone))return;
  // A token has no physical card, so it is never stale: only the player removes it.
  return twins.find(card=>!card.token&&card.ref!==incomingRef&&card.zone===location.zone&&card.slot===location.slot&&
    !tracks.some(track=>track.id===card.ref&&!track.removed&&(track.visible||track.lastSeen>=at)));
}

/** Retry the same operation after the room controller refreshes its sequence. */
export async function retryFieldMutation(act:RoomMutation,proposal:RemoteActionProposal,id:string,valid:()=>boolean,failed:(error:unknown)=>void) {
  // A stale sequence refreshes the room between attempts; a busy table can need
  // more than one refresh. The same idempotency key keeps the write single.
  const attempts=3;let reason='';
  for(let attempt=0;attempt<attempts;attempt++){
    if(!valid())return null;
    const before=remoteActionError()?.at;
    let updated:Awaited<ReturnType<RoomMutation>>=null;
    try{updated=await act(proposal,id);}catch(error){failed(error);reason=error instanceof Error?error.message:String(error);if(attempt===attempts-1)throw error;}
    if(updated)return updated;
    const server=remoteActionError();if(server&&server.at!==before)reason=server.message;
    failed(new Error(`Could not save ${proposal.type}${reason?`: ${reason}`:''}. Retrying the field update.`));
    if(attempt<attempts-1)await new Promise(resolve=>setTimeout(resolve,100*(attempt+1)));
  }
  throw new Error(`Could not save the field update (${proposal.type}${reason?`: ${reason}`:''}). Use Retry field update.`);
}
