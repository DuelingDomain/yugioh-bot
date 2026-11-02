import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { classifyFaceState, createFaceStateHysteresis, isLikelyFaceDown } from './face-state';
import type { RGBAImage } from './pixels';

const image = (pixel: (x:number,y:number)=>number[]):RGBAImage => {
  const width=120,height=176,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...pixel(x/width,y/height),255],(y*width+x)*4);
  return {width,height,data};
};
const front=image((x,y)=> {
  if(x<.06||x>.94||y<.04||y>.96)return [25,25,25];
  if(x>.12&&x<.88&&y>.18&&y<.70)return [60+140*x,40+130*y,70+80*Math.sin(35*x)*Math.cos(30*y)];
  if(x>.10&&x<.90&&y>.76&&y<.92)return y%.035<.012?[65,55,45]:[220,210,180];
  return [35,145,120];
});

test('tracks a bound face through arbitrary sleeves without a transient flip or identity inference',async()=> {
  assert.equal(classifyFaceState(front).state,'up');
  for(const rgb of [[245,245,245],[8,8,8],[190,25,45],[20,80,210],[20,180,50]]) {
    const sleeve=image((x,y)=>rgb.map(v=>v*(.75+.2*x)+5*y));
    assert.equal(classifyFaceState(sleeve,{reference:{crop:front},detectorFaceDownScore:.02}).state,'down');
    assert.equal(isLikelyFaceDown(sleeve),true);
  }
  const patterned=image((x,y)=>[110+80*Math.sin(x*32+y*21),100+65*Math.cos(x*27-y*41),120+90*Math.sin(y*35)]);
  assert.equal(classifyFaceState(patterned,{reference:{crop:front}}).state,'down');
  assert.equal(classifyFaceState(patterned,{detectorFaceDownScore:.97}).state,'down');
  assert.equal(isLikelyFaceDown(patterned),true);
  assert.equal(classifyFaceState(front,{reference:{crop:front}}).state,'up');
  assert.equal(classifyFaceState(front,{reference:{crop:front},detectorFaceDownScore:.99}).state,'unknown');
  assert.equal(classifyFaceState(front,{reference:{crop:front},detectorFaceDownScore:NaN}).state,'up');
  assert.equal(classifyFaceState(image(()=>[250,250,250]),{embedding:{space:'art-box',values:[1,0]},reference:{crop:front,embedding:{space:'art-box',values:[1,0]}}}).state,'down');
  const dark={...front,data:Uint8Array.from(front.data,(v,i)=>i%4===3?v:v*.1)};
  const blur={...front,data:await sharp(front.data,{raw:{width:front.width,height:front.height,channels:4}}).blur(10).raw().toBuffer()};
  for(const crop of [dark,blur]) assert.notEqual(classifyFaceState(crop,{reference:{crop:front},detectorFaceDownScore:.01}).state,'down');
  // An embedding change alone is not a flip; different card identities can be face-up.
  assert.notEqual(classifyFaceState(front,{embedding:{space:'art-box',values:[0,1]},reference:{embedding:{space:'art-box',values:[1,0]}}}).state,'down');
  assert.equal(classifyFaceState({width:0,height:0,data:new Uint8Array()},{detectorFaceDownScore:1}).state,'unknown');
  assert.equal(classifyFaceState({...front,data:front.data.subarray(0,40)}).state,'unknown');
  const gate=createFaceStateHysteresis();
  const down={state:'down',confidence:.95} as const,up={state:'up',confidence:.95} as const;
  assert.equal(gate.update(down,0).state,'unknown');
  assert.equal(gate.update(down,299).state,'unknown');
  assert.equal(gate.update(down,300).state,'down');
  assert.equal(gate.update(up,350).state,'unknown');
  assert.equal(gate.update({state:'unknown',confidence:0},500).state,'unknown');
  assert.equal(gate.update(up,550).state,'unknown');
  assert.equal(gate.update(up,850).state,'up');
  gate.reset();
  gate.update(up,900);
  assert.equal(gate.update(up,NaN).state,'unknown');
  assert.equal(gate.update(up,901).state,'unknown');
  gate.reset();
  gate.update(down,1000);
  assert.equal(gate.update(down,5000).state,'unknown'); // a paused camera is not sustained evidence
  assert.equal(gate.update(down,4999).state,'unknown'); // out-of-order timestamps reset
});
