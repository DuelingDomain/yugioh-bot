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
      if(message.type==='init'||message.type==='prepare') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:null}}));
      if(message.type==='peek') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{name:'Alpha',tier:'sure'}}}));
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker as unknown as typeof Worker;
  const reader=createRecognizer({backend:'wasm'});
  try {
    await Promise.all([reader.prepare(),reader.prepare()]);
    assert.equal(messages.filter(m=>m.type==='prepare').length,1);
    assert.equal((await reader.peek(frame as ImageData,{card:card(.1,.1)})).name,'Alpha');
    const controller=new AbortController();
    const reading=reader.readAll(frame as ImageData,{cards:[],signal:controller.signal});
    await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(reader.peek(frame as ImageData,{card:card(.1,.1)}),/in progress/);
    controller.abort();await assert.rejects(reading,{name:'AbortError'});
    assert.equal(workers[0].terminated,true);
    await reader.peek(frame as ImageData,{card:card(.1,.1)});
    assert.equal(workers.length,2);
    await reader.prepare();assert.equal(messages.filter(m=>m.type==='prepare').length,2);
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
function fieldRig(tier: RecognitionResult['tier'] = 'sure',maxTracks=20) {
  let at=0, outlines:DetectedQuad[]=[card(.3,.3)], motion=0, detail=1, appearance=Array(12).fill(.2), halo:number[]|undefined=Array(192).fill(.2), hidden=false, busy=false, reads=0, detects=0, identity='A', decklist=['A'], known:field.KnownFieldCard[]=[];
  const events:field.FieldEvent[]=[], inputs:{frame:ImageData;opts:any}[]=[];
  const reader={detectCards:async()=>{detects++;return structuredClone(outlines);},recognize:async(frames:ImageData[],opts:any)=>{reads++;inputs.push({frame:frames[0],opts});return {...sureResult(tier),candidates:[{cardId:identity,score:.95}]};}};
  const watcher=field.createFieldWatcher({recognizer:reader,profile:yugioh,maxTracks,buffer:{sample:async()=>({frame:{...frame,data:new Uint8ClampedArray(frame.data).fill(detail)} as ImageData,at})},
    getPriors:()=>({decklist}),getKnownCards:()=>known,hidden:()=>hidden,cpuBusy:()=>busy,now:()=>at,
    analyze:()=>({motion:()=>motion,sharpness:()=>detail,appearance:()=>appearance,halo:()=>halo??[]}),clone:async f=>f});
  watcher.subscribe(event=>events.push(event));
  return {watcher,events,inputs,get reads(){return reads;},get detects(){return detects;},
    async tick(ms=333){at+=ms;await watcher.tick();},set identity(v:string){identity=v;},set decklist(v:string[]){decklist=v;},set known(v:field.KnownFieldCard[]){known=v;},set outlines(v:DetectedQuad[]){outlines=v;},set motion(v:number){motion=v;},set detail(v:number){detail=v;},set appearance(v:number[]){appearance=v;},set halo(v:number[]|undefined){halo=v;},set hidden(v:boolean){hidden=v;},set busy(v:boolean){busy=v;}};
}
test('field watcher waits for stillness, reads twice with deck priors and binds the sharpest frame to its quad', async()=>{
  const r=fieldRig();await r.tick();await r.tick();r.detail=20;await r.tick();r.detail=2;await r.tick();await r.tick();await r.tick();
  assert.equal(r.reads,2);assert.equal(r.events.filter(e=>e.type==='placed').length,1);
  assert.equal(r.inputs[0].frame.data[0],20);assert.deepEqual(r.inputs[0].opts.priors,{decklist:['A']});
  assert.deepEqual(r.inputs[0].opts.card.quad,card(.3,.3).quad);
  for(let i=0;i<8;i++)await r.tick();assert.equal(r.reads,2);
  const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[card(.4,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,2);assert.ok(r.events.some(e=>e.type==='moved'));
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
  r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.ok(r.events.some(e=>e.type==='flipped'));r.watcher.dispose();
});
test('disappearance needs sustained clear absence and emits once, preserving id on occlusion',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];r.motion=.2;for(let i=0;i<10;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  r.outlines=[card(.3,.3)];r.motion=0;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,2);
  r.outlines=[];for(let i=0;i<5;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  for(let i=0;i<6;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.watcher.dispose();
});

test('departure needs 2.5 seconds from the first clear miss, never motion, stationary hands or unknown mat pixels',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.outlines=[];
  for(let i=0;i<8;i++)await r.tick(300);assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  await r.tick(300);assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  await r.tick(300);assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.watcher.dispose();
  for(const obstacle of ['stationary-hand','halo','no-halo','motion','cpu'] as const){
    const q=fieldRig();if(obstacle==='no-halo')q.halo=undefined;for(let i=0;i<6;i++)await q.tick();q.outlines=[];
    if(obstacle==='stationary-hand')q.appearance=Array(12).fill(.7);
    if(obstacle==='halo')q.halo=Array(192).fill(.3);
    if(obstacle==='motion')q.motion=.015;
    if(obstacle==='cpu')q.busy=true;
    for(let i=0;i<24;i++)await q.tick(300);
    assert.equal(q.events.filter(e=>e.type==='removed').length,0,obstacle);q.watcher.dispose();
  }
});

test('clear-mat evidence requires uniform surrounding pixels and rejects a stationary hand inside the old quad',async()=>{
  const {clearFieldBackground}=await import('./field-motion');
  assert.equal(typeof clearFieldBackground,'function');
  const mat=Array(96).fill([.15,.23,.18]).flat();
  assert.equal(clearFieldBackground(mat,mat),true);
  assert.equal(clearFieldBackground(Array(96).fill([.75,.55,.4]).flat(),mat),false);
  assert.equal(clearFieldBackground(mat,undefined),false);
  assert.equal(clearFieldBackground(mat,mat.map((v,i)=>i%4?v:.9)),false);
});
test('hidden and busy tabs do not infer or count time toward a stable placement',async()=>{
  const r=fieldRig();await r.tick();r.hidden=true;for(let i=0;i<10;i++)await r.tick();assert.equal(r.detects,1);
  r.hidden=false;r.busy=true;await r.tick();assert.equal(r.detects,1);r.busy=false;await r.tick();assert.equal(r.reads,0);
  for(let i=0;i<5;i++)await r.tick();assert.equal(r.reads,2);r.watcher.dispose();
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

test('both calibrated EMZ sit above M2/M4 only in Advanced and Domain',()=>{
  const calibration=zones.createFieldCalibration([{x:.1,y:.1},{x:.9,y:.9}]);
  for(const format of ['normal','domain','genesys','genesys-domain'] as const) {
    for(const [x,expected] of [[.37,'EMZ1'],[.63,'EMZ2']] as const) {
      const onMat=card(.1+x*.8-.012,.168,.024,.024);
      const zone=zones.mapFieldZone(onMat,calibration,[],format).zone;
      assert.equal(zone,format.startsWith('genesys')?(x<.5?'M2':'M4'):expected);
    }
  }
  assert.deepEqual(zones.fieldZoneLocation('EMZ1'),{zone:'extra-monster',slot:1});
  assert.deepEqual(zones.fieldZoneLocation('EMZ2'),{zone:'extra-monster',slot:2});
});
test('EMZ outlines do not shift uncalibrated main-row ordering',()=>{
  const main=[card(.25,.3,.04,.06),card(.65,.3,.04,.06)],extra=[card(.35,.05,.04,.06),card(.61,.05,.04,.06)];
  assert.equal(zones.mapFieldZone(main[1],undefined,main).zone,'M4');
  assert.equal(zones.mapFieldZone(main[1],undefined,[...main,...extra]).zone,'M4');
});

test('a large move through a brief hand occlusion keeps the physical id without another read',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];r.motion=.2;await r.tick();await r.tick();r.motion=0;r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,2);r.watcher.dispose();
});
test('known instances emit moves and recalibration remaps settled cards',async()=>{
  let at=0,outlines=[card(.3,.3)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{throw new Error('known must not reread');}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known',card:card(.3,.3),zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
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
test('verified reappearance follows the same physical ref back to its field zone',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.outlines=[];for(let i=0;i<9;i++)await r.tick();
  assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===r.events[0].track.id));assert.equal(r.reads,2);r.watcher.dispose();
});

