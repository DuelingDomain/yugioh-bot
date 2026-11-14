import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acceptsFirst, distinctScores, HybridPipeline, loadHybridOrCurrent } from './hybrid';
import { mapBankNames, buildHybridCatalog } from './hybrid-catalog';
import { hybridProfiles, duelSightModel, lightModel } from './hybrid-models';
import { RecognitionPipeline } from './pipeline';
import { openHybrid } from './hybrid-loader';
import { yugioh } from './games/yugioh';
import { fieldEmbeddingSimilarity } from './field-motion';
import { createFieldIdentityGallery } from './field-gallery';
import { slimResult } from './clip-format';
import { preprocess, cropRGBA, rotate180 } from './pixels';
import { toContractTensor } from './duelsight/preprocess';
import { buildHypotheses } from './hypotheses';
import { createRecognizer, loadHybridCatalog } from './client';
import type { GameProfile, LoadedIndex, DetectedQuad } from './types';
import type { ModelSession } from './runtime';

const card:DetectedQuad={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:1,partial:false};
const image={width:20,height:30,data:new Uint8ClampedArray(2400).fill(120)};
const entries=['A','B'].map((cardId,i)=>({cardId,passcode:i+1,name:cardId,frameClass:'Effect'}));
function fixture(firstScores=[.95],secondScore=.2,firstFailure=false) {
  const profile:GameProfile={...yugioh,id:'fixture',card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const count={first:0,second:0,current:0};
  const index=(p:GameProfile):LoadedIndex=>({meta:{version:1,gameId:p.id,modelId:p.embedding.id,modelSha256:p.embedding.sha256,dim:2,count:2,dtype:'float32',entries},vectors:new Float32Array([1,0,0,1])});
  class Tensor {constructor(public type:string,public data:Float32Array,public dims:number[]) {}}
  const detector:ModelSession={backend:'wasm',release:async()=>{},run:async()=>{throw new Error('outlined read must not detect twice');}};
  const session=(p:GameProfile,key:keyof typeof count,scores:number[]):ModelSession=>({backend:'wasm',release:async()=>{},run:async()=>{
    if(key==='first'&&firstFailure){count.first++;throw new Error('inference failed');}
    const n=scores[Math.min(count[key]++,scores.length-1)];return {[p.embedding.outputName]:{dims:[1,2],data:new Float32Array([n,Math.sqrt(1-n*n)])}};
  }});
  const args:ConstructorParameters<typeof RecognitionPipeline>=[profile,index(profile),detector,session(profile,'current',[.3]),Tensor];
  const current=new RecognitionPipeline(...args),profiles=hybridProfiles(profile);
  const firstProfile={...profiles.first,embedding:{...profiles.first.embedding,inputSize:2,dim:2}};
  const secondProfile={...profiles.second,embedding:{...profiles.second.embedding,inputSize:2,dim:2}};
  const first=new RecognitionPipeline(firstProfile,index(firstProfile),detector,session(firstProfile,'first',firstScores),Tensor);
  const second=new RecognitionPipeline(secondProfile,index(secondProfile),detector,session(secondProfile,'second',[secondScore]),Tensor);
  const notes:string[]=[];
  return {pipeline:new HybridPipeline(args,current,first,second,entries,note=>notes.push(note)),current,count,notes,args};
}

test('released first gate requires score and distinct-identity margin, including exact boundaries',()=>{
  assert.equal(acceptsFirst([{cardId:'A',score:.68},{cardId:'B',score:.62}]),true);
  assert.equal(acceptsFirst([{cardId:'A',score:.679},{cardId:'B',score:.4}]),false);
  assert.equal(acceptsFirst([{cardId:'A',score:.8},{cardId:'B',score:.741}]),false);
  assert.equal(acceptsFirst([{cardId:'A',score:.9}]),false);
  assert.equal(acceptsFirst([{cardId:'A',score:NaN},{cardId:'B',score:.2}]),false);
  assert.deepEqual(distinctScores([{cardId:'A',score:.8},{cardId:'A',score:.79},{cardId:'B',score:.6}]),[{cardId:'A',score:.8},{cardId:'B',score:.6}]);
});
test('cascade answers with the first stage, reads both orientations and preserves tagged identity and sidecar evidence',async()=>{
  const f=fixture();const r=await f.pipeline.recognize([image],{card,includeIdentityEmbedding:true,includeRaw:true,preclean:false});
  assert.equal(r.candidates[0].cardId,'A');assert.equal(r.tier,'sure');assert.equal(r.reader?.stage,'first');
  assert.equal(f.count.first,2);assert.equal(f.count.second,0);assert.equal(f.count.current,0);
  assert.equal(r.identityEmbedding?.modelId,duelSightModel.id);assert.equal(slimResult(r).reader?.stage,'first');
});
test('a strong competitor in the other orientation defeats the first gate and Light answers',async()=>{
  const f=fixture([.8,.6]);const r=await f.pipeline.recognize([image],{card,includeRaw:true,preclean:false});
  assert.equal(r.reader?.stage,'second');assert.equal(r.reader?.model,lightModel.id);assert.ok((r.reader?.first?.margin??1)<.001);
  assert.equal(r.candidates[0].cardId,'B');assert.equal(r.tier,'sure');assert.ok(f.count.second>0);
});
test('weak first read escalates and the second retains the product score floor',async()=>{
  const f=fixture([Math.SQRT1_2],Math.SQRT1_2);const r=await f.pipeline.recognize([image],{card,preclean:false});
  assert.equal(r.reader?.stage,'second');assert.equal(r.tier,'low match');assert.equal(f.count.current,0);
});
test('name priors do not promote a weak first read through the released gate',async()=>{
  const f=fixture([Math.SQRT1_2]);const r=await f.pipeline.recognize([image],{card,preclean:false,priors:{decklist:['A'],seen:['A'],voiceMentioned:['A']}});
  assert.equal(r.reader?.stage,'second');assert.equal(r.candidates[0].cardId,'B');
});
test('saved current corrections and feedback use the compatible reader instead of another vector space',async()=>{
  for(const kind of ['learning','feedback','gallery'] as const) {
    const f=fixture();if(kind==='learning')f.pipeline.setLearning({version:'v',references:[],confusions:[{a:'A',b:'B'}]});
    const r=await f.pipeline.recognize([image],{card,preclean:false,includeFeedback:kind==='feedback',gallery:kind==='gallery'?[{cardId:'A',embedding:{space:'art-box',values:[1,0]}}]:undefined});
    assert.equal(r.reader?.model,'current');assert.equal(r.reader?.stage,'second');assert.equal(f.count.first,0);assert.ok(f.count.current>0);
    if(kind==='feedback')assert.ok(r.feedback);
  }
});
test('a Light gallery routes to Light; equal-sized current and Light vectors never match',async()=>{
  const f=fixture(),r=await f.pipeline.recognize([image],{card,preclean:false,includeIdentityEmbedding:true,gallery:[{cardId:'B',embedding:{space:'art-box',modelId:lightModel.id,values:[0,1]}}]});
  assert.equal(r.reader?.model,lightModel.id);assert.equal(f.count.first,0);assert.equal(r.identityEmbedding?.modelId,lightModel.id);
  const gallery=createFieldIdentityGallery();gallery.remember({space:'art-box',values:[1,0]},'A');
  assert.deepEqual(gallery.resolve({space:'art-box',modelId:lightModel.id,values:[1,0]}),{kind:'new'});
  assert.equal(fieldEmbeddingSimilarity({space:'art-box',values:[1,0]},{space:'art-box',values:[1,0],modelId:lightModel.id}),undefined);
});
test('a first-stage name on partial or covered crops retains the existing uncertain tier',async()=>{
  for(const extra of [{partial:true},{covered:true}]){
    const f=fixture(),r=await f.pipeline.recognize([image],{card:{...card,...extra},preclean:false});
    assert.equal(r.reader?.stage,'first');assert.notEqual(r.tier,'sure');
  }
});
test('missing or corrupt hybrid assets leave a ready current reader and a visible fallback note',async()=>{
  const original=globalThis.fetch;
  try {
    for(const response of [new Response(null,{status:404}),new Response('corrupt bank bytes')]) {
      globalThis.fetch=async()=>response.clone();
      await assert.rejects(()=>loadHybridCatalog(),/HTTP 404|checksum mismatch/);
      const f=fixture();const ready=await loadHybridOrCurrent(f.current,()=>openHybrid(f.args,f.current,'/unused/',1,n=>f.notes.push(n),()=>{}),n=>f.notes.push(n));
      const r=await ready.recognize([image],{card,preclean:false});assert.equal(r.candidates[0].cardId,'B');assert.equal(r.tier,'sure');
      assert.match(f.notes[0],/Using the current reader/);assert.equal(f.count.first,0);
    }
  }finally{globalThis.fetch=original;}
});
test('an inference failure switches to current once and keeps subsequent reads working',async()=>{
  const f=fixture([.95],.2,true);
  for(let i=0;i<2;i++) {
    const r=await f.pipeline.recognize([image],{card,preclean:false});assert.equal(r.reader?.stage,'fallback');assert.equal(r.candidates[0].cardId,'B');
  }
  assert.equal(f.count.first,1);assert.equal(f.notes.length,1);assert.match(f.notes[0],/Using the current reader/);
});
test('bank names map apostrophes and spacing without intersecting the two banks or guessing spelling',()=>{
  const catalog=[{cardId:'1',passcode:1,name:"King's  Knight"},{cardId:'2',passcode:2,name:'Light only'}];
  const mapped=mapBankNames([{id:'foreign',name:'King’s Knight'},{id:'only',name:'DuelSight only'},{id:'typo',name:'Kings Knigt'}],catalog);
  assert.equal(mapped.get('foreign')?.cardId,'1');assert.equal(mapped.has('only'),false);assert.equal(mapped.has('typo'),false);
  assert.equal(catalog[1].name,'Light only');
  assert.equal(mapBankNames([{id:'x',name:'Same'}],[{cardId:'1',passcode:1,name:'Same'},{cardId:'2',passcode:2,name:'Same'}]).size,0);
  const union=buildHybridCatalog(catalog,[{cardId:'11',passcode:11,name:'King’s Knight'},{cardId:'3',passcode:3,name:'DuelSight only'}]);
  assert.equal(union.bankEntries['11'].cardId,'1');assert.equal(union.bankEntries['3'].name,'DuelSight only');
  assert.deepEqual(union.entries.map(e=>e.cardId),['1','2','3']);
});
test('Light crop preprocessing matches the eval origin/size rounding in both orientations',()=>{
  const im={width:295,height:430,data:Uint8ClampedArray.from({length:295*430*4},(_,i)=>i%251)},a=yugioh.artWindow;
  const hypotheses=buildHypotheses(im,im,null,{userBoxWithCard:false},hybridProfiles(yugioh).second);
  for(const [i,whole] of [im,rotate180(im)].entries()) {
    const expected=cropRGBA(whole,Math.round(a.x*295),Math.round(a.y*430),Math.round(a.w*295),Math.round(a.h*430));
    assert.deepEqual(hypotheses[i].image,expected);
  }
});
test('current preprocessing and decisions retain the frozen pre-change bytes',async()=>{
  const f=fixture(),r=await f.current.recognize([image],{card,includeRaw:true,preclean:false});
  assert.equal(JSON.stringify({candidates:r.candidates,tier:r.tier,quality:r.quality}), '{"candidates":[{"cardId":"B","score":0.9539391994476318},{"cardId":"A","score":0.30000001192092896}],"tier":"sure","quality":{"searchSource":"catalog","faceDown":false,"framesAgree":true,"notInDecklist":false,"confusionChecked":false,"sharpness":0,"detected":true,"cornersFound":true,"framesUsed":1,"selectedFrameIndices":[0],"fallback":false,"covered":false,"fullArt":false,"fullArtReferences":0,"partial":false,"hypothesis":"art-box"}}');
  assert.equal(createHash('sha256').update(new Uint8Array(preprocess(image,yugioh.embedding).buffer)).digest('hex'),'12906b1acbedfb23746ff724f73e331e230f3d6628bbbd0e29ab292b4d5c99fa');
  assert.equal(f.count.first,0);assert.equal(f.count.second,0);assert.equal('reader' in r,false);
});
test('DuelSight pooling preserves float32 operation order and fills undersized cells',()=>{
  const tensor=toContractTensor(new Uint8Array([255,0,128,255]),1,1,{size:128,poolVersion:2});
  assert.equal(tensor[0],1);assert.equal(tensor[128*128],-1);assert.equal(tensor[2*128*128],Math.fround(Math.fround(Math.fround(128/255)-.5)/.5));
});
test('the default worker request stays byte identical and does not opt into hybrid loading',async()=>{
  const old=globalThis.Worker,messages:object[]=[];
  class Worker {
    onmessage?: (event:{data:object})=>void;onerror?:unknown;onmessageerror?:unknown;
    postMessage(message:{id:number;type:string}){messages.push(message);queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:{backend:'wasm'}}}));}terminate(){}
  }
  globalThis.Worker=Worker as unknown as typeof globalThis.Worker;
  try {
    const reader=createRecognizer({workers:'single',backend:'wasm'});await reader.prepare();reader.dispose();
    assert.equal(JSON.stringify(messages[0]),JSON.stringify({type:'init',profile:yugioh,backend:'wasm',runtimeBase:'/dev/vision-lab/assets/ort/',role:'both',id:1}));
    assert.deepEqual(messages[1],{type:'prepare',id:2});
  }finally{globalThis.Worker=old;}
});
