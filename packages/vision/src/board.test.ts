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
  const profile = {...yugioh,card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
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
