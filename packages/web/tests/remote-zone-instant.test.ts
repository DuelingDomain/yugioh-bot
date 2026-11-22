import {afterEach, expect, test} from 'vitest';
import {createFieldWatcher, type FieldEvent, type FieldWatcherOptions} from '../../vision/src/field-watcher';
import {createFieldCalibration} from '../../vision/src/field-zones';
import {zoneSpecsFromCalibration, type GrayFrame, type ZoneTier} from '../../vision/src/zone-events';
import {yugioh} from '../../vision/src/games/yugioh';
import type {RGBAImage} from '../../vision/src/pixels';
import {pickZoneTier} from '../../vision/src/zone-events';
import {zoneInstantOption} from '../src/lib/remote/zone-instant-gate';
import {attachClipRecorder, detachClipRecorder} from '../src/lib/remote/clip-capture';

// Instant zone path: a face-up card that rests in a free zone is read from the zone cell and placed without a detector pass.
const W=320,H=180,tier:ZoneTier={name:'cpu4',idleIntervalMs:33,settleMs:120,budget:1,preRead:false,maxPreReads:0};
const calibration=createFieldCalibration([{x:.05,y:.05},{x:.95,y:.95}]);
const m3=zoneSpecsFromCalibration(calibration).find(s=>s.id==='M3')!.quad;
const box={x0:Math.min(...m3.map(p=>p.x))*W,x1:Math.max(...m3.map(p=>p.x))*W,y0:Math.min(...m3.map(p=>p.y))*H,y1:Math.max(...m3.map(p=>p.y))*H};
const front=(x:number,y:number)=>x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?[60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?(y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
const draw=(card:boolean,hand:boolean,sideways=false):RGBAImage=>{
  const data=new Uint8ClampedArray(W*H*4);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    let rgb=[30+(x*7+y*13)%9,30+(x*5+y*11)%9,36+(x*3+y*17)%9];
    const inside=x>box.x0+4&&x<box.x1-4&&y>box.y0+2&&y<box.y1-2;
    if(card&&sideways){const bw=box.x1-box.x0-8,bh=bw/1.45,cy=(box.y0+box.y1)/2;if(x>box.x0+4&&x<box.x1-4&&y>cy-bh/2&&y<cy+bh/2)rgb=[120+((x*37+y*91)%90),120+((x*53+y*17)%90),120+((x*11+y*71)%90)];}
    else if(card&&inside)rgb=front((x-box.x0-4)/(box.x1-box.x0-8),(y-box.y0-2)/(box.y1-box.y0-4));
    if(hand&&x>box.x0-10&&x<box.x1+10&&y>box.y0-10&&y<box.y1+10)rgb=[200,140,110];
    data.set([...rgb,255],(y*W+x)*4);
  }
  return {width:W,height:H,data};
};
const grayOf=(image:RGBAImage):GrayFrame=>{const data=new Uint8Array(W*H);for(let i=0;i<W*H;i++)data[i]=(image.data[i*4]*77+image.data[i*4+1]*150+image.data[i*4+2]*29)>>8;return {width:W,height:H,data};};
const cardCrop={width:96,height:140,data:(()=>{const d=new Uint8ClampedArray(96*140*4);for(let y=0;y<140;y++)for(let x=0;x<96;x++)d.set([...front(x/96,y/140),255],(y*96+x)*4);return d;})()};

const disposals:(()=>void)[]=[];
afterEach(()=>{for(const dispose of disposals.splice(0))dispose();});

function rig(instant=true,wrap=false) {
  const state={at:0,card:false,hand:false,sideways:false,reads:0,detects:0,priority:undefined as string|undefined,timing:undefined as {stagesMs:Record<string,number>;notes?:Record<string,string>}|undefined,events:[] as FieldEvent[]};
  const config:FieldWatcherOptions={
    profile:yugioh,calibration,now:()=>state.at,hidden:()=>false,clone:async f=>f,getPriors:()=>({decklist:['100']}),getKnownCards:()=>[],
    ...(instant?{zoneInstant:{tier,maxPerSecond:10}}:{}),
    buffer:{sample:async()=>({frame:draw(state.card,state.hand,state.sideways) as unknown as ImageData,at:state.at}),gray:()=>grayOf(draw(state.card,state.hand,state.sideways))},
    recognizer:{
      detectCards:async()=>{state.detects++;return [];},
      recognize:async(_frames,opts)=>{state.reads++;state.priority=opts?.priority;return {candidates:[{cardId:'100',score:.95}],tier:'sure' as const,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},identityEmbedding:{space:'art-box' as const,values:[1,0]},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:1},backend:'wasm' as const};},
    },
    analyze:()=>({crop:()=>cardCrop,motion:()=>0,sharpness:()=>20,appearance:()=>Array.from({length:12},(_,i)=>i%2?.6:.2),halo:()=>Array(192).fill(.45),occluded:()=>state.hand,touched:()=>state.hand?.3:0,skinNear:()=>state.hand?.2:0}),
  };
  // The real app wraps the buffer and recognizer in attachClipRecorder; the instant path must survive that wrapper.
  const watcher=createFieldWatcher(wrap?attachClipRecorder(config,{calibration:()=>calibration}):config);
  if(wrap)disposals.push(()=>detachClipRecorder());
  disposals.push(()=>watcher.dispose());
  watcher.subscribe(e=>{state.events.push(e);if(e.type==='placed')state.timing=watcher.getSnapshot().metrics.event;});
  // One camera frame every 33 ms into the zone watch, as the host loop does.
  const frames=(count:number)=>{for(let i=0;i<count;i++){state.at+=33;watcher.pushZoneFrame(grayOf(draw(state.card,state.hand,state.sideways)),state.at);}};
  const settle=async()=>{for(let i=0;i<20;i++)await new Promise(r=>setTimeout(r,0));};
  const tick=async(count:number,ms=100)=>{for(let i=0;i<count;i++){state.at+=ms;await watcher.tick();await settle();}};
  return {state,watcher,frames,settle,tick};
}

