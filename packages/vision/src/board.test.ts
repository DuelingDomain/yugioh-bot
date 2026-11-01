import test from 'node:test';
import assert from 'node:assert/strict';
import * as board from './board';
import { RecognitionPipeline } from './pipeline';
import { yugioh } from './games/yugioh';
import type { DetectedQuad, LoadedIndex } from './types';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
import { createRecognizer } from './client';

const card = (x: number, y: number, w = .15, h = .25): DetectedQuad => ({
  quad: [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}], kind:'face-up', confidence:.95, partial:false,
});
const frame = {width:100,height:100,data:new Uint8ClampedArray(40_000).fill(120)};
function pipeline() {
  const profile = {...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const index = {meta:{dim:2,count:2,entries:[{cardId:'A',name:'Alpha'},{cardId:'B',name:'Beta'}]},vectors:new Float32Array([1,0,0,1])} as LoadedIndex;
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  const detector = {backend:'wasm',run:()=>{throw new Error('supplied outlines must avoid repeated detection');}} as unknown as ModelSession;
  const embedder = {backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([1,0])}})} as unknown as ModelSession;
  return new RecognitionPipeline(profile,index,detector,embedder,Tensor as unknown as TensorCtor);
}
test('near/far assignment uses source frame midpoint, including the far-side tie', () => {
  assert.equal(typeof board.boardSide,'function');
  let correct=0;
  for(let i=0;i<100;i++) {
    const y=i/100;
    if(board.boardSide(y)===(y>.5?'near':'far')) correct++;
  }
  assert.equal(correct,100);
});
test('covered guard catches distinct overlap but ignores duplicates, touching and separated cards', () => {
  assert.equal(typeof board.isCovered,'function');
  const target=card(.1,.1,.3,.5);
  for(const other of [card(.25,.2,.3,.5),card(.15,.3,.3,.5),card(.15,.2,.1,.3)]) assert.equal(board.isCovered(target,[target,other]),true);
  for(const other of [card(.1,.1,.3,.5),card(.4,.1,.3,.5),card(.7,.1,.2,.5)]) assert.equal(board.isCovered(target,[target,other]),false);
  assert.equal(board.coveredBy(card(.25,.2,.3,.5),[target],target),true);
});
test('client exposes both worker operations and abort releases its worker for another read', async () => {
  const original=globalThis.Worker, messages:Record<string,unknown>[]=[], workers:FakeWorker[]=[];
  class FakeWorker {
    onmessage?: (e:{data:unknown})=>void;
    terminated=false;
    constructor(){workers.push(this);}
    postMessage(message:Record<string,unknown>){
      messages.push(message);
      if(message.type==='init') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:null}}));
      if(message.type==='peek') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{name:'Alpha',tier:'sure'}}}));
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker as unknown as typeof Worker;
  const reader=createRecognizer({backend:'wasm'});
  try {
    assert.equal((await reader.peek(frame as ImageData,{card:card(.1,.1)})).name,'Alpha');
    const controller=new AbortController();
    const reading=reader.readAll(frame as ImageData,{cards:[],signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(reader.peek(frame as ImageData,{card:card(.1,.1)}),/in progress/);
    controller.abort();await assert.rejects(reading,{name:'AbortError'});
    assert.equal(workers[0].terminated,true);
    await reader.peek(frame as ImageData,{card:card(.1,.1)});
    assert.equal(workers.length,2);
    assert.equal('signal' in (messages.find(m=>m.type==='readAll')!.opts as object),false);
  } finally {reader.dispose();globalThis.Worker=original;}
});
test('peek returns the best local name without exporting pixels and covered answers cannot be sure', async () => {
  const reader=pipeline(), target=card(.1,.1,.3,.5);
  assert.equal(typeof reader.peek,'function');
  const clean=await reader.peek(frame,{card:target});
  assert.equal(clean.name,'Alpha');assert.equal(clean.tier,'sure');
  assert.equal('warpedCard' in clean,false);assert.equal('cropJpeg' in clean,false);
  const covered=await reader.peek(frame,{card:target,cards:[target,card(.25,.2,.3,.5)]});
  assert.equal(covered.covered,true);assert.equal(covered.tier,'not sure');
  const direct=await reader.recognize([frame],{card:{...target,covered:true}});
  assert.equal(direct.quality.covered,true);assert.equal(direct.tier,'not sure');
});
test('read all preserves slots and face-down uncertainty, groups sides and limits work', async () => {
  const reader=pipeline(), cards=[card(.1,.1),card(.6,.65),{...card(.3,.65),kind:'face-down' as const}];
  assert.equal(typeof reader.readAll,'function');
  const result=await reader.readAll(frame,{cards});
  assert.equal(result.far.length,1);assert.equal(result.near.length,2);
  assert.equal(result.near[0].name,'Alpha');assert.equal(result.near[1].name,null);
  assert.equal(result.near[1].faceDown,true);assert.equal(result.near[1].tier,'not sure');
  assert.ok(result.timingsMs.total>=0);
  await assert.rejects(reader.readAll(frame,{cards:Array(61).fill(cards[0])}),/60/);
  await assert.rejects(reader.readAll(frame,{cards:[{...cards[0],quad:[]}]}),/quad/);
});

