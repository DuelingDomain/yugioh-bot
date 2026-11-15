import {afterEach, expect, test} from 'vitest';
import {createFieldWatcher, type FieldEvent, type FieldWatcherOptions} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad, RecognitionResult} from '../../vision/src/types';
import {quadIou} from '../../vision/src/field-zones';

const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,
  quad:[{x:.3,y:.3},{x:.45,y:.3},{x:.45,y:.55},{x:.3,y:.55}]};
const look=Array.from({length:288},(_,i)=>i%2?.6:.2);
const disposals:(()=>void)[]=[];
afterEach(()=>{for(const dispose of disposals.splice(0))dispose();});

async function field(recognize:FieldWatcherOptions['recognizer']['recognize']=async()=>{throw new Error('An acknowledged card needs no read');}) {
  let at=0;
  const input:{outlines:DetectedQuad[];pixels:number[];hand:boolean;near?:number;handCard?:DetectedQuad;cardAt?:DetectedQuad;cardPixels?:number[];movingShadow:boolean;sharpness:number;cropSharpness:number}={outlines:[card],pixels:look,hand:false,movingShadow:false,sharpness:100,cropSharpness:20};
  const events:FieldEvent[]=[];
  const watcher=createFieldWatcher({
    profile:yugioh,now:()=>at,hidden:()=>false,
    getKnownCards:()=>[{id:'source',card,zone:'M2',cardId:'A',faceDown:false,position:'attack'}],
    recognizer:{detectCards:async()=>structuredClone(input.outlines),recognize},
    buffer:{sample:async()=>({at,frame:{width:100,height:100,colorSpace:'srgb',data:new Uint8ClampedArray(40_000)}})},
    analyze:()=>({frameSharpness:input.sharpness,shadow:{share:input.movingShadow?.2:0,changed:input.movingShadow?.1:0},
      motion:()=>0,sharpness:()=>input.cropSharpness,appearance:q=>input.cardAt&&quadIou(q,input.cardAt)>.5?input.cardPixels??look:input.pixels,halo:()=>Array(192).fill(.2),
      occluded:q=>input.hand||!!input.handCard&&quadIou(q,input.handCard)>.5,touched:q=>input.hand||input.handCard&&quadIou(q,input.handCard)>.5?.3:0,skinNear:()=>input.near??0}),
    clone:async frame=>frame,
  });
  disposals.push(()=>watcher.dispose());
  watcher.subscribe(event=>events.push(event));
  async function scan(ms=300){at+=ms;await watcher.tick();}
  for(let i=0;i<5;i++)await scan();
  expect(watcher.getSnapshot().tracks.find(t=>t.id==='source')).toMatchObject({state:'identified',removed:false});
  return {input,events,watcher,scan,depart:()=>{input.outlines=[];input.pixels=Array(288).fill(.2);}};
}

test('a lifted card clears after sharp scans even while its shadow keeps moving',async()=>{
  const r=await field();r.depart();r.input.movingShadow=true;
  for(let i=0;i<7;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
  expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='source')?.removed).toBe(true);
});

test('three separate sharp scans judge an empty source despite a moving shadow',async()=>{
  const r=await field();r.depart();r.input.movingShadow=true;
  for(let i=0;i<3;i++)await r.scan(400);
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a hand beside a changed source does not cover the source',async()=>{
  const r=await field();r.depart();r.input.near=.2;
  r.input.pixels=Array.from({length:288},(_,i)=>(i%7)/7);
  for(let i=0;i<5;i++)await r.scan(400);
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a hand covering a card for 1.5 seconds keeps its ref without removal or placement',async()=>{
  const r=await field();r.depart();r.input.hand=true;r.input.movingShadow=true;
  for(let i=0;i<5;i++)await r.scan();
  r.input.hand=false;r.input.movingShadow=false;r.input.outlines=[card];r.input.pixels=look;
  for(let i=0;i<6;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'||e.type==='placed')).toEqual([]);
  expect(r.watcher.getSnapshot().tracks.filter(t=>!t.removed).map(t=>t.id)).toEqual(['source']);
});

test('blurred frames alone never remove an acknowledged card',async()=>{
  const r=await field();r.depart();r.input.sharpness=20;
  for(let i=0;i<30;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='source')?.removed).toBe(false);
});

