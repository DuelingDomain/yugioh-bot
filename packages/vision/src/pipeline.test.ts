import test from 'node:test';
import assert from 'node:assert/strict';
import {RecognitionPipeline} from './pipeline';
import {yugioh} from './games/yugioh';
import type {LoadedIndex,DetectedQuad} from './types';
import type {ModelSession} from './runtime';
import type {TensorCtor} from './embed';
const selected:DetectedQuad={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:1,partial:false};
const frame={width:20,height:30,data:new Uint8ClampedArray(2400).fill(120)};
function fixture(full=true,counter?:{calls:number}) {
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const index=(ids:string[])=>({meta:{dim:2,count:2,entries:ids.map(cardId=>({cardId,name:cardId,passcode:1,frameClass:'Effect'}))},vectors:new Float32Array([1,0,0,1])}) as LoadedIndex;
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  let step=0;
  const detector={backend:'wasm',run:()=>{throw new Error('selected quad must skip detection');}} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>{if(counter)counter.calls++;const score=step++===0?.9:.95;return {[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([score,Math.sqrt(1-score*score)])}};}} as unknown as ModelSession;
  return new RecognitionPipeline(profile,index(['A','B']),detector,embedder,Tensor as unknown as TensorCtor,full?index(['C','D']):undefined);
}
test('clear full-catalog answer survives decklist preference across indexes',async()=>{
  const result=await fixture().recognize([frame],{card:selected,k:5,priors:{decklist:['A'],voiceMentioned:['A']}});
  assert.equal(result.candidates[0].cardId,'C');
  assert.ok(result.candidates.some(c=>c.cardId==='A'));
  assert.equal(result.tier,'sure');
  assert.equal(result.quality.framesUsed,1);
});
test('selected quad skips detector and returns its warp even without full-art references',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeCrop:true});
  assert.equal(result.candidates[0].cardId,'A');
  assert.equal(result.quality.fullArtReferences,0);
  assert.equal(result.warpedCard?.width,10);
  assert.equal(result.warpedCard?.height,15);
  assert.equal(result.quality.fallback,false);
  assert.deepEqual(result.detectedCard,selected);
  const diagnostic=await fixture(false).recognize([frame],{card:selected,includeDiagnosticCrop:true});
  assert.equal(diagnostic.warpedCard?.width,10);assert.equal(diagnostic.warpedCard?.height,15);
  assert.deepEqual(diagnostic.candidates,result.candidates);assert.deepEqual(diagnostic.quality,result.quality);
  for(const key of ['feedback','aiWarpedCard','deferredAICrop','aiCandidateNames'])assert.equal(diagnostic[key as keyof typeof diagnostic],undefined);
});
test('live reads use only the sharpest buffered frame and return that frame outline',async()=>{
  const noisy={...frame,data:frame.data.slice()};
  for(let i=0;i<noisy.data.length;i+=4){noisy.data[i]=noisy.data[i+1]=noisy.data[i+2]=Math.floor(i/4)%2?255:0;noisy.data[i+3]=255;}
  const result=await fixture(false).recognize([noisy],{card:selected,maxFrames:1});
  assert.equal(result.quality.framesUsed,1);
  assert.deepEqual(result.quality.selectedFrameIndices,[0]);
  assert.deepEqual(result.detectedCard,selected);
  await assert.rejects(()=>fixture(false).recognize([frame],{maxFrames:2 as 1}),/maxFrames/);
});
test('clipped selected quad preserves whole-card shape and cannot be sure',async()=>{
  const result=await fixture(false).recognize([frame],{card:{...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},includeCrop:true});
  assert.equal(result.quality.partial,true);
  assert.notEqual(result.tier,'sure');
  assert.equal(result.warpedCard?.width,10);
});
test('feedback evidence is opt-in, bound to a detected warp and carries its vector and versions',async()=>{
  const plain=await fixture(false).recognize([frame],{card:selected});
  assert.equal(plain.feedback,undefined);
  const result=await fixture(false).recognize([frame],{card:selected,includeFeedback:true});
  assert.ok(result.feedback);assert.equal(result.feedback.embedding.length,2);
  assert.equal(result.feedback.space,'art-box');assert.ok(result.warpedCard);
  const clipped=await fixture(false).recognize([frame],{card:{...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},includeFeedback:true});
  assert.equal(clipped.feedback,undefined);
});
test('identity embedding is opt-in and reuses the clean art vector without feedback or crop capture',async()=>{
  const plainCount={calls:0},identityCount={calls:0};
  const plain=await fixture(false,plainCount).recognize([frame],{card:selected});
  const result=await fixture(false,identityCount).recognize([frame],{card:selected,includeIdentityEmbedding:true});
  const feedback=await fixture(false).recognize([frame],{card:selected,includeFeedback:true});
  assert.equal('identityEmbedding' in plain,false);
  assert.deepEqual(result.identityEmbedding,{values:feedback.feedback!.embedding,space:'art-box'});
  assert.ok(result.identityEmbedding!.values.every(Number.isFinite));assert.equal(identityCount.calls,plainCount.calls);
  assert.deepEqual(result.candidates,plain.candidates);assert.deepEqual(result.quality,plain.quality);
  for(const key of ['feedback','warpedCard','aiWarpedCard','deferredAICrop','cropJpeg','aiCropJpeg','aiCropToken'] as const) assert.equal(result[key as keyof typeof result],undefined);
  const disabled=await fixture(false).recognize([frame],{card:selected,includeIdentityEmbedding:false});
  assert.equal('identityEmbedding' in disabled,false);assert.equal('identityEmbedding' in feedback,false);
});
test('identity embedding copies the winning whole-card feedback hypothesis with its matching space',async()=>{
  const baseline={calls:0},requested={calls:0};
  await fixture(true,baseline).recognize([frame],{card:selected,includeFeedback:true});
  const result=await fixture(true,requested).recognize([frame],{card:selected,includeFeedback:true,includeIdentityEmbedding:true});
  assert.equal(result.candidates[0].cardId,'C');assert.equal(result.identityEmbedding?.space,'whole-card');
  assert.deepEqual(result.identityEmbedding?.values,result.feedback!.embedding);assert.equal(requested.calls,baseline.calls);
  assert.notEqual(result.identityEmbedding!.values,result.feedback!.embedding);
  const cleanValue=result.feedback!.embedding[0];result.identityEmbedding!.values[0]=-123;
  assert.equal(result.feedback!.embedding[0],cleanValue);
});
test('identity embeddings exclude covered, clipped, explicitly partial, face-down and fallback evidence',async()=>{
  for(const card of [
    {...selected,covered:true}, {...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},
    {...selected,partial:true}, {...selected,kind:'face-down' as const},
  ]) {
    const result=await fixture(false).recognize([frame],{card,includeIdentityEmbedding:true});
    assert.equal('identityEmbedding' in result,false);
  }
  const f=clickFixture(()=>[]),result=await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5},includeIdentityEmbedding:true});
  assert.equal(result.quality.fallback,true);assert.equal('identityEmbedding' in result,false);
});
test('learned references compete with the main index without manufacturing sure',async()=>{
  const p=fixture(false);
  p.setLearning({version:'v',references:[{cardId:'B',embedding:[.9,Math.sqrt(1-.9*.9)],space:'art-box'}],confusions:[]});
  const result=await p.recognize([frame],{card:selected});
  assert.equal(result.candidates[0].cardId,'B');assert.notEqual(result.tier,'sure');
  p.setLearning({version:'empty',references:[],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'A');
});
test('confusion pairs trigger another hypothesis and suppress a narrow sure winner',async()=>{
  const p=fixture(false);
  p.setLearning({version:'v',references:[],confusions:[{a:'A',b:'B'}]});
  const result=await p.recognize([frame],{card:selected});
  assert.ok(result.quality.confusionChecked);
});
test('whole-card learning cannot introduce labels absent from its clean index',async()=>{
  const p=fixture(true);p.setLearning({version:'v',references:[{cardId:'B',embedding:[.95,Math.sqrt(1-.95*.95)],space:'whole-card'}],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'C');
});
test('a late whole-card confusion winner is checked in both whole-card rotations',async()=>{
  const counter={calls:0};const p=fixture(true,counter);p.setLearning({version:'v',references:[],confusions:[{a:'C',b:'D'}]});
  const result=await p.recognize([frame],{card:selected});assert.equal(result.candidates[0].cardId,'C');assert.equal(result.quality.confusionChecked,true);
  // One art view and both whole-card rotations ran. The final .05 lead
  // over the main-index competitor stays below the stricter .06 margin.
  assert.equal(counter.calls,3);assert.equal(result.tier,'not sure');
});

// Review regressions share this single small, API-free test file.
import {topK,preferDeck} from './search';
import {learnedTopK} from './learning';
const searchIndex=(ids:string[],vectors:number[])=>({meta:{dim:2,count:ids.length,entries:ids.map(cardId=>({cardId,passcode:Number(cardId)||1,name:cardId,frameClass:'Effect'}))},vectors:new Float32Array(vectors)}) as LoadedIndex;
test('deck restriction searches only its artwork rows before catalog fallback',()=>{
  const index=searchIndex(['1','2'],[1,0,.8,.6]);
  assert.deepEqual(topK(new Float32Array([1,0]),index,5,undefined,undefined,new Set(['2'])).map(c=>c.cardId),['2']);
});
test('poisoned learned label cannot introduce a card outside the clean top ten',()=>{
  const ids=Array.from({length:11},(_,i)=>String(i+1));
  const index=searchIndex(ids,ids.flatMap((_,i)=>[Math.cos(i*.1),Math.sin(i*.1)]));
  const list=learnedTopK(new Float32Array([1,0]),index,{version:'poison',references:[{cardId:'11',embedding:[1,0],space:'art-box'}],confusions:[]},'art-box',5);
  assert.equal(list[0].cardId,'1');assert.ok(!list.some(c=>c.cardId==='11'));
});
test('face-down art sleeve cannot become sure as a face-up identity or feedback',async()=>{
  const result=await fixture(false).recognize([frame],{card:{...selected,kind:'face-down'},includeFeedback:true});
  assert.notEqual(result.tier,'sure');assert.equal(result.feedback,undefined);
});

import {filterPhysicalIndex} from './physical-index';
test('physical filter removes skills/nonphysical rows, preserves tokens and collapses duplicate art',()=>{
  const index=searchIndex(['1','300302001','999','8','9'],[1,0,1,0,1,0,1,0,1,0]);
  index.meta.entries[1]={cardId:'300302001',passcode:0,name:'A Skill'};
  index.meta.entries[2]={cardId:'999',passcode:0,name:'Token'};
  index.meta.entries[3]={cardId:'8',passcode:8,name:'Duplicate',imageId:1,frameClass:'Effect'};
  index.meta.entries[4]={...index.meta.entries[3],cardId:'9'};
  index.meta.entries[0].name='Skill Drain';
  assert.deepEqual(filterPhysicalIndex(index).meta.entries.map(e=>e.cardId),['1','999','8']);
});

import {replayTier} from './decision';
import type {RecognitionEvidence} from './types';
test('every evaluated frame must independently agree before sure',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const raw=result.raw!;assert.equal(replayTier(raw,raw.thresholds),'sure');
  raw.frames.push({...raw.frames[0],frameIndex:1,clean:[{cardId:'B',score:.99},{cardId:'A',score:.4}]});
  assert.equal(replayTier(raw,raw.thresholds),'not sure');
});
test('AI crop is warped from source at text-readable resolution; feedback stays small',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeCrop:true,includeFeedback:true});
  assert.equal(result.aiWarpedCard?.width,640);assert.equal(result.warpedCard?.width,10);
});
test('deferred AI warping preserves exact source pixels while returning identification first',async()=>{
  const source={...frame,data:frame.data.map((_,i)=>(i*17)%256)};
  const card={...selected,quad:selected.quad.map(p=>({x:p.x-.1,y:p.y}))};
  const eager=await fixture(false).recognize([source],{card,includeCrop:true});
  const deferred=await fixture(false).recognize([source],{card,includeCrop:true,deferAICrop:true});
  assert.equal(Boolean(deferred.aiWarpedCard),false);
  assert.equal(deferred.deferredAICrop?.bytes,source.data.byteLength);
  assert.deepEqual(deferred.deferredAICrop?.create(),eager.aiWarpedCard);
  assert.deepEqual(deferred.candidates,eager.candidates);
  assert.deepEqual(deferred.warpedCard,eager.warpedCard);
});
import {LearningCache} from './learning-cache';
import {toRemoteRecognitionResult} from './remote-result';
test('cached learning never fetches during reads, deduplicates refresh and expires failures',async()=>{
  let calls=0,now=0,fail=false;
  const cache=new LearningCache(async()=>{calls++;if(fail)throw Error('offline');return {version:'v1',references:[],confusions:[]};},()=>now);
  await Promise.all([cache.refresh(),cache.refresh()]);
  for(let i=0;i<10;i++)assert.equal(cache.current().version,'v1');assert.equal(calls,1);
  fail=true;await cache.refresh();assert.equal(cache.current().version,'v1');now=120001;assert.equal(cache.current().version,'empty');
});
test('remote message retains tier and guards and maps zero-passcode Tokens to catalog IDs',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected});
  result.candidates=[{cardId:'999',score:.9},{cardId:'bad',score:.8}];
  const message=toRemoteRecognitionResult(result,new Map([['999',{cardId:'999',passcode:0,name:'Token'}]]),'request');
  assert.equal(message.tier,result.tier);assert.equal(message.candidates[0].cardId,999);assert.equal(message.candidates.length,1);
  result.quality.faceDown=true;assert.deepEqual(toRemoteRecognitionResult(result,new Map(),'request').candidates,[]);
});
function temporalFixture(counter:{detect:number},switchIdentity=false) {
  const profile={...yugioh,id:'fixture',detector:{...yugioh.detector,longSide:32},card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:number[]) {}}
  const detector={backend:'wasm',run:async()=>{
    const heat=new Float32Array(128),box=new Float32Array(384),cell=26;
    heat[cell]=.99;box[2*64+cell]=Math.log(14/4);box[3*64+cell]=Math.log(22/4);box[5*64+cell]=1;
    box[cell]=counter.detect++*.1; // The outline moves on each frame.
    return {heat:{dims:[1,2,8,8],data:heat},box:{dims:[1,6,8,8],data:box}};
  }} as unknown as ModelSession;
  let calls=0;
  const embedder={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array(switchIdentity&&calls++>0?[.3,.95]:[.95,.3])}})} as unknown as ModelSession;
  return new RecognitionPipeline(profile,searchIndex(['1','2'],[1,0,0,1]),detector,embedder,Tensor as unknown as TensorCtor);
}
test('temporal frames redetect moved outlines instead of reusing a selected quad',async()=>{
  const counter={detect:0};const p=temporalFixture(counter,true);
  const result=await p.recognize([frame,frame],{card:selected,earlyExit:false,includeRaw:true});
  assert.equal(counter.detect,2);assert.equal(result.quality.framesAgree,false);assert.notEqual(result.tier,'sure');
});
test('a first clean sure frame stops before subsequent detector/embed runs',async()=>{
  const counter={detect:0};const result=await temporalFixture(counter).recognize([frame,frame,frame],{includeRaw:true});
  assert.equal(result.tier,'sure');assert.equal(counter.detect,1);assert.equal(result.quality.framesUsed,1);assert.equal(result.raw?.earlyExit,true);
});
type ClickOutline={x:number;y?:number;w?:number;h?:number;confidence?:number};
function clickFixture(scene:(width:number)=>ClickOutline[]) {
  const image={width:1280,height:720,data:new Uint8ClampedArray(1280*720*4).fill(120)};
  const profile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:number[]) {}}
  const calls:number[][]=[];
  const detector={backend:'wasm',run:async(feeds:Record<string,Tensor>)=>{
    const dims=feeds.image.dims;calls.push(dims.slice());
    const [, ,height,width]=dims,gh=height/4,gw=width/4,plane=gh*gw;
    const heat=new Float32Array(plane*2),box=new Float32Array(plane*6);
    const contentHeight=Math.round(image.height*width/image.width);
    for(const outline of scene(width)) {
      const cx=outline.x*width,cy=(outline.y??.5)*contentHeight,col=Math.floor(cx/4),row=Math.floor(cy/4),cell=row*gw+col;
      heat[cell]=outline.confidence??.99;
      box[cell]=cx/4-col-.5;box[plane+cell]=cy/4-row-.5;
      box[2*plane+cell]=Math.log((outline.w??.14)*width/4);box[3*plane+cell]=Math.log((outline.h??.36)*contentHeight/4);box[5*plane+cell]=1;
    }
    return {heat:{dims:[1,2,gh,gw],data:heat},box:{dims:[1,6,gh,gw],data:box}};
  }} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>({[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([.95,.3])}})} as unknown as ModelSession;
  const pipeline=new RecognitionPipeline(profile,searchIndex(['1','2'],[1,0,0,1]),detector,embedder,Tensor as unknown as TensorCtor);
  return {pipeline,image,calls};
}
test('an explicit one-frame click first detects the full scene at 640 and picks the clicked card',async()=>{
  const f=clickFixture(()=>[{x:.2,confidence:1},{x:.7,confidence:.98}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.7)<.001);
  assert.equal(result.quality.covered,false);assert.equal(result.quality.fallback,false);assert.equal(result.tier,'sure');
});
for(const scenario of ['missing','weak'] as const) test(`a ${scenario} clicked outline at 640 retries the original 960 detector`,async()=>{
  const f=clickFixture(width=>width===640?(scenario==='missing'?[{x:.2}]:[{x:.7,confidence:.89}]):[{x:.7}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.7)<.001);
  assert.equal(result.detectedCard!.confidence,.99);
});
for(const outline of [{x:.04},{x:.07},{x:.96},{x:.5,y:.1},{x:.5,y:.9}]) test(`a clipped or edge-touching click at ${JSON.stringify(outline)} retries 960`,async()=>{
  const f=clickFixture(()=>[outline]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:outline.x,y:outline.y??.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  if(outline.x!==.07){assert.equal(result.quality.partial,true);assert.notEqual(result.tier,'sure');}
});
test('weak overlapping outlines trigger 960 and remain in the covered-card scene',async()=>{
  const f=clickFixture(()=>[{x:.55},{x:.64,confidence:.25}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.53,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.equal(result.quality.covered,true);assert.notEqual(result.tier,'sure');
});
test('multiple outlines under a click trigger 960 before choosing the smaller card',async()=>{
  const f=clickFixture(()=>[{x:.48,w:.22,h:.4},{x:.54,w:.1,h:.2,confidence:.95}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
  assert.ok(Math.abs(result.detectedCard!.quad.reduce((sum,p)=>sum+p.x,0)/4-.54)<.001);
  assert.equal(result.quality.covered,true);assert.notEqual(result.tier,'sure');
});
test('a click on two touching card edges retries 960 even without overlap area',async()=>{
  const f=clickFixture(()=>[{x:.43},{x:.57,confidence:.95}]);
  await f.pipeline.recognize([f.image],{clickPoint:{x:.5,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960]]);
});
test('a missed click keeps the existing 448 close-up rescue after both scene passes',async()=>{
  const f=clickFixture(width=>width===448?[{x:.7}]:[{x:.2}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960],[1,3,256,448]]);
  assert.equal(result.quality.fallback,false);
});
test('unrelated outlines never turn a missed explicit click into a different detected target',async()=>{
  const f=clickFixture(()=>[{x:.2}]);
  const result=await f.pipeline.recognize([f.image],{clickPoint:{x:.7,y:.5}});
  assert.deepEqual(f.calls,[[1,3,384,640],[1,3,544,960],[1,3,256,448]]);
  assert.equal(result.detectedCard,undefined);assert.equal(result.quality.fallback,true);assert.notEqual(result.tier,'sure');
});
test('explicit quads, temporal reads and reads without a click retain their detector paths',async()=>{
  const f=clickFixture(()=>[{x:.5}]);
  await f.pipeline.recognize([f.image],{card:selected,clickPoint:{x:.5,y:.5}});assert.deepEqual(f.calls,[]);
  await f.pipeline.recognize([f.image,f.image],{clickPoint:{x:.5,y:.5},earlyExit:false});assert.deepEqual(f.calls,[[1,3,544,960],[1,3,544,960]]);
  f.calls.length=0;await f.pipeline.recognize([f.image]);assert.deepEqual(f.calls,[[1,3,544,960]]);
});
import {tuneThresholds,realsetMetrics,type RealsetSample} from './calibration';
test('threshold tuner keeps zero wrong sure on cards and negatives with a safety gap',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const sample=(id:string,label:string|null,score:number,runner:number):RealsetSample=>{
    const raw=structuredClone(result.raw!);const list=[{cardId:'A',score},{cardId:'B',score:runner}];raw.visual=list;raw.ranked=list;raw.winnerId='A';raw.frames=[{...raw.frames[0],clean:list,ranked:list,hypotheses:[list]}];
    return {id,capturedAt:'now',label,condition:'mocked',cardWidthPx:100,source:'photo',width:20,height:30,clickPoint:{x:.5,y:.5},tier:'sure',raw,latencyMs:1};
  };
  const samples=[sample('right','A',.98,.4),sample('wrong','B',.9,.6),sample('object',null,.93,.4)];
  const tuned=tuneThresholds(samples,.01);assert.equal(tuned.metrics.sureButWrong,0);assert.equal(tuned.metrics.sure,1);assert.ok(tuned.thresholds.score>.94 || tuned.thresholds.margin>.54);
  assert.equal(realsetMetrics(samples,tuned.thresholds).negativeSure,0);assert.throws(()=>tuneThresholds(samples.slice(0,1)),/negatives/);
});
test('calibration guards wrong individual whole-card views even when later art rescues capture',async()=>{
  const result=await fixture(false).recognize([frame],{card:selected,includeRaw:true});
  const raw=structuredClone(result.raw!),list=(id:string,score:number)=>[{cardId:id,score},{cardId:id==='A'?'B':'A',score:.1}];
  raw.visual=list('A',.95);raw.ranked=raw.visual;raw.frames[0].clean=raw.visual;raw.frames[0].ranked=raw.visual;
  raw.frames[0].hypotheses=[list('A',.85),list('A',.95),list('B',.90)];
  const base:RealsetSample={id:'card',capturedAt:'now',label:'A',condition:'mock',cardWidthPx:100,source:'photo',width:20,height:30,clickPoint:{x:.5,y:.5},tier:'sure',raw,latencyMs:1};
  const negative={...base,id:'negative',label:null,raw:{...raw,visual:list('B',.2),frames:[]}};
  const tuned=tuneThresholds([base,negative]);
  assert.ok(tuned.thresholds.score>.91 || tuned.thresholds.margin>.81);
});
test('AI abstains when mocked provider returns a name outside its closed candidate list',async()=>{
  const {identifyRemoteVisionCard}=await import('../../web/src/lib/remote-vision-ai');
  const {MODEL}=await import('@yugidraft/shared/cards/effects/budget-ledger');
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>Response.json({model:MODEL,stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify({name:'Wrong card'})}]});
    const result=await identifyRemoteVisionCard({prepare:()=>{throw Error('Out-of-list name reached catalog');}} as never,'mock-jpeg','mock-key',['Right card']);
    assert.equal(result.match,null);
  } finally {globalThis.fetch=original;}
});
import {calibratedThresholds} from './threshold-config';
import {indexVersion} from './learning';
test('runtime refuses thresholds calibrated for a different index or model',()=>{
  const index=searchIndex(['1','2'],[1,0,0,1]);index.meta.layoutKey='layout';
  const config={version:1,modelId:yugioh.embedding.id,modelSha256:yugioh.embedding.sha256,indexVersion:indexVersion(index.meta),layoutKey:'layout',thresholds:{score:.9,margin:.04,floor:.74},sampleCount:2,negativeCount:1,sureButWrong:0,safetyGap:.01};
  assert.equal(calibratedThresholds(config,yugioh,index).score,.9);
  assert.throws(()=>calibratedThresholds({...config,indexVersion:'stale'},yugioh,index),/Incompatible/);
  assert.throws(()=>calibratedThresholds({...config,modelSha256:'wrong'},yugioh,index),/Incompatible/);
});

test('ambiguous catalog suggestions prefer deck; a clear off-deck card still wins',()=>{
  const t=yugioh.embedding.thresholds,deck=[{cardId:'2',score:.81}],catalog=[{cardId:'1',score:.82},deck[0]];
  assert.equal(preferDeck(deck,catalog,t)[0].cardId,'2');
  assert.equal(preferDeck(deck,[{cardId:'1',score:.96},deck[0]],t)[0].cardId,'1');
});

import {catalogCards,physicalCatalogCards} from '../../../scripts/vision/catalog';
test('builder selects physical catalog entries while source parsing retains all records',()=>{
  const rows=['Trap Card','Token','Skill Card'].map((type,i)=>({id:i+1,type,name:type==='Trap Card'?'Skill Drain':type,card_images:[{id:i+1,image_url:'https://example.test/card.jpg'}]}));
  const all=catalogCards(rows);assert.equal(all.length,3);assert.deepEqual(physicalCatalogCards(all).map(c=>c.name),['Skill Drain','Token']);
});
