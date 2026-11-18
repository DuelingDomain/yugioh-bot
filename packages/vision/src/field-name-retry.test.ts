import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldWatcher,type FieldEvent,type KnownFieldCard} from './field-watcher';
import {createFieldIdentityGallery} from './field-gallery';
import {yugioh} from './games/yugioh';
import type {DetectedQuad,RecognitionResult} from './types';

function rig(backgroundReread=true,placeUnsure=false,margin=.15,readCostMs=0) {
  const gallery=createFieldIdentityGallery();let known:KnownFieldCard[]=[];
  let at=0,hand=false,motion=0,visible=true,tier:RecognitionResult['tier']='low match',identity='A',pending:Promise<void>|undefined;
  const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,quad:[{x:.3,y:.3},{x:.4,y:.3},{x:.4,y:.45},{x:.3,y:.45}]};
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/width,v=y/height;
    const rgb=u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.7?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.1&&u<.9&&v>.76&&v<.92?(v%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    data.set([...rgb,255],(y*width+x)*4);
  }
  const frame:ImageData={width,height,data,colorSpace:'srgb'},events:FieldEvent[]=[],reads:number[]=[];
  const watcher=createFieldWatcher({profile:yugioh,gallery,getKnownCards:()=>known,nameVoting:false,backgroundReread,placeUnsure,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame,at})},recognizer:{separateDetector:true,detectCards:async()=>visible?[card]:[],recognize:async()=>{
      reads.push(at);const capturedTier=tier,capturedIdentity=identity;await pending;at+=readCostMs;
      return {identityEmbedding:{space:'art-box',values:capturedIdentity==='B'?[0,1]:[1,0]},candidates:[{cardId:capturedIdentity,score:capturedTier==='sure'?.95:.65},{cardId:'RUNNER',score:.65-margin}],tier:capturedTier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:228},backend:'wasm'};
    }},analyze:()=>({motion:()=>motion,sharpness:()=>20,crop:()=>frame,appearance:()=>Array(12).fill(.6),halo:()=>Array(12).fill(.8),touched:()=>hand?.5:0,occluded:()=>hand})});
  watcher.subscribe(e=>events.push(e));
  const tick=async(ms=100)=>{at+=ms;await watcher.tick();await new Promise<void>(r=>setImmediate(r));};
  return {watcher,gallery,events,reads,tick,set known(value:KnownFieldCard[]){known=value;},set hand(v:boolean){hand=v;},set motion(v:number){motion=v;},set visible(v:boolean){visible=v;},sure(id='A'){tier='sure';identity=id;},weakNamed(){tier='not sure';},delay(p:Promise<void>){pending=p;},async untilPrompt(){for(let i=0;i<30&&!events.some(e=>e.type==='prompt');i++)await tick();assert.ok(events.some(e=>e.type==='prompt'));}};
}

