import test from 'node:test';
import assert from 'node:assert/strict';
import * as board from './board';
import { RecognitionPipeline } from './pipeline';
import { yugioh } from './games/yugioh';
import { boundsOf } from './geometry';
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
      if(message.type==='init'||message.type==='prepare') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:message.type==='prepare'?{backend:'wasm'}:null}}));
      if(message.type==='peek') queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{name:'Alpha',tier:'sure'}}}));
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=FakeWorker as unknown as typeof Worker;
  const reader=createRecognizer({backend:'wasm',workers:'single'});
  try {
    await Promise.all([reader.warmup(),reader.warmup()]);
    assert.equal(workers.length,1);
    assert.equal(messages.filter(m=>m.type==='init').length,1);
    // Table-open warmup must also load the resident index/embedder after lazy detector startup.
    assert.equal(messages.filter(m=>m.type==='prepare').length,1);
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
    reader.dispose();await assert.rejects(reader.warmup(),/disposed/);
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
// Fresh isolated crops are required by the face-state contract. Legacy tracker
// assertions below inspect settled events; provisional reading cues are separate.
const fieldCrop=(c:DetectedQuad)=>{
 const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
 for(let py=0;py<height;py++)for(let px=0;px<width;px++){
  const x=px/width,y=py/height;
  const rgb=c.kind==='face-down'?[15,15,15]:x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
  data.set([...rgb,255],(py*width+px)*4);
 }
 return {width,height,data};
};
const sureResult = (tier: RecognitionResult['tier'] = 'sure') => ({candidates:[{cardId:'A',score:.95},{cardId:'B',score:.5}],tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:10,fallback:false},timingsMs:{total:20},backend:'wasm'}) as RecognitionResult;
function fieldRig(tier: RecognitionResult['tier'] = 'sure',maxTracks=20,gallery?:ReturnType<typeof createFieldIdentityGallery>,size={width:frame.width,height:frame.height}) {
  let appearanceExplicit=false;
  let detectorCost=0;
  let at=0, outlines:DetectedQuad[]=[card(.3,.3)], motion=0, detail=20, appearance:number[]=Array.from({length:12},(_,i)=>i%2?.6:.2), halo:number[]|undefined=Array(192).fill(.2), hidden=false, busy=false, reads=0, detects=0, identity='A', decklist=['A'], known:field.KnownFieldCard[]=[],embedding:number[]|undefined,embeddingSpace:'art-box'|'whole-card'='art-box',identityAt:((card:DetectedQuad)=>string)|undefined,motionAt:((card:DetectedQuad)=>number)|undefined,motionRegion:{x:number;y:number;w:number;h:number}|undefined,cropAware=false,appearanceAt:((card:DetectedQuad)=>number[])|undefined,cropAt:((card:DetectedQuad)=>ReturnType<typeof fieldCrop>)|undefined,touchedAt:((card:DetectedQuad)=>number)|undefined,occludedAt:((card:DetectedQuad)=>boolean)|undefined,skinNearAt:((card:DetectedQuad)=>number)|undefined,qualityAt:((card:DetectedQuad)=>Record<string,boolean>)|undefined,shadow:{share:number;changed:number;moved?:Uint8Array;gx?:number;gy?:number}|undefined,frameSharpness:number|undefined,keeps:unknown[]=[];
  let tierAt:((card:DetectedQuad)=>RecognitionResult['tier'])|undefined;
  const events:field.FieldEvent[]=[], inputs:{frame:ImageData;opts:any}[]=[];
  const reader={detectCards:async(_frame:unknown,opts?:{region?:{x:number;y:number;w:number;h:number};keep?:unknown[]})=>{detects++;keeps=opts?.keep??[];at+=detectorCost;const r=cropAware?opts?.region:undefined;return structuredClone(r?outlines.filter(c=>c.quad.every(p=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h)):outlines);},recognize:async(frames:ImageData[],opts:any)=>{reads++;inputs.push({frame:frames[0],opts});const base=sureResult(tierAt?.(opts.card)??tier);return {...base,quality:{...base.quality,...qualityAt?.(opts.card)},candidates:[{cardId:identityAt?.(opts.card)??identity,score:.95}],...(embedding?{identityEmbedding:{values:embedding.slice(),space:embeddingSpace}}:{})};}};
  const watcher=field.createFieldWatcher({gallery,recognizer:reader,profile:yugioh,maxTracks,buffer:{sample:async()=>({frame:{...size,data:new Uint8ClampedArray(size.width*size.height*4).fill(detail)} as ImageData,at})},
    getPriors:()=>({decklist}),getKnownCards:()=>known,hidden:()=>hidden,cpuBusy:()=>busy,now:()=>at,
    analyze:()=>({shadow,frameSharpness,crop:c=>cropAt?.(c)??fieldCrop(c),motion:c=>motionAt?.(c)??motion,motionRegion,sharpness:()=>detail,touched:c=>touchedAt?.(c)??0,occluded:c=>occludedAt?.(c)??false,skinNear:c=>skinNearAt?.(c)??0,appearance:c=>appearanceAt?.(c)??(outlines.length||appearanceExplicit?appearance:Array(12).fill(.2)),halo:()=>halo??[]}),clone:async f=>f});
  watcher.subscribe(event=>{if(event.type!=='reading')events.push(event);});
  return {watcher,events,inputs,set tierAt(v:((card:DetectedQuad)=>RecognitionResult['tier'])|undefined){tierAt=v;},set shadow(v:{share:number;changed:number;moved?:Uint8Array;gx?:number;gy?:number}|undefined){shadow=v;},set frameSharpness(v:number|undefined){frameSharpness=v;},get keeps(){return keeps;},set detectorCost(v:number){detectorCost=v;},set identityAt(v:((card:DetectedQuad)=>string)|undefined){identityAt=v;},set motionAt(v:((card:DetectedQuad)=>number)|undefined){motionAt=v;},set motionRegion(v:{x:number;y:number;w:number;h:number}|undefined){motionRegion=v;},set cropAware(v:boolean){cropAware=v;},set cropAt(v:((card:DetectedQuad)=>ReturnType<typeof fieldCrop>)|undefined){cropAt=v;},set appearanceAt(v:((card:DetectedQuad)=>number[])|undefined){appearanceAt=v;},set touchedAt(v:((card:DetectedQuad)=>number)|undefined){touchedAt=v;},set occludedAt(v:((card:DetectedQuad)=>boolean)|undefined){occludedAt=v;},set skinNearAt(v:((card:DetectedQuad)=>number)|undefined){skinNearAt=v;},set qualityAt(v:((card:DetectedQuad)=>Record<string,boolean>)|undefined){qualityAt=v;},get reads(){return reads;},get detects(){return detects;},get at(){return at;},set embedding(v:number[]){embedding=v;},set embeddingSpace(v:'art-box'|'whole-card'){embeddingSpace=v;},
    async tick(ms=333){at+=ms;await watcher.tick();},set identity(v:string){identity=v;},set decklist(v:string[]){decklist=v;},set known(v:field.KnownFieldCard[]){known=v;},set outlines(v:DetectedQuad[]){outlines=v;},set motion(v:number){motion=v;},set detail(v:number){detail=v;},set appearance(v:number[]){appearance=v;appearanceExplicit=true;},set halo(v:number[]|undefined){halo=v;},set hidden(v:boolean){hidden=v;},set busy(v:boolean){busy=v;}};
}
test('field watcher waits for stillness, reads once with deck priors and binds the sharpest frame to its quad', async()=>{
  const r=fieldRig();r.detail=2;await r.tick();await r.tick();r.detail=20;await r.tick();r.detail=14;await r.tick();await r.tick();await r.tick();
  assert.equal(r.reads,1);assert.equal(r.events.filter(e=>e.type==='placed').length,1);
  assert.equal(r.inputs[0].frame.data[0],20);assert.deepEqual(r.inputs[0].opts.priors,{decklist:['A']});
  assert.deepEqual(r.inputs[0].opts.card.quad,card(.3,.3).quad);
  for(let i=0;i<8;i++)await r.tick();assert.equal(r.reads,1);
  const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[card(.4,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);assert.ok(r.events.some(e=>e.type==='moved'));
  r.watcher.dispose();
});
test('field watcher rejects motion, low confidence, partial and covered placements',async()=>{
  for(const obstacle of ['motion','moving-back','confidence','partial','covered','phone']) {
    const r=fieldRig();if(obstacle==='motion')r.motion=.2;
    else if(obstacle==='moving-back'){r.motion=.2;r.appearance=Array(12).fill(.2);r.outlines=[{...card(.3,.3),kind:'face-down'}];}
    else if(obstacle==='phone')r.outlines=[{...card(.3,.3,.08,.25),kind:'face-down',confidence:.45}];
    else r.outlines=[{...card(.3,.3),...(obstacle==='confidence'?{confidence:.45}:obstacle==='partial'?{partial:true}:{covered:true})}];
    for(let i=0;i<10;i++)await r.tick();assert.equal(r.reads,0,obstacle);assert.equal(r.events.length,0,obstacle);
    if(obstacle==='moving-back'){
      r.outlines=[];r.motion=0;await r.tick(33);await r.tick(67);assert.equal(r.events.length,0,'clear mat cannot confirm a stale moving outline');
      await r.tick(33);assert.equal(r.watcher.getSnapshot().tracks.length,0,'a detector miss and clear mat retire an unplaced back quietly');
      const detects=r.detects;await r.tick(33);assert.equal(r.detects,detects,'retired draws do not keep inference running before the next Set');
    }
    r.watcher.dispose();
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
  // Review r2 N1: a new look on the spot with a read that is not sure is a new card (best match), never merged into the
  // confirmed card. The confirmed card keeps its identity; no prompt.
  assert.equal(r.events.filter(e=>e.type==='prompt').length,0);assert.ok(r.reads<=reads+1,'one read for the new card');
  const newer=r.events.filter(e=>e.type==='placed').at(-1)!;assert.ok(newer.track.id!=='owner-ref'&&newer.track.bestMatch,'the new card is placed as a best match');
  assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id==='owner-ref')?.cardId,'A','bound identity is changed only by an explicit correction');r.watcher.dispose();
  const restart=fieldRig();restart.known=[{id:'existing-twin',zone:'M2',cardId:'X'}];restart.identity='Y';for(let i=0;i<8;i++)await restart.tick();assert.equal(restart.reads,1);assert.equal(restart.watcher.getSnapshot().tracks[0].id,'existing-twin');assert.equal(restart.watcher.getSnapshot().tracks[0].cardId,'Y');assert.equal(restart.events.some(e=>e.type==='prompt'),false);restart.watcher.dispose();
  const q=fieldRig('low match');for(let i=0;i<8;i++)await q.tick();const prompt=q.events.find(e=>e.type==='prompt')!;
  q.watcher.dismiss(prompt.track.id);q.appearance=Array.from({length:12},(_,i)=>i%2);q.identity='B';q.outlines=[card(.4,.3)];
  for(let i=0;i<40;i++)await q.tick(250);
  assert.equal(q.events.filter(e=>e.type==='prompt').length,1);assert.equal(q.reads,1);assert.equal(q.watcher.getSnapshot().tracks[0].state,'dismissed');q.watcher.dispose();
  const history=fieldRig('low match',2);for(let n=0;n<3;n++){history.appearance=Array.from({length:12},(_,i)=>i===n?1:0);history.outlines=[card(.3,.3)];for(let i=0;i<8;i++)await history.tick();const latest=history.events.filter(e=>e.type==='prompt').at(-1)!;history.watcher.dismiss(latest.track.id);history.outlines=[];history.appearance=Array(12).fill(.2);for(let i=0;i<12;i++)await history.tick();}assert.equal(history.events.filter(e=>e.type==='prompt').length,3,'absent dismissals do not exhaust live slots');history.appearance=Array.from({length:12},(_,i)=>i===0?1:0);history.outlines=[card(.3,.3)];for(let i=0;i<8;i++)await history.tick();assert.equal(history.events.filter(e=>e.type==='prompt').length,3,'returning dismissed card stays silent');history.watcher.dispose();
  const ignoredSet=fieldRig();ignoredSet.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await ignoredSet.tick();ignoredSet.watcher.dismiss(ignoredSet.events[0].track.id);ignoredSet.outlines=[];for(let i=0;i<12;i++)await ignoredSet.tick();ignoredSet.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await ignoredSet.tick();assert.equal(ignoredSet.events.filter(e=>e.type==='prompt').length,0);assert.equal(ignoredSet.reads,0);ignoredSet.watcher.dispose();
  const unread=fieldRig('low match');unread.known=[{id:'unread',zone:'M2',faceDown:false}];for(let i=0;i<8;i++)await unread.tick();assert.equal(unread.events.some(e=>e.type==='prompt'),false);assert.equal(unread.watcher.getSnapshot().tracks[0].id,'unread');unread.watcher.dispose();
  const hidden=fieldRig();hidden.known=[{id:'hidden',zone:'M2',faceDown:true}];for(let i=0;i<8;i++)await hidden.tick();assert.ok(hidden.events.some(e=>e.type==='placed'&&e.track.id==='hidden'&&!e.track.faceDown));assert.equal(hidden.events.some(e=>e.type==='prompt'),false);hidden.watcher.dispose();
  const set=fieldRig();set.known=[{id:'public',zone:'M2',cardId:'A',faceDown:false}];set.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<8;i++)await set.tick();assert.ok(set.events.some(e=>e.type==='flipped'&&e.track.id==='public'&&e.track.faceDown));assert.equal(set.events.some(e=>e.type==='prompt'),false);set.watcher.dispose();
});
test('new face-down cards Set without identity inference; turning up retains the ref',async()=>{
  const r=fieldRig();r.appearance=Array(12).fill(.8);r.outlines=[{...card(.3,.3),kind:'face-down'}];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,0);assert.equal(r.events.filter(e=>e.type==='placed').length,1);const placed=r.events.find(e=>e.type==='placed')!;assert.equal(placed.track.cardId,undefined);const id=placed.track.id;r.watcher.confirm(id);
  r.appearance=Array.from({length:12},(_,i)=>i%2?.6:.2);r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads,1);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.ok(r.events.some(e=>e.type==='placed'&&!e.track.faceDown));r.watcher.dispose();
  for(const playerSide of ['bottom','left','top','right'] as const){
    const side=fieldRig('sure',20,undefined,{width:160,height:90});
    side.watcher.setCalibration(zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}],{playerSide,mirrored:false}));
    side.outlines=[{...card(.3,.3,.1,.259),kind:'face-down',confidence:.5}];
    for(let i=0;i<8;i++)await side.tick();
    assert.equal(side.events.filter(e=>e.type==='placed').length,1,`${playerSide}: low-score card aspect stays valid after calibration`);
    assert.equal(side.reads,0);side.watcher.dispose();
  }
});
test('disappearance needs sustained clear absence and emits once, preserving id on occlusion',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];r.motion=.2;for(let i=0;i<10;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  r.outlines=[card(.3,.3)];r.motion=0;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);
  r.outlines=[];await r.tick(100);await r.tick(100);assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  for(let i=0;i<6;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.watcher.dispose();
});

test('departure needs repeated clear mat samples, never motion, stationary hands or unknown mat pixels',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.outlines=[];
  await r.tick(100);await r.tick(100);assert.equal(r.events.filter(e=>e.type==='removed').length,0);
  await r.tick(100);assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.watcher.dispose();
  // Owner rule: detector absence removes a card unless a hand (skin) covers the
  // spot, the spot still shows the card, it moves, or the CPU is busy. The mat
  // colour and its surround do not matter.
  for(const obstacle of ['stationary-hand','card-still-there','motion','cpu'] as const){
    const q=fieldRig();for(let i=0;i<6;i++)await q.tick();q.outlines=[];
    if(obstacle==='stationary-hand'){q.appearance=Array(12).fill(.7);q.touchedAt=()=>.3;}
    if(obstacle==='card-still-there')q.appearance=Array.from({length:12},(_,i)=>i%2?.6:.2);
    if(obstacle==='motion')q.motion=.2;
    if(obstacle==='cpu')q.busy=true;
    for(let i=0;i<24;i++)await q.tick(300);
    assert.equal(q.events.filter(e=>e.type==='removed').length,0,obstacle);q.watcher.dispose();
  }
});

test('still skin-coloured print on a still front (locked camera colour) is not a hand: the card is placed in about 1 s',async()=>{
  // Owner 2026-11-04: Man with the Mark seen clearly (front .81) stayed "cand · hid" under the first camera lock.
  const r=fieldRig();r.occludedAt=()=>true;r.touchedAt=()=>.3;
  for(let i=0;i<10;i++)await r.tick(100);
  assert.equal(r.events.filter(e=>e.type==='placed').length,1);r.watcher.dispose();
});