test('a face-down return cannot resurrect a departed identity from the pile',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const old=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];for(let i=0;i<10;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,1);
  r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.8);for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===old),false);assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id===old)?.removed,true);r.watcher.dispose();
});

test('departed tombstones are bounded and never exhaust live tracking capacity',async()=>{
  const r=fieldRig('sure',2);
  for(let n=0;n<5;n++){
    r.appearance=Array(12).fill(.3+n*.12);r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();
    assert.equal(r.events.filter(e=>e.type==='placed').length,n+1);
    r.appearance=Array(12).fill(.2);r.outlines=[];for(let i=0;i<10;i++)await r.tick();
    assert.equal(r.events.filter(e=>e.type==='removed').length,n+1);assert.ok(r.watcher.getSnapshot().tracks.length<=4);
  }
  r.watcher.dispose();
});

test('a hidden tab cannot retain a departed identity beyond its return window',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const old=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];for(let i=0;i<10;i++)await r.tick();r.hidden=true;await r.tick(31000);
  r.hidden=false;r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.some(t=>t.id===old),false);r.watcher.dispose();
});

test('absence verification backs off when slow detections cannot accumulate continuous evidence',async()=>{
  let at=0,outlines=[card(.3,.3)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>{at+=1100;return outlines;},recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'slow',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2),halo:()=>Array(192).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}
  outlines=[];for(let i=0;i<20;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}
  assert.equal(events.some(e=>e.type==='removed'),false);assert.ok(watcher.getSnapshot().metrics.intervalMs>200);watcher.dispose();
});

