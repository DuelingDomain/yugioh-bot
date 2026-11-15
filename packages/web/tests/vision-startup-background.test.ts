import {afterEach,expect,it} from 'vitest';
import {inflateSync} from 'node:zlib';
import {createFieldWatcher,type FieldEvent} from '../../vision/src/field-watcher';
import {createFieldAnalyzer} from '../../vision/src/field-motion';
import {resizeRGBA} from '../../vision/src/pixels';
import {createFieldCalibration,fieldZoneCells} from '../../vision/src/field-zones';
import {yugioh} from '../../vision/src/games/yugioh';
import type {DetectedQuad} from '../../vision/src/types';
import phone from '../../vision/src/fixtures/phantom-phone.json';

const watchers:ReturnType<typeof createFieldWatcher>[]=[];
afterEach(()=>{for(const watcher of watchers.splice(0))watcher.dispose();});
const pixels={width:phone.crop.width,height:phone.crop.height,data:new Uint8ClampedArray(inflateSync(Buffer.from(phone.crop.rgbaDeflate,'base64')))};
const card:DetectedQuad={kind:'face-down',confidence:.95,partial:false,quad:[{x:.3,y:.3},{x:.47,y:.3},{x:.47,y:.55},{x:.3,y:.55}]};

async function rig({contact=0,startup=true,changed=false,positive=false}={}){
  let at=0,visible=false;
  const body=positive?{width:96,height:140,data:new Uint8ClampedArray(96*140*4).fill(15)}:pixels;
  const sample=resizeRGBA(body,100,100);
  let frame:ImageData={...sample,data:new Uint8ClampedArray(sample.data),colorSpace:'srgb'};
  const analyze=createFieldAnalyzer(),events:FieldEvent[]=[];
  const watcher=createFieldWatcher({profile:yugioh,now:()=>at,hidden:()=>false,setGuards:{startup},clone:async f=>f,
    buffer:{sample:async()=>({frame,at})},
    recognizer:{detectCards:async()=>visible?[structuredClone(card)]:[],recognize:async()=>{throw Error('An unknown back has no public identity');}},
    analyze:f=>({...analyze(f),crop:()=>body,motion:()=>0,sharpness:()=>20,touched:()=>contact,occluded:()=>false}),
  });
  watchers.push(watcher);watcher.subscribe(e=>events.push(e));
  async function tick(n=1){for(let i=0;i<n;i++){at+=100;await watcher.tick();}}
  await tick();
  if(changed)frame={...frame,data:Uint8ClampedArray.from(frame.data,(v,i)=>i%4===3?v:255-v)};
  visible=true;watcher.scanNow({gentle:true});
  return{events,tick};
}

it.each([0,.6])('late detection of unchanged startup art does not ask at contact %s',async contact=>{
  const r=await rig({contact});await r.tick(140);
  expect(r.events.filter(e=>['placed','reading','prompt'].includes(e.type))).toEqual([]);
});

it.each([{changed:true,startup:true},{changed:false,startup:false}])('keeps the presence choice for changed pixels or startup ignore disabled: %j',async options=>{
  const r=await rig(options);await r.tick(25);
  expect(r.events.filter(e=>e.type==='placed')).toEqual([]);
  expect(r.events.filter(e=>e.type==='prompt'&&e.reason==='card-presence')).toHaveLength(1);
});

it('independent back pixels retain the held-card choice even on unchanged startup pixels',async()=>{
  const r=await rig({contact:.6,positive:true});await r.tick(140);
  expect(r.events.filter(e=>e.type==='placed')).toEqual([]);
  expect(r.events.filter(e=>e.type==='prompt'&&e.reason==='card-presence')).toHaveLength(1);
});

it.each([0,-.02])('a vacated cell matches repeated startup print with grid drift %s',async drift=>{
  const calibration=createFieldCalibration([{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);
  const cells=fieldZoneCells('normal'),target=cells.find(c=>c.zone==='M2')!,reference=cells.find(c=>c.zone==='M4')!;
  const w=target.w*.65,h=w*86/59,x=target.x+(target.w-w)/2,y=target.y+(target.h-h)/2;
  const outline:DetectedQuad={...card,quad:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}]};
  const makeFrame=(vacated:boolean):ImageData=>{
    const width=300,height=300,data=new Uint8ClampedArray(width*height*4).fill(20);
    for(const cell of [target,reference]){
      const left=cell.x+(cell.w-w)/2+(cell===reference?drift:0);
      for(let py=0;py<height;py++)for(let px=0;px<width;px++){
        const u=(px/width-left)/w,v=(py/height-y)/h;if(u<0||u>=1||v<0||v>=1)continue;
        const src=(Math.min(pixels.height-1,Math.floor(v*pixels.height))*pixels.width+Math.min(pixels.width-1,Math.floor(u*pixels.width)))*4;
        const rgb=cell===target&&!vacated?[5,140,240]:Array.from(pixels.data.subarray(src,src+3));data.set([...rgb,255],(py*width+px)*4);
      }
    }
    return{width,height,data,colorSpace:'srgb'};
  };
  let at=0,visible=false,frame=makeFrame(false);
  const analyze=createFieldAnalyzer(),events:FieldEvent[]=[];
  const watcher=createFieldWatcher({profile:yugioh,calibration,now:()=>at,hidden:()=>false,clone:async f=>f,
    buffer:{sample:async()=>({frame,at})},recognizer:{detectCards:async()=>visible?[structuredClone(outline)]:[],recognize:async()=>{throw Error('No card identity');}},
    analyze:f=>({...analyze(f),crop:()=>pixels,motion:()=>0,sharpness:()=>20,touched:()=>0,occluded:()=>false}),
  });
  watchers.push(watcher);watcher.subscribe(e=>events.push(e));
  at+=100;await watcher.tick();visible=true;frame=makeFrame(true);watcher.scanNow({gentle:true});
  for(let i=0;i<25;i++){at+=100;await watcher.tick();}
  expect(events.filter(e=>['placed','reading','prompt'].includes(e.type))).toEqual([]);
});