test('an unsure identity check (.68-.84) reads again and keeps the same card, never a candidate for ever',async()=>{
  // A new exposure changes the look of a placed card; its new embedding sits in the unsure band.
  const r=fieldRig('not sure');r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();
  const placed=r.events.find(e=>e.type==='placed')!,reads=r.reads;
  r.appearance=Array.from({length:12},(_,i)=>i%2?.9:.05);r.embedding=[.75,Math.sqrt(1-.75*.75)];
  for(let i=0;i<40;i++)await r.tick(200);
  const track=r.watcher.getSnapshot().tracks.find(t=>t.id===placed.track.id)!;
  assert.equal(track.state,'identified');assert.equal(track.cardId,'A');assert.ok(r.reads>reads+1,'fresh reads, not the held one');r.watcher.dispose();
});

test('blur baseline learns a darker exposure: at once on a camera lock event, or after 3 s of stable soft frames',async()=>{
  const r=fieldRig();r.frameSharpness=100;for(let i=0;i<5;i++)await r.tick(100);
  r.frameSharpness=20;await r.tick(100);assert.equal(r.watcher.getSnapshot().blur?.hold,true,'a sudden drop is blur');
  for(let i=0;i<36;i++)await r.tick(100);assert.equal(r.watcher.getSnapshot().blur?.hold,false,'stable soft frames are the new normal');
  r.frameSharpness=100;for(let i=0;i<5;i++)await r.tick(100);r.frameSharpness=20;await r.tick(100);assert.equal(r.watcher.getSnapshot().blur?.hold,true);
  r.watcher.resetBaselines();await r.tick(100);assert.equal(r.watcher.getSnapshot().blur?.hold,false,'a lock event learns again at once');r.watcher.dispose();
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
  const r=fieldRig();r.motion=.2;await r.tick();r.hidden=true;for(let i=0;i<10;i++)await r.tick();assert.equal(r.detects,1);
  r.hidden=false;r.busy=true;await r.tick();assert.equal(r.detects,1);r.busy=false;await r.tick();assert.equal(r.reads,0);r.motion=0;
  for(let i=0;i<5;i++)await r.tick();assert.equal(r.reads,1);r.watcher.dispose();
});
test('field calibration maps perspective grid, side piles, EMZ and defense orientation',()=>{
  const calibration=zones.createFieldCalibration([{x:.1,y:.1},{x:.9,y:.15},{x:.85,y:.95},{x:.15,y:.9}]);
  assert.equal(zones.mapFieldZone(card(.44,.35,.04,.06),calibration).zone,'M3');
  assert.equal(zones.mapFieldZone(card(.44,.68,.04,.06),calibration).zone,'S3');
  assert.equal(zones.mapFieldZone(card(.93,.35,.04,.06)).zone,'GY');
  assert.equal(zones.mapFieldZone(card(.93,.7,.04,.06)).zone,'DECK');
  assert.equal(zones.mapFieldZone(card(.03,.7,.04,.06)).zone,'EXTRA');
  assert.equal(zones.mapFieldZone(card(.35,.05,.04,.06)).zone,'EMZ1');
  assert.equal(zones.fieldOrientation(card(.3,.3,.3,.12),1920,1080),'defense');
  assert.throws(()=>zones.createFieldCalibration([{x:0,y:0},{x:0,y:0}]),/calibration/i);
});

test('moving, turning and sizing the grid moves the zones the tracker reads; a record without rotation is unchanged',()=>{
  const base=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}],aspect=16/9,t={dx:.03,dy:-.02,scale:.9,width:1,height:1,rotation:10};
  const out=zones.transformFieldCorners(base,t,aspect)!,moved=zones.createFieldCalibration(out.corners);
  const rad=10*Math.PI/180;
  // Where a mat point lands in the picture, worked out by hand: size around the centre, turn in pixels about it, then move.
  const where=(mx:number,my:number)=>{
    const x=(.2+.6*(.5+(mx-.5)*.9)-.5)*aspect,y=.2+.6*(.5+(my-.5)*.9)-.5;
    return {x:.5+(x*Math.cos(rad)-y*Math.sin(rad))/aspect+t.dx,y:.5+x*Math.sin(rad)+y*Math.cos(rad)+t.dy};
  };
  for(const zone of ['M1','S5','DECK','GY','EXTRA']){
    const cell=zones.fieldZoneCells().find(c=>c.zone===zone)!,p=where(cell.x+cell.w/2,cell.y+cell.h/2);
    assert.equal(zones.mapFieldZone(card(p.x-.01,p.y-.01,.02,.02),moved).zone,zone);
  }
  assert.equal(zones.transformFieldCorners(base,{dx:0,dy:0,scale:1,width:1,height:1},aspect)!.applied.rotation,undefined);
  assert.deepEqual(zones.transformFieldCorners(base,{dx:0,dy:0,scale:1,width:1,height:1},aspect)!.corners.map(c=>({x:+c.x.toFixed(6),y:+c.y.toFixed(6)})),base);
  assert.equal(zones.transformFieldCorners(base,{...t,rotation:zones.FIELD_ROTATION_MAX+1},aspect),null);
  // A grid that fills the picture shrinks a little to turn instead of refusing; any other change that does not fit is refused, not shrunk.
  const wide=[{x:.02,y:.02},{x:.98,y:.02},{x:.98,y:.98},{x:.02,y:.98}],flat={dx:0,dy:0,scale:1,width:1,height:1},inside=(cs:{x:number;y:number}[])=>cs.every(c=>c.x>=0&&c.x<=1&&c.y>=0&&c.y<=1);
  const full=zones.transformFieldCorners(wide,{...flat,rotation:8},aspect,true)!;
  assert.ok(full.applied.scale<1&&inside(full.corners));
  assert.equal(zones.transformFieldCorners(wide,{...flat,rotation:8},aspect),null);
  assert.equal(zones.transformFieldCorners(wide,{...full.applied,scale:full.applied.scale*1.04},aspect),null);
  // Turning back asks for the size the owner chose, so it returns in full.
  assert.equal(zones.transformFieldCorners(wide,{...flat,rotation:0},aspect,true)!.applied.scale,1);
  // A saved quad opens at its own turn: the base is the quad turned back, a turn of 0 straightens it, and the angle does not pile up.
  const saved=zones.straightenFieldCorners(out.corners,aspect);
  assert.ok(Math.abs(saved.rotation-10)<1e-6);
  const again=zones.transformFieldCorners(saved.base,{...flat,rotation:saved.rotation},aspect)!.corners;
  assert.ok(again.every((c,i)=>Math.abs(c.x-out.corners[i].x)<1e-9&&Math.abs(c.y-out.corners[i].y)<1e-9));
  const straight=zones.transformFieldCorners(saved.base,{...flat,rotation:0},aspect)!.corners;
  assert.ok(Math.abs(straight[0].y-straight[1].y)<1e-9&&Math.abs(zones.straightenFieldCorners(straight,aspect).rotation)<1e-6);
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
  const main=[card(.25,.5,.04,.06),card(.65,.5,.04,.06)],extra=[card(.35,.05,.04,.06),card(.61,.05,.04,.06)];
  assert.equal(zones.mapFieldZone(main[1],undefined,main).zone,'M4');
  assert.equal(zones.mapFieldZone(main[1],undefined,[...main,...extra]).zone,'M4');
});

test('a large move through a brief hand occlusion keeps the physical id without another read',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.watcher.confirm(id,'A');
  r.outlines=[];r.motion=.2;await r.tick();await r.tick();r.motion=0;r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].id,id);assert.equal(r.reads,1);r.watcher.dispose();
});
test('known instances emit moves and recalibration remaps settled cards',async()=>{
  // Card-sized for the mat calibrated below: a quad wider than a mat column maps as a card held above the mat.
  let at=0,outlines=[card(.3,.3,.06,.1)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{throw new Error('known must not reread');}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known',card:card(.3,.3,.06,.1),zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  outlines=[card(.4,.3,.06,.1)];for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.ok(events.some(e=>e.type==='moved'));
  watcher.setCalibration(zones.createFieldCalibration([{x:.45,y:.1},{x:.95,y:.95}]));for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(watcher.getSnapshot().tracks[0].zone,'FIELD');assert.ok(events.some(e=>e.type==='moved'&&e.track.zone==='FIELD'));watcher.dispose();
});
test('the adaptive CPU guard permits slow samples to settle instead of resetting forever',async()=>{
  let at=0,reads=0;
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>{at+=250;return [card(.3,.3)];},recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>f});
  for(let i=0;i<8;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}assert.equal(reads,1);watcher.dispose();
});
test('verified reappearance moves only inside the recent physical move window',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const old=r.watcher.getSnapshot().tracks[0].id;r.watcher.confirm(old,'A');
  r.outlines=[];for(let i=0;i<6;i++)await r.tick(100);
  assert.equal(r.events.filter(e=>e.type==='removed').length,1);r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick(100);
  assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===old));assert.equal(r.reads,1);
  r.outlines=[];for(let i=0;i<10;i++)await r.tick();
  r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.events.filter(e=>e.type==='placed').length,2,'a later identical card is a new copy');
  assert.notEqual(r.events.filter(e=>e.type==='placed').at(-1)?.track.id,old);
  r.watcher.dispose();
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
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>{at+=1100;return outlines;},recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'slow',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2),halo:()=>Array(192).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});for(let i=0;i<6;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}
  outlines=[];for(let i=0;i<20;i++){at+=watcher.getSnapshot().metrics.intervalMs;await watcher.tick();}
  assert.equal(events.some(e=>e.type==='removed'),false);assert.ok(watcher.getSnapshot().metrics.intervalMs>200);watcher.dispose();
});

test('stopping a watcher during inference discards its late placement result',async()=>{
  let at=0,resolve!:(result:RecognitionResult)=>void;const delayed=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:()=>delayed},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>f});watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}await new Promise(r=>setImmediate(r));watcher.dispose();resolve(sureResult());await new Promise(r=>setImmediate(r));assert.equal(events.length,0);
});

test('a new card gets a short sampling burst even while placement motion is clearing',async()=>{
  const r=fieldRig();r.motion=.2;await r.tick(250);
  assert.equal(r.watcher.getSnapshot().metrics.intervalMs,100);assert.equal(r.reads,0);
  r.motion=0;for(let i=0;i<7;i++)await r.tick(250);assert.equal(r.events.filter(e=>e.type==='placed').length,1);r.watcher.dispose();
});
test('tracking continues during a slow read and motion invalidates the late identity',async()=>{
 for(const split of [false,true]){
  let at=0,sampled=0,detects=0,motion=0,resolve!:(r:RecognitionResult)=>void;
  const pending=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{separateDetector:split,detectCards:async()=>{detects++;return [card(.3,.3)];},recognize:()=>pending},buffer:{sample:async()=>{sampled++;return {frame:frame as ImageData,at};}},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>motion,sharpness:()=>20}),clone:async f=>f});watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}
  motion=.3;at+=250;await watcher.tick();assert.equal(sampled,4);if(split)assert.ok(detects>1,'a separate detector worker keeps detecting during a read');else assert.equal(detects,1);
  resolve(sureResult());await new Promise(done=>setImmediate(done));motion=0;at+=250;await watcher.tick();
  assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'candidate');watcher.dispose();
 }
});
test('dismissal while the sharpest-frame clone is pending cannot start a stale read',async()=>{
  let at=0,clones=0,reads=0,unblock!:(value:ImageData)=>void;
  const events:field.FieldEvent[]=[],cloning=new Promise<ImageData>(done=>{unblock=done;});
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>++clones===2?cloning:f});watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});
  at=250;const pending=watcher.tick();await new Promise(done=>setImmediate(done));
  watcher.dismiss(watcher.getSnapshot().tracks[0].id);unblock(frame as ImageData);await pending;
  for(let i=0;i<4;i++){at+=250;await watcher.tick();}
  assert.equal(reads,0);assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'dismissed');watcher.dispose();
});
test('the confirming detector frame must still match the read appearance after inference completes',async()=>{
  let at=0,appearance=Array(12).fill(.2),resolve!:(value:RecognitionResult)=>void;
  const pending=new Promise<RecognitionResult>(done=>{resolve=done;}),events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:()=>pending},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>appearance}),clone:async f=>f});watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});
  for(let i=0;i<3;i++){at+=250;await watcher.tick();}resolve(sureResult());await new Promise(done=>setImmediate(done));
  appearance=Array(12).fill(.8);at+=250;await watcher.tick();assert.equal(events.length,0);assert.equal(watcher.getSnapshot().tracks[0].state,'candidate');watcher.dispose();
});

test('a different card after disappearance is recognized as a new physical instance',async()=>{
  const r=fieldRig();r.outlines=[card(.2,.3)];for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;
  r.outlines=[];await r.tick();r.appearance=Array(12).fill(.8);r.outlines=[card(.65,.3)];for(let i=0;i<6;i++)await r.tick();
  assert.equal(r.reads,2);assert.ok(r.events.some(e=>e.type==='placed'&&e.track.id!==id));r.watcher.dispose();
});
test('a face-down twin flipped while paused is reconciled and read under its existing id',async()=>{
  let at=0,reads=0;const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'set-card',card:card(.3,.3),zone:'M2',faceDown:true,position:'defense'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>f});
  watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(reads,1);assert.ok(events.some(e=>e.type==='placed'&&!e.track.faceDown));assert.ok(events.some(e=>e.type==='placed'&&e.track.position==='attack'));assert.equal(watcher.getSnapshot().tracks[0].id,'set-card');watcher.dispose();
});
test('dismissing a false removal preserves identified tracking and future moves',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.outlines=[];for(let i=0;i<9;i++)await r.tick();r.watcher.dismiss(id);
  assert.equal(r.watcher.getSnapshot().tracks[0].state,'identified');r.outlines=[card(.3,.3)];for(let i=0;i<6;i++)await r.tick();r.outlines=[card(.4,.3)];for(let i=0;i<6;i++)await r.tick();assert.ok(r.events.some(e=>e.type==='moved'));r.watcher.dispose();
});

test('normal native-buffer timestamp jitter never splits a known physical track',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known-jitter',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  for(const time of [200,400,800,1000,1200,1600,1800,2000,2400]){at=time;await watcher.tick();}
  assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-jitter');watcher.dispose();
});

test('a quad-backed unknown twin keeps its ref and settles a best match without a registered deck',async()=>{
  let at=0,reads=0;const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'unknown-public',card:card(.3,.3),zone:'M2',faceDown:false}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>f});
  for(let i=0;i<6;i++){at+=333;await watcher.tick();}assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks[0].id,'unknown-public');assert.equal(watcher.getSnapshot().tracks[0].state,'identified');watcher.dispose();
});

test('one missed sample before a known card settles cannot create another instance',async()=>{
  let at=0,reads=0,outlines=[card(.3,.3)];const watcher=field.createFieldWatcher({profile:yugioh,recognizer:{detectCards:async()=>outlines,recognize:async()=>{reads++;return sureResult();}},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known-early-miss',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2)}),clone:async f=>f});
  at=333;await watcher.tick();outlines=[];at=666;await watcher.tick();outlines=[card(.3,.3)];for(let i=0;i<6;i++){at+=333;await watcher.tick();}
  assert.equal(reads,1);assert.equal(watcher.getSnapshot().tracks.length,1);assert.equal(watcher.getSnapshot().tracks[0].id,'known-early-miss');watcher.dispose();
});

test('tracked click geometry is visible only while the detector sees the card',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.watcher.confirm(r.watcher.getSnapshot().tracks[0].id,'A');
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  const outline=r.watcher.getSnapshot().tracks[0].card;r.outlines=[];await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
  r.outlines=[outline];await r.tick();for(let i=0;i<3;i++)await r.tick(100);assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  r.watcher.stop();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);r.watcher.dispose();
});

