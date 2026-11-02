import {boxIou,type Box} from './session';
export interface Observation {box:Box;confidence:number;appearance?:number[];embedding?:number[];kind?:string}
export interface SessionTrack extends Observation {id:string;lastSeen:number;firstSeen:number;hits:number;cardId?:string;velocity:{x:number;y:number}}
const cosine=(a?:number[],b?:number[])=>{if(!a?.length||a.length!==b?.length)return -1;let ab=0,aa=0,bb=0;for(let i=0;i<a.length;i++){ab+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;}return ab/Math.sqrt(aa*bb||1);};
export function appearanceError(a?:number[],b?:number[]) {if(!a?.length||a.length!==b?.length)return Infinity;const shift=Math.max(-.12,Math.min(.12,a.reduce((s,v,i)=>s+v-b[i],0)/a.length));return a.reduce((s,v,i)=>s+(v-b[i]-shift)**2,0)/a.length;}
/** ByteTrack-style high/low association, velocity prediction and conservative
 * appearance re-ID. This is a small experiment, not the ByteTrack/OC-SORT code. */
export class SessionTracker {
  tracks:SessionTrack[]=[];private serial=0;
  identify(id:string,cardId:string,embedding?:number[]) {const t=this.tracks.find(t=>t.id===id);if(t){t.cardId=cardId;t.embedding=embedding;}}
  update(observations:Observation[],at:number):SessionTrack[] {
    this.tracks=this.tracks.filter(t=>at-t.lastSeen<30000);
    const used=new Set<string>(),assigned=new Map<Observation,SessionTrack>();
    for(const high of [true,false]) {
      const pool=observations.filter(o=>high?o.confidence>=.7:o.confidence>=.4&&o.confidence<.7);
      const pairs=pool.flatMap(o=>this.tracks.filter(t=>!used.has(t.id)).map(t=>{
        const dt=Math.min(1000,at-t.lastSeen),predicted={...t.box,x:t.box.x+t.velocity.x*dt,y:t.box.y+t.velocity.y*dt};
        const overlap=boxIou(predicted,o.box),error=appearanceError(t.appearance,o.appearance),similarity=cosine(t.embedding,o.embedding);
        const size=o.box.w*o.box.h/(t.box.w*t.box.h||1),sameKind=!o.kind||!t.kind||o.kind===t.kind;
        const eligible=sameKind&&size>.4&&size<2.5&&(overlap>.15&&error<.035||high&&(error<.006||similarity>.94));
        return {o,t,eligible,score:overlap+(error<.006?1:0)+(similarity>.94?1:0)};
      })).filter(p=>p.eligible).sort((a,b)=>b.score-a.score);
      for(const p of pairs) {
        if(used.has(p.t.id)||assigned.has(p.o))continue;
        const alternatives=pairs.filter(q=>q.o===p.o&&q.t!==p.t&&!used.has(q.t.id));
        if(alternatives.some(q=>Math.abs(q.score-p.score)<.12))continue;
        assigned.set(p.o,p.t);used.add(p.t.id);
      }
    }
    return observations.filter(o=>assigned.has(o)||o.confidence>=.7).map(o=>{
      let t=assigned.get(o);
      if(!t){t={...o,id:`session-track-${++this.serial}`,lastSeen:at,firstSeen:at,hits:0,velocity:{x:0,y:0}};this.tracks.push(t);}
      const dt=at-t.lastSeen;
      if(dt>0)t.velocity={x:.6*t.velocity.x+.4*(o.box.x-t.box.x)/dt,y:.6*t.velocity.y+.4*(o.box.y-t.box.y)/dt};
      t.box=o.box;t.confidence=o.confidence;t.appearance=o.appearance;t.kind=o.kind;t.embedding=o.embedding??t.embedding;t.lastSeen=at;t.hits++;return t;
    });
  }
  /** Embeddings cannot distinguish identical physical copies. Require one unused
   * candidate and a .03 similarity lead; otherwise keep the new physical ref. */
  reidentify(id:string,cardId:string,embedding:number[],at:number):string|undefined {
    const fresh=this.tracks.find(t=>t.id===id);if(!fresh)return;
    const candidates=this.tracks.filter(t=>t!==fresh&&t.cardId===cardId&&at-t.lastSeen>250&&at-t.lastSeen<10000).map(t=>({t,sim:cosine(t.embedding,embedding)})).sort((a,b)=>b.sim-a.sim);
    if(candidates[0]?.sim>=.94&&(!candidates[1]||candidates[0].sim-candidates[1].sim>=.03)) {
      const old=candidates[0].t;Object.assign(old,{...fresh,id:old.id,firstSeen:old.firstSeen,cardId,embedding});this.tracks=this.tracks.filter(t=>t!==fresh);return old.id;
    }
  }
}
