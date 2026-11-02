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
import {createFieldIdentityGallery} from './field-gallery';
import * as zones from './field-zones';
import type { RecognitionResult } from './types';
const sureResult = (tier: RecognitionResult['tier'] = 'sure') => ({candidates:[{cardId:'A',score:.95},{cardId:'B',score:.5}],tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:10,fallback:false},timingsMs:{total:20},backend:'wasm'}) as RecognitionResult;
function fieldRig(tier: RecognitionResult['tier'] = 'sure',maxTracks=20,gallery?:ReturnType<typeof createFieldIdentityGallery>) {
  let at=0, outlines:DetectedQuad[]=[card(.3,.3)], motion=0, detail=1, appearance=Array(12).fill(.2), halo:number[]|undefined=Array(192).fill(.2), hidden=false, busy=false, reads=0, detects=0, identity='A', decklist=['A'], known:field.KnownFieldCard[]=[],embedding:number[]|undefined,embeddingSpace:'art-box'|'whole-card'='art-box',appearanceAt:((card:DetectedQuad)=>number[])|undefined;
  const events:field.FieldEvent[]=[], inputs:{frame:ImageData;opts:any}[]=[];
  const reader={detectCards:async()=>{detects++;return structuredClone(outlines);},recognize:async(frames:ImageData[],opts:any)=>{reads++;inputs.push({frame:frames[0],opts});return {...sureResult(tier),candidates:[{cardId:identity,score:.95}],...(embedding?{identityEmbedding:{values:embedding.slice(),space:embeddingSpace}}:{})};}};
  const watcher=field.createFieldWatcher({gallery,recognizer:reader,profile:yugioh,maxTracks,buffer:{sample:async()=>({frame:{...frame,data:new Uint8ClampedArray(frame.data).fill(detail)} as ImageData,at})},
    getPriors:()=>({decklist}),getKnownCards:()=>known,hidden:()=>hidden,cpuBusy:()=>busy,now:()=>at,
    analyze:()=>({motion:()=>motion,sharpness:()=>detail,appearance:c=>appearanceAt?.(c)??appearance,halo:()=>halo??[]}),clone:async f=>f});
  watcher.subscribe(event=>events.push(event));
  return {watcher,events,inputs,set appearanceAt(v:((card:DetectedQuad)=>number[])|undefined){appearanceAt=v;},get reads(){return reads;},get detects(){return detects;},get at(){return at;},set embedding(v:number[]){embedding=v;},set embeddingSpace(v:'art-box'|'whole-card'){embeddingSpace=v;},
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
  const r=fieldRig('low match');for(let i=0;i<8;i++)await r.tick();
  assert.equal(r.events.filter(e=>e.type==='placed').length,0);assert.equal(r.events.filter(e=>e.type==='prompt').length,1);assert.equal(r.reads,1);
  r.watcher.confirm(r.watcher.getSnapshot().tracks[0].id,'B');for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,1);r.watcher.dispose();
});
test('one-shot owner prompts: best matches settle normally, bound moves stay quiet and dismissal is final',async()=>{
  const r=fieldRig('not sure');r.decklist=[];r.embedding=[1,0];
  for(let i=0;i<8;i++)await r.tick();
  const placed=r.events.find(e=>e.type==='placed');assert.ok(placed,'a readable best match is a normal card, even without a deck');
  assert.equal(placed.track.bestMatch,true);r.watcher.confirm(placed.track.id,'A','owner-ref');r.known=[{id:'owner-ref',zone:'M2',cardId:'A'}];
  const reads=r.reads;
  r.appearance=Array.from({length:12},(_,i)=>i%2);r.embedding=[0,1];r.identity='B';
  r.outlines=[card(.31,.3,.25,.15)];for(let i=0;i<30;i++)await r.tick(200);
  assert.equal(r.events.filter(e=>e.type==='prompt').length,0);assert.equal(r.reads,reads,'bound identity is changed only by an explicit correction');
  assert.equal(r.watcher.getSnapshot().tracks[0].id,'owner-ref');assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'A');r.watcher.dispose();
  const restart=fieldRig();restart.known=[{id:'existing-twin',zone:'M2',cardId:'X'}];restart.identity='Y';for(let i=0;i<8;i++)await restart.tick();assert.equal(restart.reads,1);assert.equal(restart.watcher.getSnapshot().tracks[0].id,'existing-twin');assert.equal(restart.watcher.getSnapshot().tracks[0].cardId,'X');assert.equal(restart.events.some(e=>e.type==='prompt'),false);restart.watcher.dispose();
  const q=fieldRig('low match');for(let i=0;i<8;i++)await q.tick();const prompt=q.events.find(e=>e.type==='prompt')!;
  q.watcher.dismiss(prompt.track.id);q.appearance=Array.from({length:12},(_,i)=>i%2);q.identity='B';q.outlines=[card(.4,.3)];
  for(let i=0;i<40;i++)await q.tick(250);
  assert.equal(q.events.filter(e=>e.type==='prompt').length,1);assert.equal(q.reads,1);assert.equal(q.watcher.getSnapshot().tracks[0].state,'dismissed');q.watcher.dispose();
  const history=fieldRig('low match',2);for(let n=0;n<3;n++){history.appearance=Array.from({length:12},(_,i)=>i===n?1:0);history.outlines=[card(.3,.3)];for(let i=0;i<8;i++)await history.tick();const latest=history.events.filter(e=>e.type==='prompt').at(-1)!;history.watcher.dismiss(latest.track.id);history.outlines=[];history.appearance=Array(12).fill(.2);for(let i=0;i<12;i++)await history.tick();}assert.equal(history.events.filter(e=>e.type==='prompt').length,3,'absent dismissals do not exhaust live slots');history.appearance=Array.from({length:12},(_,i)=>i===0?1:0);history.outlines=[card(.3,.3)];for(let i=0;i<8;i++)await history.tick();assert.equal(history.events.filter(e=>e.type==='prompt').length,3,'returning dismissed card stays silent');history.watcher.dispose();
  const ignoredSet=fieldRig();ignoredSet.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await ignoredSet.tick();ignoredSet.watcher.dismiss(ignoredSet.events[0].track.id);ignoredSet.outlines=[];for(let i=0;i<12;i++)await ignoredSet.tick();ignoredSet.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await ignoredSet.tick();assert.equal(ignoredSet.events.filter(e=>e.type==='prompt').length,1);assert.equal(ignoredSet.reads,0);ignoredSet.watcher.dispose();
  const unread=fieldRig('low match');unread.known=[{id:'unread',zone:'M2',faceDown:false}];for(let i=0;i<8;i++)await unread.tick();assert.equal(unread.events.some(e=>e.type==='prompt'),false);assert.equal(unread.watcher.getSnapshot().tracks[0].id,'unread');unread.watcher.dispose();
  const hidden=fieldRig();hidden.known=[{id:'hidden',zone:'M2',faceDown:true}];for(let i=0;i<8;i++)await hidden.tick();assert.ok(hidden.events.some(e=>e.type==='placed'&&e.track.id==='hidden'&&!e.track.faceDown));assert.equal(hidden.events.some(e=>e.type==='prompt'),false);hidden.watcher.dispose();
  const set=fieldRig();set.known=[{id:'public',zone:'M2',cardId:'A',faceDown:false}];set.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await set.tick();assert.ok(set.events.some(e=>e.type==='flipped'&&e.track.id==='public'&&e.track.faceDown));assert.equal(set.events.some(e=>e.type==='prompt'),false);set.watcher.dispose();
});
test('new face-down cards require confirmation without identity or embedding; turning up retains the ref',async()=>{
  const r=fieldRig();r.appearance=Array(12).fill(.8);r.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,0);assert.equal(r.events.some(e=>e.type==='placed'),false);const prompt=r.events.find(e=>e.type==='prompt')!;assert.equal(prompt.track.cardId,undefined);const id=prompt.track.id;r.watcher.confirm(id);
  r.appearance=Array(12).fill(.2);r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.ok(r.events.some(e=>e.type==='flipped'));r.watcher.dispose();
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
  for(let i=0;i<8;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}assert.equal(reads,2);watcher.dispose();
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
    const fingerprint=Array(24).fill(.1);fingerprint[0]=.95;fingerprint[3*(n+1)+1]=.95;fingerprint[3*(n+1)+2]=.8;
    r.appearance=fingerprint;r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();
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
  assert.equal(r.watcher.getSnapshot().metrics.intervalMs,100);assert.equal(r.reads,0);
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
  assert.equal(reads,2);assert.ok(events.some(e=>e.type==='flipped'));assert.ok(events.some(e=>e.type==='moved'&&e.track.position==='attack'));assert.equal(watcher.getSnapshot().tracks[0].id,'set-card');watcher.dispose();
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

test('a quad-backed unknown twin keeps its ref and settles a best match without a registered deck',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'unknown-public',card:card(.3,.3),zone:'M2',faceDown:false}],now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});
  for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.equal(reads,2);assert.equal(watcher.getSnapshot().tracks[0].id,'unknown-public');assert.equal(watcher.getSnapshot().tracks[0].state,'identified');watcher.dispose();
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