test('busy tracking refreshes known geometry from pixels without inference and invalidates changed cards',async()=>{
  const r=fieldRig();for(let i=0;i<6;i++)await r.tick();r.watcher.confirm(r.watcher.getSnapshot().tracks[0].id,'A');
  const detects=r.detects,reads=r.reads;r.busy=true;
  for(let i=0;i<6;i++){await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);}
  assert.equal(r.detects,detects);assert.equal(r.reads,reads);
  r.motion=.2;await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
  r.motion=0;await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false,'pixels cannot restore an invalidated outline');
  r.busy=false;await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,true);
  r.busy=true;r.appearance=Array(12).fill(.8);await r.tick(750);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false,'stationary replacements are invalidated');
  const oldRef=r.watcher.getSnapshot().tracks[0].id;r.busy=false;await r.tick();
  for(let i=0;i<6;i++)await r.tick();
  // Owner 2026-11-03: different pixels on the same spot are a new card on top. The acknowledged ref keeps its identity, hidden under it.
  // The new outline reads as the same card A (light change): it merges back. The acknowledged ref keeps its identity, no new ref.
  const old=r.watcher.getSnapshot().tracks.find(t=>t.id===oldRef);assert.equal(old?.cardId,'A','an acknowledged ref is not renamed by replacement pixels');assert.equal(old?.under,undefined);
  assert.equal(r.watcher.getSnapshot().tracks.filter(t=>!t.removed).length,1,'no second card');assert.equal(r.events.filter(e=>e.type==='placed').length,1);r.watcher.dispose();
});

test('pixel refreshes between slow detector samples preserve same-ref movement settlement',async()=>{
  let at=0,outlines=[card(.3,.3,.08,.12)];const events:field.FieldEvent[]=[];
  const watcher=field.createFieldWatcher({profile:yugioh,cpuBudget:.05,recognizer:{detectCards:async()=>{at+=100;return outlines;},recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},getKnownCards:()=>[{id:'known',zone:'M2',cardId:'A'}],now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2),halo:()=>Array(192).fill(.2)}),clone:async f=>f});
  watcher.subscribe(e=>{if(e.type!=='reading')events.push(e);});for(let i=0;i<6;i++){at+=750;await watcher.tick();}
  outlines=[card(.45,.3,.08,.12)];for(let i=0;i<20;i++){at+=750;await watcher.tick();}
  assert.ok(watcher.getSnapshot().metrics.intervalMs>750);
  assert.equal(events.filter(e=>e.type==='moved'&&e.track.id==='known'&&e.track.zone==='M3').length,1);watcher.dispose();
});


test('an unacknowledged same-position swap hides old identity before settling a fresh best match',async()=>{
  const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const before=r.reads,placed=r.events.filter(e=>e.type==='placed').length;
  r.motion=.2;await r.tick();r.motion=0;r.appearance=Array(12).fill(.8);r.identity='B';await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);
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
test('single clean placement overlaps one upright read with fresh face evidence',async()=>{
 for(const deck of [['A'],[]]){
  const r=fieldRig();r.decklist=deck;await r.tick(100);assert.equal(r.reads,1);assert.equal(r.events.length,0);
  await r.tick(100);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.inputs[0].opts.preferUpright,true);assert.ok(r.events[0].latencyMs!<=200);assert.equal(r.events[0].track.bestMatch,deck.length===0);
  for(let i=0;i<12;i++)await r.tick(100);assert.equal(r.reads,1);r.watcher.dispose();
 }
});

test('deck outlines never place identities and new GY reads stay single-shot',async()=>{
  for(const [x,y] of [[.87,.32],[.87,.03],[.87,.7],[.03,.7]])for(const faceDown of [true,false]){
    const r=fieldRig();r.outlines=[{...card(x,y,.05,.07),kind:faceDown?'face-down':'face-up'}];for(let i=0;i<7;i++)await r.tick();
    if(['DECK','EXTRA'].includes(zones.mapFieldZone(r.watcher.getSnapshot().tracks[0]?.card??card(x,y,.05,.07)).zone))assert.equal(r.events.some(e=>e.type==='placed'),false,`${x}/${y}/${faceDown}`);else assert.ok(r.events.filter(e=>e.type==='placed').length<=1);r.watcher.dispose();
  }
});
test('review S2: a five-card fan and three new separate outlines cannot auto-place',async()=>{
  for(const spacing of [.035,.14]){const r=fieldRig();r.outlines=Array.from({length:5},(_,i)=>card(.2+i*spacing,.3,.08,.12));for(let i=0;i<20;i++)await r.tick();assert.equal(r.events.some(e=>e.type==='placed'),false);assert.ok(r.events.filter(e=>e.type==='prompt').length<=1);r.watcher.dispose();}
});
test('review F: uncalibrated M2/M4 columns stay absolute when other cards appear',()=>{
  const pair=[card(.34,.5,.04,.06),card(.6,.5,.04,.06)];assert.equal(zones.mapFieldZone(pair[0],undefined,pair).zone,'M2');assert.equal(zones.mapFieldZone(pair[1],undefined,pair).zone,'M4');
});

test('review E: a removed monster reappearing on GY moves its original ref, never places another',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();const id=r.watcher.getSnapshot().tracks[0].id;r.watcher.confirm(id,'A');r.outlines=[];for(let i=0;i<6;i++)await r.tick(100);
 r.outlines=[card(.84,.3)];for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='moved'&&e.track.id===id&&e.track.zone==='GY').length,1);r.watcher.dispose();
});
test('review S3: forgetting a placement suppresses auto reapply for the same physical evidence',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.watcher.forget(r.watcher.getSnapshot().tracks[0].id);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.watcher.getSnapshot().tracks[0].state,'dismissed');r.watcher.dispose();
});

test('a different face revealed after a flip never restores the hidden old identity',async()=>{
 const r=fieldRig();for(let i=0;i<7;i++)await r.tick();r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.8);for(let i=0;i<7;i++)await r.tick();
 r.identity='B';r.outlines=[card(.3,.3)];await r.tick();assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);assert.equal(r.watcher.getSnapshot().tracks[0].visible,false);for(let i=0;i<7;i++)await r.tick();assert.equal(r.events.at(-1)?.type,'placed');assert.equal(r.events.at(-1)?.track.cardId,'B');r.watcher.dispose();
});
test('calibrated candidate centres outside the mat are rejected',async()=>{
 for(const corner of [{x:.4,y:.4},{x:.4,y:.2}]){const r=fieldRig();r.outlines=[card(.3,.3,.06,.1)];r.watcher.setCalibration(zones.createFieldCalibration([corner,{x:.95,y:.95}]));for(let i=0;i<10;i++)await r.tick();assert.equal(r.reads,0);assert.equal(r.events.length,0);r.watcher.dispose();}
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
 let at=0;const events:field.FieldEvent[]=[];const watcher=field.createFieldWatcher({profile:yugioh,getPriors:()=>undefined as any,recognizer:{detectCards:async()=>[card(.3,.3)],recognize:async()=>sureResult()},buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>0,sharpness:()=>20}),clone:async f=>f});watcher.subscribe(event=>{if(event.type!=='reading')events.push(event);});for(let i=0;i<8;i++){at+=333;await watcher.tick();}assert.equal(watcher.getSnapshot().error,undefined);assert.equal(events.at(-1)?.type,'placed');assert.equal(events.at(-1)?.track.bestMatch,true);watcher.dispose();
});

test('quiet empty-mat pixel checks skip inference but new motion starts detection before the idle budget',async()=>{
 const r=fieldRig();r.outlines=[];await r.tick(100);const before=r.detects;await r.tick(100);assert.equal(r.detects,before);r.motion=.2;r.outlines=[card(.3,.3)];await r.tick(50);assert.equal(r.detects,before+1);assert.equal(r.watcher.getSnapshot().tracks.length,1);r.watcher.dispose();
 // A cropped model pass can miss a plain sleeve that the full frame detects.
 // Retry once in this tick, without waiting for the periodic full scan.
 let at=100,moving=false,active=0,maxActive=0;const scopes:boolean[]=[];
 const watcher=field.createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,buffer:{sample:async()=>({frame:frame as ImageData,at})},
  recognizer:{detectCards:async(_f,opts)=>{scopes.push(!!opts?.region);active++;maxActive=Math.max(maxActive,active);await Promise.resolve();active--;return moving&&!opts?.region?[{...card(.3,.3),kind:'face-down'}]:[];},recognize:async()=>sureResult()},
  analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.8),motion:()=>moving?.2:0,...(moving?{motionRegion:{x:.3,y:.3,w:.15,h:.25}}:{}),sharpness:()=>20})});
 try{await watcher.tick();moving=true;at+=2500;await watcher.tick();assert.deepEqual(scopes,[false,true,false]);assert.equal(maxActive,1);assert.equal(watcher.getSnapshot().tracks.length,1);}
 finally{watcher.dispose();}
 // A localized difference must wake detection even below whole-mat motion,
 // and an unchanged front returned by the crop must not hide the new back.
 at=100;moving=false;scopes.length=0;
 const other=card(.75,.3,.12,.2),back={...card(.3,.3,.12,.2),kind:'face-down' as const};
 const populated=field.createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,buffer:{sample:async()=>({frame:frame as ImageData,at})},
  recognizer:{detectCards:async(_f,opts)=>{scopes.push(!!opts?.region);return moving&&!opts?.region?[other,back]:[other];},recognize:async()=>sureResult()},
  analyze:()=>({crop:fieldCrop,appearance:c=>zones.fieldCenter(c).x>.7?Array.from({length:12},(_,i)=>i%2?.6:.2):Array(12).fill(.8),motion:c=>moving&&zones.fieldCenter(c).x<.7?.001:0,...(moving?{motionRegion:{x:.3,y:.3,w:.12,h:.2}}:{}),sharpness:()=>20})});
 try{for(let i=0;i<8;i++){at+=100;await populated.tick();}const old=populated.getSnapshot().tracks[0];assert.equal(old.state,'identified');populated.confirm(old.id,'A');moving=true;at+=50;await populated.tick();assert.deepEqual(scopes.slice(-2),[true,false]);assert.equal(populated.getSnapshot().tracks.length,2);}
 finally{populated.dispose();}
});

test('scan budget follows the live detector backend and backs off when inference slows',async()=>{
 const original=globalThis.Worker;let at=0,cost=20,backend:'webgpu'|'wasm'='wasm',busy=false;
 class FakeWorker {
  onmessage?: (e:{data:unknown})=>void;
  postMessage(message:Record<string,unknown>){if(message.type==='init')assert.equal(message.backend,'auto');if(message.type==='detect')at+=cost;queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:message.type==='init'?null:[],detectorBackend:backend}}));}
  terminate(){}
 }
 globalThis.Worker=FakeWorker as unknown as typeof Worker;
 const reader=createRecognizer(),watcher=field.createFieldWatcher({recognizer:reader,profile:yugioh,buffer:{sample:async()=>({frame:frame as ImageData,at})},now:()=>at,hidden:()=>false,cpuBusy:()=>busy,analyze:()=>({crop:fieldCrop,appearance:()=>Array(12).fill(.2),motion:()=>1,sharpness:()=>20}),clone:async f=>f});
 const tick=async()=>{at+=1000;await watcher.tick();return watcher.getSnapshot();};
 try {
  assert.equal((await tick()).metrics.intervalMs,250);
  assert.equal(watcher.getSnapshot().metrics.dutyPercent,8);
  backend='webgpu';assert.equal((await tick()).metrics.intervalMs,66);
  assert.ok(Math.abs(watcher.getSnapshot().metrics.dutyPercent-100*20/66)<.01);
  cost=50;for(let i=0;i<40;i++)await tick();assert.ok(Math.abs(watcher.getSnapshot().metrics.intervalMs-100)<.1);
  cost=400;for(let i=0;i<20;i++)await tick();assert.equal(watcher.getSnapshot().status,'budget');assert.ok(watcher.getSnapshot().metrics.intervalMs>650);
  const samples=watcher.getSnapshot().metrics.samples;busy=true;assert.equal((await tick()).status,'busy');assert.equal(watcher.getSnapshot().metrics.samples,samples);busy=false;
  backend='wasm';assert.ok((await tick()).metrics.intervalMs>1500);
 }finally{watcher.dispose();reader.dispose();globalThis.Worker=original;}
});

test('native camera ring refreshes within100ms while retaining at most six originals',async t=>{
 const original=globalThis.createImageBitmap;let captured=0,closed=0,at=0;t.mock.method(performance,'now',()=>at);
 globalThis.createImageBitmap=(async (source:any)=>({width:1280,height:720,n:source.n??++captured,close(){closed++;}})) as any;
 t.mock.timers.enable({apis:['setTimeout']});const {createOwnFeedBuffer}=await import('./frame-buffer');const buffer=createOwnFeedBuffer({readyState:2,videoWidth:1280,videoHeight:720} as HTMLVideoElement);
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 try{await flush();at+=100;t.mock.timers.tick(100);await flush();assert.equal(((await buffer.sample()).frame as any).n,2);at+=50;assert.equal(((await buffer.sample({maxAgeMs:40})).frame as any).n,3,'bounded confirmation can request the next decoded frame within 50ms');for(let i=0;i<8;i++){at+=100;t.mock.timers.tick(100);await flush();((await buffer.sample()).frame as ImageBitmap).close();}assert.equal((await buffer.snapshot()).length,6);assert.ok(closed>=4);}
 finally{buffer.stop();await flush();t.mock.timers.reset();globalThis.createImageBitmap=original;}
});

test('repeated decoded camera frames cannot advance watcher evidence',async t=>{
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
 r.appearance=Array(12).fill(.8);await r.tick(100);r.appearance=Array.from({length:12},(_,i)=>i%2?.6:.2);for(let i=0;i<8;i++)await r.tick(100);
 const placements=r.events.filter(e=>e.type==='placed');assert.equal(placements.length,2);assert.equal(placements[1].track.id,original.track.id);assert.ok((placements[1].track.revision??0)>(original.track.revision??0));
 r.watcher.confirm(original.track.id,'A');r.appearance=Array(12).fill(.8);await r.tick(100);r.appearance=Array.from({length:12},(_,i)=>i%2?.6:.2);for(let i=0;i<8;i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='placed').length,2);r.watcher.dispose();
});
test('owner live move: a stable slide follows the same ref in under one second without rereading',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id,before=r.reads,from=r.at;
 r.outlines=[card(.428,.3)];r.motion=.2;await r.tick(100);r.motion=0;for(let i=0;i<8&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 const move=r.events.find(e=>e.type==='moved');assert.ok(move);assert.ok(r.at-from<600,'known movement settles within a short detector burst');assert.equal(move.track.id,id);assert.equal(move.track.zone,'M3');assert.equal(r.reads,before);assert.equal(r.events.filter(e=>e.type==='prompt').length,0);r.watcher.dispose();
});
test('owner live move: two clean frames 100 ms apart settle an unchanged identity',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id,before=r.reads;r.watcher.confirm(id,'A');
 r.outlines=[card(.428,.3)];r.motion=.2;await r.tick(100);r.motion=0;await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,0);await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,id);assert.equal(r.reads,before);r.watcher.dispose();
});

test('a verified read reconnects a rotated card across the mat to its acknowledged live ref',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const original=r.events[0].track;r.watcher.confirm(original.id,'A');r.known=[{id:original.id,zone:original.zone,cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<12&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,original.id);assert.equal(r.events.at(-1)?.track.position,'defense');assert.equal(r.events.at(-1)?.track.revision,original.revision);assert.equal(r.events.filter(e=>e.type==='prompt'||e.type==='removed').length,0);assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.reads,2);r.watcher.dispose();
});
for(const obstacle of ['hand','different embedding','missing embedding','different identity','removed ref','unacknowledged ref','multiple outlines'])test(`strict copy rule reconciles a read with ${obstacle}`,async()=>{
 const r=fieldRig();if(obstacle!=='missing embedding')r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;if(obstacle!=='unacknowledged ref')r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(obstacle==='hand'?.8:.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 if(obstacle==='removed ref'){r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));r.known=[{id,zone:'GY',cardId:'A'}];}
 if(obstacle==='different embedding')r.embedding=[0,1];if(obstacle==='different identity'){r.identity='B';r.embedding=[0,1];r.decklist=['A','B'];}
 r.outlines=obstacle==='multiple outlines'?[card(.5,.3),card(.72,.3)]:[card(.65,.3,.25,.15)];for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(Number(r.events.some(e=>e.type==='moved'&&e.track.id===id)),['different identity','unacknowledged ref','removed ref'].includes(obstacle)?0:1,obstacle);if(obstacle==='multiple outlines')assert.equal(r.events.filter(e=>e.type==='placed').length,2,'a second read may place a copy only while both distinct cards are visible');r.watcher.dispose();
});

