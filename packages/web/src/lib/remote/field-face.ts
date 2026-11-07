import type { RemoteActionProposal, TwinCard } from '@yugidraft/shared/remote';
import type { FieldTrack } from '@yugidraft/vision';
import { FIELD_FACE_WAIT_MS, fieldFaceProposal, fieldFaceWitness } from './field-proposals';

/** The new face must rest this long before it ends the player's hold: a false reading for a moment does not. */
export const FIELD_FACE_RELEASE_MS=2000;
/** Two automatic flips of one card this close together (down then up: glare) stop automatic flips of it for the quiet time. */
export const FIELD_FACE_PAIR_MS=10_000,FIELD_FACE_QUIET_MS=10_000;
/** A second such pair within a minute stops automatic flips of the card until its track rests in one face this long. */
export const FIELD_FACE_PAIRS_MS=60_000,FIELD_FACE_CALM_MS=5000;
const FIELD_ZONES=new Set(['monster','extra-monster','spell-trap','field','pendulum']);
const MAX_FAILS=3;

export type FieldFaceFix={track:FieldTrack;card:TwinCard;proposal:Extract<RemoteActionProposal,{type:'twin.flip'}>};
export interface FieldFaceInput {
  at:number; seat:number; tracks:readonly FieldTrack[]; twins:readonly TwinCard[];
  /** The board ref a track is bound to. Only that card can be flipped: never another card in the same zone. */
  refOf:(track:FieldTrack)=>string;
  /** Cards this check leaves alone for now (a reading placeholder, a stack that waits for a summon). */
  skip?:(ref:string)=>boolean;
  identity:(track:FieldTrack)=>{cardId:number;name?:string}|undefined;
  /** Scan field: overrules holds, the wait, the limit and earlier failures. */
  scan?:boolean;
}
/**
 * Decides which board cards follow the face of their track. The caller runs it on a timer and writes the fixes.
 * Holds live in memory: after a reload the board follows the camera again.
 */
export function createFieldFaceCheck() {
  const holds=new Map<string,{face?:boolean;since?:number}>(),seen=new Map<string,number>(),flips=new Map<string,number[]>(),fails=new Map<string,{count:number;until:number}>(),pairs=new Map<string,number>(),locks=new Map<string,{face?:boolean;since:number}>();
  const allows=(ref:string,at:number)=>{if(locks.has(ref))return false;const [a,b]=flips.get(ref)??[];return b===undefined||b-a>FIELD_FACE_PAIR_MS||at-b>=FIELD_FACE_QUIET_MS;};
  return {
    /** The player set this card's face (flip, Undo). `face` is what the camera showed then; undefined takes the next track seen. */
    hold(ref:string,face?:boolean){holds.set(ref,{face});},
    held:(ref:string)=>holds.has(ref),
    /** False while this card is in its quiet time after a down and an up. */
    allows,
    /** An automatic face change was saved. */
    flipped(ref:string,at:number){
      const last=flips.get(ref)?.at(-1);flips.set(ref,[...(flips.get(ref)??[]),at].slice(-2));fails.delete(ref);
      if(last===undefined||at-last>FIELD_FACE_PAIR_MS)return;
      const lastPair=pairs.get(ref);pairs.set(ref,at);
      if(lastPair!==undefined&&at-lastPair<=FIELD_FACE_PAIRS_MS)locks.set(ref,{since:at});
    },
    /** A write failed: wait, and stop after three until the faces agree or Scan field runs. */
    failed(ref:string,at:number){const count=(fails.get(ref)?.count??0)+1;fails.set(ref,{count,until:count>=MAX_FAILS?Infinity:at+2000*count});},
    clear(){holds.clear();seen.clear();flips.clear();fails.clear();pairs.clear();locks.clear();},
    due({at,seat,tracks,twins,refOf,skip,identity,scan=false}:FieldFaceInput):FieldFaceFix[] {
      const fixes:FieldFaceFix[]=[];
      for(const track of tracks){
        if(!fieldFaceWitness(track,at))continue;
        const card=twins.find(c=>c.ref===refOf(track)&&FIELD_ZONES.has(c.zone));
        if(!card||skip?.(card.ref))continue;
        const lock=locks.get(card.ref);
        if(lock&&(scan||lock.face===track.faceDown&&at-lock.since>=FIELD_FACE_CALM_MS)){locks.delete(card.ref);pairs.delete(card.ref);flips.delete(card.ref);}
        else if(lock&&lock.face!==track.faceDown){lock.face=track.faceDown;lock.since=at;}
        const hold=holds.get(card.ref);
        if(scan)holds.delete(card.ref);
        else if(hold){
          if(hold.face===undefined){hold.face=track.faceDown;continue;}
          if(hold.face===track.faceDown){hold.since=undefined;continue;}
          hold.since??=at;if(at-hold.since<FIELD_FACE_RELEASE_MS)continue;
          holds.delete(card.ref);
        }
        const proposal=fieldFaceProposal(card,track,seat,identity(track));
        if(!proposal){if(card.faceUp!==track.faceDown){seen.delete(card.ref);fails.delete(card.ref);}continue;}
        const since=seen.get(card.ref)??at;seen.set(card.ref,since);
        if(!scan&&(at<(fails.get(card.ref)?.until??-Infinity)||!allows(card.ref,at)||at-Math.max(since,track.restSince!)<FIELD_FACE_WAIT_MS))continue;
        fixes.push({track,card,proposal});
      }
      return fixes;
    },
  };
}
