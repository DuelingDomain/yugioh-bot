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
/** A new placement records the sighting atomically, so one Undo removes both. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false,fromRef,copyProof,summon}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean;fromRef?:string;copyProof?:{simultaneousQuads:number;at:number};summon?:{kind:RemoteSummonKind;materialRefs:string[]}}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  if(['DECK','EXTRA'].includes(track.zone))return [];
  if(existing)return faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',cardRef:track.id,...(track.bestMatch?{bestMatch:true}:{}),...location}]:[];
  return [{type:'twin.place',source:'auto',...(fromRef?{fromRef}:{}),actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(faceUp?{cardId,name,...(track.bestMatch?{bestMatch:true}:{})}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:fieldTwinPosition(track)},...(copyProof?{copyProof}:{}),...(summon?{summon}:{})}];
}

/** A clear lift leaves its public zone once, retaining the physical ref privately. */
export function fieldDepartureProposal(card:TwinCard,seat:number,destination:'deck'|'extra'|undefined=undefined):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  if(!['monster','extra-monster','spell-trap','field','pendulum','graveyard','banished'].includes(card.zone))return;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:destination??'hand',...(destination||['graveyard','banished'].includes(card.zone)?{faceUp:false}:{}),source:'auto',...(card.faceUp&&card.name?{name:card.name}:{})};
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


/** A virtual occupant without a current physical witness cannot reserve a slot. */
export function staleFieldOccupant(twins:readonly TwinCard[],tracks:readonly FieldTrack[],zone:FieldTrack['zone'],incomingRef:string,at=Math.max(-Infinity,...tracks.map(track=>track.lastSeen).filter(Number.isFinite))):TwinCard|undefined {
  const location=fieldZoneLocation(zone);
  if(!['monster','extra-monster','spell-trap','field'].includes(location.zone))return;
  return twins.find(card=>card.ref!==incomingRef&&card.zone===location.zone&&card.slot===location.slot&&
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
