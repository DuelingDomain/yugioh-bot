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