for(const zone of ['GY','BANISHED'] as const)test(`a matching field read cannot reuse a ${zone} ref without pile-exit evidence`,async t=>{
 const r=fieldRig();t.after(()=>r.watcher.dispose());r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');
 // The owner state puts the ref in a pile, but no pile lift was observed.
 r.known=[{id,zone,cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(r.events.some(e=>e.type==='moved'&&e.track.id===id),false,'pile history alone does not prove a move');
 const placements=r.events.filter(e=>e.type==='placed');assert.equal(placements.length,2);assert.notEqual(placements[1].track.id,id);assert.equal(placements[1].track.cardId,'A');
 assert.equal(r.reads,2);assert.equal(r.events.some(e=>e.type==='prompt'),false);
});

test('a rotated return after explicit removal Undo follows the same restored public ref',async()=>{
 const r=fieldRig();r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const pattern=Array.from({length:12},(_,i)=>i%2),mat=Array(12).fill(.2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;
 r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));r.known=[{id,zone:'GY',cardId:'A'}];
 await r.tick(3000);r.known=[{id,zone:'M2',cardId:'A'}];r.watcher.dismiss(id);r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<12&&!r.events.some(e=>e.type==='moved');i++)await r.tick(100);
 assert.equal(r.events.filter(e=>e.type==='moved').length,1);assert.equal(r.events.at(-1)?.track.id,id);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].removed,false);r.watcher.dispose();
});

test('a matching read after the move window reuses the public ref after a failed departure',async t=>{
 const r=fieldRig();t.after(()=>r.watcher.dispose());r.embedding=[1,0];for(let i=0;i<8;i++)await r.tick();const id=r.events[0].track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A'}];
 const mat=Array(12).fill(.2),pattern=Array.from({length:12},(_,i)=>i%2);r.appearanceAt=c=>zones.fieldCenter(c).x>.6?pattern:mat;r.outlines=[];for(let i=0;i<11;i++)await r.tick(300);assert.ok(r.events.some(e=>e.type==='removed'));
 await r.tick(3000);r.outlines=[card(.65,.3,.25,.15)];for(let i=0;i<20;i++)await r.tick(100);
 // The failed departure left the authoritative ref public; the fresh read
 // reconciles it beyond the short motion window without creating a copy.
 const moves=r.events.filter(e=>e.type==='moved');assert.equal(moves.length,1);assert.equal(moves[0].track.id,id);assert.equal(moves[0].track.cardId,'A');assert.equal(moves[0].track.position,'defense');
 assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.reads,2);assert.equal(r.events.some(e=>e.type==='prompt'),false);
 assert.equal(r.watcher.getSnapshot().tracks.length,1);assert.equal(r.watcher.getSnapshot().tracks[0].removed,false);
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
 const a=fieldRig('sure',20,restored);a.embedding=[1,0];a.identity='B';a.outlines=[card(.2,.3),card(.65,.3)];for(let i=0;i<12;i++)await a.tick();
 const placements=a.events.filter(e=>e.type==='placed');assert.equal(placements.length,2);assert.ok(placements.every(e=>e.track.cardId==='A'));assert.notEqual(placements[0].track.id,placements[1].track.id);assert.equal(a.events.some(e=>e.type==='prompt'),false);a.watcher.dispose();
 const unsure=fieldRig('not sure',20,restored);unsure.embedding=[.75,Math.sqrt(1-.75**2)];unsure.identity='B';for(let i=0;i<8;i++)await unsure.tick();assert.ok(unsure.events.some(e=>e.type==='placed'&&e.track.cardId==='B'&&e.track.bestMatch));assert.equal(unsure.events.some(e=>e.type==='prompt'),false);unsure.watcher.dispose();
 restored.remember(vector,undefined);const b=fieldRig('sure',20,restored);b.embedding=[1,0];for(let i=0;i<8;i++)await b.tick();assert.equal(b.events.length,0);assert.equal(b.watcher.getSnapshot().tracks[0].state,'dismissed');b.outlines=[];for(let i=0;i<20;i++)await b.tick();assert.equal(b.watcher.getSnapshot().tracks.length,1);b.watcher.dispose();
 restored.remember(vector,'B');assert.deepEqual(restored.resolve(vector),{kind:'match',cardId:'B'});
});

test('tracker follows slides, quarter turns and GY entry without another identity read',async()=>{
 const r=fieldRig();r.watcher.setCalibration(zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]));
 const pixels=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255);
 r.appearance=pixels;for(let i=0;i<8;i++)await r.tick();const original=r.events[0].track;r.watcher.confirm(original.id,'A');
 const before=r.reads;
 // Quarter-turn patch in the same canonical8x12 sampled coordinate system.
 const turn=Array.from({length:288},(_,i)=>{const p=Math.floor(i/3),x=p%8,y=Math.floor(p/8),sx=Math.round(y/11*7),sy=Math.round((1-x/7)*11);return pixels[(sy*8+sx)*3+i%3];});
 r.outlines=[card(.32,.3,.25,.15)];r.appearance=turn;r.motion=.2;await r.tick(100);r.motion=0;for(let i=0;i<4;i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='moved'&&e.track.position==='defense'));assert.equal(r.reads,before);
 // Non-overlapping transfer: the old footprint is empty, exactly one incoming card.
 r.appearanceAt=c=>zones.fieldCenter(c).x>.8?turn:Array(288).fill(.2);r.outlines=[card(.84,.3,.14,.2)];
 const from=r.at;r.motion=.2;await r.tick(100);assert.equal(r.watcher.getSnapshot().tracks.length,1,'motion frame reserves the incoming outline rather than birthing a second copy');r.motion=0;for(let i=0;i<4&&!r.events.some(e=>e.type==='moved'&&e.track.zone==='GY');i++)await r.tick(100);
 const gy=r.events.find(e=>e.type==='moved'&&e.track.zone==='GY');assert.ok(gy);assert.equal(gy.track.id,original.id);assert.ok(r.at-from<=500);assert.equal(r.reads,before);assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
 for(const destination of [card(.84,.3,.14,.2),card(.38,.3)]){const covered=fieldRig();covered.appearance=pixels;for(let i=0;i<8;i++)await covered.tick();const id=covered.events[0].track.id;covered.watcher.confirm(id,'A');
 covered.outlines=[];covered.appearance=Array(288).fill(.8);covered.motion=.2;await covered.tick(100);covered.motion=0;covered.appearanceAt=c=>c.quad[0].x===destination.quad[0].x?pixels:Array(288).fill(.8);covered.outlines=[destination];for(let i=0;i<8;i++)await covered.tick(100);
 assert.equal(covered.events.some(e=>e.type==='moved'&&e.track.id===id),true,'without simultaneous copy proof, matching incoming pixels follow the existing ref');covered.watcher.dispose();}
});

