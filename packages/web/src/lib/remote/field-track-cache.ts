import {remoteFieldTracksSchema,type RemoteFieldTracks,type RemoteFieldCard} from '@yugidraft/shared/remote';
import type {FieldSnapshot,KnownFieldCard} from '@yugidraft/vision';
import {catalogCardId} from '@yugidraft/vision';
export const FIELD_TRACKS_TOPIC='remote.field-tracks.v1';
const contains=(quad:RemoteFieldCard['quad'],x:number,y:number)=>{
  let sign=0;
  for(let i=0;i<4;i++){const a=quad[i],b=quad[(i+1)%4],cross=(b.x-a.x)*(y-a.y)-(b.y-a.y)*(x-a.x);if(Math.abs(cross)<1e-9)continue;if(sign&&Math.sign(cross)!==sign)return false;sign=Math.sign(cross);}
  return true;
};
export function hitTrackedCards(cards:readonly RemoteFieldCard[],x:number,y:number):RemoteFieldCard|undefined {
  if(!Number.isFinite(x)||!Number.isFinite(y))return;
  let hit:RemoteFieldCard|undefined;
  for(const card of cards)if(contains(card.quad,x,y)){if(hit)return;hit=card;}
  return hit;
}
/** A correction must inspect the displayed pixels or reacquire its physical ref. */
export function trackedRereadTarget(ref:string,cards:readonly RemoteFieldCard[],frozen?:{x:number;y:number;frame:HTMLCanvasElement}) {
  if(frozen)return {x:frozen.x,y:frozen.y,frames:[frozen.frame]};
  const card=cards.find(c=>c.ref===ref);if(!card)return;
  return {x:card.quad.reduce((sum,p)=>sum+p.x,0)/4,y:card.quad.reduce((sum,p)=>sum+p.y,0)/4};
}
/** Full replacement snapshots, read synchronously without React renders or any inference. */
export class FieldTrackCache {
  private seats=new Map<number,{at:number;cards:RemoteFieldCard[]}>();
  constructor(private now=()=>performance.now()){}
  receive(seat:number,input:unknown){
    const parsed=remoteFieldTracksSchema.safeParse(input);if(!Number.isInteger(seat)||seat<0||seat>3||!parsed.success)return false;
    this.seats.set(seat,{at:this.now(),cards:parsed.data.cards});return true;
  }
  hit(seat:number,x:number,y:number):RemoteFieldCard|undefined {
    return hitTrackedCards(this.snapshot(seat),x,y);
  }
  snapshot(seat:number):RemoteFieldCard[]{const value=this.seats.get(seat);return value&&this.now()-value.at<=3000?value.cards:[];}
  clear(seat?:number){if(seat===undefined)this.seats.clear();else this.seats.delete(seat);}
  retain(seats:Set<number>){for(const seat of this.seats.keys())if(!seats.has(seat))this.seats.delete(seat);}
}
export function fieldTrackMessage(snapshot:FieldSnapshot,entries:ReadonlyMap<string,{cardId:string;passcode:number;name:string}>,knownCards:KnownFieldCard[]=[]):RemoteFieldTracks {
  const cards:RemoteFieldCard[]=[];
  if(snapshot.status==='watching'||snapshot.status==='budget'||snapshot.status==='busy')for(const track of snapshot.tracks){
    if(track.state!=='identified'||!track.visible||track.removed||track.faceDown||track.zone==='DECK'||track.card.kind!=='face-up'||track.card.covered||track.card.partial)continue;
    const known=knownCards.find(k=>k.id===track.id);if(known?.faceDown)continue;
    const entry=entries.get((known?known.cardId:track.cardId)??'');if(!entry)continue;
    const cardId=catalogCardId(entry);if(!cardId)continue;
    cards.push({ref:track.id,cardId,name:entry.name,quad:track.card.quad.map(p=>({x:Math.round(p.x*10000)/10000,y:Math.round(p.y*10000)/10000}))});
  }
  const message=remoteFieldTracksSchema.safeParse({type:'field.tracks',cards:cards.slice(0,20)});
  return message.success?message.data:{type:'field.tracks',cards:[]};
}