test('an unacknowledged same-position swap hides old identity before settling a fresh best match',async()=>{
  const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const before=r.reads,placed=r.events.filter(e=>e.type==='placed').length;
  r.motion=.2;await r.tick();r.motion=0;r.appearance=Array(12).fill(.8);r.identity='B';await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,undefined);
  for(let i=0;i<7;i++)await r.tick();assert.equal(r.reads,before+1);assert.equal(r.events.filter(e=>e.type==='placed').length,placed+1);
  assert.equal(r.events.at(-1)?.type,'placed');assert.equal(r.events.at(-1)?.track.cardId,'B');assert.equal(r.events.at(-1)?.track.bestMatch,true);r.watcher.dispose();
});
test('review B: different pixels in the next column cannot inherit a departing identity without a missed sample',async()=>{
  const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const old=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[card(.428,.3)];r.appearance=Array(12).fill(.8);r.identity='B';await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id===old)?.visible,false);assert.equal(r.watcher.getSnapshot().tracks.length,2);
  for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===old),false);r.watcher.dispose();
});
test('round 2 NB1 A4/A5: light-tick replacements keep one same-spot track and ref',async()=>{
 for(const handFirst of [false,true]){
  const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id,before=r.reads,detects=r.detects;
  r.busy=true;if(handFirst){r.motion=.2;await r.tick(750);r.motion=0;}
  r.appearance=Array(12).fill(.8);r.identity='B';await r.tick(750);assert.equal(r.detects,detects);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
  r.busy=false;for(let i=0;i<8;i++)await r.tick();const prompt=r.events.at(-1)!;
  assert.equal(prompt.type,'placed');assert.equal(prompt.track.bestMatch,true);assert.equal(prompt.track.id,id);assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.reads,before+1);
  r.watcher.confirm(id,'B');assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'B');assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);r.watcher.dispose();
 }
});
test('automatic placement requires two independent reads and labels missing-deck evidence as best match',async()=>{
  const r=fieldRig();for(let i=0;i<3;i++)await r.tick();assert.equal(r.events.length,0);await r.tick();assert.equal(r.events.length,0);
  for(let i=0;i<3;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.notEqual(r.inputs[0].frame,r.inputs[1].frame);r.watcher.dispose();
  for(const deck of [[],['B']]){const q=fieldRig();q.decklist=deck;for(let i=0;i<7;i++)await q.tick();assert.equal(q.events.filter(e=>e.type==='placed').length,1);assert.equal(q.events.at(-1)?.track.bestMatch,true);q.watcher.dispose();}
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
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.watcher.forget(r.watcher.getSnapshot().tracks[0].id);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.watcher.getSnapshot().tracks[0].state,'dismissed');r.watcher.dispose();
});

