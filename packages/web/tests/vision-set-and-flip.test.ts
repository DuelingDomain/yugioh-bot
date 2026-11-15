import {describe, expect, it} from 'vitest';
import {createFieldWatcher, type FieldEvent, type KnownFieldCard} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad, RecognitionResult} from '../../vision/src/types';

function rig(tiers:RecognitionResult['tier'][]=['sure'],paced=false) {
  let at=0, faceDown=true, reads=0, present=true, hand=false, delayFirst=false, activity=false, extraBack=false;
  let finishFirst:(()=>void)|undefined;
  const events:FieldEvent[]=[],known:KnownFieldCard[]=[];
  const quad:DetectedQuad['quad']=[{x:.3,y:.3},{x:.4,y:.3},{x:.4,y:.45},{x:.3,y:.45}];
  const crop=()=>{
    const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const u=x/width,v=y/height;
      const rgb=faceDown?[20,50,180]:u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.7?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.1&&u<.9&&v>.76&&v<.92?(v%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
      data.set([...rgb,255],(y*width+x)*4);
    }
    return {width,height,data};
  };
  const secondary:DetectedQuad={kind:'face-down',confidence:.55,partial:false,quad:[{x:.65,y:.55},{x:.75,y:.55},{x:.75,y:.7},{x:.65,y:.7}]};
  const secondaryCrop={width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(15)};
  const isSecondary=(q:DetectedQuad)=>q.quad[0].x>.6;
  const frame={width:100,height:100,data:new Uint8ClampedArray(40000),colorSpace:'srgb'} satisfies ImageData;
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame,at})},getKnownCards:()=>known,
    recognizer:{separateDetector:true,detectCards:async()=>{if(paced)at+=170;return present?[{quad,kind:faceDown?'face-down':'face-up',confidence:faceDown?.55:.9,partial:false},...(extraBack?[secondary]:[])]:[];},
      recognize:async():Promise<RecognitionResult>=>{const tier=tiers[Math.min(reads++,tiers.length-1)];const result:RecognitionResult={candidates:[{cardId:'A',score:tier==='low match'?.7:.95}],tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:20},backend:'wasm'};if(delayFirst&&reads===1)await new Promise<void>(done=>{finishFirst=done;});return result;}},
    analyze:()=>({...(paced?{scene:{moving:activity?.1:0,sinceMark:1,mark(){}}}:{}),motion:q=>activity&&(Math.max(...q.quad.map(p=>p.x))-Math.min(...q.quad.map(p=>p.x)))*(Math.max(...q.quad.map(p=>p.y))-Math.min(...q.quad.map(p=>p.y)))>.5?.1:0,sharpness:()=>20,crop:q=>extraBack&&isSecondary(q)?secondaryCrop:crop(),appearance:q=>Array(12).fill(extraBack&&isSecondary(q)||faceDown?.1:.6),halo:()=>Array(12).fill(.8),touched:()=>hand?.5:0,occluded:()=>hand}),
  });
  watcher.subscribe(e=>{
    events.push(e);
    if(e.type==='placed') {
      const old=known.find(k=>k.id===e.track.id);
      if(old)Object.assign(old,e.track);else known.push({...e.track});
      watcher.confirm(e.track.id,e.track.cardId,e.track.id,false);
    }
  });
  return {watcher,events,addBack:()=>{extraBack=true;},setActivity:(v:boolean)=>{activity=v;},delayFirstRead:()=>{delayFirst=true;},completeFirstRead:()=>finishFirst?.(),get reads(){return reads;},setPresent:(v:boolean)=>{present=v;},setHand:(v:boolean)=>{hand=v;},setBack:()=>{faceDown=true;},flip:()=>{faceDown=false;},
    async tick(ms=830){at+=ms;await watcher.tick();}};
}

