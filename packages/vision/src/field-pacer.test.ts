import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldPacer } from './field-pacer';
import { chooseWorkerLayout } from './client';
test('CPU pacing rests one pass between bursts and sustains twenty percent',()=>{
 const p=createFieldPacer({cores:8},0,()=> 'wasm');
 p.spend(100,100);assert.equal(p.allow(199),false);assert.equal(p.allow(200),true);
 let at=200,busy=100;
 for(;at<120_000;at+=10)if(p.allow(at)){at+=100;p.spend(100,at);busy+=100;}
 assert.ok(busy/at<=.225,`long-run duty ${busy/at}`);
});
test('CPU worker layout cuts detector threads while preserving the read budget',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:8,deviceMemory:8,userAgent:'Chromium'}});
 try {assert.deepEqual(await chooseWorkerLayout('auto','wasm'),{split:true,threads:1,readThreads:4});}
 finally {if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator;}
});
test('a fresh hand waits briefly for landing, and repeated wake credits stay within twenty-five percent',()=>{
 const p=createFieldPacer({cores:8},0,()=> 'wasm');
 p.changed(100);assert.equal(p.allow(100,true),false);assert.equal(p.allow(500,true),true);
 let busy=0,at=500;
 for(;at<120_000;at+=10){if(at%2000===0)p.changed(at);if(p.allow(at)){at+=100;p.spend(100,at);busy+=100;}}
 assert.ok(busy/at<=.25,`duty with repeated wakes ${busy/at}`);
});
test('slow detectors repay wake borrowing even when inference separates motion samples',()=>{
 for(const cost of [100,300,600,1200,2400]){
  const p=createFieldPacer({cores:8},0,()=> 'wasm');let at=0,busy=0;
  for(;at<1_200_000;at+=100){p.changed(at);if(p.allow(at,true)){at+=cost;p.spend(cost,at);busy+=cost;}}
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