test('owner Fenrir: M3 -> GY -> back to M3 face-up with a white Set in M2 and an arm moving at the side',async t=>{
 const r=fieldRig();t.after(()=>r.watcher.dispose());r.watcher.setCalibration(zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]));r.cropAware=true;
 const fenrir=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),under=Array.from({length:288},(_,i)=>((Math.floor(i/3)*7+(i%3)*53)%241)/255),white=Array(288).fill(.9),mat=Array(288).fill(.2);
 const m3=card(.4,.35,.1,.15),gy=card(.84,.35,.1,.15),m2=card(.26,.35,.1,.15),set={...m2,kind:'face-down' as const,confidence:.9};
 // An older GY card B lies under Fenrir.
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'}];r.outlines=[m3];r.appearanceAt=c=>zones.fieldCenter(c).x<.5&&zones.fieldCenter(c).x>.4?fenrir:mat;
 for(let i=0;i<8;i++)await r.tick();const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id,zone:'M3',cardId:'A'}];
 // Fenrir goes to the GY.
 r.outlines=[gy];r.appearanceAt=c=>zones.fieldCenter(c).x>.8?fenrir:mat;r.motion=.2;await r.tick(100);r.motion=0;
 for(let i=0;i<6&&!r.events.some(e=>e.type==='moved'&&e.track.zone==='GY');i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===id&&e.track.zone==='GY'),'Fenrir enters the GY on its ref');
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id,zone:'GY',cardId:'A'}];
 // Fenrir comes back face-up to M3, B shows on the GY again, a white Set goes to M2,
 // and the arm keeps moving at the right edge (a small, localized motion region).
 r.identityAt=c=>zones.fieldCenter(c).x>.8?'B':'A';r.decklist=['A','B'];
 r.motionRegion={x:.72,y:.2,w:.06,h:.3};r.motionAt=c=>zones.fieldCenter(c).x>.7&&zones.fieldCenter(c).x<.8?.2:0;
 r.appearanceAt=c=>{const x=zones.fieldCenter(c).x;return x>.8?under:x>.4&&x<.5?(c.kind==='face-down'?white:fenrir):x<.4&&x>.25?white:mat;};
 // Under the purple light the detector first calls the arriving Fenrir a back.
 r.outlines=[{...gy},{...m3,kind:'face-down',confidence:.8},set];for(let i=0;i<4;i++)await r.tick(100);
 r.outlines=[{...gy},{...m3},set];const fullAt:number[]=[];for(let i=0;i<30;i++){await r.tick(100);const d=r.watcher.getSnapshot().debug;if(d?.full&&d.at===r.at&&d.path.startsWith('detector'))fullAt.push(d.at);}
 // A moving arm never starves the full-frame pass (~300 ms GPU, >=500 ms CPU).
 assert.ok(fullAt.length>=4&&fullAt.every((at,i)=>!i||at-fullAt[i-1]<=800),`full passes at ${fullAt}`);
 const snap=r.watcher.getSnapshot(),fen=snap.tracks.find(t=>t.id===id);
 assert.ok(fen,'Fenrir keeps its physical track');assert.equal(fen.zone,'M3');assert.equal(fen.faceDown,false,'a face-up read overrides any stale face-down state');assert.equal(fen.visible,true,'the camera shows a bracket on M3');assert.equal(fen.removed,false);
 assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===id&&e.track.zone==='M3'),'the GY ref moves back to M3, so the GY count drops');
 assert.ok(r.events.some(e=>e.type==='placed'&&e.track.zone==='M2'&&e.track.faceDown),'the white Set is placed face-down in M2');
 assert.equal(r.events.some(e=>e.type==='placed'&&e.track.cardId==='A'&&e.track.id!==id),false,'no second Fenrir is created');
 // The provisional back from the purple frames is replaced, not left behind.
 const provisional=r.events.find(e=>e.type==='placed'&&e.track.zone==='M3'&&e.track.faceDown);if(provisional)assert.equal(r.events.find(e=>e.type==='moved'&&e.track.id===id&&e.track.zone==='M3')?.replacesRef,provisional.track.id);
 assert.equal(snap.tracks.filter(t=>t.zone==='M3'&&!t.removed).length,1);
 // The detector also returns a second, larger outline of Fenrir (card plus hand).
 // It joins Fenrir's track: the glue never sees two cards in M3.
 const beforeDup=r.events.length;r.outlines=[{...gy},{...m3},card(.4,.35,.11,.17),set];for(let i=0;i<8;i++)await r.tick(100);r.outlines=[{...gy},{...m3},set];
 assert.equal(r.events.slice(beforeDup).some(e=>(e.type==='placed'||e.type==='prompt'||e.type==='reading')&&e.track.id!==id&&e.track.zone==='M3'),false,'a duplicate outline makes no second M3 card');
 assert.equal(r.watcher.getSnapshot().tracks.filter(t=>t.zone==='M3'&&!t.removed).length,1);
 // Identity lock: the player named Fenrir. A flip and a new read that says 'B'
 // (not a clear, higher score) keep the name; no prompt, no rename.
 const beforeLock=r.events.length,lockId=r.identityAt;r.identityAt=c=>{const p=zones.fieldCenter(c);return p.x>.8||p.x>.4&&p.x<.5?'B':'A';};
 r.outlines=[{...gy},{...m3,kind:'face-down',confidence:.9},set];for(let i=0;i<8;i++)await r.tick(100);
 r.outlines=[{...gy},{...m3},set];for(let i=0;i<12;i++)await r.tick(100);
 assert.equal(r.events.slice(beforeLock).some(e=>e.track.id===id&&(e.type==='prompt'||e.track.cardId==='B')),false,'a locked card is not re-guessed');
 assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id===id)?.cardId,'A');r.identityAt=lockId;
 const debug=snap.debug!;assert.ok(debug.detections.some(d=>d.zone==='M3'&&d.use.startsWith('track')),'the debug overlay shows the raw M3 outline and its track');
 // Infinite Impermanence: a Set in S3 is revealed, then sent from S3 to the GY.
 const s3=card(.4,.72,.1,.15),imperm=Array.from({length:288},(_,i)=>((Math.floor(i/3)*29+(i%3)*11)%239)/255);
 r.identityAt=c=>{const p=zones.fieldCenter(c);return p.x>.8?'B':p.y>.6?'C':'A';};r.decklist=['A','B','C'];
 r.appearanceAt=c=>{const p=zones.fieldCenter(c);return p.x>.8?under:p.y>.6?(c.kind==='face-down'?white:imperm):p.x>.4&&p.x<.5?fenrir:p.x<.4&&p.x>.25?white:mat;};
 r.outlines=[{...gy},{...m3},set,{...s3,kind:'face-down',confidence:.9}];for(let i=0;i<10;i++)await r.tick(100);
 const s3Set=r.events.find(e=>e.type==='placed'&&e.track.zone==='S3');assert.ok(s3Set&&s3Set.track.faceDown,'S3 Set placed');
 r.outlines=[{...gy},{...m3},set,{...s3}];for(let i=0;i<20&&!r.events.some(e=>e.track.id===s3Set.track.id&&e.track.cardId==='C');i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.track.id===s3Set.track.id&&!e.track.faceDown&&e.track.cardId==='C'),'Infinite Impermanence revealed on its Set ref');
 r.watcher.confirm(s3Set.track.id,'C');
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id,zone:'M3',cardId:'A'},{id:s3Set.track.id,zone:'S3',cardId:'C'}];
 r.appearanceAt=c=>{const p=zones.fieldCenter(c);return p.x>.8?imperm:p.x>.4&&p.x<.5&&p.y<.6?fenrir:p.x<.4&&p.x>.25&&p.y<.6?white:mat;};
 r.outlines=[{...gy},{...m3},set];r.motion=.2;await r.tick(100);r.motion=0;
 for(let i=0;i<15&&!r.events.some(e=>e.type==='moved'&&e.track.id===s3Set.track.id&&e.track.zone==='GY');i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===s3Set.track.id&&e.track.zone==='GY'),'the face-up trap goes from S3 to the GY on its ref');
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id,zone:'M3',cardId:'A'},{id:s3Set.track.id,zone:'GY',cardId:'C'}];
 // The owner clears the mat: every field card leaves within ~2 s, including a
 // twin the watcher never tracked (an EMZ Link); the GY pile stays.
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id:s3Set.track.id,zone:'GY',cardId:'C'},{id,zone:'M3',cardId:'A'},{id:'link',zone:'EMZ1',cardId:'L'}];
 r.motionRegion=undefined;r.motionAt=undefined;r.outlines=[{...gy}];r.appearanceAt=c=>zones.fieldCenter(c).x>.8?imperm:mat;const clearedFrom=r.at,before=r.events.length;
 for(let i=0;i<40&&!['link',id].every(ref=>r.events.some(e=>e.type==='removed'&&e.track.id===ref&&e.track.zone!=='GY'));i++)await r.tick(100);
 for(const ref of ['link',id])assert.ok(r.events.some(e=>e.type==='removed'&&e.track.id===ref&&e.track.zone!=='GY'),`${ref} leaves the field`);
 assert.ok(r.at-clearedFrom<=3500,`empty mat cleared after ${r.at-clearedFrom} ms`);
 assert.equal(r.events.slice(before).some(e=>e.type==='removed'&&['gy-old',s3Set.track.id].includes(e.track.id)),false,'piles stay');
 // Owner on :3000, monitor glare: a blue-white cast and an uneven glare ring
 // around M4. An arm rests by the new card (skin on its crop) and every read
 // is flagged covered. The card still gets a best match (never "Reading"
 // forever), the watcher never errors, and the card leaves when it is lifted.
 const m4=card(.54,.35,.1,.15),glare=Array.from({length:288},(_,i)=>i%3===2?.95:.8),dragon=Array.from({length:288},(_,i)=>((Math.floor(i/3)*13+(i%3)*41)%233)/255);
 const inM4=(c:DetectedQuad)=>{const x=zones.fieldCenter(c).x;return x>.5&&x<.6;};
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id:s3Set.track.id,zone:'GY',cardId:'C'}];r.identityAt=()=>'D';r.decklist=['A','B','C','D'];
 r.halo=Array.from({length:192},(_,i)=>(i%24)/24);r.touchedAt=c=>inM4(c)?.05:0;r.qualityAt=()=>({covered:true});
 r.appearanceAt=c=>zones.fieldCenter(c).x>.8?imperm:inM4(c)?dragon:glare;
 const glareFrom=r.at,beforeGlare=r.events.length;r.outlines=[{...gy},m4];
 for(let i=0;i<30&&!r.events.slice(beforeGlare).some(e=>e.type==='placed'&&e.track.zone==='M4');i++)await r.tick(100);
 const named=r.events.slice(beforeGlare).find(e=>e.type==='placed'&&e.track.zone==='M4');
 assert.ok(named&&named.track.cardId==='D'&&named.track.bestMatch,'a glare card gets a best match, never Reading forever');
 assert.ok(r.at-glareFrom<=2500,`named after ${r.at-glareFrom} ms`);assert.notEqual(r.watcher.getSnapshot().status,'error');
 r.known=[{id:'gy-old',zone:'GY',cardId:'B'},{id:s3Set.track.id,zone:'GY',cardId:'C'},{id:named.track.id,zone:'M4',cardId:'D'}];r.touchedAt=undefined;
 const goneFrom=r.at;r.outlines=[{...gy}];r.appearanceAt=c=>zones.fieldCenter(c).x>.8?imperm:glare;
 for(let i=0;i<30&&!r.events.some(e=>e.type==='removed'&&e.track.id===named.track.id);i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='removed'&&e.track.id===named.track.id),'removed by detector absence, without a uniform mat ring');
 assert.ok(r.at-goneFrom<=1500,`removed after ${r.at-goneFrom} ms`);
 // Piles: out of view is gone. No Deck on this mat shows as missing; a Deck
 // stack makes it present. The whole GY stack is picked up: GY is missing
 // after 2 full scans (the glue lifts all GY cards in one action).
 assert.ok(r.watcher.getSnapshot().missingPiles?.includes('DECK'),'no Deck on the mat');
 const cal=zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]),dcell=zones.fieldZoneCells('normal',cal.zoneSpacing,cal.zones).find(c=>c.zone==='DECK')!;
 const dc=zones.fieldMatPoint({x:dcell.x+dcell.w/2,y:dcell.y+dcell.h/2},cal),deckOutline={...card(dc.x-.04,dc.y-.06,.08,.12),kind:'face-down' as const,confidence:.9};
 r.outlines=[{...gy},deckOutline];for(let i=0;i<10;i++)await r.tick(100);
 assert.equal(r.watcher.getSnapshot().missingPiles?.includes('DECK'),false,'the Deck stack is back on the mat');
 const liftFrom=r.at;r.outlines=[deckOutline];r.appearanceAt=c=>zones.fieldCenter(c).x>.8?glare:glare;for(let i=0;i<10;i++)await r.tick(100);
 assert.equal(r.watcher.getSnapshot().missingPiles?.includes('GY'),false,'one second is not enough to call the pile picked up');
 for(let i=0;i<30&&!r.watcher.getSnapshot().missingPiles?.includes('GY');i++)await r.tick(100);
 assert.ok(r.watcher.getSnapshot().missingPiles?.includes('GY'),'the GY stack was picked up');assert.ok(r.at-liftFrom>=2000&&r.at-liftFrom<=3000,`GY missing after ${r.at-liftFrom} ms`);
 assert.equal(r.watcher.getSnapshot().missingPiles?.includes('DECK'),false);
 // Owner, Ghost Belle: M4 -> GY (its only card), then lifted from the GY and put in S2
 // by hand. The card is carried for 3 s and the CPU read is slow, so the read ends
 // long after the hand left the GY. It is the GY card moving, never a 2nd copy.
 const belle=Array.from({length:288},(_,i)=>((Math.floor(i/3)*23+(i%3)*19)%227)/255),s2=card(.26,.72,.1,.15);
 const inHand:field.KnownFieldCard[]=[{id:'gy-old',zone:'HAND',cardId:'B'},{id:s3Set.track.id,zone:'HAND',cardId:'C'}];r.known=inHand;r.identityAt=()=>'G';r.decklist=['A','B','C','D','G'];r.qualityAt=undefined;r.halo=Array(192).fill(.2);
 r.appearanceAt=c=>inM4(c)?belle:mat;const beforeBelle=r.events.length;r.outlines=[deckOutline,m4];
 for(let i=0;i<30&&!r.events.slice(beforeBelle).some(e=>e.type==='placed'&&e.track.cardId==='G');i++)await r.tick(100);
 const placedBelle=r.events.slice(beforeBelle).find(e=>e.type==='placed'&&e.track.cardId==='G')!;assert.ok(placedBelle,'Ghost Belle placed in M4');
 const gid=placedBelle.track.id;r.watcher.confirm(gid,'G');r.known=[...inHand,{id:gid,zone:'M4',cardId:'G'}];
 r.appearanceAt=c=>zones.fieldCenter(c).x>.8?belle:mat;r.outlines=[deckOutline,{...gy}];r.motion=.2;await r.tick(100);r.motion=0;
 for(let i=0;i<20&&!r.events.some(e=>e.type==='moved'&&e.track.id===gid&&e.track.zone==='GY');i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='moved'&&e.track.id===gid&&e.track.zone==='GY'),'Ghost Belle enters the GY on its ref');
 r.known=[...inHand,{id:gid,zone:'GY',cardId:'G'}];for(let i=0;i<10;i++)await r.tick(100);
 // A hand takes it from the GY, carries it for 3 s, and sets it down in S2.
 r.motionAt=c=>zones.fieldCenter(c).x>.8?.2:0;r.outlines=[deckOutline];await r.tick(100);await r.tick(100);r.motionAt=undefined;
 for(let i=0;i<30;i++)await r.tick(100);
 const beforeS2=r.events.length;r.appearanceAt=c=>zones.fieldCenter(c).y>.6&&zones.fieldCenter(c).x<.4?belle:mat;r.outlines=[deckOutline,s2];
 for(let i=0;i<30&&!r.events.slice(beforeS2).some(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone==='S2');i++)await r.tick(100);
 const atS2=r.events.slice(beforeS2).find(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone==='S2');
 assert.ok(atS2,'Ghost Belle shows in S2');assert.equal(atS2.track.id===gid||atS2.fromRef===gid,true,`the GY ref moves to S2 (got ${atS2.type} ${atS2.track.id})`);
 assert.equal(r.events.slice(beforeS2).some(e=>e.type==='placed'&&e.track.cardId==='G'&&e.track.id!==gid&&e.fromRef!==gid),false,'no second Ghost Belle');
 // A 2nd Ghost Belle: GY = [Belle X, card Y on top]. A hand goes over the GY (Y is sent),
 // and 3 s later a new Belle shows in S4. X is not the top and the touch is older than
 // 2.5 s, so X stays in the GY: the new card is a 2nd copy with a new ref.
 const s4=card(.54,.72,.1,.15),inS4=(c:DetectedQuad)=>zones.fieldCenter(c).y>.6&&zones.fieldCenter(c).x>.5&&zones.fieldCenter(c).x<.6;
 r.known=[...inHand,{id:'gy-x',zone:'GY',cardId:'G'},{id:'gy-y',zone:'GY',cardId:'B'},{id:gid,zone:'S2',cardId:'G'}];
 r.identityAt=c=>zones.fieldCenter(c).x>.8?'B':'G';
 r.appearanceAt=c=>zones.fieldCenter(c).x>.8?under:zones.fieldCenter(c).y>.6&&zones.fieldCenter(c).x<.4||inS4(c)?belle:mat;r.outlines=[deckOutline,{...gy},s2];
 for(let i=0;i<10;i++)await r.tick(100);
 r.motionAt=c=>zones.fieldCenter(c).x>.8?.2:0;await r.tick(100);r.motionAt=undefined;
 for(let i=0;i<30;i++)await r.tick(100);
 const before2nd=r.events.length;r.outlines=[deckOutline,{...gy},s2,s4];
 for(let i=0;i<30&&!r.events.slice(before2nd).some(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone==='S4'&&e.track.cardId==='G');i++)await r.tick(100);
 const second=r.events.slice(before2nd).find(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone==='S4'&&e.track.cardId==='G');
 assert.ok(second,'the 2nd Ghost Belle shows in S4');
 assert.equal(second.track.id!=='gy-x'&&second.fromRef!=='gy-x',true,`a deeper GY copy stays in the GY (got ${second.type} ${second.track.id})`);
 // "Scan field" forces a full detector pass on the next sample; the snapshot gives its time.
 r.watcher.scanNow();await r.tick(10);assert.ok(r.watcher.getSnapshot().debug?.full,'Scan field runs a full pass');
 assert.equal(r.watcher.getSnapshot().lastFullAt,r.at,'the snapshot tells when the last full pass ran');
 // Owner on :3000: Temple of the Kings goes on the GY on top of Apophis while a hand
 // is near. The new top reads and goes on the pile once; the old top stays.
 const temple=Array.from({length:288},(_,i)=>((Math.floor(i/3)*37+(i%3)*5)%229)/255),gyIds=()=>r.events.filter(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone==='GY'&&e.track.cardId==='T');
 r.identityAt=c=>zones.fieldCenter(c).x>.8?'T':'G';r.decklist=['A','B','C','D','G','T'];
 r.appearanceAt=c=>zones.fieldCenter(c).x>.8?temple:zones.fieldCenter(c).y>.6&&zones.fieldCenter(c).x<.4||inS4(c)?belle:mat;
 r.motionAt=c=>zones.fieldCenter(c).x>.8?.2:0;r.touchedAt=c=>zones.fieldCenter(c).x>.8?.08:0;await r.tick(100);await r.tick(100);r.motionAt=undefined;
 const templeFrom=r.at;for(let i=0;i<4;i++)await r.tick(100);r.touchedAt=undefined;
 for(let i=0;i<30&&!gyIds().length;i++)await r.tick(100);
 assert.equal(gyIds().length,1,'Temple of the Kings goes on the GY');assert.ok(r.at-templeFrom<=2500,`on the GY after ${r.at-templeFrom} ms`);
 assert.ok(!['gy-x','gy-y'].includes(gyIds()[0].track.id),'a new ref, the old top stays under it');
 for(let i=0;i<20;i++)await r.tick(100);assert.equal(gyIds().length,1,'pushed once');
 // Owner on :3000: the camera (re)starts on a laid-out board. Three cards show at
 // once, each in its own zone: a board, not a fanned hand. All are read; none
 // stays "dismissed" behind the deck-spread guard.
 const m1=card(.12,.35,.1,.15),m5=card(.68,.35,.1,.15),s5=card(.68,.72,.1,.15),boardIds:Record<string,string>={M1:'D',M5:'T',S5:'C'};
 r.identityAt=c=>{const z=zones.mapFieldZone(c,cal,[],'normal').zone;return boardIds[z]??(zones.fieldCenter(c).x>.8?'T':'G');};
 r.appearanceAt=c=>{const z=zones.mapFieldZone(c,cal,[],'normal').zone;return z==='M1'?dragon:z==='M5'?temple:z==='S5'?imperm:zones.fieldCenter(c).x>.8?temple:zones.fieldCenter(c).y>.6&&zones.fieldCenter(c).x<.4||inS4(c)?belle:mat;};
 const boardFrom=r.at;r.outlines=[deckOutline,{...gy},s2,s4,m1,m5,s5];
 const onBoard=()=>['M1','M5','S5'].filter(z=>r.events.some(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone===z&&e.track.cardId===boardIds[z]));
 for(let i=0;i<30&&onBoard().length<3;i++)await r.tick(100);
 assert.deepEqual(onBoard(),['M1','M5','S5'],'every card of a laid-out board is read');assert.ok(r.at-boardFrom<=3000,`board read after ${r.at-boardFrom} ms`);
 // ---- Owner 2026-11-03: cards on top of cards. ----
 // Clear the field (the GY and Deck stay), so the next steps start on an empty mat.
 const look=(seed:number)=>Array.from({length:288},(_,i)=>((Math.floor(i/3)*seed+(i%3)*(seed+6))%(211+seed))/255);
 r.outlines=[deckOutline,{...gy}];r.appearanceAt=c=>zones.fieldCenter(c).x>.8?temple:mat;r.identityAt=c=>zones.fieldCenter(c).x>.8?'T':'G';
 for(let i=0;i<40&&r.watcher.getSnapshot().tracks.some(t=>!t.removed&&/^(M|S|EMZ|FIELD)/.test(t.zone));i++)await r.tick(100);
 let kn:field.KnownFieldCard[]=[];const setKnown=(v:field.KnownFieldCard[])=>{kn=v;r.known=v;};setKnown([{id:'gy-x',zone:'GY',cardId:'G'},{id:'gy-y',zone:'GY',cardId:'B'},{id:gyIds()[0].track.id,zone:'GY',cardId:'T'}]);
 const zoneOf=(c:DetectedQuad)=>zones.mapFieldZone(c,cal,[],'normal').zone;
 const lookP=look(13),lookQ=look(17),lookX=look(29),lookK=look(31),lookN=look(37);
 const ids:Record<string,string>={};let looks:Record<string,number[]>={},names:Record<string,string>={};
 r.appearanceAt=c=>looks[zoneOf(c)]??(zones.fieldCenter(c).x>.8?temple:mat);r.identityAt=c=>names[zoneOf(c)]??(zones.fieldCenter(c).x>.8?'T':'G');
 r.decklist=['A','B','C','D','G','T','P','Q','X','K','N','APO','TMP','MWM'];
 const placedIn=(zone:string,cardId:string,from:number)=>r.events.slice(from).find(e=>(e.type==='placed'||e.type==='moved')&&e.track.zone===zone&&e.track.cardId===cardId);
 // Xyz Summon: P in M3 and Q in M4. Q goes on top of P, then the Xyz X goes on top of both.
 let from=r.events.length;looks={M3:lookP,M4:lookQ};names={M3:'P',M4:'Q'};r.outlines=[deckOutline,{...gy},m3,m4];
 for(let i=0;i<30&&!(placedIn('M3','P',from)&&placedIn('M4','Q',from));i++)await r.tick(100);
 ids.P=placedIn('M3','P',from)!.track.id;ids.Q=placedIn('M4','Q',from)!.track.id;r.watcher.confirm(ids.P,'P');r.watcher.confirm(ids.Q,'Q');
 setKnown([...kn,{id:ids.P,zone:'M3',cardId:'P'},{id:ids.Q,zone:'M4',cardId:'Q'}]);for(let i=0;i<5;i++)await r.tick(100);
 from=r.events.length;const onP={...card(.405,.355,.1,.15)};looks={M3:lookQ};names={M3:'Q'};r.motion=.2;r.outlines=[deckOutline,{...gy},onP];await r.tick(100);r.motion=0;
 for(let i=0;i<20&&!placedIn('M3','Q',from);i++)await r.tick(100);
 for(let i=0;i<5;i++)await r.tick(100);
 assert.ok(placedIn('M3','Q',from)?.track.id===ids.Q,'Q moves onto P on its own ref');
 const trackOf=(id:string)=>r.watcher.getSnapshot().tracks.find(t=>t.id===id);
 assert.equal(trackOf(ids.P)?.removed,false,'P under Q is not removed');assert.equal(trackOf(ids.P)?.under,ids.Q,'P is under Q');
 setKnown(kn.map(k=>k.id===ids.Q?{...k,zone:'M3'}:k));
 looks={M3:lookX};names={M3:'X'};r.motion=.2;await r.tick(100);r.motion=0;
 for(let i=0;i<30&&!placedIn('M3','X',from);i++)await r.tick(100);
 const xyz=placedIn('M3','X',from);assert.ok(xyz&&![ids.P,ids.Q].includes(xyz.track.id),'the Xyz is a new card on top');
 for(let i=0;i<5;i++)await r.tick(100);
 assert.equal(trackOf(ids.Q)?.under,xyz!.track.id,'Q is under the Xyz');assert.equal(trackOf(ids.P)?.removed,false);
 assert.ok(r.events.some(e=>e.type==='covered'&&e.track.id===ids.Q&&e.coverRef===xyz!.track.id),'the glue is told Q went under the Xyz');
 assert.equal(r.events.slice(from).some(e=>e.type==='removed'&&[ids.P,ids.Q].includes(e.track.id)),false,'no material goes to the hand');
 // Review r1 H5: glare on the confirmed Xyz is light, not a new card. The new outline reads as X and merges back.
 r.watcher.confirm(xyz!.track.id,'X');setKnown([...kn,{id:xyz!.track.id,zone:'M3',cardId:'X'}]);for(let i=0;i<5;i++)await r.tick(100);
 from=r.events.length;looks={M3:lookX.map((v,i)=>i%24<8?Math.min(1,v+.35):v)};for(let i=0;i<20;i++)await r.tick(100);
 assert.equal(r.events.slice(from).some(e=>e.type==='placed'||e.type==='removed'),false,'glare makes no new card and removes nothing');
 assert.equal(trackOf(xyz!.track.id)?.under,undefined,'the Xyz keeps its outline');
 // Review r1 BLOCKER (watcher part): Rank-Up. X2 goes on top of X; X (with P and Q) goes under X2, nothing leaves.
 // Review r2 N1: in poor light (read not sure) it is still a new card on top, never merged into X.
 const lookX2=look(53);looks={M3:lookX2};names={M3:'X2'};r.tierAt=c=>zoneOf(c)==='M3'?'not sure':'sure';r.motion=.2;await r.tick(100);r.motion=0;
 for(let i=0;i<30&&!placedIn('M3','X2',from);i++)await r.tick(100);for(let i=0;i<5;i++)await r.tick(100);
 const rankUp=placedIn('M3','X2',from);r.tierAt=undefined;assert.ok(rankUp&&rankUp.track.id!==xyz!.track.id,'the Rank-Up Xyz is a new card on top');
 assert.equal(rankUp!.track.bestMatch,true,'an unsure read is a best match, not lost');assert.equal(trackOf(xyz!.track.id)?.cardId,'X');
 assert.equal(trackOf(xyz!.track.id)?.under,rankUp!.track.id,'the old Xyz is under the new one');
 assert.equal(r.events.slice(from).some(e=>e.type==='removed'&&[ids.P,ids.Q,xyz!.track.id].includes(e.track.id)),false,'no material leaves');
 r.watcher.confirm(rankUp!.track.id,'X2');setKnown([...kn,{id:rankUp!.track.id,zone:'M3',cardId:'X2'}]);looks={M3:lookX2};names={M3:'X2'};
 // Review r1 H6: an Xyz in Defense Position on a monster in Attack Position is still a new card on top.
 for(let i=0;i<10;i++)await r.tick(100);
 const m2a=card(.26,.35,.1,.15),m2d=card(.235,.375,.15,.1),lookR=look(59),lookY=look(61);from=r.events.length;
 looks={M3:lookX2,M2:lookR};names={M3:'X2',M2:'R'};r.outlines=[deckOutline,{...gy},onP,m2a];
 for(let i=0;i<30&&!placedIn('M2','R',from);i++)await r.tick(100);ids.R=placedIn('M2','R',from)!.track.id;r.watcher.confirm(ids.R,'R');setKnown([...kn,{id:ids.R,zone:'M2',cardId:'R'}]);for(let i=0;i<10;i++)await r.tick(100);
 looks={M3:lookX2,M2:lookY};names={M3:'X2',M2:'Y'};r.motion=.2;r.outlines=[deckOutline,{...gy},onP,m2d];await r.tick(100);r.motion=0;
 for(let i=0;i<30&&!placedIn('M2','Y',from);i++)await r.tick(100);for(let i=0;i<5;i++)await r.tick(100);
 const defXyz=placedIn('M2','Y',from);assert.ok(defXyz&&defXyz.track.id!==ids.R&&defXyz.track.position==='defense','the Defense Position Xyz is placed as a new card');
 assert.equal(trackOf(ids.R)?.under,defXyz!.track.id,'the Attack Position monster is under it');assert.equal(trackOf(ids.R)?.cardId,'R');
 for(let i=0;i<10;i++)await r.tick(100);r.outlines=[deckOutline,{...gy},onP];looks={M3:lookX2};names={M3:'X2'};
 // The player takes the M2 stack away: both leave the field.
 for(let i=0;i<40&&!(trackOf(ids.R)?.removed&&trackOf(defXyz!.track.id)?.removed);i++)await r.tick(100);
 assert.ok(trackOf(ids.R)?.removed&&trackOf(defXyz!.track.id)?.removed,'a lifted stack leaves the field');
 setKnown(kn.filter(k=>k.id!==ids.R));
 // Temple of the Kings (K) in the Field Zone, partly covered by a new monster N in M1. K stays on the field.
 for(let i=0;i<10;i++)await r.tick(100);
 const fieldCard=card(.04,.35,.1,.15),cover=card(.115,.35,.1,.15);
 from=r.events.length;looks={M3:lookX,FIELD:lookK};names={M3:'X',FIELD:'K'};r.outlines=[deckOutline,{...gy},onP,fieldCard];
 for(let i=0;i<30&&!placedIn('FIELD','K',from);i++)await r.tick(100);
 ids.K=placedIn('FIELD','K',from)!.track.id;r.watcher.confirm(ids.K,'K');setKnown([...kn,{id:ids.K,zone:'FIELD',cardId:'K'}]);for(let i=0;i<15;i++)await r.tick(100);
 looks={M3:lookX,FIELD:lookK,M1:lookN};names={M3:'X',FIELD:'K',M1:'N'};r.outlines=[deckOutline,{...gy},onP,cover];
 for(let i=0;i<30&&!placedIn('M1','N',from);i++)await r.tick(100);for(let i=0;i<10;i++)await r.tick(100);
 assert.ok(placedIn('M1','N',from),'the covering monster is placed in M1');
 assert.equal(r.events.slice(from).some(e=>e.track.id===ids.K&&(e.type==='removed'||e.type==='moved')),false,'Temple stays in the Field Zone');
 assert.equal(trackOf(ids.K)?.under,undefined,'a neighbour in M1 is not a card on top: Temple keeps its own zone');assert.equal(trackOf(ids.K)?.removed,false);
 // GY log: Apophis -> Temple -> Man with the Mark, a hand over the pile each time. Count 3, in order.
 r.outlines=[deckOutline,onP,cover];r.appearanceAt=c=>looks[zoneOf(c)]??mat;
 for(let i=0;i<30&&!r.watcher.getSnapshot().missingPiles?.includes('GY');i++)await r.tick(100);
 setKnown(kn.filter(k=>k.zone!=='GY'));const pile:string[]=[];
 const land=async(cardId:string,seed:number)=>{
  const before=r.events.length;r.touchedAt=c=>zoneOf(c)==='GY'?.1:0;r.motionAt=c=>zoneOf(c)==='GY'?.2:0;await r.tick(100);await r.tick(100);
  looks={...looks,GY:look(seed)};names={...names,GY:cardId};r.outlines=[deckOutline,onP,cover,{...gy}];await r.tick(100);r.touchedAt=undefined;r.motionAt=undefined;
  for(let i=0;i<30&&!placedIn('GY',cardId,before);i++)await r.tick(100);
  const e=placedIn('GY',cardId,before);assert.ok(e,`${cardId} goes on the GY`);pile.push(e!.track.id);
  setKnown([...kn,{id:e!.track.id,zone:'GY',cardId}]);for(let i=0;i<5;i++)await r.tick(100);
 };
 await land('APO',41);await land('TMP',43);
 // A hand passes over the pile: a re-read of the same top is not a new card.
 const passFrom=r.events.length;r.touchedAt=c=>zoneOf(c)==='GY'?.1:0;r.motionAt=c=>zoneOf(c)==='GY'?.2:0;await r.tick(100);await r.tick(100);r.touchedAt=undefined;r.motionAt=undefined;
 for(let i=0;i<15;i++)await r.tick(100);
 assert.equal(r.events.slice(passFrom).some(e=>(e.type==='placed'||e.type==='moved'||e.type==='removed')&&(e.track.zone==='GY'||pile.includes(e.track.id))),false,'a hand over the pile changes nothing');
 await land('MWM',47);
 // Review r1 H9: an unreadable top (prompt, glue pushes "Unknown card") does not take the next card's identity.
 {const before=r.events.length;r.tierAt=c=>zoneOf(c)==='GY'?'low match':'sure';r.touchedAt=c=>zoneOf(c)==='GY'?.1:0;r.motionAt=c=>zoneOf(c)==='GY'?.2:0;await r.tick(100);await r.tick(100);
  looks={...looks,GY:look(67)};names={...names,GY:'UNK'};await r.tick(100);r.touchedAt=undefined;r.motionAt=undefined;
  for(let i=0;i<30&&!r.events.slice(before).some(e=>e.type==='prompt'&&e.track.zone==='GY');i++)await r.tick(100);
  const unknown=r.events.slice(before).find(e=>e.type==='prompt'&&e.track.zone==='GY');assert.ok(unknown,'an unreadable GY top asks for its name');
  setKnown([...kn,{id:unknown!.track.id,zone:'GY'}]);r.tierAt=undefined;for(let i=0;i<5;i++)await r.tick(100);
  const next=r.events.length;r.touchedAt=c=>zoneOf(c)==='GY'?.1:0;r.motionAt=c=>zoneOf(c)==='GY'?.2:0;await r.tick(100);await r.tick(100);
  looks={...looks,GY:look(71)};names={...names,GY:'NXT'};await r.tick(100);r.touchedAt=undefined;r.motionAt=undefined;
  for(let i=0;i<30&&!placedIn('GY','NXT',next);i++)await r.tick(100);
  const pushed=placedIn('GY','NXT',next);assert.ok(pushed&&pushed.track.id!==unknown!.track.id,'the next card is a new entry, not the Unknown one renamed');
  setKnown([...kn,{id:pushed!.track.id,zone:'GY',cardId:'NXT'}]);for(let i=0;i<5;i++)await r.tick(100);
  assert.equal(kn.filter(k=>k.zone==='GY').length,5,'GY count: 3 + Unknown + 1');}
 assert.deepEqual(kn.filter(k=>k.zone==='GY').map(k=>k.cardId),['APO','TMP','MWM',undefined,'NXT'],'order: Apophis, Temple, Man with the Mark, Unknown, next');assert.equal(new Set(pile).size,3,'three cards, three refs');
 // One second of heavy blur, then a hand passes: the GY still has 3 cards, nothing goes to the hand.
 r.frameSharpness=100;for(let i=0;i<5;i++)await r.tick(100);
 const blurFrom=r.events.length,sharpLooks=looks;r.frameSharpness=10;r.detail=1;looks=Object.fromEntries(Object.entries(looks).map(([z,v])=>[z,v.map(()=>.45)]));r.outlines=[deckOutline,onP];for(let i=0;i<10;i++)await r.tick(100);
 looks=sharpLooks;r.frameSharpness=100;r.detail=20;r.outlines=[deckOutline,onP,cover,{...gy}];r.touchedAt=c=>zoneOf(c)==='GY'?.1:0;r.motionAt=c=>zoneOf(c)==='GY'?.2:0;await r.tick(100);await r.tick(100);r.touchedAt=undefined;r.motionAt=undefined;
 for(let i=0;i<15;i++)await r.tick(100);
 assert.equal(r.watcher.getSnapshot().missingPiles?.includes('GY'),false,'a blurred pile is never picked up');
 assert.equal(r.events.slice(blurFrom).some(e=>e.type==='removed'||e.type==='placed'&&e.track.zone==='GY'),false,'nothing leaves and nothing is added');
 // Owner on :3000: "my shadow leans forward, it covers the card a bit, and in certain
 // cases the card disappears". Soft shadow blobs (30-70% darker, soft edge) move over
 // a known card while the detector loses it; then a shadow from above covers the whole
 // board. The card is never removed. A card really lifted under a shadow still leaves
 // within 1.5 s after the shadow settles.
 {
  const s=fieldRig();t.after(()=>s.watcher.dispose());const scal=zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]);s.watcher.setCalibration(scal);
  const art=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),floor=Array(288).fill(.2),spot=card(.4,.35,.1,.15);
  // Soft blob on the 8x12 patch: darkening `dark` inside radius r around (cx,cy), logistic edge.
  const shade=(patch:number[],dark:number,cx:number,cy:number,radius:number)=>patch.map((v,i)=>{const p=Math.floor(i/3),d=Math.hypot((p%8)/7-cx,Math.floor(p/8)/11-cy);return v*(1-dark/(1+Math.exp((d-radius)/.12)));});
  s.outlines=[spot];s.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?art:floor;s.frameSharpness=100;
  for(let i=0;i<8;i++)await s.tick();const sid=s.events.find(e=>e.type==='placed')!.track.id;s.watcher.confirm(sid,'A');s.known=[{id:sid,zone:'M3',cardId:'A'}];
  assert.ok(s.keeps.length>=1,'the detector is asked to keep the known card at a lower score');
  const removed=()=>s.events.filter(e=>e.type==='removed'&&e.track.id===sid).length;
  for(const dark of [.3,.5,.7]){
   // The shadow sweeps over the card (the detector loses it), then rests on it for 3 s.
   s.outlines=[];
   for(let k=0;k<10;k++){const cx=-.5+k*.2;s.shadow={share:.3,changed:.05};s.motionAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?.03:0;s.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?shade(art,dark,cx,.5,.6):shade(floor,dark,.5,.5,2);await s.tick(100);}
   s.motionAt=undefined;s.shadow={share:.3,changed:0};
   for(let k=0;k<30;k++)await s.tick(100);
   assert.equal(removed(),0,`a card under a ${dark*100}% soft shadow stays`);
   s.shadow={share:0,changed:.3};s.outlines=[spot];s.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?art:floor;for(let k=0;k<5;k++)await s.tick(100);s.shadow=undefined;
  }
  // A shadow from above over the whole board: everything 60% darker, the detector sees nothing.
  s.outlines=[];s.shadow={share:.9,changed:.9};s.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?art.map(v=>v*.4):floor.map(v=>v*.4);await s.tick(100);
  s.shadow={share:.9,changed:0};for(let k=0;k<30;k++)await s.tick(100);
  assert.equal(removed(),0,'a shadow from above over the whole board removes nothing');
  assert.equal(s.watcher.getSnapshot().shadow?.share,.9,'the debug line shows the shadow share');
  // Lifted under the shadow: the arm (and its shadow) moves, settles, the spot shows dark mat only.
  s.shadow={share:.9,changed:.05};s.motionAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?.2:0;s.appearanceAt=()=>floor.map(v=>v*.4);
  for(let k=0;k<3;k++)await s.tick(100);
  assert.equal(s.watcher.getSnapshot().shadow?.hold,true,'removal holds while the shadow moves');
  s.motionAt=undefined;s.shadow={share:.9,changed:0};const settled=s.at;
  for(let k=0;k<30&&!removed();k++)await s.tick(100);
  assert.equal(removed(),1,'a card lifted under a shadow is removed');assert.ok(s.at-settled<=1500,`removed ${s.at-settled} ms after the shadow settled`);
 }
 // Owner: the camera was blurry for a moment and cards were removed. A blurred frame
 // (sharpness far below its recent baseline) is never "no outline" evidence, for field
 // cards or piles; removals hold until 0.5 s after it, then re-check.
 {
  const b=fieldRig();t.after(()=>b.watcher.dispose());const bcal=zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]);b.watcher.setCalibration(bcal);
  const art=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),floor=Array(288).fill(.2),spot=card(.4,.35,.1,.15),pile=card(.84,.35,.1,.15);
  b.outlines=[spot,pile];b.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?art:floor;b.frameSharpness=100;b.known=[{id:'gy-top',zone:'GY',cardId:'B'}];
  for(let i=0;i<8;i++)await b.tick();const bid=b.events.find(e=>e.type==='placed'&&e.track.zone==='M3')!.track.id;b.watcher.confirm(bid,'A');b.known=[{id:'gy-top',zone:'GY',cardId:'B'},{id:bid,zone:'M3',cardId:'A'}];
  b.frameSharpness=30;b.outlines=[];b.appearanceAt=()=>Array(288).fill(.45);for(let k=0;k<12;k++)await b.tick(100);
  assert.equal(b.watcher.isBlurred(),true);assert.ok(b.watcher.frameSharpness().ratio<.5);assert.equal(b.watcher.getSnapshot().blur?.hold,true,'debug: blur · hold');
  assert.equal(b.events.some(e=>e.type==='removed'),false,'a blurred camera removes no card');assert.equal(b.watcher.getSnapshot().missingPiles?.includes('GY'),false,'nor a pile');
  b.frameSharpness=100;b.outlines=[spot,pile];b.appearanceAt=c=>zones.fieldCenter(c).x>.4&&zones.fieldCenter(c).x<.5?art:floor;for(let k=0;k<10;k++)await b.tick(100);
  assert.equal(b.events.some(e=>e.type==='removed'),false);assert.equal(b.watcher.isBlurred(),false);
 }
 // Owner: the mat is EMPTY but a face-down card stays in S3 (a twin with no live track;
 // arms move at the mat edges, so the "empty mat" rule never runs). A stale face-down
 // candidate with a huge box hangs over M4-M1. The S3 twin is removed within ~1.5 s,
 // the re-sync list names it, Scan field removes it again after an Undo, and the
 // candidate expires; a box larger than two zones never starts a card.
 {
  const e=fieldRig();t.after(()=>e.watcher.dispose());const ecal=zones.createFieldCalibration([{x:0,y:0},{x:1,y:1}]);e.watcher.setCalibration(ecal);
  const darkMat=Array(288).fill(.12),back=Array.from({length:288},(_,i)=>.1+(i%5)*.01);
  e.appearanceAt=()=>darkMat;e.frameSharpness=100;e.known=[{id:'s3-set',zone:'S3',faceDown:true,position:'defense'}];
  // Arms at both mat edges: localized motion every frame.
  e.motionRegion={x:.0,y:.1,w:.08,h:.8};e.motionAt=c=>{const b=boundsOf(c.quad);return b.w>.9?.02:zones.fieldCenter(c).x<.1||zones.fieldCenter(c).x>.9?.2:0;};
  const huge={...card(.12,.3,.6,.45),kind:'face-down' as const,confidence:.6},small={...card(.68,.35,.1,.15),kind:'face-down' as const,confidence:.9};
  e.outlines=[huge,small];e.appearanceAt=c=>zones.fieldCenter(c).x>.6&&zones.fieldCenter(c).x<.8?back:darkMat;for(let k=0;k<3;k++)await e.tick(100);
  assert.equal(e.watcher.getSnapshot().tracks.some(t=>boundsOf(t.card.quad).w>.5),false,'a box larger than two zones starts no card');
  e.outlines=[];e.appearanceAt=()=>darkMat;const emptyFrom=e.at;
  for(let k=0;k<30&&!e.events.some(x=>x.type==='removed'&&x.track.id==='s3-set');k++)await e.tick(100);
  const gone=e.events.find(x=>x.type==='removed'&&x.track.id==='s3-set');
  assert.ok(gone,'the face-down S3 twin with no live track leaves the empty mat');assert.ok(e.at-emptyFrom<=1500,`S3 removed after ${e.at-emptyFrom} ms`);assert.equal(gone.track.faceDown,true);
  assert.deepEqual(e.watcher.getSnapshot().missingTwins,['s3-set'],'the re-sync gets the missing twin');
  for(let k=0;k<25;k++)await e.tick(100);
  assert.equal(e.watcher.getSnapshot().tracks.some(t=>t.state==='candidate'&&!t.removed),false,'the stale candidate expired');
  // The player Undoes the removal (twin back in S3). After the retries, Scan field removes it again.
  for(let k=0;k<60;k++)await e.tick(100);const beforeScan=e.events.filter(x=>x.type==='removed'&&x.track.id==='s3-set').length;
  e.watcher.scanNow();for(let k=0;k<10&&e.events.filter(x=>x.type==='removed'&&x.track.id==='s3-set').length===beforeScan;k++)await e.tick(100);
  assert.ok(e.events.filter(x=>x.type==='removed'&&x.track.id==='s3-set').length>beforeScan,'Scan field removes it');
 }
});

