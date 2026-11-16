import {afterEach,expect,it,vi} from 'vitest';
import {createFieldWatcher,type FieldEvent} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad,RecognitionResult} from '../../vision/src/types';

const watchers:ReturnType<typeof createFieldWatcher>[]=[];
afterEach(()=>{for(const watcher of watchers.splice(0))watcher.dispose();vi.useRealTimers();});

function rig(firstTier:RecognitionResult['tier']='low match',firstMs=228,nameVoting=true,fuseAfterRead=2) {
  vi.useFakeTimers();
  let at=0,hand=false,release:(()=>void)|undefined;
  const ready=new Promise<void>(done=>{release=done;});
  const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,quad:[{x:.3,y:.3},{x:.4,y:.3},{x:.4,y:.45},{x:.3,y:.45}]};
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=x/width,v=y/height;
    const rgb=u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.7?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.1&&u<.9&&v>.76&&v<.92?(v%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    data.set([...rgb,255],(y*width+x)*4);
  }
  const crop={width,height,data},frame:ImageData={...crop,colorSpace:'srgb'};
  const events:FieldEvent[]=[],reads:number[]=[];
  const watcher=createFieldWatcher({profile:yugioh,nameVoting,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame,at})},
    recognizer:{separateDetector:true,detectCards:async()=>[card],recognize:async frames=>{
      reads.push(frames.length);at+=reads.length===1?firstMs:228*frames.length;
      if(reads.length===1)await ready;
      const tier=frames.length===1||reads.length<fuseAfterRead?firstTier:'sure';
      return {candidates:[{cardId:'A',score:tier==='low match'?.65:.95}],tier,quality:{detected:true,cornersFound:true,framesUsed:frames.length,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:228},backend:'wasm'};
    }},
    analyze:()=>({motion:()=>0,sharpness:()=>20,crop:()=>crop,appearance:()=>Array(12).fill(.6),halo:()=>Array(12).fill(.8),touched:()=>hand?.5:0,occluded:()=>hand}),
  });
  watchers.push(watcher);watcher.subscribe(e=>events.push(e));
  async function tick(){at+=100;await watcher.tick();}
  return {events,reads,tick,hand:()=>{hand=true;},async first(){for(let i=0;i<30&&!reads.length;i++)await tick();expect(reads).toEqual([1]);await tick();await tick();release?.();await Promise.resolve();}};
}

it('a sure first read places without waiting for the voting window',async()=>{
  const r=rig('sure');await r.first();await r.tick();await r.tick();
  expect(r.events.some(e=>e.type==='placed'&&e.track.cardId==='A')).toBe(true);
  expect(r.reads).toEqual([1]);
});

it('an unusable fast first read uses three clean frames to recover a name',async()=>{
  const r=rig();await r.first();await r.tick();await r.tick();await r.tick();
  await vi.advanceTimersByTimeAsync(420);await r.tick();await r.tick();
  expect(r.reads).toEqual([1,3]);
  expect(r.events.some(e=>e.type==='placed'&&e.track.cardId==='A')).toBe(true);
});

it.each([{ms:1121,enabled:true},{ms:228,enabled:false}])('a slow or disabled reader skips extra frames: %j',async({ms,enabled})=>{
  const r=rig('low match',ms,enabled);await r.first();await r.tick();await r.tick();
  await vi.advanceTimersByTimeAsync(420);
  expect(r.reads.every(frames=>frames===1)).toBe(true);
  expect(r.events.some(e=>e.type==='placed')).toBe(false);
});

it('hand contact during the window cannot feed a vote or place a card',async()=>{
  const r=rig();await r.first();r.hand();await r.tick();await r.tick();await r.tick();
  await vi.advanceTimersByTimeAsync(420);await r.tick();
  expect(r.reads.every(frames=>frames===1)).toBe(true);
  expect(r.events.some(e=>e.type==='placed')).toBe(false);
});

it('an unanswered resting card feeds fresh background frames into the existing voting mean',async()=>{
 const r=rig('low match',228,true,4);await r.first();await r.tick();await r.tick();await r.tick();
 await vi.advanceTimersByTimeAsync(420);await r.tick();await r.tick();
 expect(r.events.filter(e=>e.type==='prompt')).toHaveLength(1);
 for(let i=0;i<25&&r.reads.length<3;i++)await r.tick();
 await r.tick();await r.tick();await r.tick();await vi.advanceTimersByTimeAsync(420);await r.tick();await r.tick();
 expect(r.reads).toEqual([1,3,1,3]);
 expect(r.events.filter(e=>e.type==='placed'&&e.track.cardId==='A')).toHaveLength(1);
 expect(r.events.filter(e=>e.type==='prompt')).toHaveLength(1);
});
