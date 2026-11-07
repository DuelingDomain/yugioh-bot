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
test('CPU worker layout reserves one detector and two read threads',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{hardwareConcurrency:8,deviceMemory:8,userAgent:'Chromium'}});
 try {assert.deepEqual(await chooseWorkerLayout('auto','wasm'),{split:true,threads:1,readThreads:2});}
 finally {if(original)Object.defineProperty(globalThis,'navigator',original);else delete (globalThis as any).navigator;}
});