test('unchanged face-down sleeve matching the mat is never removed by the fast absence path',async()=>{
 let at=0;
 const outline={...card(.3,.3),kind:'face-down' as const};
 const patch=Array(288).fill(0),halo=Array(192).fill(0);
 const crop={width:96,height:140,data:new Uint8ClampedArray(96*140*4)};
 const events:field.FieldEvent[]=[];
 const watcher=field.createFieldWatcher({profile:yugioh,
  recognizer:{detectCards:async()=>[structuredClone(outline)],recognize:async()=>sureResult()},
  buffer:{sample:async()=>({frame:frame as ImageData,at})},
  getKnownCards:()=>[{id:'dark-sleeve',zone:'M2',card:structuredClone(outline),faceDown:true}],
  now:()=>at,hidden:()=>false,
  analyze:()=>({crop:()=>crop,motion:()=>0,motionOutside:()=>0,sharpness:()=>20,appearance:()=>patch,halo:()=>halo}),clone:async f=>f});
 watcher.subscribe(event=>{if(event.type!=='reading')events.push(event);});
 try{
  for(let i=0;i<30;i++){at+=100;await watcher.tick();}
  assert.equal(events.filter(event=>event.type==='removed').length,0);
  assert.equal(events.filter(event=>event.type==='placed').length,0);
  assert.equal(watcher.getSnapshot().tracks.filter(track=>!track.removed).length,1);
  assert.equal(watcher.getSnapshot().tracks[0].id,'dark-sleeve');
 }finally{watcher.dispose();}
});