test('a stale card clears after the hold limit once sharp scans show mat',async()=>{
  const r=await field();r.depart();r.input.sharpness=1;r.input.movingShadow=true;
  for(let i=0;i<10;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  r.input.sharpness=100;
  for(let i=0;i<7;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a shadow over the unchanged card cannot expire its identity',async()=>{
  const r=await field();r.input.outlines=[];r.input.movingShadow=true;
  for(let i=0;i<20;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'||e.type==='placed')).toEqual([]);
  expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='source')?.removed).toBe(false);
});

test('a hand that outlasts the shadow limit still protects the covered card',async()=>{
  const r=await field();r.depart();r.input.hand=true;r.input.movingShadow=true;
  for(let i=0;i<15;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  r.input.hand=false;r.input.outlines=[card];r.input.pixels=look;
  for(let i=0;i<6;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'||e.type==='placed')).toEqual([]);
});

test('blur interrupts clear scans instead of completing their removal window',async()=>{
  const r=await field();r.depart();r.input.movingShadow=true;
  for(let i=0;i<2;i++)await r.scan();
  r.input.sharpness=20;
  for(let i=0;i<20;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  r.input.sharpness=100;
  for(let i=0;i<2;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  for(let i=0;i<7;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('sharp full scans clear a changed textured spot after the shadow limit',async()=>{
  const r=await field();r.depart();r.input.movingShadow=true;
  // The old card is gone, but this is not uniform mat: use detector absence.
  r.input.pixels=Array.from({length:288},(_,i)=>(i%7)/7);
  for(let i=0;i<12;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a sharp unchanged card validates a new exposure before its later departure',async()=>{
  const r=await field();r.input.sharpness=20;
  // Whole-scene contrast fell, but the card still has sharp, unchanged detail.
  for(let i=0;i<8;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  r.depart();r.input.movingShadow=true;
  for(let i=0;i<8;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('unchanged coarse colour without sharp detail cannot validate focus',async()=>{
  const r=await field();r.input.sharpness=20;r.input.cropSharpness=2;
  for(let i=0;i<8;i++)await r.scan();
  r.depart();r.input.movingShadow=true;
  for(let i=0;i<15;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
});

test('a weak box following a pickup does not move the source removal check onto a hand',async()=>{
  const r=await field();
  const shift=(p:DetectedQuad['quad'][number])=>({x:p.x,y:p.y+.14});
  const pickup:DetectedQuad={...card,confidence:.4,quad:[shift(card.quad[0]),shift(card.quad[1]),shift(card.quad[2]),shift(card.quad[3])]};
  r.input.outlines=[pickup];r.input.cardAt=pickup;r.input.handCard=pickup;
  await r.scan();
  r.depart();r.input.cardAt=undefined;r.input.sharpness=20;
  for(let i=0;i<12;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  r.input.sharpness=100;
  for(let i=0;i<8;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test.each([0,.2])('a strong pickup outline cannot carry the source spot into the hand (nearby skin %s)',async near=>{
  const r=await field();
  const pickup:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x,y:p.y+.14}))};
  r.input.outlines=[pickup];r.input.cardAt=pickup;r.input.handCard=pickup;
  r.input.pixels=Array(288).fill(.2);r.input.near=near;
  for(let i=0;i<6;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
  expect(r.events.filter(e=>e.type==='placed')).toEqual([]);
});

test('losing the lifted outline still judges its published source rather than the hand',async()=>{
  const r=await field();
  const pickup:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x,y:p.y+.14}))};
  r.input.outlines=[pickup];r.input.cardAt=pickup;r.input.handCard=pickup;
  r.input.pixels=Array(288).fill(.2);await r.scan(400);
  r.input.outlines=[];
  for(let i=0;i<6;i++)await r.scan(400);
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test.each(['hand','blur'] as const)('a brief %s between detector passes interrupts source clearance',async interruption=>{
  const r=await field();
  const pickup:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x,y:p.y+.14}))};
  r.input.outlines=[pickup];r.input.cardAt=pickup;r.input.handCard=pickup;
  r.input.pixels=Array(288).fill(.2);
  for(let i=0;i<2;i++)await r.scan(400);
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  if(interruption==='hand')r.input.hand=true;else r.input.sharpness=20;
  await r.scan(100);
  r.input.hand=false;r.input.sharpness=100;
  for(let i=0;i<2;i++)await r.scan(600);
  expect(r.events.filter(e=>e.type==='removed')).toEqual([]);
  for(let i=0;i<4;i++)await r.scan(400);
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a neighbouring different card cannot inherit the source identity during a shadow',async()=>{
  const r=await field();
  const neighbour:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x-.13,y:p.y}))};
  r.input.outlines=[neighbour];r.input.cardAt=neighbour;
  r.input.cardPixels=Array.from({length:288},(_,i)=>i%3?.1:.9);
  r.input.pixels=Array(288).fill(.2);r.input.movingShadow=true;
  for(let i=0;i<10;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='moved'&&e.track.id==='source')).toEqual([]);
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test('a known card returning to its own spot after a long pickup retains its ref',async()=>{
  const r=await field();r.depart();
  for(let i=0;i<18;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed')).toHaveLength(1);
  r.input.outlines=[card];r.input.pixels=look;
  for(let i=0;i<6;i++)await r.scan();
  expect(r.watcher.getSnapshot().tracks.filter(t=>!t.removed).map(t=>t.id)).toEqual(['source']);
  expect(r.events.filter(e=>e.type==='placed'||e.type==='prompt')).toEqual([]);
});

test('a long absence does not let a different card inherit the returning source ref',async()=>{
  const r=await field();r.depart();
  for(let i=0;i<18;i++)await r.scan();
  r.input.outlines=[card];r.input.pixels=Array.from({length:288},(_,i)=>i%3?.1:.9);
  for(let i=0;i<6;i++)await r.scan();
  expect(r.watcher.getSnapshot().tracks.find(t=>t.id==='source')?.removed).toBe(true);
  expect(r.events.filter(e=>e.type==='moved'&&e.track.id==='source')).toEqual([]);
});

test('a different card at the source does not hide a pickup into the hand',async()=>{
  const r=await field();
  const pickup:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x,y:p.y+.14}))};
  r.input.outlines=[card,pickup];r.input.cardAt=pickup;r.input.handCard=pickup;
  r.input.pixels=Array.from({length:288},(_,i)=>i%3?.1:.9);
  for(let i=0;i<8;i++)await r.scan();
  expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(1);
});

test.each([false,true])('an empty source waits only for a possible same-card read (same appearance %s)',async same=>{
  let finish:((result:RecognitionResult)=>void)|undefined;
  const r=await field(async()=>new Promise<RecognitionResult>(resolve=>{finish=resolve;}));
  try {
    const other:DetectedQuad={...card,quad:card.quad.map(p=>({x:p.x+.4,y:p.y}))};
    r.input.outlines=[card,other];r.input.cardAt=other;
    r.input.cardPixels=same?look:Array.from({length:288},(_,i)=>i%3?.1:.9);
    for(let i=0;i<12&&!finish;i++)await r.scan();
    expect(finish).toBeDefined();
    r.depart();
    for(let i=0;i<4;i++)await r.scan();
    expect(r.events.filter(e=>e.type==='removed'&&e.track.id==='source')).toHaveLength(same?0:1);
  } finally {
    r.watcher.dispose();
    finish?.({candidates:[{cardId:'other',score:.95}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:0},backend:'wasm'});
  }
});
