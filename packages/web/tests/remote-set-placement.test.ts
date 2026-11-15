import {expect, test} from 'vitest';
import {createFieldWatcher, type FieldEvent} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import {createFieldCalibration, fieldMatPoint} from '../../vision/src/field-zones';
import type {DetectedQuad} from '../../vision/src/types';

function rig() {
  let at=0, touched=.3, occluded=true;
  let card:DetectedQuad={quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}],kind:'face-down',confidence:.95,partial:false};
  const events:FieldEvent[]=[];
  const crop={width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(15)};
  const frame:ImageData={width:100,height:100,colorSpace:'srgb',data:new Uint8ClampedArray(40_000)};
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
    recognizer:{detectCards:async()=>[structuredClone(card)],recognize:async()=>{throw new Error('a back needs no identity read');}},
    buffer:{sample:async()=>({frame,at})},
    analyze:()=>({motion:()=>0,sharpness:()=>20,touched:()=>touched,occluded:()=>occluded,
      crop:()=>crop,appearance:()=>[.1,.3,.1,.3],halo:()=>Array(192).fill(.5)}),clone:async frame=>frame});
  watcher.subscribe(event=>events.push(event));
  return {watcher,events,set touched(value:number){touched=value;},set occluded(value:boolean){occluded=value;},
    set card(value:DetectedQuad){card=value;},async tick(){at+=100;await watcher.tick();}};
}

test('release uses edge contact even when still sleeve pixels look like skin',async()=>{
  const r=rig();
  try {
    for(let i=0;i<10;i++)await r.tick();
    r.touched=0;
    for(let i=0;i<30;i++)await r.tick();
    expect(r.events.filter(e=>e.type==='placed')).toHaveLength(1);
    expect(r.events.filter(e=>e.type==='prompt')).toHaveLength(0);
  } finally {r.watcher.dispose();}
});

test('skin below the release cutoff does not restart the older rest-print timeout',async()=>{
  const r=rig();
  try {
    r.touched=.01;r.occluded=false;
    for(let i=0;i<5;i++)await r.tick();
    expect(r.events.filter(e=>e.type==='placed')).toHaveLength(1);
    expect(r.events.filter(e=>e.type==='prompt')).toHaveLength(0);
  } finally {r.watcher.dispose();}
});

// Detector corners stay portrait ordered when the paper card turns sideways.
const horizontal=(y:number):DetectedQuad=>({kind:'face-down',confidence:.95,partial:false,
  quad:[{x:.42,y:y-.05},{x:.42,y:y+.05},{x:.58,y:y+.05},{x:.58,y:y-.05}]});

test.each(['bottom','left','top','right'] as const)('sideways hand backs stay private with the player at %s',async playerSide=>{
  const r=rig();
  try {
    const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:1}],{playerSide,mirrored:false});
    const camera=(card:DetectedQuad)=>({...card,quad:card.quad.map(point=>fieldMatPoint(point,calibration))});
    r.watcher.setCalibration(calibration);
    r.card=camera(horizontal(.83));r.touched=0;r.occluded=false;
    for(let i=0;i<40;i++)await r.tick();
    expect(r.events.filter(e=>['placed','reading','prompt'].includes(e.type))).toHaveLength(0);
    r.card=camera({kind:'face-down',confidence:.95,partial:false,
      quad:[{x:.45,y:.72},{x:.55,y:.72},{x:.55,y:.95},{x:.45,y:.95}]});
    for(let i=0;i<15;i++)await r.tick();
    expect(r.events.filter(e=>e.type==='placed')).toHaveLength(1);
    expect(r.events.find(e=>e.type==='placed')?.track.zone).toBe('S3');
  } finally {r.watcher.dispose();}
});

test('a sideways Set in a monster cell keeps the defense placement path',async()=>{
  const r=rig();
  try {
    r.watcher.setCalibration(createFieldCalibration([{x:0,y:0},{x:1,y:1}]));
    r.card=horizontal(.5);r.touched=0;r.occluded=false;
    for(let i=0;i<15;i++)await r.tick();
    expect(r.events.filter(e=>e.type==='placed')).toHaveLength(1);
    const placed=r.events.find(e=>e.type==='placed');
    expect(placed?.track.zone).toBe('M3');
    expect(placed?.track.position).toBe('defense');
  } finally {r.watcher.dispose();}
});
