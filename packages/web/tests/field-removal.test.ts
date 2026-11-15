import {afterEach, expect, test} from 'vitest';
import {createFieldWatcher, type FieldEvent} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad} from '../../vision/src/types';
import {quadIou} from '../../vision/src/field-zones';

const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,
  quad:[{x:.3,y:.3},{x:.45,y:.3},{x:.45,y:.55},{x:.3,y:.55}]};
const look=Array.from({length:288},(_,i)=>i%2?.6:.2);
const disposals:(()=>void)[]=[];
afterEach(()=>{for(const dispose of disposals.splice(0))dispose();});

async function field() {
  let at=0;
  const input:{outlines:DetectedQuad[];pixels:number[];hand:boolean;handCard?:DetectedQuad;cardAt?:DetectedQuad;movingShadow:boolean;sharpness:number;cropSharpness:number}={outlines:[card],pixels:look,hand:false,movingShadow:false,sharpness:100,cropSharpness:20};
  const events:FieldEvent[]=[];
  const watcher=createFieldWatcher({
    profile:yugioh,now:()=>at,hidden:()=>false,
    getKnownCards:()=>[{id:'source',card,zone:'M2',cardId:'A',faceDown:false,position:'attack'}],
    recognizer:{detectCards:async()=>structuredClone(input.outlines),recognize:async()=>{throw new Error('An acknowledged card needs no read');}},
    buffer:{sample:async()=>({at,frame:{width:100,height:100,colorSpace:'srgb',data:new Uint8ClampedArray(40_000)}})},
    analyze:()=>({frameSharpness:input.sharpness,shadow:{share:input.movingShadow?.2:0,changed:input.movingShadow?.1:0},
      motion:()=>0,sharpness:()=>input.cropSharpness,appearance:q=>input.cardAt&&quadIou(q,input.cardAt)>.5?look:input.pixels,halo:()=>Array(192).fill(.2),
      occluded:q=>input.hand||!!input.handCard&&quadIou(q,input.handCard)>.5,touched:q=>input.hand||input.handCard&&quadIou(q,input.handCard)>.5?.3:0}),
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
