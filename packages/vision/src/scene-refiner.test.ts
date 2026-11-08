import test from 'node:test';
import assert from 'node:assert/strict';
import { SceneRefiner } from './scene-refiner';
import type { DetectedCard } from './detector/detector';
const card=(x=0):DetectedCard=>({cx:20+x,cy:30,w:20,h:30,angle:0,conf:.9,kind:'face-up',scores:{'face-up':.9,'face-down':0},pts:[[10+x,15],[30+x,15],[30+x,45],[10+x,45]]});
const image={width:100,height:100,data:new Uint8ClampedArray(40000)};
const changedImage={...image,data:new Uint8ClampedArray(40000).fill(80)};
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

test('stationary boxes refit after 1.5 seconds without replacing a quad for small edge jitter',()=>{
 let at=0,calls=0;
 const refiner=new SceneRefiner(c=>{calls++;return c.pts.map(([x,y])=>({x:x+calls,y}));},()=>at);
 const pass=(img=image)=>{refiner.begin(100,100);return refiner.refine(card(),img);};
 const first=pass();at=1499;assert.strictEqual(pass(),first);assert.equal(calls,1);
 at=1500;assert.strictEqual(pass(),first);assert.equal(calls,2);
 at=1501;assert.strictEqual(pass(),first);assert.equal(calls,2);
 at=2999;pass();assert.equal(calls,2,'retaining a quad also refreshes the fit timestamp');
 at=3000;assert.strictEqual(pass(),first);assert.equal(calls,3);
});

test('every refitted corner must stay within three native pixels of the accepted quad',()=>{
 let at=0,dx=0,dy=0;
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y],i)=>({x:x+(i===2?dx:0),y:y+(i===2?dy:0)})),()=>at);
 const pass=(img=image)=>{refiner.begin(100,100);return refiner.refine(card(),img);};
 const first=pass();
 at=1500;dx=2;dy=2;assert.strictEqual(pass(),first,'diagonal jitter under three pixels is ignored');
 at=3000;dx=3;dy=0;assert.strictEqual(pass(),first,'three pixels is still jitter');
 at=4500;dx=3;dy=1;const changed=pass(changedImage);assert.notStrictEqual(changed,first,'one corner beyond three pixels replaces the quad when the pixels change');
 assert.deepEqual(changed[2],{x:33,y:46});
});

test('ignored fit jitter does not move the accepted quad anchor',()=>{
 let at=0,offset=0;
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y])=>({x:x+offset,y})),()=>at);
 const pass=(img=image)=>{refiner.begin(100,100);return refiner.refine(card(),img);};
 const first=pass();
 for(offset=1;offset<=3;offset++){at+=1500;assert.strictEqual(pass(),first);}
 at+=1500;const changed=pass(changedImage);assert.notStrictEqual(changed,first);
 assert.equal(changed[0].x,first[0].x+4,'slow cumulative fit drift eventually replaces the quad');
});

test('detector drift still replaces the fit even when its refined corners are close',()=>{
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y])=>({x,y})));
 const pass=(c:DetectedCard)=>{refiner.begin(100,100);return refiner.refine(c,image);};
 const first=pass(card());assert.strictEqual(pass(card(1)),first);
 const moved=pass(card(2));assert.notStrictEqual(moved,first);
 assert.equal(moved[0].x,12);
});

test('a rejected fit can recover on the next TTL refit',()=>{
 let at=0,rejected=true;
 const refiner=new SceneRefiner(c=>rejected?[]:c.pts.map(([x,y])=>({x,y})),()=>at);
 const pass=()=>{refiner.begin(100,100);return refiner.refine(card(),image);};
 assert.deepEqual(pass(),[]);
 at=1500;rejected=false;assert.equal(pass().length,4);
});

test('a rejected refit invalidates a previously accepted quad',()=>{
 let at=0,rejected=false;
 const refiner=new SceneRefiner(c=>rejected?[]:c.pts.map(([x,y])=>({x,y})),()=>at);
 const pass=()=>{refiner.begin(100,100);return refiner.refine(card(),image);};
 assert.equal(pass().length,4);
 at=1500;rejected=true;assert.deepEqual(pass(),[]);
});

test('large edge-fit jumps on unchanged pixels keep the accepted quad until the image changes',()=>{
 let at=0,offset=0,calls=0;
 const refiner=new SceneRefiner(c=>{calls++;return c.pts.map(([x,y])=>({x:x+offset,y}));},()=>at);
 const pass=(img=image)=>{refiner.begin(100,100);return refiner.refine(card(),img);};
 const first=pass();
 at=1500;offset=12;assert.strictEqual(pass(),first,'identical pixels cannot establish a new edge');
 at=3000;assert.strictEqual(pass({...image,data:new Uint8ClampedArray(40000).fill(3)}),first,'camera noise cannot establish a new edge');
 at=4500;assert.notStrictEqual(pass(changedImage),first,'changed pixels permit a genuinely changed fit');
 assert.equal(calls,4,'TTL refits still run even when their quads are retained');
});

test('pixel evidence uses native quad coordinates scaled to the detector image',()=>{
 let at=0,offset=0;
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y])=>({x:x+offset,y})),()=>at);
 const pass=(img=image)=>{refiner.begin(200,200);return refiner.refine(card(100),img);};
 const first=pass();at=1500;offset=12;assert.strictEqual(pass(),first);
 at=3000;assert.notStrictEqual(pass(changedImage),first);
});

test('ignored pixel noise does not move the accepted pixel anchor',()=>{
 let at=0,offset=0;
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y])=>({x:x+offset,y})),()=>at);
 const pass=(level:number)=>{refiner.begin(100,100);return refiner.refine(card(),{...image,data:new Uint8ClampedArray(40000).fill(level)});};
 const first=pass(0);offset=12;
 at=1500;assert.strictEqual(pass(2),first);
 at=3000;assert.strictEqual(pass(4),first);
 at=4500;assert.notStrictEqual(pass(6),first,'cumulative pixel drift permits the changed fit');
});

test('a real boundary change is accepted even when the card interior stays identical',()=>{
 let at=0,right=300;
 const large:DetectedCard={...card(),cx:200,cy:250,w:200,h:300,pts:[[100,100],[300,100],[300,400],[100,400]]};
 const refiner=new SceneRefiner(c=>c.pts.map(([x,y],i)=>({x:i===1||i===2?right:x,y})),()=>at);
 const pass=()=>{
  const data=new Uint8ClampedArray(400*500*4);
  for(let y=100;y<400;y++)for(let x=100;x<right;x++){const i=(y*400+x)*4;data[i]=data[i+1]=data[i+2]=240;}
  refiner.begin(400,500);return refiner.refine(large,{width:400,height:500,data});
 };
 const first=pass();at=1500;right=294;
 const changed=pass();assert.notStrictEqual(changed,first);
 assert.equal(changed[1].x,294,'interior sample points alone would miss this six-pixel edge movement');
});
