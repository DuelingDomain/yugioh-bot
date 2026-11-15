import {expect, test} from 'vitest';
import {classifyFaceState} from '../../vision/src/face-state';
import {measureSetEvidence, newSetCardMemory, setCropLook} from '../../vision/src/set-card-evidence';

function back(patterned:boolean) {
  const width=96,height=140,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const rgb=patterned?[100+48*Math.sin(x/width*32+y/height*21),100+39*Math.cos(x/width*27-y/height*41),100+54*Math.sin(y/height*35)]:[15,15,15];
    data.set([...rgb,255],(y*width+x)*4);
  }
  return {width,height,data};
}

test.each([
  {name:'weak box and marginal pixels',score:.55,patterned:true,known:false,positive:false},
  {name:'strong box and marginal pixels',score:.95,patterned:true,known:false,positive:true},
  {name:'an accepted patterned sleeve',score:.55,patterned:true,known:true,positive:true},
  {name:'a plain back with strong pixels',score:.55,patterned:false,known:false,positive:true},
])('$name',({score,patterned,known,positive})=>{
  const crop=back(patterned),observation=classifyFaceState(crop),memory=newSetCardMemory();
  expect(observation.state).toBe('down');
  if(patterned)expect(observation.confidence).toBeLessThan(.9);
  if(known)memory.backs.push(setCropLook(crop));
  expect(measureSetEvidence(crop,score,observation,memory).evidence.positive).toBe(positive);
});