test('owner M3: a revealed sideways Set flips upright on its original ref within 700 ms',async()=>{
 const r=fieldRig();r.outlines=[card(.44,.3,.12,.2)];
 for(let i=0;i<12;i++)await r.tick(100);
 const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M3',cardId:'A',faceDown:false}];
 r.outlines=[{...card(.4,.34,.2,.12),kind:'face-down'}];r.appearance=Array(12).fill(.9);r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<20&&!r.events.some(e=>e.type==='flipped'&&e.track.faceDown);i++)await r.tick(33);
 assert.ok(r.events.some(e=>e.type==='flipped'&&e.track.faceDown),'front becomes a revealed Set');
 r.watcher.confirm(id);r.known=[{id,zone:'M3',faceDown:true,position:'defense'}];r.events.length=0;
 r.outlines=[{...card(.44,.3,.12,.175),confidence:.65}];r.appearance=Array.from({length:12},(_,i)=>i%2?.6:.2);r.motion=.2;await r.tick(33);r.motion=0;
 const from=r.at;for(let i=0;i<21&&!r.events.some(e=>e.type==='placed'&&!e.track.faceDown);i++)await r.tick(33);
 const reveal=r.events.find(e=>e.type==='placed'&&!e.track.faceDown);assert.ok(reveal,JSON.stringify(r.watcher.getSnapshot()));
 assert.equal(reveal.track.id,id);assert.equal(reveal.track.zone,'M3');assert.equal(reveal.track.position,'attack');assert.ok(r.at-from<700);assert.equal(r.reads,2);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});


test('owner white back: a calibrated face-up M3 becomes a sideways revealed Set within 400 ms',async()=>{
 for(const kind of ['face-down','face-up'] as const){
  const r=fieldRig('sure',20,undefined,{width:160,height:90});
  r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
  r.outlines=[card(.43,.38,.1,.259)];for(let i=0;i<12;i++)await r.tick(100);
  const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M3',cardId:'A',faceDown:false}];r.events.length=0;
  r.cropAt=()=>({width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(245)});
  r.outlines=[{...card(.407,.421,.146,.178),kind,confidence:.45}];r.appearance=Array(12).fill(.96);r.motion=.2;await r.tick(33);r.motion=0;
  const from=r.at;for(let i=0;i<12&&!r.events.some(e=>e.type==='flipped');i++)await r.tick(33);
  const set=r.events.find(e=>e.type==='flipped');assert.ok(set,`${kind}: ${JSON.stringify(r.watcher.getSnapshot())}`);
  assert.equal(set.track.id,id);assert.equal(set.track.zone,'M3');assert.equal(set.track.position,'defense');assert.equal(set.track.faceDown,true);assert.ok(r.at-from<400);assert.equal(r.reads,1);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
 }
});


// Owner S2 (Apophis): a revealed card turned face-down again in its zone is a flip, never a return to the hand.
// A plain white sleeve leaves the pixel face gate undecided; the low-score detector back decides after 600 ms.
// Lifted to turn it over (out of view for a moment), the back that comes back to the zone keeps the same ref.
test('a face-up card turned face-down in its zone flips in place, also after a lift; it never leaves to the hand',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90});
 r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 const front=card(.43,.38,.1,.259),art=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),sleeve=Array(288).fill(.92),mat=Array(288).fill(.2);
 r.outlines=[front];r.appearanceAt=()=>art;for(let i=0;i<12;i++)await r.tick(100);
 const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M3',cardId:'A',faceDown:false}];r.events.length=0;
 const undecided=()=>{const w=96,h=140,d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const e=Math.exp(-(((x-48)/20)**2+((y-70)/28)**2));d.set([150+60*e,150,150-60*e,255],(y*w+x)*4);}return {width:w,height:h,data:d};};
 r.cropAt=undecided;r.outlines=[{...front,kind:'face-down',confidence:.43}];r.appearanceAt=()=>sleeve;r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<20&&!r.events.some(e=>e.type==='flipped');i++)await r.tick(67);
 const flip=r.events.find(e=>e.type==='flipped');assert.ok(flip,JSON.stringify(r.watcher.getSnapshot().debug?.reasons));
 assert.equal(flip.track.id,id);assert.equal(flip.track.faceDown,true);assert.equal(r.events.some(e=>e.type==='removed'),false);
 r.watcher.dispose();
 // Lifted to turn it over: the spot is clear mat for two full scans (removed), then the back is put down in the zone.
 const l=fieldRig('sure',20,undefined,{width:160,height:90});
 l.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 l.outlines=[front];l.appearanceAt=()=>art;for(let i=0;i<12;i++)await l.tick(100);
 const ref=l.events.find(e=>e.type==='placed')!.track.id;l.watcher.confirm(ref,'A');l.known=[{id:ref,zone:'M3',cardId:'A',faceDown:false}];l.events.length=0;
 l.outlines=[];l.appearanceAt=()=>mat;for(let i=0;i<12&&!l.events.some(e=>e.type==='removed');i++)await l.tick(333);
 assert.ok(l.events.some(e=>e.type==='removed'&&e.track.id===ref),'the lift is seen');l.events.length=0;l.known=[{id:ref,zone:'HAND',cardId:'A'}];
 l.cropAt=undecided;l.outlines=[{...front,kind:'face-down',confidence:.43}];l.appearanceAt=()=>sleeve;for(let i=0;i<20&&!l.events.some(e=>e.type==='flipped');i++)await l.tick(67);
 const back=l.events.find(e=>e.type==='flipped');assert.ok(back,JSON.stringify(l.watcher.getSnapshot().debug?.reasons));
 assert.equal(back.track.id,ref,'the same ref, not a new Set');assert.equal(back.track.faceDown,true);assert.equal(l.events.some(e=>e.type==='placed'),false);l.watcher.dispose();
});

// Owner cleared the field: S2, S4, M3 and FIELD stayed ~10 s while an arm lay on the mat at the far side.
// A hand/arm or a moving shadow holds only the removals of the cards it lies over or beside; a clear spot
// elsewhere is removed after two empty full scans (~1 s).
test('a removal hold for a hand, arm or moving shadow is local to the cards it covers or touches',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90});
 r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 const art=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),mat=Array(288).fill(.2),left=card(.22,.38,.1,.259),mid=card(.43,.38,.1,.259);
 const near=(c:DetectedQuad)=>zones.fieldCenter(c).x<.33;
 r.outlines=[left,mid];r.appearanceAt=()=>art;for(let i=0;i<12;i++)await r.tick(100);
 const placed=r.events.filter(e=>e.type==='placed'),ids=placed.map(e=>e.track.id);assert.equal(placed.length,2);
 for(const e of placed)r.watcher.confirm(e.track.id,'A');r.known=placed.map(e=>({id:e.track.id,zone:e.track.zone,cardId:'A',faceDown:false}));r.events.length=0;
 const leftId=placed.find(e=>near(e.track.card))!.track.id,midId=ids.find(id=>id!==leftId)!;
 // The arm lies beside the left card and its shadow moves there; the middle card is lifted.
 const moved=new Uint8Array(32*24);for(let y=7;y<17;y++)for(let x=4;x<10;x++)moved[y*32+x]=1;
 r.skinNearAt=c=>near(c)?.2:0;r.outlines=[];r.appearanceAt=()=>mat;const from=r.at;
 for(let i=0;i<10&&!r.events.some(e=>e.type==='removed');i++){r.shadow={share:.3,changed:.05,moved,gx:32,gy:24};await r.tick(150);}
 const gone=r.events.filter(e=>e.type==='removed').map(e=>e.track.id);
 assert.deepEqual(gone,[midId],JSON.stringify(r.watcher.getSnapshot().debug?.reasons));assert.ok(r.at-from<=1500,`removed after ${r.at-from} ms`);
 for(let i=0;i<6;i++){r.shadow={share:.3,changed:.05,moved,gx:32,gy:24};await r.tick(150);}
 assert.equal(r.events.some(e=>e.type==='removed'&&e.track.id===leftId),false,'the card under the arm stays');
 // The arm leaves: the left card goes too.
 r.skinNearAt=undefined;r.shadow=undefined;const after=r.at;for(let i=0;i<12&&!r.events.some(e=>e.type==='removed'&&e.track.id===leftId);i++)await r.tick(150);
 assert.ok(r.events.some(e=>e.type==='removed'&&e.track.id===leftId));assert.ok(r.at-after<=1500,`left after ${r.at-after} ms`);r.watcher.dispose();
});

// Owner S4/S3 (Apophis, plain white sleeve, back .20): the track stayed up or hid, so the board never got a flip. A weak back
// that rests on the mat and shows a sleeve unlike the mat counts: the front turns down, the track stays visible with a rest
// time for the board, and Scan field reports the box. The same weak box over plain mat (a card that left) is no back.
test('a weak white back resting on the mat turns a bound front down; a weak box over plain mat does not',async()=>{
 const undecided=()=>{const w=96,h=140,d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const e=Math.exp(-(((x-48)/20)**2+((y-70)/28)**2));d.set([150+60*e,150,150-60*e,255],(y*w+x)*4);}return {width:w,height:h,data:d};};
 const front=card(.43,.6,.1,.2),art=Array.from({length:288},(_,i)=>((Math.floor(i/3)*17+(i%3)*31)%251)/255),sleeve=Array(288).fill(.92),mat=Array(288).fill(.2);
 const placed=async(confidence=.2)=>{
  const r=fieldRig('sure',20,undefined,{width:160,height:90});
  r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
  r.outlines=[front];r.appearanceAt=()=>art;for(let i=0;i<12;i++)await r.tick(100);
  const {id,zone}=r.events.find(e=>e.type==='placed')!.track;r.watcher.confirm(id,'A');r.known=[{id,zone,cardId:'A',faceDown:false}];r.events.length=0;
  r.cropAt=undecided;r.outlines=[{...front,kind:'face-down',confidence,cell:true}];
  return {r,id};
 };
 const {r,id}=await placed();r.appearanceAt=()=>sleeve;
 for(let i=0;i<20&&!r.events.some(e=>e.type==='flipped');i++)await r.tick(100);
 const flip=r.events.find(e=>e.type==='flipped');assert.ok(flip,JSON.stringify(r.watcher.getSnapshot().debug?.reasons));
 assert.equal(flip.track.id,id);assert.equal(flip.track.faceDown,true);
 await r.tick(100);await r.tick(100);
 const seen=r.watcher.getSnapshot().tracks.find(t=>t.id===id)!;
 assert.equal(seen.faceDown,true);assert.equal(seen.visible,true,'a resting weak back is not hidden');assert.equal(typeof seen.restSince,'number');
 r.watcher.scanNow();for(let i=0;i<6;i++)await r.tick(100);
 assert.deepEqual(r.watcher.getSnapshot().lastScanBacks,[flip.track.zone]);r.watcher.dispose();
 // A back in one Scan pass only is not evidence.
 const once=(await placed()).r;once.appearanceAt=()=>sleeve;for(let i=0;i<20;i++)await once.tick(100);
 once.watcher.scanNow();const box=[{...front,kind:'face-down' as const,confidence:.2,cell:true}];
 for(let i=0;i<6;i++){once.outlines=i===0?box:[];await once.tick(100);}
 assert.deepEqual(once.watcher.getSnapshot().lastScanBacks??[],[]);once.watcher.dispose();
 // None of these is a back: a weak box over plain mat, glare on a third of the art, a flat dark object, a printed mat with no empty
 // baseline, a hand beside the sleeve, a moving shadow over it.
 const glare=art.map((v,i)=>Math.floor(Math.floor(i/3)/8)<4?.97:v);
 // A .3 box gets no shortcut: glare, a dark object and a printed mat under it stay fronts.
 for(const [name,look] of [['.3 glare',glare],['.3 flat dark object',Array(288).fill(.45)],['.3 printed mat',Array(288).fill(.3)]] as const){
  const {r:other}=await placed(.3);other.appearanceAt=()=>look as number[];
  for(let i=0;i<25;i++)await other.tick(100);
  assert.equal(other.events.some(e=>e.type==='flipped'),false,name);other.watcher.dispose();
 }
 for(const [name,look,extra] of [['plain mat',mat],['glare',glare],['flat dark object',Array(288).fill(.45)],['printed mat',Array(288).fill(.3)],['hand near',sleeve,(x:ReturnType<typeof fieldRig>)=>{x.skinNearAt=()=>.2;}],['moving shadow',sleeve,(x:ReturnType<typeof fieldRig>)=>{x.shadow={share:.4,changed:.4};}]] as const){
  const {r:other}=await placed();other.appearanceAt=()=>look as number[];extra?.(other);
  for(let i=0;i<25;i++)await other.tick(100);
  assert.equal(other.events.some(e=>e.type==='flipped'),false,name);other.watcher.dispose();
 }
});

