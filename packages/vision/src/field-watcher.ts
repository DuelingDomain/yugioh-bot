import type { Recognizer } from './client';
import type { DetectedQuad, GameProfile, RecognitionPriors, RecognitionResult } from './types';
import { boundsOf } from './geometry';
import { isCovered } from './board';
import { createFieldAnalyzer, cloneFieldFrame, closeFieldFrame, type FieldFrame, type FieldAnalysis } from './field-motion';
import { fieldCenter, fieldOrientation, mapFieldZone, quadIou, type FieldCalibration, type FieldZone } from './field-zones';

export interface FieldTrack {
  id:string; card:DetectedQuad; zone:FieldZone; position:'attack'|'defense'; faceDown:boolean; cardId?:string;
  state:'candidate'|'identified'|'prompt'|'dismissed'; firstSeen:number; lastSeen:number; removed:boolean;
}
export type FieldEvent = { type:'placed'|'moved'|'flipped'|'removed'|'prompt'; track:FieldTrack; result?:RecognitionResult; latencyMs?:number; reason?:'uncertain'|'recognition-error'|'reappeared'; source:'auto' };
export interface FieldMetrics { detectorMs:number; recognitionMs:number; dutyPercent:number; intervalMs:number; samples:number; skipped:number; placements:number; latencyMs:number; errors:number }
export interface FieldSnapshot { status:'stopped'|'watching'|'hidden'|'busy'|'budget'|'error'; tracks:FieldTrack[]; metrics:FieldMetrics; error?:string }
export interface FieldBuffer { sample():Promise<{frame:FieldFrame;at:number}> }
export interface KnownFieldCard { id:string; card?:DetectedQuad; zone:FieldZone; cardId?:string; faceDown?:boolean }
export interface FieldWatcherOptions {
  recognizer:Pick<Recognizer,'detectCards'|'recognize'>; buffer:FieldBuffer; profile:GameProfile;
  getPriors?:()=>RecognitionPriors; getKnownCards?:()=>KnownFieldCard[]; calibration?:FieldCalibration;
  stableMs?:number; removalMs?:number; cpuBudget?:number; maxTracks?:number;
  now?:()=>number; hidden?:()=>boolean; cpuBusy?:()=>boolean;
  /** Dependency injection for replay/tests; production defaults sample browser pixels. */
  analyze?:(frame:FieldFrame)=>FieldAnalysis; clone?:(frame:FieldFrame)=>Promise<FieldFrame>;
}
interface InternalTrack { view:FieldTrack; anchor:DetectedQuad; announced?:DetectedQuad; announcedZone?:FieldZone; announcedPosition?:FieldTrack['position']; reappeared?:boolean; halo?:number[]; stableSince:number; observations:number; clearMissing:number; missingSamples:number; best?:{frame:FieldFrame;card:DetectedQuad;score:number}; kind:DetectedQuad['kind']; position:FieldTrack['position']; needsRead:boolean }
const distance=(a:DetectedQuad,b:DetectedQuad)=>{const x=fieldCenter(a),y=fieldCenter(b);return Math.hypot(x.x-y.x,x.y-y.y);};
const copy=(track:FieldTrack):FieldTrack=>({...track,card:structuredClone(track.card)});
/** Owner-only caller, native frame buffer. One detector/read at a time; no AI or uploads. */
export function createFieldWatcher(options:FieldWatcherOptions) {
  const now=options.now??(()=>performance.now()),analyze=options.analyze??createFieldAnalyzer(),clone=options.clone??cloneFieldFrame;
  const hidden=options.hidden??(()=>typeof document!=='undefined'&&document.hidden);
  const stableMs=Math.max(800,Math.min(1200,options.stableMs??1000)),removalMs=Math.max(2000,options.removalMs??2000);
  const budget=Math.max(.05,Math.min(.5,options.cpuBudget??.2)),maxTracks=Math.max(1,Math.min(60,options.maxTracks??20));
  const tracks:InternalTrack[]=[],listeners=new Set<(event:FieldEvent)=>void>(),updates=new Set<()=>void>(),retained=new Set<FieldFrame>();
  const metrics:FieldMetrics={detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0};
  let status:FieldSnapshot['status']='stopped',error:string|undefined,active=false,disposed=false,inFlight=false,epoch=0,serial=0,previousAt=-Infinity,lastFrameAt=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,ema=0,busyUntil=0,observer:PerformanceObserver|undefined,calibration=options.calibration;
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  const notify=()=>{for(const listener of updates)listener();};
  const emit=(type:FieldEvent['type'],t:InternalTrack,extra:Partial<FieldEvent>={})=>{const event:FieldEvent={type,track:copy(t.view),source:'auto',...extra};for(const listener of listeners)listener(event);};
  function pruneFrames() {
    const used=new Set(tracks.flatMap(t=>t.best?[t.best.frame]:[]));
    for(const frame of retained)if(!used.has(frame)){closeFieldFrame(frame);retained.delete(frame);}
    // At most six native originals, shared among all tracks rather than one clone per card.
    while(retained.size>6){const frame=retained.values().next().value!;for(const t of tracks)if(t.best?.frame===frame)t.best=undefined;closeFieldFrame(frame);retained.delete(frame);}
  }
  function interruptWindow() {previousAt=-Infinity;for(const t of tracks){t.stableSince=NaN;t.observations=0;t.clearMissing=0;t.missingSamples=0;t.best=undefined;}pruneFrames();}
  const idle=()=>{
    const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{scheduling?:{isInputPending():boolean}};
    return options.cpuBusy?.() || now()<busyUntil || nav?.scheduling?.isInputPending();
  };
  async function tick() {
    if(disposed||inFlight)return;
    if(hidden()||idle()){status=hidden()?'hidden':'busy';metrics.skipped++;interruptWindow();notify();return;}
    const generation=epoch;inFlight=true;const start=now();let current:FieldFrame|undefined,detectFrame:FieldFrame|undefined;
    try {
      const sample=await options.buffer.sample();current=sample.frame;
      if(generation!==epoch||disposed)return;
      if(sample.at<=lastFrameAt){metrics.skipped++;return;}
      lastFrameAt=sample.at;
      const maxGap=Math.max(1000,metrics.intervalMs*1.8),gap=sample.at-previousAt,dt=Number.isFinite(gap)&&gap<=maxGap?gap:0;
      if(gap>maxGap)interruptWindow();previousAt=sample.at;
      const evidence=analyze(current);
      detectFrame=await clone(current);
      const detectStart=now(),detected=await options.recognizer.detectCards(detectFrame);
      metrics.detectorMs=now()-detectStart;
      if(generation!==epoch||disposed)return;
      const cards=detected.filter(c=>c.quad.length===4&&c.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,60);
      metrics.samples++;status='watching';error=undefined;
      const matched=new Map<InternalTrack,DetectedQuad>(),taken=new Set<DetectedQuad>();
      const pairs=tracks.flatMap(t=>cards.map(c=>{
        const a=boundsOf(t.view.card.quad),b=boundsOf(c.quad),ratio=(a.w*a.h)/(b.w*b.h||1);
        const overlap=quadIou(t.view.card,c),d=distance(t.view.card,c);
        return {t,c,score:overlap+(1-d)*.1,eligible:ratio>.35&&ratio<2.85&&(overlap>=.12||d<.16)};
      })).filter(p=>p.eligible).sort((a,b)=>b.score-a.score);
      for(const {t,c} of pairs)if(!matched.has(t)&&!taken.has(c)){matched.set(t,c);taken.add(c);}
      // A single recently hidden instance and a single new outline can be followed
      // across the mat. Multiple unmatched cards remain ambiguous and are not guessed.
      const lost=tracks.filter(t=>!matched.has(t)&&t.view.state==='identified'&&!t.view.removed&&sample.at-t.view.lastSeen<=removalMs);
      const incoming=cards.filter(c=>!taken.has(c));
      if(lost.length===1&&incoming.length===1) {
        const a=boundsOf(lost[0].view.card.quad),b=boundsOf(incoming[0].quad),ratio=a.w*a.h/(b.w*b.h||1);
        if(ratio>.5&&ratio<2){matched.set(lost[0],incoming[0]);taken.add(incoming[0]);}
      }
      for(const c of cards)if(!taken.has(c)&&tracks.length<maxTracks) {
        const zone=mapFieldZone(c,calibration,cards).zone;
        const known=options.getKnownCards?.().find(k=>!tracks.some(t=>t.view.id===k.id)&&(k.card?quadIou(k.card,c)>.5:k.zone===zone));
        const t:InternalTrack={view:{id:known?.id??`fw-${session}-${++serial}`,card:c,zone,position:fieldOrientation(c,current.width,current.height),faceDown:c.kind==='face-down',cardId:known?.faceDown?undefined:known?.cardId,state:known?'identified':'candidate',firstSeen:sample.at,lastSeen:sample.at,removed:false},anchor:c,...(known?{announced:c,announcedZone:known.zone,announcedPosition:fieldOrientation(c,current.width,current.height)}:{}),stableSince:sample.at,observations:0,clearMissing:0,missingSamples:0,kind:c.kind,position:fieldOrientation(c,current.width,current.height),needsRead:!known};
        tracks.push(t);matched.set(t,c);
      }
      for(const t of tracks) {
        const c=matched.get(t);
        if(!c) {
          t.best=undefined;t.stableSince=NaN;t.observations=0;
          // Consecutive clear detector samples only: hidden tabs, overload and motion cannot remove cards.
          const halo=evidence.halo?.(t.view.card),blocked=halo&&t.halo&&halo.filter((v,i)=>Math.abs(v-t.halo![i])>.1).length/halo.length>.2;
          if(evidence.motion(t.view.card)>.025||blocked){t.clearMissing=0;t.missingSamples=0;continue;}
          t.clearMissing+=dt;t.missingSamples++;
          if(t.view.state==='identified'&&!t.view.removed&&t.clearMissing>removalMs&&t.missingSamples>=3){t.view.removed=true;emit('removed',t);}
          continue;
        }
        t.reappeared ||= t.view.removed;t.view.removed=false;t.clearMissing=0;t.missingSamples=0;t.view.lastSeen=sample.at;t.view.card=c;
        // Uncalibrated ordering is assigned at settlement, then kept until the card actually moves.
        if(calibration||t.view.state==='candidate'||distance(t.anchor,c)>.02)t.view.zone=mapFieldZone(c,calibration,cards).zone;
        const position=fieldOrientation(c,current.width,current.height);
        const clean=c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards)&&evidence.motion(c)<=.025;
        const still=quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012&&t.kind===c.kind&&t.position===position;
        if(!clean||!still||!Number.isFinite(t.stableSince)) {
          t.anchor=c;t.stableSince=clean?sample.at:NaN;t.observations=0;t.best=undefined;t.kind=c.kind;t.position=position;
        }
        if(!clean)continue;
        t.observations++;
        const score=evidence.sharpness(c);
        if(!t.best||score>t.best.score)t.best={frame:current,card:structuredClone(c),score};
        if(t.observations<3||sample.at-t.stableSince<stableMs)continue;
        const wasFaceDown=t.view.faceDown;
        t.view.faceDown=c.kind==='face-down';t.view.position=position;
        if(t.reappeared){emit('prompt',t,{reason:'reappeared'});t.reappeared=false;}
        if(t.view.state==='identified') {
          if(t.announced&&(quadIou(t.announced,c)<.7||distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position)){emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;}
          if(wasFaceDown!==t.view.faceDown){emit('flipped',t);t.needsRead=!t.view.faceDown&&!t.view.cardId;}
        }
        t.halo=evidence.halo?.(c);
        if(!t.needsRead){t.best=undefined;continue;}
        t.needsRead=false;
        if(t.view.faceDown) {
          t.view.cardId=undefined;t.view.state='identified';t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.best=undefined;metrics.placements++;emit('placed',t,{latencyMs:now()-t.view.firstSeen});continue;
        }
        const best=t.best!;let input:FieldFrame|undefined;
        try {
          input=await clone(best.frame);const readStart=now();
          const result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{card:best.card,k:5,maxFrames:1,priors:options.getPriors?.()});
          metrics.recognitionMs=now()-readStart;
          if(generation!==epoch||disposed)return;
          const safe=result.tier==='sure'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&result.candidates[0].cardId!==options.profile.cardBack.cardId;
          metrics.latencyMs=now()-t.view.firstSeen;
          if(safe){t.view.state='identified';t.view.cardId=result.candidates[0].cardId;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;metrics.placements++;emit('placed',t,{result,latencyMs:metrics.latencyMs});}
          else {t.view.state='prompt';emit('prompt',t,{result:{...result,candidates:result.candidates.slice(0,5)},latencyMs:metrics.latencyMs,reason:'uncertain'});}
        } catch(cause) {
          if(generation!==epoch||disposed)return;
          t.view.state='prompt';metrics.errors++;emit('prompt',t,{reason:'recognition-error'});
        } finally {if(input)closeFieldFrame(input);t.best=undefined;}
      }
      if(tracks.some(t=>t.best?.frame===current)){retained.add(current);current=undefined;}
      // Forget transient non-cards; identified instances remain until the caller resolves them.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.state==='candidate'&&sample.at-tracks[i].view.lastSeen>3000)tracks.splice(i,1);
      pruneFrames();
    } catch(cause) {
      if(generation===epoch&&!disposed){status='error';error=cause instanceof Error?cause.message:String(cause);metrics.errors++;interruptWindow();}
    } finally {
      if(detectFrame)closeFieldFrame(detectFrame);if(current)closeFieldFrame(current);
      const elapsed=now()-start;ema=ema?ema*.8+elapsed*.2:elapsed;
      metrics.intervalMs=Math.max(250,Math.min(5000,ema/budget));metrics.dutyPercent=Math.min(100,100*ema/metrics.intervalMs);
      if(status==='watching'&&metrics.intervalMs>500)status='budget';inFlight=false;notify();
    }
  }
  function schedule() {if(!active)return;timer=setTimeout(async()=>{const start=now();await tick();if(active)scheduleAfter(Math.max(0,metrics.intervalMs-(now()-start)));},0);}
  function scheduleAfter(delay:number) {if(active)timer=setTimeout(()=>schedule(),delay);}
  function stop() {active=false;epoch++;clearTimeout(timer);observer?.disconnect();observer=undefined;interruptWindow();status='stopped';notify();}
  return {
    tick,
    start() {
      if(active||disposed)return;active=true;status='watching';
      if(typeof PerformanceObserver!=='undefined')try {observer=new PerformanceObserver(list=>{if(list.getEntries().some(e=>e.duration>50))busyUntil=now()+250;});observer.observe({entryTypes:['longtask']});}catch{/* Not supported by every browser. */}
      schedule();
    },
    stop,
    dispose(){stop();disposed=true;for(const t of tracks)t.best=undefined;pruneFrames();listeners.clear();updates.clear();},
    subscribe(listener:(event:FieldEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    subscribeState(listener:()=>void){updates.add(listener);return()=>{updates.delete(listener);};},
    getSnapshot():FieldSnapshot{return {status,tracks:tracks.map(t=>copy(t.view)),metrics:{...metrics},error};},
    setCalibration(value?:FieldCalibration){calibration=value;interruptWindow();},
    confirm(id:string,cardId?:string){const t=tracks.find(t=>t.view.id===id);if(t){t.view.cardId=cardId;t.view.state='identified';t.needsRead=false;t.announced=t.view.card;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;t.best=undefined;pruneFrames();notify();}},
    dismiss(id:string){const t=tracks.find(t=>t.view.id===id);if(t){t.view.state='dismissed';t.needsRead=false;t.best=undefined;pruneFrames();notify();}},
    forget(id:string){const i=tracks.findIndex(t=>t.view.id===id);if(i>=0)tracks.splice(i,1);pruneFrames();notify();},
  };
}
export type FieldWatcher=ReturnType<typeof createFieldWatcher>;
