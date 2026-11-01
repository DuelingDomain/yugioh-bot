import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIndex, decodeIndex } from './index-format';
import { topK, normalize } from './search';
import { sharpness } from './quality';
const meta = { version: 1 as const, modelId: 'x', modelSha256: 'a', dim: 2, count: 2, dtype: 'float32' as const,
  entries: [{ cardId: 'a', passcode: 1, name: 'A' }, { cardId: 'b', passcode: 2, name: 'B' }] };
test('index roundtrip validates dimensions and ranks with bounded priors', () => {
  const index = decodeIndex(encodeIndex(new Float32Array([1, 0, 0.98, 0.2]), meta), meta);
  assert.equal(topK(normalize(new Float32Array([1, 0])), index, 2)[0].cardId, 'a');
  assert.equal(topK(new Float32Array([1, 0]), index, 2, { voiceMentioned: ['b'] })[0].cardId, 'b');
  assert.throws(() => decodeIndex(new ArrayBuffer(3), meta));
  assert.throws(() => topK(new Float32Array(3), index, 2));
});
test('flat catalog search preserves cosine, alternate-art deduplication, ties and restrictions',()=>{
  for(const vectors of [new Int8Array([3,4,5,0,0,0,-3,-4,0,5,3,4]),new Float32Array([.3,.4,.5,0,0,0,-.3,-.4,0,.5,.3,.4])]) {
    const entries=['alt','alt','zero','negative','other','tie'].map((cardId,i)=>({cardId,passcode:i+1,name:cardId,frameClass:i===4?'Spell':'Effect'}));
    const index={meta:{...meta,count:6,dtype:vectors instanceof Int8Array?'int8' as const:'float32' as const,entries},vectors};
    const plain=topK(new Float32Array([1,0]),index,10);
    assert.deepEqual(plain.map(c=>c.cardId),['alt','tie','other','negative']);
    assert.ok(Math.abs(plain[0].score-1)<1e-6);assert.ok(Math.abs(plain[1].score-.6)<1e-6);
    const restricted=topK(new Float32Array([1,0]),index,3,undefined,undefined,new Set(['tie','alt']));
    assert.deepEqual(restricted.map(c=>c.cardId),['alt','tie']);
    assert.equal(topK(new Float32Array([0,1]),index,1,{frameClasses:['Spell']})[0].cardId,'other');
    assert.equal(topK(new Float32Array([.6,.8]),index,1,{voiceMentioned:['tie']})[0].cardId,'tie');
  }
});
test('Laplacian variance distinguishes flat and detailed frames', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4).fill(128);
  const flat = sharpness({ width: 16, height: 16, data });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let c = 0; c < 3; c++) data[(y * 16 + x) * 4 + c] = (x + y) % 2 ? 255 : 0;
  assert.equal(flat, 0); assert.ok(sharpness({ width: 16, height: 16, data }) > 10000);
});
import { chooseCard } from './detector/run';
import { warpQuad } from './geometry';
import { validateOptions } from './options';
test('click selection never picks a distant card, and degenerate warps fail', () => {
  const img = { width: 16, height: 16, data: new Uint8ClampedArray(1024) };
  const card = { cx: 4, cy: 4, w: 4, h: 6, angle: 0, conf: 1, kind: 'face-up' as const, scores: { 'face-up': 1, 'face-down': 0 }, pts: [[2,1],[6,1],[6,7],[2,7]] as [number,number][], box: [] };
  assert.equal(chooseCard([card], img, { x: .25, y: .25 }), card);
  assert.equal(chooseCard([card], img, { x: .9, y: .9 }), undefined);
  assert.equal(warpQuad(img, [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}], 4, 6), null);
  assert.throws(() => validateOptions({ clickPoint: { x: NaN, y: 0 } }));
});

// A deck/voice prior or a fallback must never manufacture a "sure" visual match.
import { tierFor } from './search';
import { duelLensModel } from './models';
test('upstream confidence tiers preserve the margin, floor and fallback guards', () => {
  const t = duelLensModel.thresholds;
  const candidates = (a: number, b: number) => [{ cardId: 'a', score: a }, { cardId: 'b', score: b }];
  assert.equal(tierFor(candidates(.9, .7), t), 'sure');
  assert.equal(tierFor(candidates(.81, .8), t), 'not sure');
  assert.equal(tierFor(candidates(.72, .5), t), 'low match');
  assert.equal(tierFor(candidates(.9, .7), t, true), 'not sure');
  assert.equal(tierFor([], t), 'low match');
  assert.equal(tierFor(candidates(.9, .7), t, false, undefined, false), 'not sure');
  assert.equal(tierFor([{cardId:'back',score:.9},{cardId:'a',score:.85}], t, false, 'back'), 'not sure');
});

