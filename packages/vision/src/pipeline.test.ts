import test from 'node:test';
import assert from 'node:assert/strict';
import {RecognitionPipeline} from './pipeline';
import {yugioh} from './games/yugioh';
import type {LoadedIndex,DetectedQuad} from './types';
import type {ModelSession} from './runtime';
import type {TensorCtor} from './embed';
const selected:DetectedQuad={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:1,partial:false};
const frame={width:20,height:30,data:new Uint8ClampedArray(2400).fill(120)};
function fixture(full=true) {
  const profile={...yugioh,card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const index=(ids:string[])=>({meta:{dim:2,count:2,entries:ids.map(cardId=>({cardId,name:cardId}))},vectors:new Float32Array([1,0,0,1])}) as LoadedIndex;
  class Tensor {constructor(public type:unknown,public data:unknown,public dims:unknown){}}
  let step=0;
  const detector={backend:'wasm',run:()=>{throw new Error('selected quad must skip detection');}} as unknown as ModelSession;
  const embedder={backend:'wasm',run:async()=>{const score=step++===0?.9:.95;return {[profile.embedding.outputName]:{dims:[1,2],data:new Float32Array([score,Math.sqrt(1-score*score)])}};}} as unknown as ModelSession;
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
});
test('clipped selected quad preserves whole-card shape and cannot be sure',async()=>{
  const result=await fixture(false).recognize([frame],{card:{...selected,quad:selected.quad.map(p=>({x:p.x-.2,y:p.y})),partial:true},includeCrop:true});
  assert.equal(result.quality.partial,true);
  assert.notEqual(result.tier,'sure');
  assert.equal(result.warpedCard?.width,10);
});