test('a face-up card that rests in a free zone is placed from the instant read, with no detector result',async()=>{
  const r=rig();
  r.frames(6);
  r.state.card=true;r.frames(8);
  await r.settle();
  expect(r.state.reads).toBe(1);
  expect(r.state.priority).toBe('high');
  await r.tick(6);
  const placed=r.state.events.find(e=>e.type==='placed');
  expect(placed?.track).toMatchObject({zone:'M3',cardId:'100',faceDown:false});
  expect(r.state.events.filter(e=>e.type==='placed')).toHaveLength(1);
  expect(r.state.reads).toBe(1);
  expect(r.watcher.zoneInstantStats()).toMatchObject({reads:1,delivered:1});
  // The timing log names the instant stages.
  const timing=r.state.timing;
  expect(timing?.notes?.source).toBe('instant-zone');
  expect(Object.keys(timing?.stagesMs??{})).toEqual(expect.arrayContaining(['zoneSettle','zoneSampled','zoneClassified','zoneRead','commit']));
});

test('without the instant path the same empty-detector scene places nothing',async()=>{
  const r=rig(false);
  r.state.card=true;
  await r.tick(12);
  expect(r.state.events.filter(e=>e.type==='placed')).toEqual([]);
});

test('a hand over the zone is not read and nothing is placed',async()=>{
  const r=rig();
  r.frames(6);
  r.state.card=true;r.state.hand=true;r.frames(8);
  await r.settle();
  await r.tick(6);
  expect(r.state.reads).toBe(0);
  expect(r.state.events.filter(e=>e.type==='placed')).toEqual([]);
});

test('the machine gate: on for a 4-core desktop, off for phones, low memory, few cores and the kill switch',()=>{
  const desktop={cores:4,userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'};
  expect(zoneInstantOption(pickZoneTier,'wasm',60,desktop)?.tier.name).toBe('cpu4');
  expect(zoneInstantOption(pickZoneTier,'webgpu',20,{...desktop,cores:8})?.tier.name).toBe('gpu');
  expect(zoneInstantOption(pickZoneTier,'wasm',60,{...desktop,cores:2})).toBeUndefined();
  expect(zoneInstantOption(pickZoneTier,'wasm',60,{...desktop,memoryGb:2})).toBeUndefined();
  expect(zoneInstantOption(pickZoneTier,'wasm',60,{cores:8,userAgent:'Mozilla/5.0 (Linux; Android 14) Mobile'})).toBeUndefined();
  process.env.NEXT_PUBLIC_REMOTE_ZONE_INSTANT='0';
  try{expect(zoneInstantOption(pickZoneTier,'wasm',60,desktop)).toBeUndefined();}finally{delete process.env.NEXT_PUBLIC_REMOTE_ZONE_INSTANT;}
});


test('the instant path is still created when the buffer goes through the clip recorder wrapper',async()=>{
  const r=rig(true,true);
  r.frames(6);
  r.state.card=true;r.frames(8);
  await r.settle();
  expect(r.state.reads).toBe(1);
  expect(r.watcher.zoneInstantStats()).toMatchObject({reads:1});
});

test('a card taken away between the read and the placing tick is not placed (textured mat)',async()=>{
  const r=rig();
  r.frames(6);
  r.state.card=true;r.frames(8);
  await r.settle();
  expect(r.state.reads).toBe(1);
  r.state.card=false;
  await r.tick(6);
  expect(r.state.events.filter(e=>e.type==='placed')).toEqual([]);
});

test('a sideways card never takes the instant path',async()=>{
  const r=rig();
  r.frames(6);
  r.state.card=true;r.state.sideways=true;r.frames(8);
  await r.settle();
  await r.tick(6);
  expect(r.state.reads).toBe(0);
  expect(r.state.events.filter(e=>e.type==='placed')).toEqual([]);
});
