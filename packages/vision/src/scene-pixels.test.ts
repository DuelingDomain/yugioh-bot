import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenePixels } from './scene-pixels';
import { createFieldAnalyzer, sameFieldAppearance } from './field-motion';

test('settled cells preserve an empty-mat before frame across a card arrival and departure',()=>{
 const analyze=createFieldAnalyzer(),width=160,height=160;
 const empty={width,height,colorSpace:'srgb' as const,data:new Uint8ClampedArray(width*height*4).fill(80)};
 const card={quad:[{x:.3,y:.3},{x:.5,y:.3},{x:.5,y:.6},{x:.3,y:.6}],kind:'face-up' as const,confidence:.95,partial:false};
 assert.equal(analyze(empty,0).settledAppearance?.(card),undefined,'unlearned pixels abstain');
 const before=analyze(empty,4100),baseline=before.appearance?.(card);
 assert.ok(sameFieldAppearance(baseline,before.settledAppearance?.(card)));
 const occupied={...empty,data:new Uint8ClampedArray(empty.data)};
 for(let y=48;y<96;y++)for(let x=48;x<80;x++)occupied.data.set([200,200,200,255],(y*width+x)*4);
 const after=analyze(occupied,4200);
 assert.equal(sameFieldAppearance(baseline,after.appearance?.(card)),false);
 assert.ok(sameFieldAppearance(baseline,after.settledAppearance?.(card)),'the newly occupied cells still carry the before frame');
 analyze(occupied,8500);
 assert.ok(sameFieldAppearance(baseline,before.appearance?.(card)),'the saved empty-mat frame does not turn into the resting card');
 assert.ok(sameFieldAppearance(baseline,analyze(empty,8600).appearance?.(card)),'the vacated box returns to the saved empty mat');
});
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
test('face sampling draws only the card rectangle and reads a 96 by 140 patch',async()=>{
 const {createFieldAnalyzer}=await import('./field-motion');
 const original=globalThis.OffscreenCanvas,draws:unknown[][]=[],reads:number[][]=[];
 class Canvas {
  constructor(public width:number,public height:number){}
  getContext(){return {drawImage:(...args:unknown[])=>draws.push(args),getImageData:(x:number,y:number,w:number,h:number)=>{reads.push([w,h]);return {width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(120)};}};}
 }
 globalThis.OffscreenCanvas=Canvas as unknown as typeof OffscreenCanvas;
 try{
  const frame={width:1920,height:1080,close(){}} as ImageBitmap;
  const analysis=createFieldAnalyzer()(frame),quad=[{x:.2,y:.3},{x:.3,y:.3},{x:.3,y:.5},{x:.2,y:.5}];
  assert.ok(analysis.crop?.({quad,kind:'face-up',confidence:.9,partial:false}));
  assert.deepEqual(reads.at(-1),[96,140]);assert.equal(draws.at(-1)?.[1],384);
  assert.ok(reads.every(([w,h])=>w<=320&&h<=180));
 }finally{globalThis.OffscreenCanvas=original;}
});

test('cards centered beyond each frame corner retain their visible outline',()=>{
 const original=globalThis.OffscreenCanvas;
 class Canvas {
  constructor(public width:number,public height:number){}
  getContext(){return {drawImage(){},getImageData:(_x:number,_y:number,w:number,h:number)=>({width:w,height:h,data:new Uint8ClampedArray(w*h*4).fill(120)})};}
 }
 globalThis.OffscreenCanvas=Canvas as unknown as typeof OffscreenCanvas;
 try{
  const pixels=new ScenePixels({width:1920,height:1080} as ImageBitmap);
  for(const cx of [-40,1960])for(const cy of [-50,1130]){
   const pts:[number,number][]=[[cx-60,cy-90],[cx+60,cy-90],[cx+60,cy+90],[cx-60,cy+90]];
   const result=pixels.refine({cx,cy,w:120,h:180,angle:0,conf:.9,kind:'face-up',scores:{'face-up':.9,'face-down':0},pts});
   assert.equal(result.length,4,`visible card at ${cx},${cy} survives`);
   assert.deepEqual(result,pts.map(([x,y])=>({x,y})));
  }
 }finally{globalThis.OffscreenCanvas=original;}
});
