import {markBackTiming} from './field-timing';
import {remoteFieldTracksSchema,type RemoteFieldTracks,type RemoteFieldCard,type TwinCard} from '@yugidraft/shared/remote';
import type {FieldSnapshot,KnownFieldCard,FieldCalibration} from '@yugidraft/vision';
import {catalogCardId,createFieldCalibration} from '@yugidraft/vision';
export const FIELD_TRACKS_TOPIC='remote.field-tracks.v1';
const emptyCards:RemoteFieldCard[]=[],emptyBacks:FieldBack[]=[];
export type FieldBack=NonNullable<RemoteFieldTracks['backs']>[number];
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
  private seats=new Map<number,{at:number;cards:RemoteFieldCard[];backs:FieldBack[];calibration?:FieldCalibration}>();
  private listeners=new Set<()=>void>();
  private timer:ReturnType<typeof setTimeout>|undefined;
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);this.scheduleExpiry();return()=>{this.listeners.delete(listener);if(!this.listeners.size){clearTimeout(this.timer);this.timer=undefined;}};};
  private notify(){for(const listener of this.listeners)listener();this.scheduleExpiry();}
  private scheduleExpiry(){
    clearTimeout(this.timer);this.timer=undefined;
    if(!this.listeners.size)return;
    const remaining=[...this.seats.values()].filter(v=>v.backs.length&&this.now()-v.at<=3000).map(v=>3001-(this.now()-v.at));
    if(remaining.length)this.timer=setTimeout(()=>{this.timer=undefined;this.notify();},Math.max(1,Math.min(...remaining)));
  }
  constructor(private now=()=>performance.now()){}
  receive(seat:number,input:unknown){
    const parsed=remoteFieldTracksSchema.safeParse(input);if(!Number.isInteger(seat)||seat<0||seat>3||!parsed.success)return false;
    let calibration:FieldCalibration|undefined;
    try{if(parsed.data.calibration)calibration=createFieldCalibration(parsed.data.calibration.corners,parsed.data.calibration.orientation,parsed.data.calibration.zoneSpacing,parsed.data.calibration.zones);}catch{return false;}
    const previous=this.seats.get(seat)?.backs??[],backs=parsed.data.backs??[];
    this.seats.set(seat,{at:this.now(),cards:parsed.data.cards,backs,calibration});
    for(const ref of new Set([...previous,...backs].map(b=>b.ref)))markBackTiming(ref,backs.some(b=>b.ref===ref)?'tracksReceived':'tracksCleared',{seat});
    this.notify();return true;
  }
  hit(seat:number,x:number,y:number):RemoteFieldCard|undefined {
    return hitTrackedCards(this.snapshot(seat),x,y);
  }
  snapshot(seat:number):RemoteFieldCard[]{const value=this.seats.get(seat);return value&&this.now()-value.at<=3000?value.cards:emptyCards;}
  backs(seat:number):FieldBack[]{const value=this.seats.get(seat);return value&&this.now()-value.at<=3000?value.backs:emptyBacks;}
  calibration(seat:number):FieldCalibration|undefined {const value=this.seats.get(seat);return value&&this.now()-value.at<=3000?value.calibration:undefined;}
  clear(seat?:number){if(seat===undefined)this.seats.clear();else this.seats.delete(seat);this.notify();}
  retain(seats:Set<number>){for(const seat of this.seats.keys())if(!seats.has(seat))this.seats.delete(seat);this.notify();}
}
export function fieldTrackMessage(snapshot:FieldSnapshot,entries:ReadonlyMap<string,{cardId:string;passcode:number;name:string}>,knownCards:KnownFieldCard[]=[],calibration?:FieldCalibration):RemoteFieldTracks {
  const cards:RemoteFieldCard[]=[];
  const backs:FieldBack[]=[];
  const quad=(card:{quad:{x:number;y:number}[]})=>card.quad.map(p=>({x:Math.round(p.x*10000)/10000,y:Math.round(p.y*10000)/10000}));
  if(snapshot.status==='watching'||snapshot.status==='budget'||snapshot.status==='busy'){
    for(const pile of snapshot.piles??[])backs.push({ref:`pile-${pile.zone}`,zone:pile.zone,quad:quad(pile.card)});
    for(const track of snapshot.tracks){
      if(track.state!=='identified'||!track.visible||track.removed||!track.faceDown||track.card.covered||track.card.partial||!/^(?:M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(track.zone))continue;
      if(!knownCards.some(k=>k.id===track.id&&k.faceDown))continue;
      backs.push({ref:track.id,zone:track.zone as FieldBack['zone'],quad:quad(track.card)});
    }
  }
  if(snapshot.status==='watching'||snapshot.status==='budget'||snapshot.status==='busy')for(const track of snapshot.tracks){
    if(track.state!=='identified'||!track.visible||track.removed||track.faceDown||track.zone==='DECK'||track.card.kind!=='face-up'||track.card.covered||track.card.partial)continue;
    const known=knownCards.find(k=>k.id===track.id);if(!known||known.faceDown||!known.cardId||['DECK','EXTRA','HAND'].includes(known.zone))continue;
    const entry=entries.get(known.cardId);if(!entry)continue;
    const cardId=catalogCardId(entry);if(!cardId)continue;
    cards.push({ref:track.id,cardId,name:entry.name,quad:track.card.quad.map(p=>({x:Math.round(p.x*10000)/10000,y:Math.round(p.y*10000)/10000}))});
  }
  const message=remoteFieldTracksSchema.safeParse({type:'field.tracks',cards:cards.slice(0,20),...(backs.length?{backs:backs.slice(0,22)}:{}),...(calibration?.orientation?{calibration}:{})});
  return message.success?message.data:{type:'field.tracks',cards:[]};
}

/** Transport TTL alone does not establish current public identity. */
export function publicTrackedTwin(cached:RemoteFieldCard,twins:readonly TwinCard[]) {
  const twin=twins.find(card=>card.ref===cached.ref);
  if(!twin?.faceUp||!twin.cardId||['hand','deck'].includes(twin.zone))return;
  return {ref:twin.ref,cardId:twin.cardId,name:twin.name};
}