// The field watcher is deterministic with timestamped native-frame samples.
import * as field from './field-watcher';
import * as zones from './field-zones';
import type { RecognitionResult } from './types';
const sureResult = (tier: RecognitionResult['tier'] = 'sure') => ({candidates:[{cardId:'A',score:.95},{cardId:'B',score:.5}],tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:10,fallback:false},timingsMs:{total:20},backend:'wasm'}) as RecognitionResult;
function fieldRig(tier: RecognitionResult['tier'] = 'sure') {
  let at=0, outlines:DetectedQuad[]=[card(.3,.3)], motion=0, detail=1, appearance=Array(12).fill(.2), hidden=false, busy=false, reads=0, detects=0;
  const events:field.FieldEvent[]=[], inputs:{frame:ImageData;opts:any}[]=[];
  const reader={detectCards:async()=>{detects++;return structuredClone(outlines);},recognize:async(frames:ImageData[],opts:any)=>{reads++;inputs.push({frame:frames[0],opts});return sureResult(tier);}};
  const watcher=field.createFieldWatcher({recognizer:reader,profile:yugioh,buffer:{sample:async()=>({frame:{...frame,data:new Uint8ClampedArray(frame.data).fill(detail)} as ImageData,at})},
    getPriors:()=>({decklist:['A']}),hidden:()=>hidden,cpuBusy:()=>busy,now:()=>at,
    analyze:()=>({motion:()=>motion,sharpness:()=>detail,appearance:()=>appearance}),clone:async f=>f});
  watcher.subscribe(event=>events.push(event));
  return {watcher,events,inputs,get reads(){return reads;},get detects(){return detects;},
    async tick(ms=333){at+=ms;await watcher.tick();},set outlines(v:DetectedQuad[]){outlines=v;},set motion(v:number){motion=v;},set detail(v:number){detail=v;},set appearance(v:number[]){appearance=v;},set hidden(v:boolean){hidden=v;},set busy(v:boolean){busy=v;}};
}
test('field watcher waits for stillness, reads once with deck priors and binds the sharpest frame to its quad', async()=>{
  const r=fieldRig();await r.tick();await r.tick();r.detail=20;await r.tick();r.detail=2;await r.tick();await r.tick();
  assert.equal(r.reads,1);assert.equal(r.events.filter(e=>e.type==='placed').length,1);
  assert.equal(r.inputs[0].frame.data[0],20);assert.deepEqual(r.inputs[0].opts.priors,{decklist:['A']});
  assert.deepEqual(r.inputs[0].opts.card.quad,card(.3,.3).quad);
  for(let i=0;i<8;i++)await r.tick();assert.equal(r.reads,1);
  const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[card(.4,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);assert.ok(r.events.some(e=>e.type==='moved'));
  r.watcher.dispose();
});
test('field watcher rejects motion, low confidence, partial and covered placements',async()=>{
  for(const obstacle of ['motion','confidence','partial','covered']) {
    const r=fieldRig();if(obstacle==='motion')r.motion=.2;
    else r.outlines=[{...card(.3,.3),...(obstacle==='confidence'?{confidence:.45}:obstacle==='partial'?{partial:true}:{covered:true})}];
    for(let i=0;i<10;i++)await r.tick();assert.equal(r.reads,0,obstacle);assert.equal(r.events.length,0,obstacle);r.watcher.dispose();
  }
});
test('uncertain results prompt with five alternatives, require confirmation and do not retry',async()=>{
  const r=fieldRig('not sure');for(let i=0;i<8;i++)await r.tick();
  assert.equal(r.events.filter(e=>e.type==='placed').length,0);assert.equal(r.events.filter(e=>e.type==='prompt').length,1);assert.equal(r.reads,1);
  r.watcher.confirm(r.watcher.getSnapshot().tracks[0].id,'B');for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,1);r.watcher.dispose();
});
test('face-down placements contain no identity or embedder call; turning up reads under the same id',async()=>{
  const r=fieldRig();r.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,0);const placed=r.events.find(e=>e.type==='placed')!;assert.equal(placed.track.cardId,undefined);const id=placed.track.id;
  r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,1);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.ok(r.events.some(e=>e.type==='flipped'));r.watcher.dispose();
});
test('disappearance needs two clear seconds and emits a suggestion once, preserving id on occlusion',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];r.motion=.2;for(let i=0;i<10;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  r.outlines=[card(.3,.3)];r.motion=0;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);
  r.outlines=[];for(let i=0;i<5;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  for(let i=0;i<6;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.watcher.dispose();
});
test('hidden and busy tabs do not infer or count time toward a stable placement',async()=>{
  const r=fieldRig();await r.tick();r.hidden=true;for(let i=0;i<10;i++)await r.tick();assert.equal(r.detects,1);
  r.hidden=false;r.busy=true;await r.tick();assert.equal(r.detects,1);r.busy=false;await r.tick();assert.equal(r.reads,0);
  for(let i=0;i<5;i++)await r.tick();assert.equal(r.reads,1);r.watcher.dispose();
});
test('field calibration maps perspective grid, side piles, EMZ and defense orientation',()=>{
  const calibration=zones.createFieldCalibration([{x:.1,y:.1},{x:.9,y:.15},{x:.85,y:.95},{x:.15,y:.9}]);
  assert.equal(zones.mapFieldZone(card(.44,.35,.04,.06),calibration).zone,'M3');
  assert.equal(zones.mapFieldZone(card(.44,.68,.04,.06),calibration).zone,'S3');
  assert.equal(zones.mapFieldZone(card(.84,.35,.04,.06)).zone,'GY');
  assert.equal(zones.mapFieldZone(card(.84,.7,.04,.06)).zone,'DECK');
  assert.equal(zones.mapFieldZone(card(.1,.7,.04,.06)).zone,'EXTRA');
  assert.equal(zones.mapFieldZone(card(.35,.05,.04,.06)).zone,'EMZ1');
  assert.equal(zones.fieldOrientation(card(.3,.3,.3,.12),1920,1080),'defense');
  assert.throws(()=>zones.createFieldCalibration([{x:0,y:0},{x:0,y:0}]),/calibration/i);
});

