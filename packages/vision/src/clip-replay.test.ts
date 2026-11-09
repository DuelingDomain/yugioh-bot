import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldWatcher } from './field-watcher';
import { yugioh } from './games/yugioh';
import type { DetectedQuad, RecognitionResult } from './types';
import { createClipRecorder } from './clip-recorder';
import { parseClip } from './clip-format';
import { draftTruth, gateAgainstBaseline, replayClip, scoreReplay, formatMetricsTable } from './clip-replay';

// One synthetic 6 s session: an empty mat, then one card placed and read as A. The recorder saves it as a
// .ddclip; the replay feeds the saved frames through a fresh watcher with the recorded reads and scores
// against the draft labels.
test('a saved clip replays deterministically through the field watcher and scores against its labels', async () => {
  const quad = (x:number,y:number):DetectedQuad => ({kind:'face-up',confidence:.95,partial:false,quad:[{x,y},{x:x+.06,y},{x:x+.06,y:y+.12},{x,y:y+.12}]});
  const width=120,height=176,data=new Uint8ClampedArray(width*height*4);
  // A card-like picture (dark border, art, text lines): the face-state check reads it as a front.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const u=x/width,v=y/height;const rgb=u<.06||u>.94||v<.04||v>.96?[25,25,25]:u>.12&&u<.88&&v>.18&&v<.70?[60+140*u,40+130*v,70+80*Math.sin(35*u)*Math.cos(30*v)]:u>.10&&u<.90&&v>.76&&v<.92?v%.035<.012?[65,55,45]:[220,210,180]:[35,145,120];data.set([...rgb,255],(y*width+x)*4);}
  const face={width,height,data};
  const analyze=()=>({motion:()=>0,sharpness:()=>20,appearance:()=>Array(12).fill(.2),crop:()=>face});
  const read=():RecognitionResult=>({candidates:[{cardId:'A',score:.95},{cardId:'B',score:.3}],tier:'sure',quality:{detected:true,cornersFound:true,framesUsed:2,selectedFrameIndices:[0],sharpness:20,fallback:false,searchSource:'deck'},timingsMs:{total:40,sharpness:1,detect:0,warp:2,embed:30,search:1,embedCount:2},backend:'wasm'} as RecognitionResult);
  let at=0,outlines:DetectedQuad[]=[];
  const recorder=createClipRecorder({now:()=>at,windowMs:30_000,frameGapMs:200,encode:async frame=>({bytes:new Uint8Array((frame as ImageData).data.buffer.slice(0)),width,height,camera:{width,height}})});
  recorder.setContext({decklist:['A','B'],backend:'wasm',seat:0});
  const live=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,clone:async f=>f,analyze,
    ...recorder.wrap({buffer:{sample:async()=>({frame:face as ImageData,at})},recognizer:{detectCards:async()=>structuredClone(outlines),recognize:async()=>read()}})});
  const liveEvents:string[]=[];
  live.subscribe(event=>{liveEvents.push(`${event.type}:${event.track.cardId??''}`);recorder.onEvent(event);});
  try {
    for(let i=0;i<60;i++){at+=100;await live.tick();await Promise.resolve();if(i===10)outlines=[quad(.3,.3)];}
  } finally { live.dispose(); }
  assert.ok(liveEvents.some(e=>e==='placed:A'),`live watcher placed A: ${liveEvents.join(' ')}`);
  const bytes=recorder.save();
  const stats=recorder.stats();
  assert.ok(stats.frames>=25&&stats.frames<=31,`5 fps ring kept ${stats.frames} frames`);
  const bundle=parseClip(bytes);
  assert.equal(bundle.frames.length,stats.frames);
  assert.ok(bundle.events.some(e=>e.kind==='read')&&bundle.events.some(e=>e.kind==='watcher'&&e.event.type==='placed'),'clip holds reads and watcher events');
  assert.deepEqual(bundle.session.decklist,['A','B']);
  const truth=draftTruth(bundle,'synthetic');
  assert.equal(truth.events.length,1);assert.equal(truth.events[0].kind,'summon');assert.equal(truth.events[0].cardId,'A');
  const decode=async(b:Uint8Array)=>({data:new Uint8ClampedArray(b.buffer,b.byteOffset,b.byteLength),width,height});
  const replay=async()=>scoreReplay(await replayClip({bundle:{...bundle,truth},decode,analyze}),truth,bundle.session,'synthetic');
  const first=await replay(),second=await replay();
  assert.equal(first.mode,'recorded');assert.equal(first.onBoard,1);assert.equal(first.identityPct,100);
  assert.equal(first.wrongAutomatic,0);assert.equal(first.falseRemovals,0);assert.equal(first.twins,0);
  const {wallS:_a,...firstNumbers}=first,{wallS:_b,...secondNumbers}=second;
  assert.deepEqual(firstNumbers,secondNumbers,'two replays of one clip give the same numbers (wall time aside)');
  assert.ok(formatMetricsTable([first]).includes('identity %'));
  assert.deepEqual(gateAgainstBaseline([first],[first]),[]);
  assert.equal(gateAgainstBaseline([{...first,ttbP95:first.ttbP95*2+500,falseRemovals:1}],[first]).length,2);
});
