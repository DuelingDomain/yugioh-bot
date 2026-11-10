import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { classifyFaceState, createFaceStateHysteresis, isLikelyFaceDown } from './face-state';
import type { RGBAImage } from './pixels';

const image = (pixel: (x:number,y:number)=>number[]):RGBAImage => {
  const width=120,height=176,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...pixel(x/width,y/height),255],(y*width+x)*4);
  return {width,height,data};
};
const front=image((x,y)=> {
  if(x<.06||x>.94||y<.04||y>.96)return [25,25,25];
  if(x>.12&&x<.88&&y>.18&&y<.70)return [60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)];
  if(x>.10&&x<.90&&y>.76&&y<.92)return y%.035<.012?[65,55,45]:[220,210,180];
  return [35,145,120];
});

test('tracks a bound face through arbitrary sleeves without a transient flip or identity inference',async()=> {
  assert.equal(classifyFaceState(front).state,'up');
  for(const rgb of [[245,245,245],[8,8,8],[190,25,45],[20,80,210],[20,180,50]]) {
    const sleeve=image((x,y)=>rgb.map(v=>v*(.75+.2*x)+5*y));
    assert.equal(classifyFaceState(sleeve,{reference:{crop:front},detectorFaceDownScore:.02}).state,'down');
    assert.equal(isLikelyFaceDown(sleeve),true);
  }
  const patterned=image((x,y)=>[110+80*Math.sin(x*32+y*21),100+65*Math.cos(x*27-y*41),120+90*Math.sin(y*35)]);
  assert.equal(classifyFaceState(patterned,{reference:{crop:front}}).state,'down');
  assert.equal(classifyFaceState(patterned,{detectorFaceDownScore:.97}).state,'down');
  assert.equal(isLikelyFaceDown(patterned),true);
  assert.equal(classifyFaceState(front,{reference:{crop:front}}).state,'up');
  assert.equal(classifyFaceState(front,{reference:{crop:front},detectorFaceDownScore:.99}).state,'unknown');
  assert.equal(classifyFaceState(front,{reference:{crop:front},detectorFaceDownScore:NaN}).state,'up');
  assert.equal(classifyFaceState(image(()=>[250,250,250]),{embedding:{space:'art-box',values:[1,0]},reference:{crop:front,embedding:{space:'art-box',values:[1,0]}}}).state,'down');
  const dark={...front,data:Uint8Array.from(front.data,(v,i)=>i%4===3?v:v*.1)};
  const blur={...front,data:await sharp(front.data,{raw:{width:front.width,height:front.height,channels:4}}).blur(10).raw().toBuffer()};
  for(const crop of [dark,blur]) assert.notEqual(classifyFaceState(crop,{reference:{crop:front},detectorFaceDownScore:.01}).state,'down');
  // An embedding change alone is not a flip; different card identities can be face-up.
  assert.notEqual(classifyFaceState(front,{embedding:{space:'art-box',values:[0,1]},reference:{embedding:{space:'art-box',values:[1,0]}}}).state,'down');
  assert.equal(classifyFaceState({width:0,height:0,data:new Uint8Array()},{detectorFaceDownScore:1}).state,'unknown');
  assert.equal(classifyFaceState({...front,data:front.data.subarray(0,40)}).state,'unknown');
  const gate=createFaceStateHysteresis();
  const down={state:'down',confidence:.95} as const,up={state:'up',confidence:.95} as const;
  assert.equal(gate.update(down,0).state,'unknown');
  assert.equal(gate.update(down,299).state,'unknown');
  assert.equal(gate.update(down,300).state,'down');
  assert.equal(gate.update(up,350).state,'unknown');
  assert.equal(gate.update({state:'unknown',confidence:0},500).state,'unknown');
  assert.equal(gate.update(up,550).state,'unknown');
  assert.equal(gate.update(up,850).state,'up');
  gate.reset();
  gate.update(up,900);
  assert.equal(gate.update(up,NaN).state,'unknown');
  assert.equal(gate.update(up,901).state,'unknown');
  gate.reset();
  gate.update(down,1000);
  assert.equal(gate.update(down,5000).state,'unknown'); // a paused camera is not sustained evidence
  assert.equal(gate.update(down,4999).state,'unknown'); // out-of-order timestamps reset
});

