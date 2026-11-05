import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldWatcher } from './field-watcher';
import { yugioh } from './games/yugioh';
import type { DetectedQuad, DetectOptions, RecognitionResult } from './types';
import { createFieldCalibration, fieldMatPoint, fieldZoneCells } from './field-zones';

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
  let at=0,detects=0,reads=0,motion=0,outlines=[deck],deckLook=Array(12).fill(.2);
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame:face as ImageData,at})},
    recognizer:{detectCards:async()=>{detects++;return structuredClone(outlines);},recognize:async()=>{reads++;return {candidates:[{cardId:'A',score:.95}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{total:1},backend:'wasm'} as RecognitionResult;}},
    analyze:()=>({motion:()=>motion,sharpness:()=>20,appearance:c=>c.quad[0].x===deck.quad[0].x?deckLook:Array(12).fill(.2),crop:c=>c.kind==='face-down'?back:face}),
  });
  const tick=async()=>{at+=100;await watcher.tick();await Promise.resolve();};
  try {
    for(let i=0;i<5;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1);
    outlines=[{...deck,quad:deck.quad.map(p=>({x:.94+(p.x-.9)/3,y:.74+(p.y-.7)/3}))},deck,front];
    for(let i=0;i<10&&!reads;i++)await tick();
    assert.equal(reads,1);
    assert.deepEqual(watcher.getSnapshot().piles?.[0].card.quad,deck.quad,'the largest deck outline owns the pile');
    const before=detects;
    await tick();
    assert.equal(detects,before,'the completed read uses cached outlines');
    assert.equal(watcher.getSnapshot().piles?.length,1,'cached field outlines cannot prove deck absence');
    motion=.3;for(let i=0;i<10;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1,'a one-second hand cover retains the verified deck');motion=0;
    // Owner: the Deck vanished from the board while an arm passed and the detector gave it no box. Its unchanged
    // spot keeps it; only a changed spot for five seconds (or Scan field) takes it off.
    outlines=[];
    for(let i=0;i<60;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1,'no box, but the spot still shows the deck: it stays');
    deckLook=Array(12).fill(.7);
    for(let i=0;i<45;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,1,'a changed spot is not yet gone');
    for(let i=0;i<10;i++)await tick();
    assert.equal(watcher.getSnapshot().piles?.length,0,'a changed spot with no box for five seconds clears the deck');
    assert.equal(watcher.getSnapshot().metrics.errors,0);
  } finally { watcher.dispose(); }
});

test('a low-score Extra Deck stack in its calibrated cell is a pile; an empty mat cell with the same score is not', async () => {
  // Owner on :3000: light-sleeve Deck found (.66), pink-sleeve Extra Deck on a dark mat gets no box (score under .4).
  const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:1}]);
  const width=320,height=176;
  // A card-shaped stack (59:86 in pixels) centred in the zone cell.
  const cellQuad=(zone:string)=>{const c=fieldZoneCells('normal',calibration.zoneSpacing,calibration.zones).find(cell=>cell.zone===zone)!,m=fieldMatPoint({x:c.x+c.w/2,y:c.y+c.h/2},calibration),h=c.h*.7,w=h*height/width*59/86;
    return [{x:m.x-w/2,y:m.y-h/2},{x:m.x+w/2,y:m.y-h/2},{x:m.x+w/2,y:m.y+h/2},{x:m.x-w/2,y:m.y+h/2}];};
  const extra:DetectedQuad={kind:'face-down',confidence:.3,partial:false,kept:true,pile:true,quad:cellQuad('EXTRA')};
  // Owner 2026-11-04: an empty dark Extra cell became a pile. Here the Deck cell is empty mat with a .3 outline.
  const deckProbe:DetectedQuad={kind:'face-down',confidence:.3,partial:false,kept:true,pile:true,quad:cellQuad('DECK')};
  const back={width,height,data:new Uint8ClampedArray(width*height*4).fill(240)};
  let at=0,asked:DetectOptions|undefined;
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame:back as ImageData,at})},
    recognizer:{detectCards:async(_f,opts)=>{asked=opts;return structuredClone([extra,deckProbe]);},recognize:async()=>{throw new Error('piles are never read');}},
    analyze:()=>({motion:()=>0,sharpness:()=>20,crop:()=>back,halo:()=>Array(96).fill([.12,.14,.16]).flat(),
      appearance:c=>Array(96).fill(c.quad[0].x===extra.quad[0].x?[.85,.45,.6]:[.13,.14,.15]).flat()}),
  });
  watcher.setCalibration(calibration);
  try {
    for(let i=0;i<8;i++){at+=100;await watcher.tick();await Promise.resolve();}
    assert.equal(asked?.piles?.length,2,'the detector is given the Deck and Extra cells');
    const snapshot=watcher.getSnapshot();
    assert.deepEqual(snapshot.piles?.map(p=>p.zone),['EXTRA'],'the .3 pink Extra stack is a pile; the .3 outline on empty mat is not');
    assert.deepEqual(snapshot.debug?.pileScores,{DECK:.3,EXTRA:.3});
    assert.equal(snapshot.metrics.errors,0);
  } finally { watcher.dispose(); }
});
