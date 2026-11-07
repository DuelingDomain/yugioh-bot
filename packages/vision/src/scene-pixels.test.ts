import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenePixels } from './scene-pixels';
test('bitmap scene copies detector-sized pixels and only native refinement subrectangles',()=>{
 const original=globalThis.OffscreenCanvas,reads:number[][]=[],draws:unknown[][]=[];
 class Canvas {
  constructor(public width:number,public height:number){}
  getContext(){return {drawImage:(...args:unknown[])=>draws.push(args),getImageData:(x:number,y:number,w:number,h:number)=>{reads.push([w,h]);return {width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(120)};}};}
 }
 globalThis.OffscreenCanvas=Canvas as unknown as typeof OffscreenCanvas;
 try{
  const pixels=new ScenePixels({width:1920,height:1080} as ImageBitmap);
  assert.deepEqual([pixels.sample(undefined,960).width,pixels.sample(undefined,960).height],[960,540]);
  const region={x:.2,y:.3,w:.1,h:.2};const crop=pixels.sample(region,448);
  assert.ok(Math.max(crop.width,crop.height)<=448);assert.equal(draws.at(-1)?.[1],384);
  pixels.refine({cx:500,cy:500,w:120,h:180,angle:0,conf:.9,kind:'face-up',scores:{'face-up':.9,'face-down':0},pts:[[440,410],[560,410],[560,590],[440,590]]});
  assert.ok(reads.every(([w,h])=>w*h<1920*1080/3),JSON.stringify(reads));
 }finally{globalThis.OffscreenCanvas=original;}
});