import {createFieldWatcher,type FieldEvent} from './field-watcher';
import {yugioh} from './games/yugioh';
import type {DetectedQuad,RecognitionResult} from './types';

test('fresh Set settles from independent pixels and a reveal reads its front once with a new timing origin',async()=>{
 let at=0,down=true,reads=0,phone=true,detects=0,motion=0,backScore=.74,backLook=.1;
 const back=image(()=>[15,15,15]);
 const outline=():DetectedQuad=>{
  const w=phone?.12:down?.2*176/120:.2,h=phone?.2:down?.2*120/176:.2;
  return {kind:down?'face-down':'face-up',confidence:down?(phone?.55:backScore):.99,partial:false,quad:[{x:.4-w/2,y:.4-h/2},{x:.4+w/2,y:.4-h/2},{x:.4+w/2,y:.4+h/2},{x:.4-w/2,y:.4+h/2}]};
 };
 const events:FieldEvent[]=[];
 const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
  buffer:{sample:async()=>({frame:{width:120,height:176,data:front.data} as ImageData,at})},clone:async f=>f,
  analyze:()=>({crop:()=>down?back:front,motion:()=>motion,sharpness:()=>20,appearance:()=>Array(288).fill(down?backLook:.05)}),
  recognizer:{detectCards:async()=>{detects++;return [outline()];},recognize:async()=>{reads++;return {candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{fallback:false,covered:false,partial:false,faceDown:false},timingsMs:{embed:20,search:1,total:21},backend:'wasm'} as RecognitionResult;}}});
 watcher.subscribe(e=>events.push(e));
 const tick=async(ms=100)=>{at+=ms;await watcher.tick();await Promise.resolve();};
 try{
  for(let i=0;i<4;i++)await tick();assert.equal(events.length,0,'a low-score phone shape never becomes a card');phone=false;at+=1000;
  motion=.2;for(let i=0;i<17;i++)await tick();backLook=.6;await tick();assert.equal(events.length,0,'a moving confident back cannot commit');motion=0;const backDetects=detects;
  await tick(33);assert.equal(events.length,0,'one clean back frame cannot commit a moving draw');
  assert.equal(detects,backDetects,'fresh pixels confirm the latest back outline without another inference');
  motion=.2;await tick(33);motion=0;await tick(33);
  assert.equal(events.length,0,'motion during the detector throttle resets the clean Set window');
  await tick(67);assert.equal(events.filter(e=>e.type==='placed').length,1,'two uninterrupted clean samples commit before the full face window');
  backScore=.55;for(let i=0;i<3;i++)await tick();
  const set=events.find(e=>e.type==='placed'&&e.track.faceDown);
  assert.ok(set,'clean back commits within 400ms without model identity');assert.equal(reads,0);assert.equal(events.some(e=>e.type==='reading'),false,'backs need no speculative identity placeholder');
  at+=1000;down=false;const revealedAt=at;
  for(let i=0;i<8&&!events.some(e=>e.type==='placed'&&!e.track.faceDown);i++)await tick();
  const reveal=events.find(e=>e.type==='placed'&&!e.track.faceDown);
  assert.ok(reveal);assert.ok(at-revealedAt<=300,'front recognition overlaps face settling');assert.equal(reveal.track.id,set.track.id);assert.equal(reads,1,'retain the verified front read across the face transition');
  assert.ok(reveal.timing!.originAt>=performance.timeOrigin+revealedAt);
  assert.ok(reveal.latencyMs!<700);assert.notEqual(reveal.timing!.id,set.timing!.id);
  backScore=.74;at+=1000;down=true;motion=.2;await tick();motion=0;await tick();
  assert.equal(events.some(e=>e.type==='flipped'&&e.track.faceDown),false,'a transient back observation cannot flip an existing public front');
  down=false;for(let i=0;i<3;i++)await tick();assert.equal(reads,1,'a rejected transient back does not reread the front');
  const before=detects;at+=1000;down=true;motion=.2;await tick();motion=0;for(let i=0;i<3;i++)await tick();assert.ok(events.some(e=>e.type==='flipped'&&e.track.faceDown));assert.equal(detects-before,1,'fresh changed-face pixels reuse the new detector outline');assert.equal(reads,1);
 }finally{watcher.dispose();}
});