import { dropPlaceholders } from './placeholder-art';
import { buildHypotheses } from './hypotheses';
import { yugioh } from './games/yugioh';
test('back placeholders are excluded and artwork cropping follows the supplied game data', () => {
  const entries = [{cardId:'back'}, {cardId:'placeholder'}, {cardId:'real'}];
  const result = dropPlaceholders(entries, [new Float32Array([1,0]),new Float32Array([.99,.01]),new Float32Array([0,1])], 'back');
  assert.deepEqual(result.entries.map(e=>e.cardId), ['back','real']);
  const image={width:10,height:10,data:new Uint8ClampedArray(400)};
  const crops=buildHypotheses(image,image,null,{userBoxWithCard:false},{...yugioh,artWindow:{x:.2,y:.3,w:.4,h:.5}});
  assert.equal(crops[0].image.width,4); assert.equal(crops[0].image.height,5);
});

import { catalogCards } from '../../../scripts/vision/catalog';
test('full catalog retains Tokens, Skills and alternate artwork', () => {
  const rows = ['Effect Monster', 'Token', 'Skill Card'].map((type, i) => ({
    id: i + 1, name: type, type, card_images: [{id: i + 1, image_url: 'https://images.ygoprodeck.com/card.jpg'},
      {id: i + 101, image_url: 'https://images.ygoprodeck.com/alt.jpg'}],
  }));
  const cards = catalogCards({data: rows});
  assert.equal(cards.length, 3); assert.equal(cards.flatMap(c => c.images).length, 6);
});

import { createRecognizer } from './client';
import { webRuntime, openModelSession, type WebOrt } from './web-runtime';
test('game shorthand validates before allocating a worker and disposal rejects recognition', async () => {
  assert.throws(() => createRecognizer({game: 'unknown' as 'yugioh'}), /Unsupported game/);
  const reader = createRecognizer({game: 'yugioh'}); reader.dispose();
  await assert.rejects(reader.recognize([]), /disposed/);
});
test('isolated WASM enables four threads and SIMD; other pages keep one thread', () => {
  const ort = {env: {wasm: {}}} as WebOrt;
  const deps = {ort, getURL: (path: string) => path, hardwareConcurrency: 16};
  webRuntime({...deps, crossOriginIsolated: true});
  assert.equal(ort!.env.wasm.numThreads, 4); assert.equal(ort!.env.wasm.simd, true);
  webRuntime({...deps, crossOriginIsolated: false});
  assert.equal(ort!.env.wasm.numThreads, 1);
});
test('auto uses an available WebGPU adapter and retries a failed run on threaded SIMD WASM',async(t)=>{
  t.mock.method(console,'debug',()=>{});t.mock.method(console,'warn',()=>{});
  let fail=false,gpuRuns=0,wasmRuns=0;
  class Tensor {constructor(public type:string,public data:Float32Array,public dims:number[]){}}
  const output={vector:{data:new Float32Array([1,0]),dims:[1,2]}};
  const build=(gpu:boolean)=>({env:{wasm:{}},Tensor,InferenceSession:{create:async()=>({release:async()=>{},run:async()=>{
    if(gpu){gpuRuns++;if(fail)throw new Error('GPU device lost');}else wasmRuns++;return output;
  }})}} as unknown as WebOrt);
  const wasm=build(false),gpu=build(true);
  const {session}=await openModelSession('model.onnx','test-model',{ort:wasm,ortWebGpu:async()=>gpu,gpu:{requestAdapter:async()=>({info:{vendor:'test-gpu'}})},fetch:async()=>new Response(new Uint8Array([1,2,3])),getURL:path=>path,crossOriginIsolated:true,hardwareConcurrency:8});
  const feeds={input:new Tensor('float32',new Float32Array([1]),[1])};
  await session.run(feeds);assert.equal(session.ep,'webgpu');assert.equal(gpuRuns,1);assert.equal(wasmRuns,0);
  fail=true;await session.run(feeds);assert.equal(session.ep,'wasm');assert.equal(wasmRuns,1);
  await session.run(feeds);assert.equal(gpuRuns,2);assert.equal(wasmRuns,2);
  assert.equal(wasm.env.wasm.numThreads,4);assert.equal(wasm.env.wasm.simd,true);await session.release();
});