test('a stationary arm over the last clear halo suppresses removal until the surround clears',async()=>{
  let at=0,outlines=[card(.3,.3)],halo=Array(12).fill(.2);const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},getPriors:()=>({decklist:['A']}),now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,halo:()=>halo,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  outlines=[];halo=Array(12).fill(.7);for(let i=0;i<12;i++){at+=333;await watcher.tick();}assert.equal(events.filter(e=>e.type==='removed').length,0);
  halo=Array(12).fill(.2);for(let i=0;i<9;i++){at+=333;await watcher.tick();}assert.equal(events.filter(e=>e.type==='removed').length,1);watcher.dispose();
});
test('stopping a watcher during inference discards its late placement result',async()=>{
  let at=0,resolve!:(result:RecognitionResult)=>void;const delayed=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:()=>delayed},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});watcher.subscribe(e=>events.push(e));
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}await new Promise(r=>setImmediate(r));watcher.dispose();resolve(sureResult());await new Promise(r=>setImmediate(r));assert.equal(events.length,0);
});

test('recognition starts after 500 ms and publishes only after the next clean detector frame',async()=>{
  const r=fieldRig();await r.tick(250);await r.tick(250);assert.equal(r.reads,0);
  await r.tick(250);assert.equal(r.reads,1);assert.equal(r.events.length,0);
  await new Promise(done=>setImmediate(done));await r.tick(250);
  assert.equal(r.events.filter(e=>e.type==='placed').length,0);assert.equal(r.reads,2);for(let i=0;i<3;i++)await r.tick(250);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events[0].latencyMs,1500);r.watcher.dispose();
});
test('a new card gets a short sampling burst even while placement motion is clearing',async()=>{
  const r=fieldRig();r.motion=.2;await r.tick(250);
  assert.equal(r.watcher.getSnapshot().metrics.intervalMs,150);assert.equal(r.reads,0);
  r.motion=0;for(let i=0;i<7;i++)await r.tick(250);assert.equal(r.events.filter(e=>e.type==='placed').length,1);r.watcher.dispose();
});
test('tracking continues during a slow read and motion invalidates the late identity',async()=>{
  let at=0,sampled=0,detects=0,motion=0,resolve!:(r:RecognitionResult)=>void;
  const pending=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>{detects++;return [card(.3,.3)];},recognize:()=>pending},buffer:{sample:async()=>{sampled++;return {frame:frame as ImageData,at};}},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>motion,sharpness:()=>1}),clone:async f=>f});watcher.subscribe(e=>events.push(e));
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}
  motion=.3;at+=250;await watcher.tick();assert.equal(sampled,4);assert.equal(detects,3);
  resolve(sureResult());await new Promise(done=>setImmediate(done));motion=0;at+=250;await watcher.tick();
  assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'candidate');watcher.dispose();
});
test('dismissal while the sharpest-frame clone is pending cannot start a stale read',async()=>{
  let at=0,clones=0,reads=0,unblock!:(value:ImageData)=>void;
  const events:field.FieldEvent[]=[],cloning=new Promise<ImageData>(done=>{unblock=done;});
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>++clones===4?cloning:f});watcher.subscribe(e=>events.push(e));
  at=250;await watcher.tick();at=500;await watcher.tick();at=750;const pending=watcher.tick();await new Promise(done=>setImmediate(done));
  watcher.dismiss(watcher.getSnapshot().tracks[0].id);unblock(frame as ImageData);await pending;
  for(let i=0;i<4;i++){at+=250;await watcher.tick();}
  assert.equal(reads,0);assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'dismissed');watcher.dispose();
});
test('the confirming detector frame must still match the read appearance after inference completes',async()=>{
  let at=0,appearance=Array(12).fill(.2),resolve!:(value:RecognitionResult)=>void;
  const pending=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:()=>pending},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>appearance}),clone:async f=>f});watcher.subscribe(e=>events.push(e));
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}resolve(sureResult());await new Promise(done=>setImmediate(done));
  appearance=Array(12).fill(.8);at+=250;await watcher.tick();assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'candidate');watcher.dispose();
});