test('a different face revealed after a flip never restores the hidden old identity',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.8);for(let i=0;i<7;i++)await r.tick();
 r.identity='B';r.outlines=[card(.3,.3)];await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,undefined);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.at(-1)?.type,'placed');assert.equal(r.events.at(-1)?.track.cardId,'B');r.watcher.dispose();
});
test('disagreeing readable evidence settles the latest result as best match',async()=>{
 const r=fieldRig();r.decklist=['A','B'];for(let i=0;i<3;i++)await r.tick();r.identity='B';for(let i=0;i<5;i++)await r.tick();assert.equal(r.reads,2);assert.equal(r.events.at(-1)?.type,'placed');assert.equal(r.events.at(-1)?.track.bestMatch,true);r.watcher.dispose();
});
test('calibrated candidates outside the mat are rejected',async()=>{
 for(const corner of [{x:.4,y:.4},{x:.34,y:.2}]){const r=fieldRig();r.watcher.setCalibration(zones.createFieldCalibration([corner,{x:.95,y:.95}]));for(let i=0;i<10;i++)await r.tick();assert.equal(r.reads,0);assert.equal(r.events.length,0);r.watcher.dispose();}
});

test('a deck spread staggered across 1.5 seconds stays outside the twin',async()=>{
 const r=fieldRig();for(let i=0;i<5;i++)await r.tick(200);r.outlines=[card(.3,.3),card(.49,.3)];await r.tick(200);r.outlines=[card(.3,.3),card(.49,.3),card(.68,.3)];for(let i=0;i<15;i++)await r.tick(200);assert.equal(r.events.some(e=>e.type==='placed'),false);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});