import { detectFullArtLayout, fullArtProfile } from './full-art';
import { hitTestQuad } from './scene';
test('frameless texture suggests full art; a pale text box rejects it', () => {
  const width=100,height=150,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) { const p=(y*width+x)*4; data[p]=(x*17+y*5)%220; data[p+1]=(x*9+y*13)%220; data[p+2]=(x*7+y*19)%220; data[p+3]=255; }
  assert.equal(detectFullArtLayout({width,height,data},yugioh), true);
  for(let y=110;y<143;y++) for(let x=8;x<92;x++) data.set([226,214,186,255],(y*width+x)*4);
  assert.equal(detectFullArtLayout({width,height,data},yugioh), false);
  assert.notEqual(layoutKey(fullArtProfile(yugioh)),layoutKey(yugioh));
});
test('quad hit testing uses polygons and smallest overlapping card, including partials', () => {
  const outer={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up' as const,confidence:.9,partial:false};
  const inner={...outer,quad:[{x:.2,y:.1},{x:.6,y:.4},{x:.4,y:.8},{x:0,y:.5}]};
  assert.equal(hitTestQuad([outer,inner],{x:.3,y:.4}),1);
  assert.equal(hitTestQuad([inner],{x:.59,y:.12}),-1);
  assert.equal(hitTestQuad([{...outer,partial:true}],{x:0,y:.5}),0);
});

import { layoutKey } from './profile';

test('selected scene quad validates before entering the worker', () => {
  assert.throws(()=>validateOptions({card:{quad:[{x:NaN,y:0}],kind:'face-up',partial:false,confidence:1}}),/card/);
});
test('AI client blocks automatic sure calls and only sends the requested small crop', async () => {
  const reader=createRecognizer({game:'yugioh'}),oldFetch=globalThis.fetch;
  let body:any;
  globalThis.fetch=(async (_url,init)=>{body=JSON.parse(init!.body as string);return Response.json({name:'Known',match:{name:'Known',passcode:1}});}) as typeof fetch;
  const result={tier:'sure',cropJpeg:'jpeg',candidates:[]} as any;
  try {
    await assert.rejects(reader.askAI(result),/explicit/);
    assert.equal(body,undefined);
    await reader.askAI(result,{explicitRequest:true});
    assert.deepEqual(body,{jpegBase64:'jpeg',localTier:'sure',explicitRequest:true});
  } finally {globalThis.fetch=oldFetch;reader.dispose();}
});

test('tiny outlines have a 24 CSS pixel target without taking direct polygon hits',()=>{
  const tiny={quad:[{x:.49,y:.49},{x:.51,y:.49},{x:.51,y:.51},{x:.49,y:.51}],kind:'face-up' as const,confidence:1,partial:false};
  assert.equal(hitTestQuad([tiny],{x:.58,y:.5},{width:100,height:100}),0);
  const direct={...tiny,quad:[{x:.55,y:.45},{x:.65,y:.45},{x:.65,y:.55},{x:.55,y:.55}]};
  assert.equal(hitTestQuad([tiny,direct],{x:.58,y:.5},{width:100,height:100}),1);
});
test('feedback client sends only eligible crop evidence and the confirmed source',async()=>{
  const reader=createRecognizer(),oldFetch=globalThis.fetch;let body:any;
  globalThis.fetch=(async(_url,init)=>{body=JSON.parse(init!.body as string);return Response.json({id:'sample'});}) as typeof fetch;
  const result={tier:'not sure',cropJpeg:'jpeg',warpedCard:{data:'private pixels'},candidates:[{cardId:'A',score:.9}],feedback:{embedding:[1,0],gameId:'yugioh',modelId:'m',modelSha256:'a'.repeat(64),indexVersion:'v',layoutKey:'layout',space:'art-box',deltaVersion:'delta'},quality:{sharpness:42,frameClass:'Effect'}} as any;
  try{await assert.rejects(reader.recordFeedback({...result,feedback:undefined},'B','voice'),/eligible/);assert.equal(body,undefined);
    await reader.recordFeedback(result,'B','voice');const sent:any=body;assert.equal(sent.source,'voice');assert.equal(sent.chosenCardId,'B');assert.equal(sent.jpegBase64,'jpeg');assert.equal(sent.warpedCard,undefined);assert.equal(sent.deltaVersion,undefined);
  }finally{globalThis.fetch=oldFetch;reader.dispose();}
});