test('a different card after disappearance is recognized as a new physical instance',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];await r.tick();r.appearance=Array(12).fill(.8);r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,4);assert.ok(r.events.some(e=>e.type==='placed'&&e.track.id!==id));r.watcher.dispose();
});
test('a face-down twin flipped while paused is reconciled and read under its existing id',async()=>{
  let at=0,reads=0;const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'set-card',card:card(.3,.3),zone:'M2',faceDown:true,position:'defense'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
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
  assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-jitter');watcher.dispose();
});

test('a quad-backed unknown twin keeps its ref and prompts without a registered deck',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'unknown-public',card:card(.3,.3),zone:'M2',faceDown:false}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks[0].id,'unknown-public');assert.equal(watcher.getSnapshot().tracks[0].state,'prompt');watcher.dispose();
});

test('one missed sample before a known card settles cannot create another instance',async()=>{
  let at=0,reads=0,outlines=[card(.3,.3)];const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known-early-miss',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  at=333;await watcher.tick();outlines=[];at=666;await watcher.tick();outlines=[card(.3,.3)];for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-early-miss');watcher.dispose();
});

test('tracked click geometry is visible only while the detector sees the card',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  const outline=r.watcher.getSnapshot().tracks[0].card;r.outlines=[];await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
  r.outlines=[outline];await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  r.watcher.stop();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);r.watcher.dispose();
});

test('busy tracking refreshes known geometry from pixels without inference and invalidates changed cards',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();
  const detects=r.detects,reads=r.reads;r.busy=true;
  for(let i=0;i<6;i++){await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);}
  assert.equal(r.detects,detects);assert.equal(r.reads,reads);
  r.motion=.2;await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
  r.motion=0;await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false,'pixels cannot restore an invalidated outline');
  r.busy=false;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  r.busy=true;r.appearance=Array(12).fill(.8);await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false,'stationary replacements are invalidated');
  const oldRef=r.watcher.getSnapshot().tracks[0].id;r.busy=false;await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id===oldRef)?.visible,false,'the detector cannot restore the old identity onto replacement pixels');
  assert.equal(r.reads,reads);for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,reads+1);r.watcher.dispose();
});

