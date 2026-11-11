import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldWatcher } from './field-watcher';
import { yugioh } from './games/yugioh';
import type { DetectedQuad, RecognitionResult } from './types';
import { createClipRecorder } from './clip-recorder';
import { parseClip } from './clip-format';
import { createFieldCalibration, mapFieldZone } from './field-zones';
import { draftTruth, gateAgainstBaseline, replayClip, scoreReplay, formatMetricsTable } from './clip-replay';

// One synthetic 6 s session: a calibrated mat seen by a wider camera, an empty board, then one card placed and read as A.
// The recorder saves frames cropped to the mat as a .ddclip; the replay feeds them through a fresh watcher with the
// recorded reads (rebased into the crop) and scores against the draft labels.
test('a saved clip replays deterministically through the field watcher and scores against its labels', async () => {
  const quad = (x:number,y:number):DetectedQuad => ({kind:'face-up',confidence:.95,partial:false,quad:[{x,y},{x:x+.06,y},{x:x+.06,y:y+.12},{x,y:y+.12}]});
  const width=120,height=176,data=new Uint8ClampedArray(width*height*4);
  // A card-like picture (dark border, art, text lines): the face-state check reads it as a front.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=x/width,v=y/height;const rgb=u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.70?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.10&&u<.90&&v>.76&&v<.92?v%.035<.012?[65,55,45]:[220,210,180]:[35,145,120];data.set([...rgb,255],(y*width+x)*4);}
  const face={width,height,data};
  const analyze=()=>({motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2),crop:()=>face});
  // Each live read takes 40 ms of test clock, so the clip records a read time.
  const read=():RecognitionResult=>({candidates:[{cardId:'A',score:.95},{cardId:'B',score:.3}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:2,selectedFrameIndices:[0],sharpness:20,fallback:false,searchSource:'deck'},timingsMs:{total:40,sharpness:1,detect:0,warp:2,embed:30,search:1,embedCount:2},backend:'wasm'} as RecognitionResult);
  let at=0,outlines:DetectedQuad[]=[];
  // The mat fills the middle of the camera picture; saved frames are cropped to it (camera fractions .25-.75).
  const calibration=createFieldCalibration([{x:.3,y:.3},{x:.7,y:.7}]), crop={x:.25,y:.25,w:.5,h:.5};
  const recorder=createClipRecorder({now:()=>at,windowMs:30_000,frameGapMs:200,encode:async frame=>({bytes:new Uint8Array((frame as ImageData).data.buffer.slice(0)),width,height,camera:{width,height},crop})});
  recorder.setContext({decklist:['A','B'],backend:'wasm',seat:0}); recorder.setCalibration(calibration);
  const live=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,analyze,calibration,
    ...recorder.wrap({buffer:{sample:async()=>({frame:face as ImageData,at})},recognizer:{detectCards:async()=>structuredClone(outlines),recognize:async()=>{at+=40;return read();}}})});
  const liveEvents:string[]=[]; let liveZone='';
  live.subscribe(event=>{liveEvents.push(`${event.type}:${event.track.cardId??''}`);if(event.type==='placed')liveZone=event.track.zone;recorder.onEvent(event);});
  // One card in camera coordinates, inside the mat, left of the middle; cropped it sits elsewhere in the picture.
  const placed=quad(.36,.56);
  try {
    for(let i=0;i<60;i++){at+=100;await live.tick();await Promise.resolve();if(i===10)outlines=[placed];}
  } finally { live.dispose(); }
  assert.ok(liveEvents.some(e=>e==='placed:A'),`live watcher placed A: ${liveEvents.join(' ')}`);
  const bytes=recorder.save();
  const stats=recorder.stats();
  assert.ok(stats.frames>=25&&stats.frames<=31,`5 fps ring kept ${stats.frames} frames`);
  const bundle=parseClip(bytes);
  assert.equal(bundle.frames.length,stats.frames);
  assert.ok(bundle.events.some(e=>e.kind==='read')&&bundle.events.some(e=>e.kind==='watcher'&&e.event.type==='placed'),'clip holds reads and watcher events');
  // The per-card trace rides along: search source and the publish wait are in the saved timing record.
  assert.ok(bundle.events.some(e=>e.kind==='timing'&&e.timing.notes?.source==='deck'&&e.timing.durationsMs['hold.publish']!==undefined),'clip timing holds the read trace');
  assert.deepEqual(bundle.session.decklist,['A','B']);
  assert.deepEqual(bundle.session.frame.crop,crop); assert.ok(bundle.session.frameCalibration,'clip carries the frame-based calibration');
  // The recorded outline is still in camera fractions: against the frame calibration it would land in another zone.
  assert.notEqual(mapFieldZone(placed,bundle.session.frameCalibration).zone,liveZone,'the test crop moves the raw outline to another zone');
  const truth=draftTruth(bundle,'synthetic');
  assert.equal(truth.events.length,1);assert.equal(truth.events[0].kind,'summon');assert.equal(truth.events[0].cardId,'A');
  const decode=async(b:Uint8Array)=>({data:new Uint8ClampedArray(b.buffer,b.byteOffset,b.byteLength),width,height});
  const zones:string[]=[];
  const replay=async()=>{const result=await replayClip({bundle:{...bundle,truth},decode,analyze,onEvent:e=>{if(e.event.type==='placed')zones.push(e.event.track.zone);}});return scoreReplay(result,truth,bundle.session,'synthetic');};
  const first=await replay(),second=await replay();
  assert.deepEqual(zones,[liveZone,liveZone],`replay places the card in the live zone ${liveZone}`);
  assert.equal(first.mode,'recorded');assert.equal(first.onBoard,1);assert.equal(first.identityPct,100);assert.equal(first.unreplayable,0);
  assert.ok(first.readMsP50>0,'recorded read time is reported');
  assert.equal(first.wrongAutomatic,0);assert.equal(first.falseRemovals,0);assert.equal(first.twins,0);
  const {wallS:_a,...firstNumbers}=first,{wallS:_b,...secondNumbers}=second;
  assert.deepEqual(firstNumbers,secondNumbers,'two replays of one clip give the same numbers (wall time aside)');
  assert.ok(formatMetricsTable([first]).includes('identity %'));
  assert.deepEqual(gateAgainstBaseline([first],[first]),[]);
  assert.equal(gateAgainstBaseline([{...first,ttbP95:first.ttbP95*2+500,falseRemovals:1}],[first]).length,2);
  assert.equal(gateAgainstBaseline([{...first,mode:'real'}],[first]).length,1,'mode change fails the gate');
  assert.equal(gateAgainstBaseline([],[first]).length,1,'a missing clip fails the gate');
});