// Owner S3: a clear white face-down card on the dark mat got no box (the detector scores light sleeves .3-.45,
// below its .4 floor). In a calibrated field cell a weak back counts when its sleeve differs from the mat.
test('a low-score white back in an empty field cell is placed as a Set; the same score on plain mat is not',async()=>{
 for(const look of [.92,.2]){
  const r=fieldRig('sure',20,undefined,{width:160,height:90});
  r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
  r.cropAt=()=>{const w=96,h=140,d=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const e=Math.exp(-(((x-48)/20)**2+((y-70)/28)**2));d.set([150+60*e,150,150-60*e,255],(y*w+x)*4);}return {width:w,height:h,data:d};};
  r.outlines=[{...card(.43,.6,.1,.2),kind:'face-down',confidence:.33,cell:true}];r.appearanceAt=()=>Array(288).fill(look);
  for(let i=0;i<20;i++)await r.tick(100);
  const set=r.events.find(e=>e.type==='placed');
  if(look>.5){assert.ok(set,JSON.stringify(r.watcher.getSnapshot().debug));assert.equal(set.track.faceDown,true);assert.match(set.track.zone,/^S[1-5]$/);}
  else assert.equal(set,undefined,'a weak outline on plain mat is not a card');
  r.watcher.dispose();
 }
});

test('centre assignment accepts full camera quads that cross calibrated field and side-zone edges',async()=>{
 const calibration=zones.createFieldCalibration([{x:.1,y:.1},{x:.9,y:.9}],{playerSide:'bottom',mirrored:false});
 for(const [x,zone] of [[.045,'FIELD'],[.955,'GY'],[.5,'M3']] as const){
  const r=fieldRig();r.watcher.setCalibration(calibration);
  const quad=[{x:x-.055,y:.3},{x:x+.055,y:.3},{x:x+.055,y:.46},{x:x-.055,y:.46}].map(p=>zones.fieldMatPoint(p,calibration));
  r.outlines=[{quad,kind:'face-up',confidence:.95,partial:false}];for(let i=0;i<8;i++)await r.tick(100);
  assert.equal(r.watcher.getSnapshot().tracks.length,1,zone);assert.equal(r.watcher.getSnapshot().tracks[0].zone,zone);r.watcher.dispose();
 }
});


test('owner stale M3: an unbacked restart reservation cannot override the fresh top match',async()=>{
 const r=fieldRig();r.outlines=[card(.44,.3,.12,.175)];r.known=[{id:'stale-mark',zone:'M3',cardId:'old-mark',faceDown:false}];r.identity='kusanagi';
 for(let i=0;i<8;i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='placed'&&e.track.id==='stale-mark'&&e.track.cardId==='kusanagi'));
 for(let i=0;i<6;i++)await r.tick(100);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'kusanagi','the old server identity cannot cancel a pending save');
 assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});


test('owner adjacent move: a revealed Set identity follows its new front while a new card replaces M3',async()=>{
 for(const [sideways,confidence] of [[true,.95],[false,.95],[true,.65],[false,.65]] as const){
 const r=fieldRig();r.outlines=[card(.44,.3,.12,.175)];for(let i=0;i<10;i++)await r.tick(100);
 const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M3',cardId:'A',faceDown:false}];
 r.outlines=[{...(sideways?card(.4,.33,.2,.137):card(.44,.3,.12,.175)),kind:'face-down'}];r.appearance=Array(12).fill(.9);for(let i=0;i<8;i++)await r.tick(100);
 r.watcher.confirm(id,undefined,id,false);r.known=[{id,zone:'M3',cardId:'A',faceDown:true}];r.events.length=0;
 r.identityAt=c=>zones.fieldCenter(c).x>.6?'A':'B';r.appearanceAt=c=>Array.from({length:12},(_,i)=>zones.fieldCenter(c).x>.6?(i%2?.6:.2):(i%2?.9:.1));
 r.outlines=[{...card(.44,.3,.12,.175),confidence},card(.604,.3,.12,.175)];
 let seen=0;for(let i=0;i<20;i++){await r.tick(100);for(const event of r.events.slice(seen)){if(event.type==='placed'&&event.track.cardId==='B'&&event.track.id===id&&r.watcher.getSnapshot().tracks.some(t=>t.id===id&&t.cardId==='B'&&(t.revision??0)===(event.track.revision??0))){r.watcher.confirm(id,'B',id,false);r.known=[{id,zone:'M3',cardId:'B',faceDown:false}];}}seen=r.events.length;}
 const old=r.watcher.getSnapshot().tracks.find(t=>t.id===id);assert.equal(old?.cardId,'A');assert.equal(old?.zone,'M4');
 assert.ok(r.events.some(e=>e.track.id!==id&&e.track.cardId==='B'&&e.track.zone==='M3'&&e.type==='placed'));
 assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
 }
});

test('a same-class white Set confirms fresh pixels without another slow detector pass',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90});
 r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 r.outlines=[card(.43,.38,.1,.259)];for(let i=0;i<12;i++)await r.tick(100);
 const id=r.events.find(e=>e.type==='placed')!.track.id;
 r.watcher.confirm(id,'A');r.known=[{id,zone:'M3',cardId:'A',faceDown:false}];r.events.length=0;
 r.cropAt=()=>({width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(245)});
 r.outlines=[{...card(.407,.421,.146,.178),kind:'face-up',confidence:.45}];r.appearance=Array(12).fill(.96);
 r.detectorCost=200;const before=r.detects,from=r.at;
 r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<10&&!r.events.some(e=>e.type==='flipped');i++)await r.tick(67);
 assert.ok(r.events.some(e=>e.type==='flipped'&&e.track.id===id&&e.track.faceDown));
 assert.equal(r.detects-before,1,'a validated outline supports the unchanged pixel samples');
 assert.ok(r.at-from<500,`Set took ${r.at-from} ms`);
 assert.equal(r.reads,1);assert.equal(r.events.some(e=>e.type==='prompt'),false);r.watcher.dispose();
});

test('a slow first detector pass leaves time for three fresh Set confirmation frames',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90});
 r.outlines=[];await r.tick(1000);
 r.outlines=[{...card(.407,.421,.146,.178),kind:'face-down',confidence:.65}];r.appearance=Array(12).fill(.9);
 r.detectorCost=300;const before=r.detects,from=r.at;r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<10&&!r.events.some(e=>e.type==='placed');i++)await r.tick(67);
 assert.ok(r.events.some(e=>e.type==='placed'&&e.track.faceDown));
 assert.equal(r.detects-before,1,'fresh pixels finish the gate without rerunning inference');
 assert.ok(r.at-from<600,`Set took ${r.at-from} ms`);assert.equal(r.reads,0);r.watcher.dispose();
});

test('pixel confirmation does not lower the measured detector duty budget',async()=>{
 const r=fieldRig();for(let i=0;i<8;i++)await r.tick(100);r.detectorCost=200;for(let i=0;i<20;i++)await r.tick(500);
 const id=r.events.find(e=>e.type==='placed')!.track.id;r.watcher.confirm(id,'A');r.known=[{id,zone:'M2',cardId:'A',faceDown:false}];
 r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.9);r.events.length=0;
 r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<10&&!r.events.some(e=>e.type==='flipped');i++)await r.tick(67);
 assert.ok(r.events.some(e=>e.type==='flipped'));assert.ok(r.watcher.getSnapshot().metrics.intervalMs>750,'idle scans retain the actual inference cost');r.watcher.dispose();
});

test('long main-thread tasks do not starve budgeted detection and fresh pixel confirmation',async()=>{
 const original=globalThis.PerformanceObserver;let pressure:((list:any)=>void)|undefined;
 globalThis.PerformanceObserver=class{constructor(callback:(list:any)=>void){pressure=callback;}observe(){}disconnect(){}} as unknown as typeof PerformanceObserver;
 const r=fieldRig();r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.9);
 try{
  r.watcher.start();
  for(let i=0;i<10&&!r.events.some(e=>e.type==='placed');i++){pressure?.({getEntries:()=>[{duration:80}]});await r.tick(33);}
  assert.ok(r.events.some(e=>e.type==='placed'&&e.track.faceDown),'fresh frames progress despite unrelated main-thread work');
  assert.equal(r.reads,0);
 }finally{r.watcher.dispose();globalThis.PerformanceObserver=original;}
});

test('a quiet empty field limits background scans and still wakes immediately on motion',async()=>{
 const r=fieldRig();r.outlines=[];r.detectorCost=200;await r.tick(100);const before=r.detects;
 for(let i=0;i<20;i++)await r.tick(500);
 assert.ok(r.detects-before<=5,'quiet empty-field retries are at least two seconds apart');
 r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.9);r.motion=.2;await r.tick(33);r.motion=0;
 for(let i=0;i<10&&!r.events.some(e=>e.type==='placed');i++)await r.tick(67);
 assert.ok(r.events.some(e=>e.type==='placed'&&e.track.faceDown));r.watcher.dispose();
});

test('a stationary card recovers after a transient empty detector result',async()=>{
 const r=fieldRig();r.outlines=[];await r.tick(100);
 r.outlines=[{...card(.3,.3),kind:'face-down'}];r.appearance=Array(12).fill(.9);
 for(let i=0;i<30&&!r.events.some(e=>e.type==='placed');i++)await r.tick(100);
 assert.ok(r.events.some(e=>e.type==='placed'&&e.track.faceDown),'quiet retries recover a missed card without new motion');
 assert.equal(r.reads,0);r.watcher.dispose();
});

// Owner 2026-11-04 (Remote Duels, CPU): a card shown to the camera above the field was placed on the field
// ("Treasures of the Kings placed"). Through the mat homography a card held above the mat maps much larger than
// the cards resting there; with fingers on it, it is a held card (add-to-hand path), never a field card.
test('a card held above the mat over a zone is a held card, never a field placement; Debug says why',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90}),all:field.FieldEvent[]=[];r.watcher.subscribe(e=>all.push(e));
 r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 const resting=card(.33,.38,.1,.259),held=card(.5,.42,.13,.337);
 const isHeld=(c:DetectedQuad)=>zones.fieldCenter(c).x>.5;r.appearanceAt=c=>isHeld(c)?Array(12).fill(.9):Array.from({length:12},(_,i)=>i%2?.6:.2);
 r.outlines=[resting];for(let i=0;i<12;i++)await r.tick(100);
 const placed=r.events.find(e=>e.type==='placed')!;assert.equal(placed.track.zone,'M2');r.watcher.confirm(placed.track.id,'A');r.known=[{id:placed.track.id,zone:'M2',cardId:'A',faceDown:false}];
 for(let i=0;i<4;i++)await r.tick(100);all.length=0;
 // Shown over M3/S3, 1.3x the resting card's size (under the two-zone outline limit), fingers at its edge, reading as another card.
 r.identityAt=c=>isHeld(c)?'B':'A';r.touchedAt=c=>isHeld(c)?.04:0;
 r.outlines=[resting,held];for(let i=0;i<12;i++)await r.tick(100);
 assert.equal(all.some(e=>e.track.cardId==='B'||['reading','placed','prompt'].includes(e.type)&&e.track.id!==placed.track.id),false,JSON.stringify(all.map(e=>[e.type,e.track.zone,e.track.cardId])));
 assert.equal(r.watcher.getSnapshot().held?.length,1,'the held-card reader owns it');
 const debug=r.watcher.getSnapshot().debug!;
 assert.match(debug.detections.find(d=>d.quad[0].x===held.quad[0].x)?.use??'',/^held: size 1\.\dx/);
 assert.match(debug.reasons[placed.track.id]??'',/^on mat/);
 r.watcher.dispose();
});

// Owner 2026-11-04: a face-down track "S1 · down · hid" whose box ran from S1 down into M1 over the owner's arm stayed on
// the board with no detector box; Scan field did not remove it. A box that never lay on the mat plane is a phantom:
// a nearby arm, its own (arm) look or a weak kept outline cannot keep it, and it is taken back, not sent to the hand.
test('a phantom track with no box on the mat plane expires in two full scans despite an arm and weak outlines',async()=>{
 const r=fieldRig('sure',20,undefined,{width:160,height:90});
 r.watcher.setCalibration(zones.createFieldCalibration([{x:.11,y:.25},{x:.84,y:.84}],{playerSide:'bottom',mirrored:false}));
 const tall:DetectedQuad={...card(.23,.47,.09,.36),kind:'face-down',confidence:.8};
 r.known=[{id:'set-1',zone:'S1',faceDown:true,card:tall}];r.outlines=[tall];r.appearanceAt=()=>Array(288).fill(.7);
 for(let i=0;i<4;i++)await r.tick(333);
 assert.equal(r.watcher.getSnapshot().tracks.find(t=>t.id==='set-1')?.removed,false,'the restored track exists');
 // The arm stays beside it; only a weak kept outline of the arm remains.
 r.skinNearAt=()=>.2;r.outlines=[{...tall,confidence:.3,kept:true}];const from=r.at;
 for(let i=0;i<12&&!r.events.some(e=>e.type==='removed');i++)await r.tick(333);
 const gone=r.events.find(e=>e.type==='removed');
 assert.equal(gone?.track.id,'set-1',JSON.stringify(r.watcher.getSnapshot().debug?.reasons));assert.equal(gone?.reason,'phantom');assert.ok(r.at-from<=3000,`gone after ${r.at-from} ms`);
 assert.equal((r.keeps as {x:number;y:number}[][]).some(q=>Math.abs(q[0].x-tall.quad[0].x)<1e-6&&Math.abs(q[0].y-tall.quad[0].y)<1e-6),false,'its box does not keep weak outlines');
 r.watcher.dispose();
});

test('CPU budget: a still noisy mat rarely runs the detector, a change wakes it, and long motion stays in budget', async()=>{
 let seed=12345;const random=()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32;
 const W=320,H=180,image=(shift=0,patch?:number):{width:number;height:number;data:Uint8ClampedArray}=>{
  const data=new Uint8ClampedArray(W*H*4);
  for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=40+shift+Math.round((random()-.5)*14);data[i+3]=255;}
  if(patch!==undefined)for(let y=60;y<110;y++)for(let x=patch;x<patch+36;x++){const i=(y*W+x)*4;data[i]=220;data[i+1]=180;data[i+2]=140;}
  return {width:W,height:H,data};
 };
 let at=1000,frame=image(),passes=0,busyMs=0;
 const cost=300,watcher=field.createFieldWatcher({now:()=>at,hidden:()=>false,profile:yugioh,clone:async f=>f,
  buffer:{sample:async()=>({frame:frame as ImageData,at})},
  recognizer:{detectorBackend:'wasm',detectCards:async()=>{passes++;busyMs+=cost;at+=cost;return [];},recognize:async()=>{throw new Error('no reads here');}}});
 const run=async(ms:number,next:(i:number)=>ReturnType<typeof image>)=>{const end=at+ms;let i=0;while(at<end){frame=next(i++);at+=100;await watcher.tick();}};
 await run(1000,()=>image());
 passes=0;busyMs=0;
 // Noise alone and a change of exposure are not a change of the scene.
 await run(30_000,i=>image(i%20<10?0:3));
 assert.ok(passes<=8,`a still mat ran ${passes} passes in 30 s`);
 // A hand keeps moving for 30 s: wakes the detector at once, and the share stays near the sustained budget.
 passes=0;busyMs=0;const before=at;
 await run(30_000,i=>image(0,20+(i*7)%260));
 assert.ok(passes>=10,`motion ran only ${passes} passes`);
 assert.ok(busyMs/(at-before)<.5,`motion used ${Math.round(100*busyMs/(at-before))}% of the time`);
 assert.ok(watcher.getSnapshot().metrics.dutyPercent<60);
 // It stops: one pass on the final scene, then quiet again.
 passes=0;const still=image(0,100);await run(20_000,()=>({...still}));
 assert.ok(passes>=1&&passes<=8,`after motion: ${passes} passes in 20 s`);
 watcher.dispose();
});