test('pixel refreshes between slow detector samples preserve same-ref movement settlement',async()=>{
  let at=0,outlines=[card(.3,.3,.08,.12)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,cpuBudget:.05,recognizer:{detectCards:async()=>{at+=100;return outlines;},recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>events.push(e));for(let i=0;i<6;i++){at+=750;await watcher.tick();}
  outlines=[card(.45,.3,.08,.12)];for(let i=0;i<20;i++){at+=750;await watcher.tick();}
  assert.ok(watcher.getSnapshot().metrics.intervalMs>750);
  assert.equal(events.filter(e=>e.type==='moved'&&e.track.id==='known'&&e.track.zone==='M3').length,1);watcher.dispose();
});


test('review A: a same-position swap immediately hides old identity and prompts after one new read',async()=>{
  const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const before=r.reads,placed=r.events.filter(e=>e.type==='placed').length;
  r.motion=.2;await r.tick();r.motion=0;r.appearance=Array(12).fill(.8);r.identity='B';await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,undefined);
  for(let i=0;i<7;i++)await r.tick();assert.equal(r.reads,before+1);assert.equal(r.events.filter(e=>e.type==='placed').length,placed);
  assert.equal(r.events.at(-1)?.type,'prompt');assert.equal(r.events.at(-1)?.reason,'changed');r.watcher.dispose();
});
test('review B: different pixels in the next column cannot inherit a departing identity without a missed sample',async()=>{
  const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const old=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[card(.428,.3)];r.appearance=Array(12).fill(.8);r.identity='B';await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id===old)?.visible,false);assert.equal(r.watcher.getSnapshot().tracks.length,2);
  for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===old),false);r.watcher.dispose();
});
test('review B4: a zone-only restart reads Y before binding known X and prompts on disagreement',async()=>{
  const r=fieldRig();r.known=[{id:'old-X',zone:'M2',cardId:'X'}];r.identity='Y';for(let i=0;i<7;i++)await r.tick();
  assert.equal(r.reads,1);assert.equal(r.watcher.getSnapshot().tracks.some(t=>t.id==='old-X'),false);assert.equal(r.events.at(-1)?.type,'prompt');r.watcher.dispose();
});
test('review S4: auto placement requires two independent agreeing reads and deck membership',async()=>{
  const r=fieldRig();for(let i=0;i<3;i++)await r.tick();assert.equal(r.events.length,0);await r.tick();assert.equal(r.events.length,0);
  for(let i=0;i<3;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.notEqual(r.inputs[0].frame,r.inputs[1].frame);r.watcher.dispose();
  for(const deck of [[],['B']]){const q=fieldRig();q.decklist=deck;for(let i=0;i<7;i++)await q.tick();assert.equal(q.events.filter(e=>e.type==='placed').length,0);assert.equal(q.events.at(-1)?.type,'prompt');q.watcher.dispose();}
});
test('review C/D: pile outlines of either face never create automatic placements',async()=>{
  for(const [x,y] of [[.87,.32],[.87,.03],[.87,.7],[.03,.7]])for(const faceDown of [true,false]){
    const r=fieldRig();r.outlines=[{...card(x,y,.05,.07),kind:faceDown?'face-down':'face-up'}];for(let i=0;i<7;i++)await r.tick();
    assert.equal(r.events.some(e=>e.type==='placed'),false,`${x}/${y}/${faceDown}`);r.watcher.dispose();
  }
});
test('review S2: a five-card fan and three new separate outlines cannot auto-place',async()=>{
  for(const spacing of [.035,.14]){const r=fieldRig();r.outlines=Array.from({length:5},(_,i)=>card(.2+i*spacing,.3,.08,.12));for(let i=0;i<20;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='placed'),false);assert.ok(r.events.filter(e=>e.type==='prompt').length<=1);r.watcher.dispose();}
});
test('review F: uncalibrated M2/M4 columns stay absolute when other cards appear',()=>{
  const pair=[card(.34,.3,.04,.06),card(.6,.3,.04,.06)];assert.equal(zones.mapFieldZone(pair[0],undefined,pair).zone,'M2');assert.equal(zones.mapFieldZone(pair[1],undefined,pair).zone,'M4');
});

test('review E: a removed monster reappearing on GY moves its original ref, never places another',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[];for(let i=0;i<12;i++)await r.tick();
 r.outlines=[card(.84,.3)];for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='moved'&&e.track.id===id&&e.track.zone==='GY').length,1);r.watcher.dispose();
});
test('review S3: forgetting a placement suppresses auto reapply for the same physical evidence',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.watcher.forget(r.watcher.getSnapshot().tracks[0].id);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.at(-1)?.reason,'suppressed');r.watcher.dispose();
});

test('a different face revealed after a flip never restores the hidden old identity',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.8);for(let i=0;i<7;i++)await r.tick();
 r.outlines=[card(.3,.3)];await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,undefined);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.at(-1)?.reason,'changed');r.watcher.dispose();
});
test('disagreeing second read prompts instead of placing',async()=>{
 const r=fieldRig();r.decklist=['A','B'];for(let i=0;i<3;i++)await r.tick();r.identity='B';for(let i=0;i<5;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.events.some(e=>e.type==='placed'),false);assert.equal(r.events.at(-1)?.type,'prompt');r.watcher.dispose();
});
test('calibrated candidates outside the mat are rejected',async()=>{
 const r=fieldRig();r.watcher.setCalibration(zones.createFieldCalibration([{x:.4,y:.4},{x:.95,y:.95}]));for(let i=0;i<10;i++)await r.tick();assert.equal(r.reads,0);assert.equal(r.events.length,0);r.watcher.dispose();
});

