import test from 'node:test';
import assert from 'node:assert/strict';
import { detectScene } from './detect-scene';
import { SceneRefiner } from './scene-refiner';
import { yugioh } from './games/yugioh';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
const image={width:320,height:192,data:new Uint8ClampedArray(320*192*4).fill(120)};
class Tensor {constructor(public type:unknown,public data:unknown,public dims:number[]) {}}
const profile={...yugioh,detector:{...yugioh.detector,longSide:320}};
function detector() {
 const sizes:number[][]=[];
 const session={backend:'wasm',run:async(feeds:Record<string,Tensor>)=>{
  const [, ,height,width]=feeds.image.dims;sizes.push([width,height]);const gw=width/4,gh=height/4,n=gw*gh;
  const heat=new Float32Array(n*2),box=new Float32Array(n*6);
  for(const [cx,conf] of [[.2,.9],[.5,.3],[.8,.22]]){const col=Math.floor(cx*gw),row=Math.floor(gh/2),i=row*gw+col;heat[i]=conf;box[2*n+i]=Math.log(width*.12/4);box[3*n+i]=Math.log(height*.5/4);box[5*n+i]=1;}
  return {heat:{dims:[1,2,gh,gw],data:heat},box:{dims:[1,6,gh,gw],data:box}};
 }} as unknown as ModelSession;
 return {session,sizes};
}
test('decode-floor rejects skip refinement while kept and pile outlines still refine',async()=>{
 let fits=0;const cache=new SceneRefiner(c=>{fits++;return c.pts.map(([x,y])=>({x,y}));});
 const {session}=detector();
 const quads=await detectScene(image,profile,session,Tensor as unknown as TensorCtor,{},cache);
 assert.equal(quads.length,1);assert.equal(fits,1);
 const keep=[[{x:.43,y:.2},{x:.57,y:.2},{x:.57,y:.8},{x:.43,y:.8}]];
 const piles=[[{x:.72,y:.2},{x:.88,y:.2},{x:.88,y:.8},{x:.72,y:.8}]];
 const held=await detectScene(image,profile,session,Tensor as unknown as TensorCtor,{keep,piles,shadowPass:false},cache);
 assert.equal(held.length,3);assert.equal(fits,3,'the strong outline reuses its fit');
 assert.equal(held[1].kept,true);assert.equal(held[2].pile,true);
});
test('shadow rescue detects only a padded crop of lost live outlines',async()=>{
 const {session,sizes}=detector();
 const dark={width:1280,height:768,data:new Uint8ClampedArray(1280*768*4).fill(35)},large={...profile,detector:{...profile.detector,longSide:960}};
 const lost=[[{x:.08,y:.05},{x:.18,y:.05},{x:.18,y:.3},{x:.08,y:.3}]];
 await detectScene(dark,large,session,Tensor as unknown as TensorCtor,{keep:lost});
 assert.equal(sizes.length,2);assert.ok(sizes[1][0]<=448&&sizes[1][1]<=448&&sizes[0][0]===960,JSON.stringify(sizes));
 const other=detector();
 await detectScene(dark,large,other.session,Tensor as unknown as TensorCtor,{keep:lost,shadowKeep:[]});
 assert.equal(other.sizes.length,1,'twin-only keep regions do not trigger shadow rescue');
});
test('a weak outline near a known card can refine across the hysteresis overlap threshold',async()=>{
 const {session}=detector();
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y])=>({x:x+(c.conf<.4?20:0),y})));
 const keep=[[{x:.515,y:.2},{x:.65,y:.2},{x:.65,y:.8},{x:.515,y:.8}]];
 const result=await detectScene(image,profile,session,Tensor as unknown as TensorCtor,{keep,shadowPass:false},refiner);
 assert.equal(result.length,2);assert.equal(result[1].kept,true);
});

test('far-apart shadow rescues retain at least half native resolution',async()=>{
 const {session,sizes}=detector();
 const dark={width:1920,height:1080,data:new Uint8ClampedArray(1920*1080*4).fill(35)};
 const keep=[.02,.85].map(x=>[{x,y:.02},{x:x+.1,y:.02},{x:x+.1,y:.16},{x,y:.16}]);
 const samples:{region:any;longSide:number}[]=[];
 await detectScene(dark,{...profile,detector:{...profile.detector,longSide:960}},session,Tensor as unknown as TensorCtor,{keep},undefined,{
  width:1920,height:1080,
  sample(region,longSide){samples.push({region,longSide});const w=Math.ceil(region!.w*1920),h=Math.ceil(region!.h*1080),scale=longSide/Math.max(w,h);return {width:Math.round(w*scale),height:Math.round(h*scale),data:new Uint8ClampedArray(Math.round(w*scale)*Math.round(h*scale)*4).fill(35)};},
  refine:c=>c.pts.map(([x,y])=>({x,y})),
 });
 assert.equal(samples.length,1,'one combined crop costs less than separate rescues');
 const crop=samples[0],native=Math.max(Math.ceil(crop.region.w*1920),Math.ceil(crop.region.h*1080));
 assert.ok(crop.longSide/native>=.5,`rescue scale ${crop.longSide/native}`);
 assert.ok(Math.max(...sizes[1])>=native*.5,'detector preserves the sampled rescue resolution');
});
test('diagonally separated shadow rescues choose cheaper individual crops',async()=>{
 const {session}=detector();
 const dark={width:1920,height:1080,data:new Uint8ClampedArray(1920*1080*4).fill(35)};
 const keep=[{x:.01,y:.01},{x:.92,y:.88}].map(({x,y})=>[{x,y},{x:x+.06,y},{x:x+.06,y:y+.1},{x,y:y+.1}]);
 const samples:{region:any;longSide:number}[]=[];
 await detectScene(dark,profile,session,Tensor as unknown as TensorCtor,{keep},undefined,{
  width:1920,height:1080,
  sample(region,longSide){samples.push({region,longSide});return {width:448,height:448,data:new Uint8ClampedArray(448*448*4).fill(35)};},
  refine:c=>c.pts.map(([x,y])=>({x,y})),
 });
 assert.equal(samples.length,2,'two small rescues cost less than a full-board rescue');
 assert.ok(samples.every(s=>s.longSide/Math.max(s.region.w*1920,s.region.h*1080)>=.5));
});
test('4K shadow rescue keeps the half-native floor above the 960-pixel full-pass scale',async()=>{
 const samples:number[]=[];
 const session={backend:'wasm',run:async(feeds:Record<string,Tensor>)=>{
  const [,,height,width]=feeds.image.dims,gw=width/4,gh=height/4;
  return {heat:{dims:[1,2,gh,gw],data:new Float32Array(gw*gh*2)},box:{dims:[1,6,gh,gw],data:new Float32Array(gw*gh*6)}};
 }} as unknown as ModelSession;
 const frame={width:960,height:540,data:new Uint8ClampedArray(960*540*4).fill(35)};
 await detectScene(frame,{...profile,detector:{...profile.detector,longSide:960}},session,Tensor as unknown as TensorCtor,{
  keep:[[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]],
 },undefined,{
  width:3840,height:2160,
  sample(_region,longSide){samples.push(longSide);return {...frame};},refine:()=>[],
 });
 assert.deepEqual(samples,[1920],'a full-board 4K rescue samples at half native resolution');
});
