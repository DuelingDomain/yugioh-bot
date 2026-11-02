import type { RemoteActionProposal, TwinCard } from '@yugidraft/shared/remote';
import { fieldZoneLocation, type FieldEvent, type FieldTrack } from '@yugidraft/vision';
/** A new placement records the sighting atomically, so one Undo removes both. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  if(['GY','BANISHED','DECK','EXTRA'].includes(track.zone))return [];
  if(existing)return faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',cardRef:track.id,...location}]:[];
  return [{type:'twin.place',source:'auto',actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(faceUp?{cardId,name}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:track.position}}];
}

/** Leave the playable field once; pile disappearance never guesses a destination. */
export function fieldDepartureProposal(card:TwinCard,seat:number):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(card.zone))return;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:'graveyard',source:'auto',...(card.faceUp&&card.name?{name:card.name}:{})};
}

/** Queue delays must not attach an old read to replacement pixels. */
export function fieldEvidenceMatches(event:FieldEvent,current:FieldTrack|undefined) {
  return !!current&&!current.removed&&!!current.visible&&(current.revision??0)===(event.track.revision??0)&&
    (event.type==='prompt'?current.state==='prompt':current.state==='identified'&&current.cardId===event.track.cardId);
}