test('an unanswered resting name retries with backoff, then a sure read places without another question',async()=>{
  const r=rig();try{
    await r.untilPrompt();const first=r.reads.length;
    for(let i=0;i<6;i++)await r.tick();assert.equal(r.reads.length,first);
    for(let i=0;i<100;i++)await r.tick();
    const gaps=r.reads.slice(2).map((at,i)=>at-r.reads[i+1]);
    assert.ok(gaps.length>=2);assert.ok(gaps[1]>gaps[0]);assert.ok(r.reads.length<=5);
    r.sure();for(let i=0;i<320&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
    assert.equal(r.events.filter(e=>e.type==='prompt').length,1);
    assert.equal(r.events.filter(e=>e.type==='placed'&&e.track.cardId==='A').length,1);
    assert.equal(r.watcher.getSnapshot().tracks[0].state,'identified');
  }finally{r.watcher.dispose();}
});

for(const gate of ['hand','motion','missing','disabled'] as const)test(`background read waits for ${gate}`,async()=>{
  const r=rig(gate!=='disabled');try{
    await r.untilPrompt();const count=r.reads.length;
    if(gate==='hand')r.hand=true;if(gate==='motion')r.motion=.2;if(gate==='missing')r.visible=false;
    r.sure();for(let i=0;i<70;i++)await r.tick();
    assert.equal(r.reads.length,count);assert.equal(r.events.some(e=>e.type==='placed'),false);
    if(gate==='hand'||gate==='motion'){r.hand=false;r.motion=0;for(let i=0;i<80&&!r.events.some(e=>e.type==='placed');i++)await r.tick();assert.ok(r.events.some(e=>e.type==='placed'&&e.track.cardId==='A'),'a clean resting frame resumes the pending question');}
  }finally{r.watcher.dispose();}
});

for(const answer of ['confirm','dismiss'] as const)test(`a player ${answer} cancels even an in-flight retry`,async()=>{
  const r=rig();try{
    await r.untilPrompt();let release=()=>{};r.delay(new Promise<void>(done=>{release=done;}));r.sure('B');
    const count=r.reads.length;for(let i=0;i<30&&r.reads.length===count;i++)await r.tick();assert.ok(r.reads.length>count);
    const id=r.watcher.getSnapshot().tracks[0].id;
    if(answer==='confirm')r.watcher.confirm(id,'PLAYER');else r.watcher.dismiss(id);
    release();for(let i=0;i<100;i++)await r.tick();
    assert.equal(r.events.some(e=>e.type==='placed'&&e.track.cardId==='B'),false);
    assert.equal(r.watcher.getSnapshot().tracks[0].cardId,answer==='confirm'?'PLAYER':undefined);
  }finally{r.watcher.dispose();}
});

for(const margin of [.05,.15])test(`unsure placement requires the measured margin (${margin}) and keeps the same ref on a sure correction`,async()=>{
  const r=rig(true,true,margin);try{
    for(let i=0;i<20&&!r.events.some(e=>e.type==='placed'||e.type==='prompt');i++)await r.tick();
    if(margin===.05){assert.equal(r.events.some(e=>e.type==='placed'),false);assert.ok(r.events.some(e=>e.type==='prompt'));return;}
    const placed=r.events.find(e=>e.type==='placed');assert.ok(placed?.track.nameCandidates);assert.equal(placed.track.nameCandidates.length,2);
    r.watcher.confirm(placed.track.id,'A',undefined,false);assert.equal(r.gallery.entries().length,0,'an unsure guess never trains the session gallery');r.sure('B');
    for(let i=0;i<80&&r.events.filter(e=>e.type==='placed').length<2;i++)await r.tick();
    const corrected=r.events.filter(e=>e.type==='placed').at(-1);assert.equal(corrected?.track.id,placed.track.id);assert.equal(corrected?.track.cardId,'B');assert.equal(corrected?.track.nameCandidates,undefined);
    assert.equal(r.events.some(e=>e.type==='removed'),false);
  }finally{r.watcher.dispose();}
});
test('a tapped unsure name is never corrected by a later sure read',async()=>{
 const r=rig(true,true);try{
   for(let i=0;i<20&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
   const placed=r.events.find(e=>e.type==='placed');assert.ok(placed?.track.nameCandidates);
   r.watcher.confirm(placed.track.id,'PLAYER');r.sure('B');for(let i=0;i<100;i++)await r.tick();
   assert.equal(r.events.filter(e=>e.type==='placed').length,1);assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'PLAYER');
 }finally{r.watcher.dispose();}
});

test('background work shares a ten percent duty cap even when the reader is slow',async()=>{
 const r=rig(true,false,.15,500);try{
  await r.untilPrompt();for(let i=0;i<150;i++)await r.tick();
  assert.ok(r.reads.length>=3);
  for(let i=2;i<r.reads.length;i++)assert.ok(r.reads[i]-r.reads[i-1]>=5000,'read cost plus nine times that cost between starts');
 }finally{r.watcher.dispose();}
});

test('an automatically shown Best match also improves on a sure background read',async()=>{
 const r=rig();try{
  r.weakNamed();for(let i=0;i<20&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
  const first=r.events.find(e=>e.type==='placed');assert.ok(first?.track.bestMatch);
  r.watcher.confirm(first.track.id,'A',undefined,false);r.sure('B');
  for(let i=0;i<80&&r.events.filter(e=>e.type==='placed').length<2;i++)await r.tick();
  const last=r.events.filter(e=>e.type==='placed').at(-1);assert.equal(last?.track.cardId,'B');assert.equal(last?.track.bestMatch,undefined);assert.equal(last?.track.id,first.track.id);
 }finally{r.watcher.dispose();}
});

test('a sure background correction survives the old server name until its save acknowledges it',async()=>{
 const r=rig();try{
  r.weakNamed();for(let i=0;i<20&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
  const first=r.events.find(e=>e.type==='placed');assert.ok(first);
  r.watcher.confirm(first.track.id,'A',undefined,false);r.known=[{id:first.track.id,zone:'M2',cardId:'A',faceDown:false}];r.sure('B');
  for(let i=0;i<80&&r.events.filter(e=>e.type==='placed').length<2;i++)await r.tick();
  for(let i=0;i<10;i++)await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'B');
  r.known=[{id:first.track.id,zone:'M2',cardId:'B',faceDown:false}];r.watcher.confirm(first.track.id,'B',undefined,false);await r.tick();
  assert.equal(r.watcher.getSnapshot().tracks[0].cardId,'B');
 }finally{r.watcher.dispose();}
});

test('a corrected name teaches the fresh sure embedding, not the original weak crop',async()=>{
 const r=rig(true,true);try{
  for(let i=0;i<20&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
  const first=r.events.find(e=>e.type==='placed');assert.ok(first);
  r.watcher.confirm(first.track.id,'A',undefined,false);r.sure('B');
  for(let i=0;i<80&&r.events.filter(e=>e.type==='placed').length<2;i++)await r.tick();
  r.watcher.confirm(first.track.id,'B',undefined,false);
  assert.deepEqual(r.gallery.resolve({space:'art-box',values:[0,1]}),{kind:'match',cardId:'B'});
  assert.deepEqual(r.gallery.resolve({space:'art-box',values:[1,0]}),{kind:'new'});
 }finally{r.watcher.dispose();}
});
