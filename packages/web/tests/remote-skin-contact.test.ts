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

test('skin gripping opposite outside edges is contact even when no skin covers the crop',()=>{
  const image=scene(false);
  for(let y=40;y<=60;y++)for(let x=71;x<=82;x++)image.data.set([180,135,108,255],(y*image.width+x)*4);
  const empty=scene(false);
  for(let y=40;y<=60;y++)for(let x=18;x<=29;x++)empty.data.set([20,20,20,255],(y*empty.width+x)*4);
  const analyze=createFieldAnalyzer();analyze(empty);
  const evidence=analyze(image);
  expect(evidence.touched?.(card)).toBe(0);
  expect(evidence.edgeGrip?.(card)).toBe('grip');
  for(let i=0;i<10;i++)expect(analyze(image).edgeGrip?.(card)).toBe('grip');
  expect(analyze(empty).edgeGrip?.(card)).not.toBe('grip');
  const nearby=createFieldAnalyzer();nearby(empty);
  expect(nearby(scene(false)).edgeGrip?.(card)).not.toBe('grip');
});
