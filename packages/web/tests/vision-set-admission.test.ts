import {afterEach, describe, expect, it} from 'vitest';
import {createFieldWatcher, type FieldEvent, type FieldWatcherOptions, type KnownFieldCard} from '../../vision/src/field-watcher';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad} from '../../vision/src/types';

const disposals: (()=>void)[]=[];
afterEach(()=>{for(const dispose of disposals.splice(0))dispose();});

function rig() {
  let at=0, motion=0, touched=0;
  let outlines:DetectedQuad[]=[];
  const events:FieldEvent[]=[], known:KnownFieldCard[]=[];
  const frame={width:100,height:100,data:new Uint8ClampedArray(40000),colorSpace:'srgb'} satisfies ImageData;
  const crop={width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(15)};
  const recognize:FieldWatcherOptions['recognizer']['recognize']=async()=>{throw new Error('A Set must not need an identity read');};
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,
    getKnownCards:()=>known,
    recognizer:{detectCards:async()=>structuredClone(outlines),recognize},
    buffer:{sample:async()=>({frame,at})},clone:async f=>f,
    analyze:()=>({motion:()=>motion,touched:()=>touched,occluded:()=>touched>0,
      sharpness:()=>20,crop:()=>crop,appearance:()=>Array(12).fill(.06),halo:()=>Array(12).fill(.3)}),
  });
  disposals.push(()=>watcher.dispose());
  watcher.subscribe(e=>events.push(e));
  return {watcher,events,known,
    async tick(ms=833){at+=ms;await watcher.tick();},
    set outlines(value:DetectedQuad[]){outlines=value;},
    set motion(value:number){motion=value;},set touched(value:number){touched=value;},
  };
}

const back:DetectedQuad={quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}],kind:'face-down',confidence:.55,partial:false};

describe('field Set confirmation at CPU detector cadence',()=>{
  it.each(['motion','hand','miss'] as const)('requires new clean samples after %s',async obstacle=>{
    const r=rig();r.outlines=[back];await r.tick();await r.tick();
    if(obstacle==='motion')r.motion=.2;
    if(obstacle==='hand')r.touched=.3;
    if(obstacle==='miss')r.outlines=[];
    await r.tick();r.motion=0;r.touched=0;r.outlines=[back];
    await r.tick();
    expect(r.events.some(e=>e.type==='placed')).toBe(false);
    for(let i=0;i<4;i++)await r.tick();
    expect(r.events.filter(e=>e.type==='placed')).toHaveLength(1);
  });

  it('does not join isolated evidence across long gaps',async()=>{
    const r=rig();r.outlines=[back];
    for(let i=0;i<6;i++)await r.tick(2000);
    expect(r.events.some(e=>e.type==='placed')).toBe(false);
  });
});
