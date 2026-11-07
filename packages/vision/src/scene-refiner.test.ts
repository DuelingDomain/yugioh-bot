import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRefiner } from './scene-refiner';
import type { DetectedCard } from './detector/detector';
const card=(x=0):DetectedCard=>({cx:20+x,cy:30,w:20,h:30,angle:0,conf:.9,kind:'face-up',scores:{'face-up':.9,'face-down':0},pts:[[10+x,15],[30+x,15],[30+x,45],[10+x,45]]});
const image={width:100,height:100,data:new Uint8ClampedArray(40000)};
test('refinement reuse is bounded by two native pixels, kind, dimensions and the last pass',()=>{
  let calls=0;
  const refiner=new SceneRefiner((c)=>{calls++;return c.pts.map(([x,y])=>({x,y}));});
  const pass=(c:DetectedCard,img=image)=>{refiner.begin(img.width,img.height);return refiner.refine(c,img);};
  const first=pass(card());assert.deepEqual(pass(card(1)),first);assert.equal(calls,1);
  pass(card(2));assert.equal(calls,2,'compare with the original box, so slow drift refines');
  pass({...card(2),kind:'face-down'});assert.equal(calls,3);
  pass(card(2),{...image,width:200});assert.equal(calls,4);
  refiner.begin(100,100);refiner.begin(100,100);pass(card(2));assert.equal(calls,5,'a missing detection expires');
});

test('stationary boxes refit after 1.5 seconds even while the detector stays identical',()=>{
 let at=0,calls=0;
 const refiner=new SceneRefiner(c=>{calls++;return c.pts.map(([x,y])=>({x:x+calls,y}));},()=>at);
 const pass=()=>{refiner.begin(100,100);return refiner.refine(card(),image);};
 const first=pass();at=1499;assert.deepEqual(pass(),first);assert.equal(calls,1);
 at=1500;assert.notDeepEqual(pass(),first);assert.equal(calls,2);
 at=1501;pass();assert.equal(calls,2);
});