describe('Set confirmation across CPU detector intervals',()=>{
  it('admits a sparse back and retries a weak reveal on the same ref',async()=>{
    const r=rig(['low match','sure']);
    try {
      for(let i=0;i<4;i++)await r.tick();
      const sets=r.events.filter(e=>e.type==='placed'&&e.track.faceDown);
      expect(sets).toHaveLength(1);
      const ref=sets[0].track.id;
      r.flip();
      for(let i=0;i<8;i++)await r.tick();
      const reveal=r.events.find(e=>e.type==='placed'&&!e.track.faceDown);
      expect(reveal?.track.id).toBe(ref);
      expect(reveal?.track.cardId).toBe('A');
      expect(r.events.some(e=>e.type==='prompt')).toBe(false);
      expect(r.reads).toBe(2);
    } finally {r.watcher.dispose();}
  });
  it('prompts after two failed reveal reads without publishing an identity',async()=>{
    const r=rig(['low match']);
    try {
      for(let i=0;i<4;i++)await r.tick();
      const ref=r.events.find(e=>e.type==='placed')?.track.id;
      expect(ref).toBeDefined();
      r.flip();
      for(let i=0;i<12;i++)await r.tick();
      expect(r.reads).toBe(2);
      expect(r.events.filter(e=>e.type==='placed'&&!e.track.faceDown)).toHaveLength(0);
      const prompts=r.events.filter(e=>e.type==='prompt');
      expect(prompts).toHaveLength(1);
      expect(prompts[0].track.id).toBe(ref);
      expect(prompts[0].track.cardId).toBeUndefined();
    } finally {r.watcher.dispose();}
  });
  it('finishes a recent detector-witnessed reveal when the detector misses the released card',async()=>{
    const r=rig();
    try {
      for(let i=0;i<4;i++)await r.tick();
      const ref=r.events.find(e=>e.type==='placed')?.track.id;
      expect(ref).toBeDefined();
      r.flip();r.setHand(true);
      await r.tick();
      r.setHand(false);r.setPresent(false);
      for(let i=0;i<10;i++)await r.tick(100);
      const reveal=r.events.find(e=>e.type==='placed'&&!e.track.faceDown);
      expect(reveal?.track.id).toBe(ref);
      expect(reveal?.track.cardId).toBe('A');
    } finally {r.watcher.dispose();}
  });
  it.each(['unwitnessed','expired','back'] as const)('does not reveal from %s pixels after detector absence',async scenario=>{
    const r=rig();
    try {
      for(let i=0;i<4;i++)await r.tick();
      expect(r.events.filter(e=>e.type==='placed'&&e.track.faceDown)).toHaveLength(1);
      r.flip();
      if(scenario!=='unwitnessed'){r.setHand(true);await r.tick();r.setHand(false);}
      r.setPresent(false);
      if(scenario==='expired')await r.tick(1600);
      if(scenario==='back')r.setBack();
      for(let i=0;i<10;i++){r.watcher.scanNow({gentle:true});await r.tick(100);}
      expect(r.reads).toBe(0);
      expect(r.events.filter(e=>e.type==='placed'&&!e.track.faceDown)).toHaveLength(0);
    } finally {r.watcher.dispose();}
  });
  it('retains the Set ref when a hand interrupts the first reveal read',async()=>{
    const r=rig();
    try {
      for(let i=0;i<4;i++)await r.tick();
      const ref=r.events.find(e=>e.type==='placed')?.track.id;
      expect(ref).toBeDefined();
      r.flip();r.setHand(true);r.delayFirstRead();await r.tick();
      r.setHand(false);r.setPresent(false);r.setActivity(true);
      for(let i=0;i<3;i++)await r.tick(100);
      expect(r.reads).toBe(1);
      expect(r.events.filter(e=>e.type==='placed'&&!e.track.faceDown)).toHaveLength(0);
      r.setHand(true);await r.tick(100);r.completeFirstRead();r.setHand(false);
      for(let i=0;i<6;i++)await r.tick(100);
      const reveal=r.events.find(e=>e.type==='placed'&&!e.track.faceDown);
      expect(reveal?.track.id).toBe(ref);
      expect(reveal?.track.cardId).toBe('A');
    } finally {r.completeFirstRead();r.watcher.dispose();}
  });
});

it('settles a new front locally while there is motion elsewhere on the mat',async()=>{
  const r=rig(['not sure'],true);
  try {
    r.flip();r.setActivity(true);
    await r.tick();
    for(let i=0;i<5;i++)await r.tick(100);
    expect(r.events.filter(e=>e.type==='placed'&&!e.track.faceDown)).toHaveLength(1);
    expect(r.events.find(e=>e.type==='placed')?.track.cardId).toBe('A');
    const placed=r.events.find(e=>e.type==='placed')!;
    expect(placed.track.lastSeen-placed.track.firstSeen).toBeLessThanOrEqual(400);
  } finally {r.watcher.dispose();}
});

it('local front confirmation does not admit an unrelated back while the scene moves',async()=>{
  const r=rig(['not sure'],true);
  try {
    r.flip();r.addBack();r.setActivity(true);
    await r.tick();
    for(let i=0;i<2;i++)await r.tick(100);
    expect(r.events.some(e=>e.type==='placed'&&!e.track.faceDown)).toBe(true);
    expect(r.events.filter(e=>e.type==='placed'&&e.track.faceDown)).toEqual([]);
  } finally {r.watcher.dispose();}
});