test('a large move through a brief hand occlusion keeps the physical id without another read',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];r.motion=.2;await r.tick();await r.tick();r.motion=0;r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);r.watcher.dispose();
});
test('known instances emit moves and recalibration remaps settled cards',async()=>{
  let at=0,outlines=[card(.3,.3)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{throw new Error('known must not reread');}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known',card:card(.3,.3),zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  outlines=[card(.4,.3)];for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.ok(events.some(e=>e.type==='moved'));
  watcher.setCalibration(zones.createFieldCalibration([{x:.4,y:.1},{x:.95,y:.95}]));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(watcher.getSnapshot().tracks[0].zone,'FIELD');assert.ok(events.some(e=>e.type==='moved'&&e.track.zone==='FIELD'));watcher.dispose();
});
test('the adaptive CPU guard permits slow samples to settle instead of resetting forever',async()=>{
  let at=0,reads=0;
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>{at+=250;return [card(.3,.3)];},recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  for(let i=0;i<8;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}assert.equal(reads,1);watcher.dispose();
});
test('reappearance replaces a stale removal suggestion with a reconciliation prompt',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.outlines=[];for(let i=0;i<9;i++)await r.tick();
  assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.ok(r.events.some(e=>e.type==='prompt'&&e.reason==='reappeared'));assert.equal(r.reads,1);r.watcher.dispose();
});

