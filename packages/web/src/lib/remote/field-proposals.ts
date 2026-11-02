import type {RoomMutation} from './room-mutations';
import type { RemoteActionProposal, TwinCard } from '@yugidraft/shared/remote';
import { fieldZoneLocation, type FieldEvent, type FieldTrack } from '@yugidraft/vision';
/** Copy evidence must come from distinct, identified quads in the same frame. */
export function simultaneousFieldCopies(a:FieldTrack,b:FieldTrack):boolean {
  if(a.id===b.id||!a.cardId||a.cardId!==b.cardId||!['identified','prompt'].includes(a.state)||b.state!=='identified'||!a.visible||!b.visible||a.removed||b.removed||a.faceDown||b.faceDown||a.card.kind!=='face-up'||b.card.kind!=='face-up'||a.lastSeen!==b.lastSeen)return false;
  const box=(t:FieldTrack)=>({left:Math.min(...t.card.quad.map(p=>p.x)),right:Math.max(...t.card.quad.map(p=>p.x)),top:Math.min(...t.card.quad.map(p=>p.y)),bottom:Math.max(...t.card.quad.map(p=>p.y))});
  const x=box(a),y=box(b),area=Math.max(0,Math.min(x.right,y.right)-Math.max(x.left,y.left))*Math.max(0,Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top));
  return area/Math.min((x.right-x.left)*(x.bottom-x.top),(y.right-y.left)*(y.bottom-y.top))<.04;
}
/** Physical orientation never makes an illegal face-down Attack Position Set. */
export function fieldTwinPosition(track:Pick<FieldTrack,'faceDown'|'zone'|'position'>):FieldTrack['position'] {
  return track.faceDown&&/^M[1-5]$|^EMZ[12]$/.test(track.zone)?'defense':track.faceDown&&/^S[1-5]$|^FIELD$/.test(track.zone)?'attack':track.position;
}
/** A new placement records the sighting atomically, so one Undo removes both. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false,copyProof}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean;copyProof?:{simultaneousQuads:2;at:number}}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  if(['GY','BANISHED','DECK','EXTRA'].includes(track.zone))return [];
  if(existing)return faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',cardRef:track.id,...(track.bestMatch?{bestMatch:true}:{}),...location}]:[];
  return [{type:'twin.place',source:'auto',actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(faceUp?{cardId,name,...(track.bestMatch?{bestMatch:true}:{})}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:fieldTwinPosition(track)},...(copyProof?{copyProof}:{})}];
}

/** Leave the playable field once; pile disappearance never guesses a destination. */
export function fieldDepartureProposal(card:TwinCard,seat:number):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(card.zone))return;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:'graveyard',source:'auto',...(card.faceUp&&card.name?{name:card.name}:{})};
}

/** Queue delays must not attach an old read to replacement pixels. */
export function fieldEvidenceMatches(event:FieldEvent,current:FieldTrack|undefined) {
  return !!current&&!current.removed&&!!current.visible&&(current.revision??0)===(event.track.revision??0)&&current.faceDown===event.track.faceDown&&
    (event.type==='prompt'?current.state==='prompt':current.state==='identified'&&current.cardId===event.track.cardId);
}

export class StaleFieldPlacementError extends Error {
  constructor(readonly placement:Extract<RemoteActionProposal,{type:'twin.place'}>){super('The card changed during save. Remove the stale placement to continue.');}
}
/** A card may change during HTTP, after the preflight evidence check. */
export async function applyVerifiedFieldMutation(event:FieldEvent,current:()=>FieldTrack|undefined,act:RoomMutation,proposal:RemoteActionProposal) {
  if(!fieldEvidenceMatches(event,current()))return null;
  const updated=await act(proposal);
  if(!updated)return null;
  if(!fieldEvidenceMatches(event,current())){
    if(proposal.type==='twin.place'){
      let undone=false;try{if(updated.state.undo)undone=!!await act({type:'undo',actorSeat:proposal.actorSeat,targetActionId:updated.state.undo.actionId});}catch{/* Explicit recovery also covers a failed refresh/network. */}
      if(!undone)throw new StaleFieldPlacementError(proposal);
    }
    return null;
  }
  return updated;
}
