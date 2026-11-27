import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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
import { createFieldWatcher, type FieldEvent, type FieldWatcherOptions } from './field-watcher';
import type { GameProfile, LoadedIndex, DetectedQuad } from './types';
import type { ModelSession } from './runtime';

const card:DetectedQuad={quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'face-up',confidence:1,partial:false};
const image={width:20,height:30,data:new Uint8ClampedArray(2400).fill(120)};
const entries=['A','B'].map((cardId,i)=>({cardId,passcode:i+1,name:cardId,frameClass:'Effect'}));
function fixture(firstScores=[.95],secondScore:number|number[] =.2,firstFailure=false,temporal=false) {
  const profile:GameProfile={...yugioh,id:'fixture',detector:{...yugioh.detector,longSide:32},card:{...yugioh.card,warpWidth:10,warpHeight:15},embedding:{...yugioh.embedding,dim:2,inputSize:2}};
  const count={first:0,second:0,current:0};
  const index=(p:GameProfile):LoadedIndex=>({meta:{version:1,gameId:p.id,modelId:p.embedding.id,modelSha256:p.embedding.sha256,dim:2,count:2,dtype:'float32',entries},vectors:new Float32Array([1,0,0,1])});
  class Tensor {constructor(public type:string,public data:Float32Array,public dims:number[]) {}}
  const detector:ModelSession={backend:'wasm',release:async()=>{},run:async()=>{
    if(!temporal)throw new Error('outlined read must not detect twice');
    const heat=new Float32Array(128),box=new Float32Array(384),cell=26;
    heat[cell]=.99;box[2*64+cell]=Math.log(14/4);box[3*64+cell]=Math.log(22/4);box[5*64+cell]=1;
    return {heat:{dims:[1,2,8,8],data:heat},box:{dims:[1,6,8,8],data:box}};
  }};
  const session=(p:GameProfile,key:keyof typeof count,scores:number[]):ModelSession=>({backend:'wasm',release:async()=>{},run:async()=>{
    if(key==='first'&&firstFailure){count.first++;throw new Error('inference failed');}
    const n=scores[Math.min(count[key]++,scores.length-1)];return {[p.embedding.outputName]:{dims:[1,2],data:new Float32Array([n,Math.sqrt(1-n*n)])}};
  }});
  const args:ConstructorParameters<typeof RecognitionPipeline>=[profile,index(profile),detector,session(profile,'current',[.3]),Tensor];
  const current=new RecognitionPipeline(...args),profiles=hybridProfiles(profile);
  const firstProfile={...profiles.first,embedding:{...profiles.first.embedding,inputSize:2,dim:2}};
  const secondProfile={...profiles.second,embedding:{...profiles.second.embedding,inputSize:2,dim:2}};
  const first=new RecognitionPipeline(firstProfile,index(firstProfile),detector,session(firstProfile,'first',firstScores),Tensor);
  const secondIndex=index(secondProfile);
  const second=new RecognitionPipeline(secondProfile,secondIndex,detector,session(secondProfile,'second',typeof secondScore==='number'?[secondScore]:secondScore),Tensor);
  const notes:string[]=[];
  return {pipeline:new HybridPipeline(args,current,first,second,entries,note=>notes.push(note)),current,count,notes,args,secondIndex};
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
test('hybrid preserves positive-back Set admission and only replaces face-up name reading',async()=>{
  const trace=JSON.parse(readFileSync(new URL('./fixtures/phantom-phone.json',import.meta.url),'utf8'));
  const phone={width:trace.crop.width,height:trace.crop.height,data:new Uint8ClampedArray(inflateSync(Buffer.from(trace.crop.rgbaDeflate,'base64')))};
  const front={width:96,height:140,data:new Uint8ClampedArray(96*140*4)};
  for(let py=0;py<front.height;py++)for(let px=0;px<front.width;px++){
    const x=px/front.width,y=py/front.height;
    const rgb=x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    front.data.set([...rgb,255],(py*front.width+px)*4);
  }
  const back={...front,data:new Uint8ClampedArray(front.data.length).fill(15)};
  const frame:ImageData={width:100,height:100,colorSpace:'srgb',data:new Uint8ClampedArray(40_000).fill(120)};
  const setTimes:number[]=[];
  for(const selected of ['current','hybrid'] as const)for(const kind of ['phone','back','front'] as const){
    const f=fixture(),pipeline=selected==='hybrid'?f.pipeline:f.current;
    const outline:DetectedQuad={quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}],kind:kind==='front'?'face-up':'face-down',confidence:.95,partial:false};
    let at=0,present=false;
    const events:FieldEvent[]=[];
    const recognizer:FieldWatcherOptions['recognizer']={
      detectCards:async()=>present?[outline]:[],
      recognize:(frames,opts)=>pipeline.recognize(frames.map(frame=>{assert.ok('data' in frame);return frame;}),opts),
    };
    const watcher=createFieldWatcher({profile:f.args[0],recognizer,now:()=>at,hidden:()=>false,buffer:{sample:async()=>({frame,at})},clone:async frame=>frame,
      analyze:()=>({motion:()=>0,sharpness:()=>20,crop:()=>kind==='phone'?phone:kind==='back'?back:front,
        appearance:()=>kind==='front'?Array.from({length:12},(_,i)=>i%2?.6:.2):Array(12).fill(.8),halo:()=>Array(192).fill(.2)})});
    watcher.subscribe(event=>events.push(event));
    try{
      at+=100;await watcher.tick();present=true;watcher.scanNow();
      for(let i=0;i<20;i++){at+=100;await watcher.tick();}
      assert.equal(watcher.getSnapshot().metrics.errors,0);
      const placements=events.filter(event=>event.type==='placed');
      if(kind==='phone'){
        assert.equal(placements.length,0,selected);assert.equal(events.some(event=>event.type==='reading'),false);
        const prompts=events.filter(event=>event.type==='prompt');assert.equal(prompts.length,1);
        assert.equal(prompts[0].reason,'card-presence');assert.equal(prompts[0].track.setEvidence?.positive,false);
      }else{
        assert.equal(placements.length,1,`${selected} ${kind}`);
        const placed=placements[0];assert.equal(placed.track.faceDown,kind==='back');
        if(kind==='back'){
          assert.equal(placed.track.setEvidence?.positive,true);assert.equal(placed.track.setEvidence?.decision,'committed');
          assert.equal(placed.track.cardId,undefined);assert.equal(events.some(event=>event.type==='reading'),false);
          setTimes.push(placed.track.lastSeen-placed.track.firstSeen);
        }else{
          assert.equal(placed.track.cardId,selected==='hybrid'?'A':'B');
          if(selected==='hybrid'){assert.equal(placed.result?.reader?.selected,'hybrid');assert.equal(placed.timing?.reader?.stage,'first');assert.ok(f.count.first>0);assert.equal(f.count.current,0);}
          else assert.ok(f.count.current>0);
        }
      }
      if(kind!=='front')assert.deepEqual(f.count,{first:0,second:0,current:0},'Set evidence never invokes a name reader');
    }finally{watcher.dispose();}
  }
  assert.deepEqual(setTimes,[100,100],'Current and Hybrid keep the same positive Set timing');
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
test('the same borderline Hybrid read needs stronger evidence outside the registered deck',async()=>{
  const read=async(score:number,decklist:string[])=>fixture([score],score).pipeline.recognize([image],{card,preclean:false,priors:{decklist}});
  const listed=await read(.745,['A']);
  assert.equal(listed.reader?.stage,'first');assert.equal(listed.tier,'sure');
  const unlisted=await read(.745,['B']);
  assert.equal(unlisted.reader?.stage,'second');assert.notEqual(unlisted.tier,'sure');
  assert.equal(unlisted.candidates[0].cardId,'A');
  const strong=await read(.95,['B']);
  assert.equal(strong.tier,'sure');assert.equal(strong.quality.notInDecklist,true);
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
test('missing, corrupt or failed downloads leave a ready current reader and a visible fallback note',async()=>{
  const original=globalThis.fetch;
  try {
    for(const response of [new Response(null,{status:404}),new Response('corrupt bank bytes'),new Error('network disconnected')]) {
      globalThis.fetch=async()=>{if(response instanceof Error)throw response;return response.clone();};
      await assert.rejects(()=>loadHybridCatalog(),/HTTP 404|checksum mismatch|network disconnected/);
      const f=fixture();const ready=await loadHybridOrCurrent(f.current,()=>openHybrid(f.args,f.current,'/unused/',1,n=>f.notes.push(n),()=>{}),n=>f.notes.push(n));
      const r=await ready.recognize([image],{card,preclean:false});assert.equal(r.candidates[0].cardId,'B');assert.equal(r.tier,'sure');
      assert.match(f.notes[0],/Using the current reader/);assert.equal(f.count.first,0);
    }
  }finally{globalThis.fetch=original;}
});
test('WASM session startup failure keeps Current usable without WebGPU',async()=>{
  const f=fixture();
  const ready=await loadHybridOrCurrent(f.current,async()=>{throw new Error('WASM session creation failed');},note=>f.notes.push(note));
  const r=await ready.recognize([image],{card,preclean:false});
  assert.equal(r.candidates[0].cardId,'B');assert.equal(r.backend,'wasm');
  assert.equal(f.count.first,0);assert.match(f.notes[0],/Using the current reader/);
});
test('a stalled catalog download has a bounded wait and aborts its request',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const original=globalThis.fetch;let signal:AbortSignal|null|undefined;
  globalThis.fetch=async(_input,init)=>{signal=init?.signal;return new Promise<Response>(()=>{});};
  try{
    const failed=assert.rejects(loadHybridCatalog(),/Hybrid catalog timed out/);
    for(let i=0;i<10&&!signal;i++)await new Promise<void>(resolve=>setImmediate(resolve));
    assert.ok(signal);t.mock.timers.tick(8_000);await failed;assert.equal(signal.aborted,true);
  }finally{globalThis.fetch=original;t.mock.timers.reset();}
});
test('Light uses the deck prior without changing the stricter released first-stage gate',async()=>{
  const make=()=>{const f=fixture([.71],1);f.secondIndex.vectors.set([.79,Math.sqrt(1-.79**2),.72,Math.sqrt(1-.72**2)]);return f;};
  const f=make();
  const r=await f.pipeline.recognize([image],{card,preclean:false,priors:{decklist:['A']}});
  assert.equal(r.reader?.model,lightModel.id);assert.equal(r.candidates[0].cardId,'A');
  assert.equal(r.tier,'sure');
  const unlisted=await make().pipeline.recognize([image],{card,preclean:false});
  assert.equal(unlisted.candidates[0].cardId,'A');assert.equal(unlisted.tier,'not sure');
});
test('Hybrid escalates disagreeing frames and Light fuses the majority without manufacturing certainty',async()=>{
  const f=fixture([.95,.95,.2,.2,.2,.2],[.2,.2,.95,.95,.95,.95],false,true);
  const r=await f.pipeline.recognize([image,image,image],{card,maxFrames:3,earlyExit:false,preclean:false,includeRaw:true});
  assert.equal(r.reader?.model,lightModel.id);assert.equal(r.candidates[0].cardId,'A');
  assert.equal(r.quality.framesUsed,3);assert.equal(r.quality.framesAgree,false);assert.equal(r.tier,'not sure');
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

for(const failure of ['init','prepare','recognize','crash'] as const)test(`Hybrid ${failure} recovers through Current and leaves outlines and later reads usable`,async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const old=globalThis.Worker;
  const workers:Worker[]=[],notes:string[]=[],messages:{type:string;reader?:string;frames?:unknown[]}[]=[];
  const answer=await fixture().current.recognize([image],{card,preclean:false});
  class Worker {
    onmessage?: (event:{data:object})=>void;
    onerror?: (event:{message:string})=>void;
    onmessageerror?:()=>void;
    terminated=false;
    constructor(){workers.push(this);}
    postMessage(message:{id:number;type:string;reader?:string;frames?:typeof image[]},transfers:Transferable[]=[]){
      messages.push(message);
      if(workers[0]===this){
        assert.equal(transfers.length,0,'Hybrid retains frames for recovery');
        if(message.type===failure||failure==='crash'&&message.type==='recognize'){
          if(failure==='crash')queueMicrotask(()=>this.onerror?.({message:'WASM worker failed'}));
          return;
        }
      }
      const sent=structuredClone(message,{transfer:transfers});
      for(const frame of sent.frames??[])assert.equal(frame.data.byteLength,2400,'the retry receives intact pixels');
      queueMicrotask(()=>this.onmessage?.({data:{id:message.id,result:message.type==='recognize'?answer:message.type==='detect'?[]:{backend:'wasm'},backendStatus:{backend:'wasm',models:[{model:'embedder',backend:'wasm'}]}}}));
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=Worker as unknown as typeof globalThis.Worker;
  const reader=createRecognizer({reader:'hybrid',workers:'single',backend:'wasm',onBackendChange:status=>{if(status.readerNote)notes.push(status.readerNote);}});
  try {
    const fresh=()=>({...image,data:new Uint8ClampedArray(image.data)}) as ImageData;
    const read=reader.recognize([fresh()],{card,transferFrames:true});
    for(let i=0;i<20;i++)await Promise.resolve();
    if(failure==='prepare'){
      // Recognition does not implicitly call prepare on the client; exercise the real warm-up boundary.
      await read;
      const warming=reader.prepare();for(let i=0;i<20;i++)await Promise.resolve();
      t.mock.timers.tick(15_000);await warming;
    }else{t.mock.timers.tick(15_000);assert.equal((await read).candidates[0].cardId,'B');}
    assert.equal(workers[0].terminated,true);assert.equal(workers.length,2);
    assert.match(notes.at(-1)??'',/Using the current reader/);
    assert.ok(messages.filter(m=>m.type==='init').slice(1).every(m=>m.reader===undefined),'Current restart never opts back in');
    assert.deepEqual(await reader.detectCards(fresh()),[]);
    const again=await reader.recognize([fresh()],{card});assert.equal(again.candidates[0].cardId,'B');
    assert.equal(again.reader?.stage,'fallback');assert.equal(again.reader?.model,'current');
    assert.equal(workers.length,2,'failure stays sticky until the owner switches');
  }finally{reader.dispose();globalThis.Worker=old;t.mock.timers.reset();}
});
test('a split Hybrid read failure preserves the existing scene worker',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const old=globalThis.Worker,workers:Worker[]=[];
  const answer=await fixture().current.recognize([image],{card,preclean:false});
  class Worker {
    onmessage?:(event:{data:object})=>void;onerror?:unknown;onmessageerror?:unknown;
    role?:string;hybrid=false;terminated=false;
    constructor(){workers.push(this);}
    postMessage(m:{id:number;type:string;role?:string;reader?:string}){
      if(m.type==='init'){this.role=m.role;this.hybrid=m.reader==='hybrid';}
      if(m.type==='recognize'&&this.hybrid)return;
      queueMicrotask(()=>this.onmessage?.({data:{id:m.id,result:m.type==='recognize'?answer:m.type==='detect'?[]:{backend:'wasm'}}}));
    }
    terminate(){this.terminated=true;}
  }
  globalThis.Worker=Worker as unknown as typeof globalThis.Worker;
  const reader=createRecognizer({reader:'hybrid',workers:'split',backend:'wasm'});
  try{
    await reader.prepare();await reader.detectCards(image as ImageData);
    const scene=workers.find(w=>w.role==='scene');assert.ok(scene);
    const reading=reader.recognize([image as ImageData],{card});
    for(let i=0;i<20;i++)await Promise.resolve();t.mock.timers.tick(15_000);
    assert.equal((await reading).candidates[0].cardId,'B');
    assert.equal(scene.terminated,false);assert.equal(workers.filter(w=>w.role==='scene').length,1);
    assert.equal(reader.separateDetector,true);assert.deepEqual(await reader.detectCards(image as ImageData),[]);
  }finally{reader.dispose();globalThis.Worker=old;t.mock.timers.reset();}
});
