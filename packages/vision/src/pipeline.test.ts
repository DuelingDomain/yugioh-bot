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
import {topK} from './search';
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
