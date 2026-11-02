import type {FieldWatcherOptions,FieldEvent,FieldTrack} from '../src/field-watcher';
import {createFieldAnalyzer,closeFieldFrame,clearFieldBackground} from '../src/field-motion';
import {fieldOrientation,mapFieldZone} from '../src/field-zones';
import {boundsOf} from '../src/geometry';
import type {DetectedQuad,RecognitionResult} from '../src/types';
import {SessionTracker} from './tracker';
/** Experimental CPU tracker. Uses the unchanged detector/warp/embed/search worker.
 * One scheduled inference at a time. No truth labels, AI, feedback or network writes. */
export function createTrackedWatcher(options:FieldWatcherOptions) {
  const tracker=new SessionTracker(),analyze=createFieldAnalyzer(),listeners=new Set<(e:FieldEvent)=>void>();
  const states=new Map<string,{view:FieldTrack;stable:number;lastBox:DetectedQuad;appearance?:number[];halo?:number[];read:boolean;prompted:boolean;announced:boolean;clearAt?:number;result?:RecognitionResult}>();
  let active=false,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined,errors=0;
  const now=()=>performance.now(),emit=(type:FieldEvent['type'],s:(typeof states extends Map<string,infer V>?V:never))=>{const e:FieldEvent={type,track:structuredClone(s.view),source:'auto',result:s.result};for(const listener of listeners)listener(e);};
  async function tick() {
    let frame:Awaited<ReturnType<FieldWatcherOptions['buffer']['sample']>>['frame']|undefined;
    try {
      const sample=await options.buffer.sample();frame=sample.frame;const evidence=analyze(frame),at=sample.at;
      const cards=await options.recognizer.detectCards(await createImageBitmap(frame));if(!active)return;
      const observations=cards.map(card=>({box:boundsOf(card.quad),confidence:card.confidence,appearance:evidence.appearance?.(card),kind:card.kind}));
      const matches=tracker.update(observations,at),visible=new Set<string>();
      for(const t of matches){
        const i=observations.findIndex(o=>o.box===t.box),card=cards[i];if(!card)continue;visible.add(t.id);
        let s=states.get(t.id);
        if(!s){s={view:{id:t.id,card,zone:mapFieldZone(card,options.calibration,cards,options.format).zone,position:fieldOrientation(card,frame.width,frame.height),faceDown:card.kind==='face-down',state:'candidate',firstSeen:at,lastSeen:at,removed:false},stable:at,lastBox:card,read:false,prompted:false,announced:false};states.set(t.id,s);}
        const oldBox=boundsOf(s.lastBox.quad),b=boundsOf(card.quad),still=Math.hypot(b.x-oldBox.x,b.y-oldBox.y)<.012;
        if(!still||evidence.motion(card)>.025||card.covered||card.partial||card.confidence<.7){s.stable=at;s.lastBox=card;continue;}
        if(at-s.stable<400||t.hits<3)continue;
        const zone=mapFieldZone(card,options.calibration,cards,options.format).zone,position=fieldOrientation(card,frame.width,frame.height),faceDown=card.kind==='face-down';
        const moved=s.announced&&(s.view.zone!==zone||s.view.position!==position||s.view.removed),flipped=s.announced&&s.view.faceDown!==faceDown;
        s.view={...s.view,card,zone,position,faceDown,lastSeen:at,removed:false,visible:true};s.clearAt=undefined;s.appearance=evidence.appearance?.(card);s.halo=evidence.halo?.(card);
        if(s.announced){if(moved)emit('moved',s);if(flipped)emit('flipped',s);continue;}
        if(s.read)continue;s.read=true;
        if(!faceDown){
          const result=await options.recognizer.recognize([await createImageBitmap(frame)],{card,maxFrames:1,k:5,includeIdentityEmbedding:true,priors:options.getPriors?.()});if(!active)return;s.result=result;
          const winner=result.candidates[0]?.cardId;
          if(result.tier==='sure'&&winner&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&!result.quality.fallback){
            const reid=result.identityEmbedding?tracker.reidentify(t.id,winner,result.identityEmbedding.values,at):undefined;
            if(reid&&states.get(reid)?.announced){const old=states.get(reid)!;states.delete(t.id);s.view={...s.view,id:reid,cardId:winner,state:'identified',firstSeen:old.view.firstSeen};s.announced=true;s.prompted=old.prompted;states.set(reid,s);visible.add(reid);emit('moved',s);continue;}
            tracker.identify(t.id,winner,result.identityEmbedding?.values);s.view.cardId=winner;
            if(options.getPriors?.()?.decklist?.includes(winner)&&!result.quality.notInDecklist){s.view.state='identified';s.announced=true;emit('placed',s);continue;}
          }
        }
        if(!s.prompted){s.prompted=true;s.view.state='prompt';emit('prompt',s);}
      }
      for(const [id,s] of states)if(!visible.has(id)&&s.announced&&!s.view.removed){
        if(evidence.motion(s.view.card)>.01||!clearFieldBackground(evidence.appearance?.(s.view.card),s.halo)){s.clearAt=undefined;continue;}
        s.clearAt??=at;if(at-s.clearAt>=2500){s.view.removed=true;s.view.visible=false;emit('removed',s);}
      }
    }catch{errors++;}finally{if(frame)closeFieldFrame(frame);}
  }
  function schedule(){if(!active)return;timer=setTimeout(()=>{const start=now();inFlight=tick().finally(()=>{inFlight=undefined;if(active){const settling=[...states.values()].some(s=>!s.read);timer=setTimeout(schedule,Math.max(100,(now()-start)/(settling?.5:.2)));}});},0);}
  return {start(){active=true;schedule();},dispose(){active=false;clearTimeout(timer);listeners.clear();},subscribe(listener:(e:FieldEvent)=>void){listeners.add(listener);return()=>listeners.delete(listener);},getSnapshot(){return {status:errors?'error':'watching',error:errors?`${errors} experimental tracker errors`:undefined,metrics:{errors},tracks:[...states.values()].map(s=>s.view)};}};
}