test('a resting front shows its Reading card before the crop is sharp enough to read, and is removed when the card leaves',async()=>{
 let at=0,present=true,reads=0;
 const events:FieldEvent[]=[],outline=():DetectedQuad=>({kind:'face-up',confidence:.99,partial:false,quad:[{x:.3,y:.3},{x:.5,y:.3},{x:.5,y:.5},{x:.3,y:.5}]});
 const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
  buffer:{sample:async()=>({frame:{width:120,height:176,data:front.data} as ImageData,at})},clone:async f=>f,
  analyze:()=>({crop:()=>front,motion:()=>0,sharpness:()=>2,appearance:()=>Array(288).fill(.05)}),
  recognizer:{detectCards:async()=>present?[outline()]:[],recognize:async()=>{reads++;return {candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{fallback:false,covered:false,partial:false,faceDown:false},timingsMs:{embed:20,search:1,total:21},backend:'wasm'} as RecognitionResult;}}});
 watcher.subscribe(e=>events.push(e));
 const tick=async(ms=100)=>{at+=ms;await watcher.tick();await Promise.resolve();};
 try{
  for(let i=0;i<12;i++)await tick();
  assert.ok(events.some(e=>e.type==='reading'),'the Reading card shows while the crop is still too soft to read');assert.equal(reads,0,'the read still waits for a sharp crop');
  present=false;at+=3000;for(let i=0;i<30;i++)await tick();
  assert.ok(events.some(e=>e.type==='removed'),'the Reading card goes away when the card leaves');
 }finally{watcher.dispose();}
});