test('Undo suppression belongs to physical appearance, not every later card in the same column',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();r.watcher.forget(r.watcher.getSnapshot().tracks[0].id);r.appearance=Array(12).fill(.8);for(let i=0;i<8;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,2);r.watcher.dispose();
});

test('pending zone-only bindings reserve known refs before concurrent reads finish',async()=>{
 const r=fieldRig();r.known=[{id:'known-A',zone:'M2',cardId:'A'}];r.outlines=[card(.31,.3,.03,.06),card(.36,.3,.03,.06)];for(let i=0;i<14;i++)await r.tick();const ids=r.watcher.getSnapshot().tracks.map(t=>t.id);assert.equal(ids.filter(id=>id==='known-A').length,1);assert.equal(new Set(ids).size,ids.length);r.watcher.dispose();
});
test('held cards much larger than settled cards stay outside the twin',async()=>{
 const r=fieldRig();r.outlines=[card(.2,.3,.06,.1)];for(let i=0;i<8;i++)await r.tick();r.outlines=[card(.2,.3,.06,.1),card(.5,.25,.2,.3)];for(let i=0;i<8;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='prompt').length,0);r.watcher.dispose();
});
test('a transient camera-frame wait is starting, without an unavailable error',async()=>{
 const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[],recognize:async()=>sureResult()},buffer:{sample:async()=>{throw Error('Waiting for a camera frame');}},hidden:()=>false});await watcher.tick();assert.equal(watcher.getSnapshot().status,'starting');assert.equal(watcher.getSnapshot().error,undefined);assert.equal(watcher.getSnapshot().metrics.errors,0);watcher.dispose();
});

test('full detector samples hide mismatching identity even while motion prevents a replacement read',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();r.appearance=Array(12).fill(.8);r.motion=.2;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);r.watcher.dispose();
});
test('a low-match prompt is not reopened for replacement pixels',async()=>{
 const r=fieldRig('low match');for(let i=0;i<8;i++)await r.tick();const old=r.events.at(-1)!.track;assert.equal(old.state,'prompt');r.appearance=Array(12).fill(.8);await r.tick();const current=r.watcher.getSnapshot().tracks[0];assert.equal(current.state,'prompt');assert.equal(current.revision,old.revision);assert.equal(r.events.filter(e=>e.type==='prompt').length,1);r.watcher.dispose();
});

test('an optional priors provider returning undefined still recognizes a full-catalog best match',async()=>{
 let at=0;const events:field.FieldEvent[]=[];const watcher=field.createFieldWatcher({profile:yugioh,getPriors:()=>undefined as any,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({motion:()=>0,sharpness:()=>1}),clone:async f=>f});watcher.subscribe(event=>events.push(event));for(let i=0;i<8;i++){at+=333;await watcher.tick();}assert.equal(watcher.getSnapshot().error,undefined);assert.equal(events.at(-1)?.type,'placed');assert.equal(events.at(-1)?.track.bestMatch,true);watcher.dispose();
});

test('quiet empty-mat pixel checks skip inference but new motion starts detection before the idle budget',async()=>{
 const r=fieldRig();r.outlines=[];await r.tick(100);const before=r.detects;await r.tick(100);assert.equal(r.detects,before);r.motion=.2;r.outlines=[card(.3,.3)];await r.tick(50);assert.equal(r.detects,before+1);assert.equal(r.watcher.getSnapshot().tracks.length,1);r.watcher.dispose();
});

test('native camera ring refreshes within100ms while retaining at most six originals',async t=>{
 const original=globalThis.createImageBitmap;let captured=0,closed=0,at=0;t.mock.method(performance,'now',()=>at);
 globalThis.createImageBitmap=(async (source:any)=>({width:1280,height:720,n:source.n??++captured,close(){closed++;}})) as any;
 t.mock.timers.enable({apis:['setTimeout']});const {createOwnFeedBuffer}=await import('./frame-buffer');const buffer=createOwnFeedBuffer({readyState:2,videoWidth:1280,videoHeight:720} as HTMLVideoElement);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 try{await flush();at+=100;t.mock.timers.tick(100);await flush();assert.equal(((await buffer.sample()).frame as any).n,2);for(let i=0;i<8;i++){at+=100;t.mock.timers.tick(100);await flush();((await buffer.sample()).frame as ImageBitmap).close();}assert.equal((await buffer.snapshot()).length,6);assert.ok(closed>=4);}
 finally{buffer.stop();await flush();t.mock.timers.reset();globalThis.createImageBitmap=original;}
});

