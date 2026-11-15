import {expect, test} from 'vitest';
import {createFieldAnalyzer} from '../../vision/src/field-motion';
import type {DetectedQuad} from '../../vision/src/types';

const card:DetectedQuad={kind:'face-up',confidence:.95,partial:false,
  quad:[{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}]};

function scene(finger:boolean):ImageData {
  const width=100,height=100,data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let colour=[20,20,20];
    if(x>=30&&x<=70&&y>=30&&y<=70)colour=[130,80,60]; // Warm printed artwork.
    if(x>=18&&x<=(finger?44:29)&&y>=40&&y<=60){
      const shade=.8+.2*(x-18)/26;
      colour=[200,150,120].map(value=>value*shade);
    }
    data.set([...colour,255],(y*width+x)*4);
  }
  return {width,height,colorSpace:'srgb',data};
}

test('nearby skin cannot flood through a different printed colour on the card',()=>{
  const evidence=createFieldAnalyzer()(scene(false));
  expect(evidence.skinNear?.(card)).toBeGreaterThan(0);
  expect(evidence.touched?.(card)).toBe(0);
});

test('a shaded finger crossing the card edge still blocks the card',()=>{
  const evidence=createFieldAnalyzer()(scene(true));
  expect(evidence.touched?.(card)).toBeGreaterThan(.12);
  expect(evidence.occluded?.(card)).toBe(true);
});