test('a card that never gets sharp keeps its Reading card, raises one focus hint instead of a prompt, and reads when a sharp crop arrives',async()=>{
 let at=0,sharp=2,reads=0;
 const events:FieldEvent[]=[],outline=():DetectedQuad=>({kind:'face-up',confidence:.99,partial:false,quad:[{x:.3,y:.3},{x:.5,y:.3},{x:.5,y:.5},{x:.3,y:.5}]});
 const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
  buffer:{sample:async()=>({frame:{width:120,height:176,data:front.data} as ImageData,at})},clone:async f=>f,
  analyze:()=>({crop:()=>front,motion:()=>0,sharpness:()=>sharp,appearance:()=>Array(288).fill(.05)}),
  recognizer:{detectCards:async()=>[outline()],recognize:async()=>{reads++;return {candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{fallback:false,covered:false,partial:false,faceDown:false},timingsMs:{embed:20,search:1,total:21},backend:'wasm'} as RecognitionResult;}}});
 watcher.subscribe(e=>events.push(e));
 const tick=async(ms=100)=>{at+=ms;await watcher.tick();await Promise.resolve();};
 try{
  for(let i=0;i<200;i++)await tick();
  assert.ok(events.some(e=>e.type==='reading'),'the Reading card stays');assert.ok(!events.some(e=>e.type==='prompt'),'no prompt for a card that is only too soft');
  assert.equal(watcher.getSnapshot().softCamera,true,'one focus hint is raised');assert.equal(reads,0);
  sharp=40;for(let i=0;i<20;i++)await tick();
  assert.ok(reads>0,'a sharp crop is read at once');assert.equal(watcher.getSnapshot().softCamera,undefined,'the hint clears once a read starts');
 }finally{watcher.dispose();}
});
test('CPU budget, 1.2 s detector: a flip in place settles soon and a Set moved after 7 s still keeps its id',async()=>{
 let at=0,down=false,x=.3,moving=0,dirty=0,motion=0,passes=0,passAt=0,oldest=0;
 const back=image(()=>[15,15,15]),events:FieldEvent[]=[];
 const outline=():DetectedQuad=>{const w=down?.2*176/120:.2,h=down?.2*120/176:.2;
  return {kind:down?'face-down':'face-up',confidence:down?.74:.99,partial:false,quad:[{x:x-w/2,y:.4-h/2},{x:x+w/2,y:.4-h/2},{x:x+w/2,y:.4+h/2},{x:x-w/2,y:.4+h/2}]};};
 const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
  buffer:{sample:async()=>({frame:{width:120,height:176,data:front.data} as ImageData,at})},clone:async f=>f,
  analyze:()=>({crop:()=>down?back:front,motion:()=>motion,sharpness:()=>20,appearance:()=>Array(288).fill(down?.6:.05),scene:{moving,sinceMark:dirty,mark(){dirty=0;}}}),
  recognizer:{detectorBackend:'wasm',detectCards:async()=>{passes++;passAt=at;at+=1200;return [outline()];},recognize:async()=>({candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{fallback:false,covered:false,partial:false,faceDown:false},timingsMs:{embed:20,search:1,total:21},backend:'wasm'}) as RecognitionResult}});
 watcher.subscribe(e=>{events.push(e);if(e.type==='placed')watcher.confirm(e.track.id,e.track.cardId,'ref-1',false);});
 const until=async(ms:number,done:()=>boolean)=>{const end=at+ms;while(at<end&&!done()){at+=100;await watcher.tick();await Promise.resolve();const live=watcher.getSnapshot().tracks.find(t=>!t.removed);if(live)oldest=Math.max(oldest,at-live.lastSeen);}return done();};
 const change=async(apply:()=>void)=>{moving=dirty=30;motion=.2;at+=100;await watcher.tick();apply();dirty=30;at+=100;await watcher.tick();moving=0;motion=0;dirty=30;};
 try{
  dirty=30;assert.ok(await until(10_000,()=>events.some(e=>e.type==='placed')),'the card is placed');
  await until(1500,()=>false);passes=0;await until(7000,()=>false);
  assert.ok(passes<=3,`a still card ran ${passes} passes in 7 s`);
  const flipAt=at;await change(()=>{down=true;});
  assert.ok(await until(6000,()=>events.some(e=>e.type==='flipped'&&e.track.faceDown)),'the flip settles');
  assert.ok(at-flipAt<=3400,`flip took ${at-flipAt} ms`);
  await until(1500,()=>false);const set=watcher.getSnapshot().tracks.find(t=>!t.removed)!;
  assert.ok(set.restSince!==undefined&&at-set.lastSeen<=1500,'a flipped card can speak for its face');
  oldest=0;await until(7000,()=>false);assert.ok(oldest<=1500,`a still Set went unseen for ${oldest} ms`);
  // The move starts long after the last pass: only the still check can vouch for the card.
  assert.ok(await until(4000,()=>at-passAt>=3000));events.length=0;await change(()=>{x=.7;});
  assert.ok(await until(6000,()=>events.some(e=>e.type==='moved')),`the Set moves (${events.map(e=>e.type)})`);
  const after=watcher.getSnapshot().tracks.filter(t=>!t.removed);
  assert.equal(after.length,1);assert.equal(after[0].id,set.id);assert.equal(events.some(e=>e.type==='removed'),false);
 }finally{watcher.dispose();}
});

test('a fresh low-confidence reveal can ask again without a retry loop',async()=>{
 let at=0,down=false,reads=0;
 const back=image(()=>[15,15,15]),events:FieldEvent[]=[];
 const outline=():DetectedQuad=>({kind:down?'face-down':'face-up',confidence:.99,partial:false,quad:[{x:.3,y:.3},{x:.42,y:.3},{x:.42,y:.5},{x:.3,y:.5}]});
 const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,buffer:{sample:async()=>({frame:front as ImageData,at})},clone:async f=>f,
  analyze:()=>({crop:()=>down?back:front,motion:()=>0,sharpness:()=>20,appearance:()=>Array.from({length:288},(_,i)=>down?.1:i%2?.7:.3)}),
  recognizer:{detectCards:async()=>[outline()],recognize:async()=>{reads++;return {candidates:[],tier:'low match',quality:{fallback:false},timingsMs:{total:1},backend:'wasm'} as unknown as RecognitionResult;}}});
 watcher.subscribe(e=>events.push(e));const sample=async()=>{at+=100;await watcher.tick();await Promise.resolve();};
 try{for(let i=0;i<8;i++)await sample();assert.equal(events.filter(e=>e.type==='prompt').length,1);down=true;for(let i=0;i<5;i++)await sample();down=false;for(let i=0;i<15;i++)await sample();assert.equal(events.filter(e=>e.type==='prompt').length,2);assert.equal(reads,2,'one read per new front, no failed-reveal retry queue');}finally{watcher.dispose();}
});