test('a deck spread staggered across 1.5 seconds stays prompt-only',async()=>{
 const r=fieldRig();for(let i=0;i<5;i++)await r.tick(200);r.outlines=[card(.3,.3),card(.49,.3)];await r.tick(200);r.outlines=[card(.3,.3),card(.49,.3),card(.68,.3)];for(let i=0;i<15;i++)await r.tick(200);assert.equal(r.events.some(e=>e.type==='placed'),false);assert.ok(r.events.some(e=>e.type==='prompt'));r.watcher.dispose();
});
test('Undo suppression belongs to physical appearance, not every later card in the same column',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();r.watcher.forget(r.watcher.getSnapshot().tracks[0].id);r.appearance=Array(12).fill(.8);for(let i=0;i<8;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,2);r.watcher.dispose();
});

test('pending zone-only bindings reserve known refs before concurrent reads finish',async()=>{
 const r=fieldRig();r.known=[{id:'known-A',zone:'M2',cardId:'A'}];r.outlines=[card(.31,.3,.03,.06),card(.36,.3,.03,.06)];for(let i=0;i<14;i++)await r.tick();const ids=r.watcher.getSnapshot().tracks.map(t=>t.id);assert.equal(ids.filter(id=>id==='known-A').length,1);assert.equal(new Set(ids).size,ids.length);r.watcher.dispose();
});
test('held cards much larger than settled cards require a prompt',async()=>{
 const r=fieldRig();r.outlines=[card(.2,.3,.06,.1)];for(let i=0;i<8;i++)await r.tick();r.outlines=[card(.2,.3,.06,.1),card(.5,.25,.2,.3)];for(let i=0;i<8;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.at(-1)?.type,'prompt');r.watcher.dispose();
});
test('a transient camera-frame wait is starting, without an unavailable error',async()=>{
 const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[],recognize:async()=>sureResult()},buffer:{sample:async()=>{throw Error('Waiting for a camera frame');}},hidden:()=>false});await watcher.tick();assert.equal(watcher.getSnapshot().status,'starting');assert.equal(watcher.getSnapshot().error,undefined);assert.equal(watcher.getSnapshot().metrics.errors,0);watcher.dispose();
});

test('full detector samples hide mismatching identity even while motion prevents a replacement read',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();r.appearance=Array(12).fill(.8);r.motion=.2;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);r.watcher.dispose();
});
test('an old prompt loses its evidence revision when replacement pixels arrive',async()=>{
 const r=fieldRig('not sure');for(let i=0;i<8;i++)await r.tick();const old=r.events.at(-1)!.track;assert.equal(old.state,'prompt');r.appearance=Array(12).fill(.8);await r.tick();const current=r.watcher.getSnapshot().tracks[0];assert.equal(current.state,'candidate');assert.equal(current.visible,false);assert.equal(current.revision,(old.revision??0)+1);r.watcher.dispose();
});

test('an optional priors provider returning undefined still recognizes full catalog and prompts',async()=>{
 let at=0;const events:field.FieldEvent[]=[];const watcher=field.createFieldWatcher({profile:yugioh,getPriors:()=>undefined as any,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});watcher.subscribe(event=>events.push(event));for(let i=0;i<8;i++){at+=333;await watcher.tick();}assert.equal(watcher.getSnapshot().error,undefined);assert.equal(events.at(-1)?.type,'prompt');watcher.dispose();
});

test('quiet empty-mat pixel checks skip inference but new motion starts detection before the idle budget',async()=>{
 const r=fieldRig();r.outlines=[];await r.tick(100);const before=r.detects;await r.tick(100);assert.equal(r.detects,before);r.motion=.2;r.outlines=[card(.3,.3)];await r.tick(50);assert.equal(r.detects,before+1);assert.equal(r.watcher.getSnapshot().tracks.length,1);r.watcher.dispose();
});