test('a stationary arm over the last clear halo suppresses removal until the surround clears',async()=>{
  let at=0,outlines=[card(.3,.3)],halo=Array(12).fill(.2);const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,halo:()=>halo}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  outlines=[];halo=Array(12).fill(.7);for(let i=0;i<12;i++){at+=333;await watcher.tick();}assert.equal(events.filter(e=>e.type==='removed').length,0);
  halo=Array(12).fill(.2);for(let i=0;i<8;i++){at+=333;await watcher.tick();}assert.equal(events.filter(e=>e.type==='removed').length,1);watcher.dispose();
});
test('stopping a watcher during inference discards its late placement result',async()=>{
  let at=0,resolve!:(result:RecognitionResult)=>void;const delayed=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:()=>delayed},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});watcher.subscribe(e=>events.push(e));
  for(let i=0;i<4;i++){at+=333;await watcher.tick();}at+=333;const pending=watcher.tick();await new Promise(r=>setImmediate(r));watcher.dispose();resolve(sureResult());await pending;assert.equal(events.length,0);
});

test('a different card after disappearance is recognized as a new physical instance',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];await r.tick();r.appearance=Array(12).fill(.8);r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,2);assert.ok(r.events.some(e=>e.type==='placed'&&e.track.id!==id));r.watcher.dispose();
});
test('a face-down twin flipped while paused is reconciled and read under its existing id',async()=>{
  let at=0,reads=0;const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'set-card',zone:'M2',faceDown:true,position:'defense'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(reads,1);assert.ok(events.some(e=>e.type==='flipped'));assert.ok(events.some(e=>e.type==='moved'&&e.track.position==='attack'));assert.equal(watcher.getSnapshot().tracks[0].id,'set-card');watcher.dispose();
});
test('dismissing a false removal preserves identified tracking and future moves',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[];for(let i=0;i<9;i++)await r.tick();r.watcher.dismiss(id);
  assert.equal(r.watcher.getSnapshot().tracks[0].state,'identified');r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();r.outlines=[card(.4,.3)];for(let i=0;i<6;i++)await r.tick();assert.ok(r.events.some(e=>e.type==='moved'));r.watcher.dispose();
});

test('normal native-buffer timestamp jitter never splits a known physical track',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known-jitter',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  for(const time of [200,400,800,1000,1200,1600,1800,2000,2400]){at=time;await watcher.tick();}
  assert.equal(reads,0);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-jitter');watcher.dispose();
});

test('a pre-existing face-up unknown twin can acquire identity without another placement ref',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'unknown-public',zone:'M2',faceDown:false}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks[0].id,'unknown-public');assert.equal(watcher.getSnapshot().tracks[0].cardId,'A');watcher.dispose();
});

test('one missed sample before a known card settles cannot create another instance',async()=>{
  let at=0,reads=0,outlines=[card(.3,.3)];const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known-early-miss',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  at=333;await watcher.tick();outlines=[];at=666;await watcher.tick();outlines=[card(.3,.3)];for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(reads,0);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-early-miss');watcher.dispose();
});
