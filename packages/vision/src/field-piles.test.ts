import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldWatcher } from './field-watcher';
import { yugioh } from './games/yugioh';
import type { DetectedQuad, RecognitionResult } from './types';

test('cached identity settlement preserves deck observations until a real detector scan clears them', async () => {
  const quad = (x:number,y:number,down=false):DetectedQuad => ({kind:down?'face-down':'face-up',confidence:.95,partial:false,quad:[{x,y},{x:x+.06,y},{x:x+.06,y:y+.12},{x,y:y+.12}]});
  const deck=quad(.9,.7,true), front=quad(.3,.3);
  const width=120,height=176,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const u=x/width,v=y/height;
    const rgb=u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.70?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.10&&u<.90&&v>.76&&v<.92?v%.035<.012?[65,55,45]:[220,210,180]:[35,145,120];
    data.set([...rgb,255],(y*width+x)*4);
  }
  const face={width,height,data},back={width,height,data:new Uint8ClampedArray(data.length).fill(240)};
  let at=0,detects=0,reads=0,motion=0,outlines=[deck];
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame:face as ImageData,at})},
    recognizer:{detectCards:async()=>{detects++;return structuredClone(outlines);},recognize:async()=>{reads++;return {candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{total:1},backend:'wasm'} as RecognitionResult;}},
    analyze:()=>({motion:()=>motion,sharpness:()=>20,appearance:()=>Array(12).fill(.2),crop:c=>c.kind==='face-down'?back:face}),
  });
  const tick=async()=>{at+=100;await watcher.tick();await Promise.resolve();};
  try {
    for(let i=0;i<5;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1);
    outlines=[deck,front];
    for(let i=0;i<10&&!reads;i++)await tick();
    assert.equal(reads,1);
    const before=detects;
    await tick();
    assert.equal(detects,before,'the completed read uses cached outlines');
    assert.equal(watcher.getSnapshot().piles?.length,1,'cached field outlines cannot prove deck absence');
    motion=.3;for(let i=0;i<10;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1,'a one-second hand cover retains the verified deck');motion=0;
    outlines=[];
    for(let i=0;i<35;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,0,'detector absence clears a deck after its three-second grace period');
    assert.equal(watcher.getSnapshot().metrics.errors,0);
  } finally { watcher.dispose(); }
});