test('repeated decoded camera frames cannot provide two independent watcher reads',async t=>{
 const original=globalThis.createImageBitmap;let captured=0,at=0,presented=1;t.mock.method(performance,'now',()=>at);
 globalThis.createImageBitmap=(async(source:any)=>({width:1280,height:720,n:source.n??++captured,close(){}})) as any;
 t.mock.timers.enable({apis:['setTimeout']});const {createOwnFeedBuffer}=await import('./frame-buffer');const buffer=createOwnFeedBuffer({readyState:2,videoWidth:1280,videoHeight:720,getVideoPlaybackQuality:()=>({totalVideoFrames:presented})} as HTMLVideoElement);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 try{await flush();at=100;t.mock.timers.tick(100);await flush();assert.equal(((await buffer.sample()).frame as any).n,1);presented=2;at=200;t.mock.timers.tick(100);await flush();assert.equal(((await buffer.sample()).frame as any).n,2);}
 finally{buffer.stop();await flush();t.mock.timers.reset();globalThis.createImageBitmap=original;}
});

test('a face-down outline in the next zone cannot inherit a face-up departing identity',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.appearance=Array(12).fill(.8);r.outlines=[{...card(.428,.3),kind:'face-down'}];for(let i=0;i<8;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===id),false);assert.equal(r.watcher.getSnapshot().tracks.length,2);r.watcher.dispose();
});
test('owner live move: same-color face-down outlines cannot reconnect a departing face-up identity',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;
 r.outlines=[{...card(.65,.3),kind:'face-down'}];for(let i=0;i<8;i++)await r.tick();
 assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===id),false);assert.equal(r.events.some(e=>e.type==='flipped'&&e.track.id===id),false);assert.equal(r.watcher.getSnapshot().tracks.length,2);r.watcher.dispose();
});
test('turning a pending prompt face-down invalidates its old public identity choice',async()=>{
 const r=fieldRig('low match');for(let i=0;i<8;i++)await r.tick();const previous=r.events.at(-1)!.track.revision??0;r.appearance=Array(12).fill(.8);r.outlines=[{...card(.3,.3),kind:'face-down'}];await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].state,'dismissed');assert.equal(r.watcher.getSnapshot().tracks[0].revision,previous+1);r.watcher.dispose();
});
test('unverified zone reservations do not exempt new outlines from the deck-spread guard',async()=>{
 const r=fieldRig();r.known=[{id:'old-X',zone:'M1',cardId:'X'},{id:'old-Y',zone:'M3',cardId:'Y'}];r.outlines=[card(.2,.3),card(.45,.3),card(.65,.3)];for(let i=0;i<18;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='placed'),false);r.watcher.dispose();
});

test('owner prompt stability: restored evidence reoffers only an unacknowledged placement with its current revision',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const original=r.events.find(e=>e.type==='placed')!;
 r.appearance=Array(12).fill(.8);await r.tick(100);r.appearance=Array(12).fill(.2);for(let i=0;i<8;i++)await r.tick(100);
 const placements=r.events.filter(e=>e.type==='placed');assert.equal(placements.length,2);assert.equal(placements[1].track.id,original.track.id);assert.ok((placements[1].track.revision??0)>(original.track.revision??0));
 r.watcher.confirm(original.track.id,'A');r.appearance=Array(12).fill(.8);await r.tick(100);r.appearance=Array(12).fill(.2);for(let i=0;i<8;i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='placed').length,2);r.watcher.dispose();
});
test('owner live move: a stable slide follows the same ref in under one second without rereading',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id,before=r.reads,from=r.at;
 r.outlines=[card(.428,.3)];r.motion=.2;await r.tick(100);r.motion=0;for(let i=0;i<8&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 const move=r.events.find(e=>e.type==='moved');assert.ok(move);assert.ok(r.at-from<600,'known movement settles within a short detector burst');assert.equal(move.track.id,id);assert.equal(move.track.zone,'M3');assert.equal(r.reads,before);assert.equal(r.events.filter(e=>e.type==='prompt').length,0);r.watcher.dispose();
});
test('owner live move: two clean frames 100 ms apart settle an unchanged identity',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id,before=r.reads;
 r.outlines=[card(.428,.3)];r.motion=.2;await r.tick(100);r.motion=0;await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,0);await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,id);assert.equal(r.reads,before);r.watcher.dispose();
});

