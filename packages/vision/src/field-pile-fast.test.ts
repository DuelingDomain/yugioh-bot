import test from 'node:test';
import assert from 'node:assert/strict';
import {createFieldWatcher,type FieldEvent} from './field-watcher';
import {yugioh} from './games/yugioh';
import type {DetectedQuad,RecognitionResult} from './types';
import {createFieldCalibration,fieldMatPoint,fieldZoneCells} from './field-zones';

// A GY top is a log entry: it is read once at rest (no name vote),
// and a top covered by the next send before its read ended still becomes an entry.
function rig(tier:RecognitionResult['tier'],noCrop=false) {
  const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:1}]),width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const u=x/width,v=y/height;
    data.set([...(u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.7?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:[35,145,120]),255],(y*width+x)*4);
  }
  const frame:ImageData={width,height,data,colorSpace:'srgb'},events:FieldEvent[]=[];
  const gy=fieldZoneCells('normal',calibration.zoneSpacing,calibration.zones).find(cell=>cell.zone==='GY')!,m=fieldMatPoint({x:gy.x+gy.w/2,y:gy.y+gy.h/2},calibration),h=gy.h*.7,w=h*.43;
  const at=(dx:number):DetectedQuad=>({kind:'face-up',confidence:.9,partial:false,quad:[{x:m.x-w/2+dx,y:m.y-h/2},{x:m.x+w/2+dx,y:m.y-h/2},{x:m.x+w/2+dx,y:m.y+h/2},{x:m.x-w/2+dx,y:m.y+h/2}]});
  let now=0,outlines=[at(0)],look=.6,reads=0,gate:Promise<void>|undefined,id='A';
  const watcher=createFieldWatcher({profile:yugioh,calibration,now:()=>now,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame,at:now})},
    recognizer:{separateDetector:true,detectCards:async()=>structuredClone(outlines),recognize:async()=>{
      reads++;const wait=gate;await wait;
      return {identityEmbedding:{space:'art-box',values:[look,1-look]},candidates:[{cardId:id,score:tier==='sure'?.95:.6},{cardId:'RUNNER',score:.3}],tier,quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{}} as unknown as RecognitionResult;
    }},
    analyze:()=>({motion:()=>0,sharpness:()=>20,crop:()=>noCrop?undefined:frame,appearance:c=>Array(12).fill(c.quad[0].x>at(.01).quad[0].x?.2:look),halo:()=>Array(12).fill(.8),touched:()=>0,occluded:()=>false})});
  watcher.subscribe(e=>events.push(e));
  const tick=async(ms=100)=>{now+=ms;await watcher.tick();await new Promise<void>(r=>setImmediate(r));};
  return {watcher,events,tick,at,get now(){return now;},get reads(){return reads;},set outlines(v:DetectedQuad[]){outlines=v;},set look(v:number){look=v;},set gate(v:Promise<void>|undefined){gate=v;},set id(v:string){id=v;}};
}

test('a GY top whose face pixels are unknown is read after 100 ms, not the 600 ms face wait',async()=>{
  const r=rig('sure',true);
  try {
    for(let i=0;i<30&&!r.events.some(e=>e.type==='placed');i++)await r.tick();
    assert.ok(r.events.some(e=>e.type==='placed'&&e.track.zone==='GY'),'the GY top is placed');
    assert.ok(r.now<=400,`placed after ${r.now} ms`);
  } finally { r.watcher.dispose(); }
});

test('a GY top is read once at rest: no name-vote wait for a weak first read',async()=>{
  const r=rig('low match'),started=Date.now();let release!:()=>void;r.gate=new Promise<void>(resolve=>{release=resolve;});
  try {
    // The read starts as the card lands and ends once it rests.
    for(let i=0;i<3;i++)await r.tick();
    release();r.gate=undefined;
    for(let i=0;i<30&&!r.events.some(e=>e.type==='prompt');i++)await r.tick();
    const prompt=r.events.find(e=>e.type==='prompt');
    assert.ok(prompt,'the weak GY top still gets an entry');
    assert.equal(prompt.track.zone,'GY');
    assert.equal(r.reads,1,'one read, no vote re-read');
    // The field name vote waits 420 ms in real time before it asks again.
    assert.ok(Date.now()-started<300,`took ${Date.now()-started} ms`);
  } finally { r.watcher.dispose(); }
});

test('a GY top covered by the next send before its read ended still becomes an entry',async()=>{
  const r=rig('low match');let release!:()=>void;r.gate=new Promise<void>(resolve=>{release=resolve;});
  try {
    for(let i=0;i<6&&!r.reads;i++)await r.tick();
    assert.equal(r.reads,1,'the first top starts its read');
    const first=r.watcher.getSnapshot().tracks.find(t=>t.zone==='GY')!.id;
    // The next card lands on top while the first read is still running.
    r.look=.3;r.outlines=[r.at(.004)];
    for(let i=0;i<6;i++)await r.tick();
    release();r.gate=undefined;
    const ids=()=>new Set(r.events.filter(e=>e.type==='prompt'&&e.reason==='pile'&&e.track.zone==='GY').map(e=>e.track.id));
    for(let i=0;i<30&&ids().size<2;i++)await r.tick();
    assert.ok(ids().has(first),'the covered top gets its own entry');
    assert.equal(ids().size,2,'the new top is a second entry, not a rename of the first');
  } finally { r.watcher.dispose(); }
});
