import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldPacer } from './field-pacer';
import { chooseWorkerLayout } from './client';
test('CPU pacing rests one pass between bursts and sustains twenty percent',()=>{
 const p=createFieldPacer({cores:8},0,()=> 'wasm');
 p.spend(100,100);assert.equal(p.check(199),'rest');assert.equal(p.check(200),'ready');
 let at=200,busy=100;
 for(;at<120_000;at+=10)if(p.check(at)==='ready'){at+=100;p.spend(100,at);busy+=100;}
 assert.ok(busy/at<=.225,`long-run duty ${busy/at}`);
 const slow=createFieldPacer({cores:2},0);
 slow.spend(2400,2400);slow.spend(2400,7200);
 assert.equal(slow.check(9600),'budget');
 slow.spend(2400,12_000,false,false);
 assert.equal(slow.duty(12_000),72);
 assert.equal(slow.gap(12_000),4800);
 assert.equal(slow.check(14_399),'rest');
 assert.equal(slow.check(14_400),'ready','a priority pass leaves no additional debt');
});
test('CPU worker layout cuts detector threads while preserving the read budget',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:8,deviceMemory:8,userAgent:'Chromium'}});
 try {assert.deepEqual(await chooseWorkerLayout('auto','wasm'),{split:true,threads:1,readThreads:4});}
 finally {if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator;}
});
test('a fresh hand waits briefly for landing, and repeated wake credits stay within twenty-five percent',()=>{
 const p=createFieldPacer({cores:8},0,()=> 'wasm');
 p.changed(100);assert.equal(p.check(100,true),'rest');assert.equal(p.check(500,true),'ready');
 let busy=0,at=500;
 for(;at<120_000;at+=10){if(at%2000===0)p.changed(at);if(p.check(at)==='ready'){at+=100;p.spend(100,at);busy+=100;}}
 assert.ok(busy/at<=.25,`duty with repeated wakes ${busy/at}`);
});
test('a zoom can spend only the tokens currently available and still counts toward duty',()=>{
 const p=createFieldPacer({cores:2},0);
 for(let i=0;i<4;i++){
  assert.equal(p.canSpendPriority(0),true);
  p.spendPriority(240,0);
 }
 assert.equal(p.priorityCost,240);
 assert.equal(p.canSpendPriority(0),false);
 assert.equal(p.duty(0),9.6);
 assert.equal(p.check(0),'ready','zooms leave the whole-frame budget available');
 p.spend(2500,0);
 assert.equal(p.canSpendPriority(680),false);
 assert.equal(p.canSpendPriority(690),true,'a low-end zoom refills in under a second');
 p.spendPriority(240,690);
 assert.equal(p.canSpendPriority(690),false);
});
test('slow detectors repay wake borrowing even when inference separates motion samples',()=>{
 for(const cost of [100,300,600,1200,2400]){
  const p=createFieldPacer({cores:8},0,()=> 'wasm');let at=0,busy=0;
  for(;at<1_200_000;at+=100){p.changed(at);if(p.check(at,true)==='ready'){at+=cost;p.spend(cost,at);busy+=cost;}}
  assert.ok(busy/at<=.21,`${cost} ms detector used ${busy/at}`);
 }
});

test('GPU and single-worker layouts preserve read thread counts',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 try {
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:8,deviceMemory:8,userAgent:'Chromium',gpu:{requestAdapter:async()=>({})}}});
  assert.deepEqual(await chooseWorkerLayout('auto','auto'),{split:true,threads:2});
  assert.deepEqual(await chooseWorkerLayout('split','auto'),{split:true,threads:2});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:4,userAgent:'Safari'}});
  assert.deepEqual(await chooseWorkerLayout('auto','wasm'),{split:false,threads:2});
 }finally {if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator;}
});

test('GPU still-board scans stay within 1.5 seconds with cards or an empty board',()=>{
 let backend='webgpu';const p=createFieldPacer({cores:8},0,()=>backend);
 for(const hasCards of [true,false]){
  assert.equal(p.stillEvery(20000,hasCards),1500);
  p.changed(20001);assert.ok(p.stillEvery(20002,hasCards)<=1500);
 }
 backend='wasm';assert.equal(p.stillEvery(40000,true),4000);assert.equal(p.stillEvery(40000,false),15000);
});
test('an urgent pass for a new resting card skips backoff and the moving rest, and normal passes resume soon after',()=>{
 const p=createFieldPacer({cores:8},0,()=> 'wasm');
 for(let i=0;i<60;i++)p.late(1000);
 p.changed(1000);p.spend(300,1000,true);
 assert.equal(p.check(1400,true,true),'rest');assert.equal(p.check(1400,false,true),'rest');
 assert.equal(p.check(1300,true,true,true),'ready');
 // Backoff ~4: the duty over a long run stays near the sustain rate (0.2 / 4 = 0.05, plus the initial bucket).
 let busy=0,at=1300;
 for(;at<120_000;at+=10)if(p.check(at,true,true,true)==='ready'){at+=300;p.spend(300,at,true);busy+=300;}
 assert.ok(busy/at<=.08,`urgent duty at backoff ${busy/at}`);
 // No backoff: an urgent burst may borrow one pass, and a normal pass is allowed again within 3 s.
 const q=createFieldPacer({cores:8},0,()=> 'wasm');
 q.spend(300,300,true);let t=300;
 for(let i=0;i<40&&t<10_000;i++,t+=10)if(q.check(t,false,true,true)==='ready'){t+=300;q.spend(300,t,true);}
 const burstEnd=t;while(q.check(t)!=='ready')t+=10;
 assert.ok(t-burstEnd<=3000,`normal pass waits ${t-burstEnd} ms after an urgent burst`);
});

test('urgent admission respects rest and borrows at most one pass',()=>{
 const p=createFieldPacer({cores:8},0);
 p.spend(2400,2400,true,'urgent');
 assert.equal(p.check(4799,false,true,true),'rest');
 assert.equal(p.check(4800,false,true,true),'ready');
 p.spend(2400,7200,true,'urgent');
 assert.equal(p.check(9600,false,true,true),'budget');
 assert.equal(p.check(14_000,false,true,true),'ready');

 const backedOff=createFieldPacer({cores:8},0);
 for(let i=0;i<60;i++)backedOff.late(1000);
 backedOff.spend(3000,3000,true,'urgent');
 assert.equal(backedOff.check(5999,false,true,true),'rest');
 assert.equal(backedOff.check(6000,false,true,true),'ready','an overrun during backoff leaves no debt');
 backedOff.spend(3000,9000,true,'urgent');
 assert.equal(backedOff.check(12_000,false,true,true),'ready','a positive balance admits another urgent pass');
 backedOff.spend(15_000,27_000,true);
 assert.equal(backedOff.check(33_600,false,true,true),'budget','backoff still blocks borrowing');
});