test('a verified read reconnects a rotated card across the mat to its acknowledged live ref',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const original=r.events[0].track;r.watcher.confirm(original.id,'A');r.known=[{id:original.id,zone:original.zone,cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<12&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,original.id);assert.equal(r.events.at(-1)?.track.position,'defense');assert.equal(r.events.at(-1)?.track.revision,original.revision);assert.equal(r.events.filter(e=>e.type==='prompt'||e.type==='removed').length,0);assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.reads,3);r.watcher.dispose();
});
for(const obstacle of ['hand','different embedding','missing embedding','different identity','removed ref','pile ref','unacknowledged ref','multiple outlines'])test(`read-backed movement never adopts a copy with ${obstacle}`,async()=>{
 const r=fieldRig();if(obstacle!=='missing embedding')r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;if(obstacle!=='unacknowledged ref')r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(obstacle==='hand'?.8:.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 if(obstacle==='removed ref'){r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));r.known=[{id,zone:'GY',cardId:'A'}];}
 if(obstacle==='pile ref')r.known=[{id,zone:'GY',cardId:'A'}];
 if(obstacle==='different embedding')r.embedding=[0,1];if(obstacle==='different identity'){r.identity='B';r.decklist=['A','B'];}
 r.outlines=obstacle==='multiple outlines'?[card(.5,.3),card(.72,.3)]:[card(.65,.3,.25,.15)];for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved'&&e.track.id===id).length,0,obstacle);if(obstacle==='multiple outlines')assert.equal(r.events.filter(e=>e.type==='placed').length,1);r.watcher.dispose();
});

test('a rotated return after explicit removal Undo follows the same restored public ref',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));r.known=[{id,zone:'GY',cardId:'A'}];
 await r.tick(3000);r.known=[{id,zone:'M2',cardId:'A'}];r.watcher.dismiss(id);r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<12&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,id);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].removed,false);r.watcher.dispose();
});

test('a failed departure that still looks public never substitutes for explicit Undo',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const mat=Array(12).fill(.2),pattern=Array.from({length:12},(_,i)=>i%2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));
 await r.tick(3000);r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,0);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});
test('a different card returning to an explicitly restored spot abstains without moving the old ref',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);r.watcher.dismiss(id);r.identity='B';r.decklist=['A','B'];r.embedding=[0,1];r.appearance=Array.from({length:12},(_,i)=>i%2);r.outlines=[card(.3,.3)];for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='moved').length,0);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});

// One duel-gallery feature probe: persistence, hysteresis, corrected answers and copy refs.
test('duel gallery reuses confirmed and dismissed embeddings without stealing physical refs',async()=>{
 const gallery=createFieldIdentityGallery();const vector={values:[1,0],space:'art-box' as const};
 gallery.remember(vector,'A');assert.deepEqual(gallery.resolve(vector),{kind:'match',cardId:'A'});
 assert.equal(gallery.resolve({values:[.75,Math.sqrt(1-.75**2)],space:'art-box'}).kind,'hold');
 assert.equal(gallery.resolve({values:[0,1],space:'art-box'}).kind,'new');
 const restored=createFieldIdentityGallery(JSON.parse(JSON.stringify(gallery.entries())));
 const a=fieldRig('low match',20,restored);a.embedding=[1,0];a.outlines=[card(.2,.3),card(.65,.3)];for(let i=0;i<12;i++)await a.tick();
 const placements=a.events.filter(e=>e.type==='placed');assert.equal(placements.length,2);assert.ok(placements.every(e=>e.track.cardId==='A'));assert.notEqual(placements[0].track.id,placements[1].track.id);assert.equal(a.events.some(e=>e.type==='prompt'),false);a.watcher.dispose();
 restored.remember(vector,undefined);const b=fieldRig('low match',20,restored);b.embedding=[1,0];for(let i=0;i<8;i++)await b.tick();assert.equal(b.events.length,0);assert.equal(b.watcher.getSnapshot().tracks[0].state,'dismissed');b.outlines=[];for(let i=0;i<20;i++)await b.tick();assert.equal(b.watcher.getSnapshot().tracks.length,1);b.watcher.dispose();
 restored.remember(vector,'B');assert.deepEqual(restored.resolve(vector),{kind:'match',cardId:'B'});
});
