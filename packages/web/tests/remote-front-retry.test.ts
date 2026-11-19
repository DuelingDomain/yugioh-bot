import {expect, test} from 'vitest';
import {classifyFaceState} from '../../vision/src/face-state';
import {createFieldWatcher, type FieldEvent, type FieldTrack} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad, RecognitionResult} from '../../vision/src/types';
import {fieldEvidenceMismatch} from '../src/lib/remote/field-proposals';

function frontImage(){
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    const x=px/width,y=py/height;
    const rgb=x<.06||x>.94||y<.04||y>.96?[25,25,25]:x>.12&&x<.88&&y>.18&&y<.70?
      [60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)]:x>.10&&x<.90&&y>.76&&y<.92?
      (y%.035<.012?[65,55,45]:[220,210,180]):[35,145,120];
    data.set([...rgb,255],(py*width+px)*4);
  }
  return {width,height,data};
}
const result=(score:number):RecognitionResult=>({candidates:[{cardId:'A',score}],tier:score<.74?'low match':'sure',
    quality:{detected:true,cornersFound:true,framesUsed:1,selectedFrameIndices:[0],sharpness:20,fallback:false},timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:0},backend:'wasm'});

test('a glare choice accepts a still-unnamed front and expires when its glare, position or revision changes',()=>{
  const track:FieldTrack={id:'card',revision:1,zone:'S5',position:'attack',faceDown:false,state:'candidate',removed:false,firstSeen:performance.now()-2500,lastSeen:performance.now(),
    card:{kind:'face-up',confidence:.95,quad:[],partial:false},glare:{share:.1,candidates:[{cardId:'A',score:.65}]}};
  const prompt:FieldEvent={type:'prompt',source:'auto',reason:'uncertain',track};
  expect(fieldEvidenceMismatch(prompt,track,true)).toBeUndefined();
  for(const changed of [{glare:undefined},{zone:'S4' as const},{position:'defense' as const},{revision:2},{cardId:'other'}])
    expect(fieldEvidenceMismatch(prompt,{...track,...changed},true)).toBeDefined();
});

test('a low read made before rest gets a settled crop before asking',async()=>{
  let at=0;
  const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,
    quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}]};
  const crop=frontImage(),{width,height,data}=crop,events:FieldEvent[]=[];
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
    recognizer:{detectCards:async()=>[structuredClone(card)],recognize:async frames=>result('data' in frames[0]&&frames[0].data[0]>=3?.95:.70)},
    buffer:{sample:async()=>{const pixels=new Uint8ClampedArray(data);pixels[0]=at/100;return {frame:{width,height,colorSpace:'srgb',data:pixels},at};}},
    analyze:()=>({motion:c=>c===card||c.quad[0].x===.3?at<300?.03:0:0,sharpness:()=>20,touched:()=>0,occluded:()=>false,
      crop:()=>crop,appearance:()=>[.2,.6,.2,.6,.2,.6],halo:()=>Array(192).fill(.2)}),clone:async frame=>frame});
  watcher.subscribe(event=>events.push(event));
  try {
    for(let i=0;i<12;i++){at+=100;await watcher.tick();}
    expect(events.filter(e=>e.type==='prompt')).toHaveLength(0);
    expect(events.find(e=>e.type==='placed')?.track.cardId).toBe('A');
  } finally {watcher.dispose();}
});


test('a known front keeps its presence through an ambiguous crop, while a changed back still asks',async()=>{
  let at=0,motion=0,crop=frontImage(),look=[.2,.6,.2,.6,.2,.6];
  const frame:ImageData={...crop,colorSpace:'srgb'};
  const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,
    quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}]};
  const events:FieldEvent[]=[];
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
    recognizer:{detectCards:async()=>[structuredClone(card)],recognize:async()=>result(.95)},
    buffer:{sample:async()=>({frame,at})},clone:async value=>value,
    analyze:()=>({motion:()=>motion,sharpness:()=>20,touched:()=>0,occluded:()=>false,
      crop:()=>crop,appearance:()=>look,halo:()=>Array(192).fill(.2)})});
  watcher.subscribe(event=>events.push(event));
  const tick=async(count:number)=>{for(let i=0;i<count;i++){at+=100;await watcher.tick();}};
  try {
    await tick(12);const placed=events.find(e=>e.type==='placed');expect(placed?.track.cardId).toBe('A');
    watcher.confirm(placed!.track.id,'A');
    const unclear=frontImage();
    for(let py=0;py<unclear.height;py++)for(let px=0;px<unclear.width;px++){
      const x=px/unclear.width,y=py/unclear.height;
      const rgb=x<.05||x>.95||y<.05||y>.95?[20,20,20]:[100+48*Math.sin(x*32+y*21),100+39*Math.cos(x*27-y*41),100+54*Math.sin(y*35)];
      unclear.data.set([...rgb,255],(py*unclear.width+px)*4);
    }
    expect(classifyFaceState(unclear).state).toBe('unknown');
    expect(classifyFaceState(unclear,{reference:{crop}}).state).toBe('down');
    crop=unclear;
    events.length=0;motion=.01;await tick(1);motion=0;await tick(20);
    expect(events.filter(e=>e.type==='prompt')).toHaveLength(0);
    expect(watcher.getSnapshot().tracks.find(t=>t.id===placed?.track.id)?.cardId).toBe('A');
    card.kind='face-down';look=[.8,.1,.8,.1,.8,.1];await tick(20);
    expect(events.filter(e=>e.type==='prompt'&&e.reason==='card-presence')).toHaveLength(1);
    expect(events.filter(e=>e.type==='flipped'&&e.track.faceDown)).toHaveLength(0);
  } finally {watcher.dispose();}
});
