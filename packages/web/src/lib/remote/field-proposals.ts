import type { RemoteActionProposal, TwinCard } from '@yugidraft/shared/remote';
import { fieldZoneLocation, type FieldTrack } from '@yugidraft/vision';
/** Recognition precedes a NEW placement: the last reversible event adds the twin. */
export function fieldPlacementProposals({track,seat,cardId,name,existing=false}:{track:FieldTrack;seat:number;cardId?:number;name?:string;existing?:boolean}):RemoteActionProposal[] {
  const location=fieldZoneLocation(track.zone),faceUp=!track.faceDown;
  // Deck contents are private. Never publish a read from that area.
  if(track.zone==='DECK'&&faceUp)return [];
  const identified:RemoteActionProposal[]=faceUp&&cardId?[{type:'card.identified',actorSeat:seat,seat,cardId,name,source:'auto',...(existing?{cardRef:track.id,...location}:{})}]:[];
  return [...identified,...(existing?[]:[{type:'twin.place' as const,actorSeat:seat,seat,zone:location.zone,card:{ref:track.id,...(faceUp?{cardId,name}:{}),...(location.slot?{slot:location.slot}:{}),faceUp,position:track.position}}])];
}

/** Leave the playable field once; pile disappearance never guesses a destination. */
export function fieldDepartureProposal(card:TwinCard,seat:number):Extract<RemoteActionProposal,{type:'twin.move'}>|undefined {
  if(!['monster','extra-monster','spell-trap','field','pendulum'].includes(card.zone))return;
  return {type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone:'graveyard',source:'auto',...(card.faceUp&&card.name?{name:card.name}:{})};
}
