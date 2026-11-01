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
  const profile={...yugioh,card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const index=(ids:string[])=>({meta:{dim:2,count:2,entries:ids.map(cardId=>({cardId,name:cardId}))},vectors:new Float32Array([1,0,0,1])}) as LoadedIndex;
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  let step=0;
  const detector={backend:'wasm',run:()=>{throw new Error('selected quad must skip detection');}} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>{if(counter)counter.calls++;const score=step++===0?.9:.95;return {[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([score,Math.sqrt(1-score*score)])}};}} as unknown as ModelSession;
  return new RecognitionPipeline(profile,index(['A','B']),detector,embedder,Tensor as unknown as TensorCtor,full?index(['C','D']):undefined);
}
test('both indexes retain competitors and priors cannot turn a changed winner into sure',async()=>{
  const result=await fixture().recognize([frame],{card:selected,k:5,priors:{decklist:['A'],voiceMentioned:['A']}});
  assert.equal(result.candidates[0].cardId,'A');
  assert.ok(result.candidates.some(c=>c.cardId==='C'));
  assert.equal(result.tier,'not sure');
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
  const result=await fixture(false).recognize([frame,noisy,frame],{card:selected,maxFrames:1});
  assert.equal(result.quality.framesUsed,1);
  assert.deepEqual(result.quality.selectedFrameIndices,[1]);
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
  assert.equal(result.candidates[0].cardId,'B');
  p.setLearning({version:'empty',references:[],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'A');
});
test('confusion pairs trigger another hypothesis and suppress a narrow sure winner',async()=>{
  const p=fixture(false);
  p.setLearning({version:'v',references:[],confusions:[{a:'A',b:'B'}]});
  const result=await p.recognize([frame],{card:selected});
  assert.ok(result.quality.confusionChecked);
});
test('whole-card learned labels may come from the main catalog',async()=>{
  const p=fixture(true);p.setLearning({version:'v',references:[{cardId:'B',embedding:[.95,Math.sqrt(1-.95*.95)],space:'whole-card'}],confusions:[]});
  assert.equal((await p.recognize([frame],{card:selected})).candidates[0].cardId,'B');
});
test('a late whole-card confusion winner is checked in both whole-card rotations',async()=>{
  const counter={calls:0};const p=fixture(true,counter);p.setLearning({version:'v',references:[],confusions:[{a:'C',b:'D'}]});
  const result=await p.recognize([frame],{card:selected});assert.equal(result.candidates[0].cardId,'C');assert.equal(result.quality.confusionChecked,true);
  // One art view and both whole-card rotations ran. The final .05 lead
  // over the main-index competitor stays below the stricter .06 margin.
  assert.equal(counter.calls,3);assert.equal(result.tier,'not sure');
});
