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

test('the calibrated mat edge excludes the desk from skin evidence and still detects a hand that crosses it',()=>{
  const mat=[{x:.1,y:.31},{x:.9,y:.28},{x:.9,y:.9},{x:.1,y:.9}];
  const image=scene(false);
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){
    const desk=y<32-(x-10)*3/80;
    image.data.set(desk?[190,130,95,255]:[45,50,55,255],(y*100+x)*4);
  }
  const analyze=createFieldAnalyzer();
  const clear=analyze(image,0,mat);
  expect(clear.skinNear?.(card)).toBe(0);
  expect(clear.touched?.(card)).toBe(0);
  const hand={...image,data:new Uint8ClampedArray(image.data)};
  for(let y=16;y<50;y++)for(let x=40;x<60;x++)hand.data.set([190,130,95,255],(y*100+x)*4);
  expect(analyze(hand,100,mat).touched?.(card)).toBeGreaterThan(.12);
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

test('skin-coloured scenery that stays still for four seconds stops counting as a hand',()=>{
  const analyze=createFieldAnalyzer(),still=scene(true);
  expect(analyze(still,0).touched?.(card)).toBeGreaterThan(.12);
  for(let at=500;at<=3500;at+=500)expect(analyze(still,at).touched?.(card)).toBeGreaterThan(.12);
  for(let at=4000;at<=5000;at+=500)analyze(still,at);
  const evidence=analyze(still,5500);
  expect(evidence.touched?.(card)).toBe(0);
  expect(evidence.edgeGrip?.(card)).not.toBe('grip');
});

test('a hand arriving over learned scenery still blocks the card',()=>{
  const analyze=createFieldAnalyzer(),empty=scene(false);
  for(let at=0;at<=5000;at+=500)analyze(empty,at);
  const evidence=analyze(scene(true),5500);
  expect(evidence.touched?.(card)).toBeGreaterThan(.12);
  expect(evidence.occluded?.(card)).toBe(true);
});

test('a hand that keeps moving is never learned as scenery',()=>{
  const analyze=createFieldAnalyzer(),shifted=scene(true);
  // The same finger four pixels shorter: its tip moves on every frame.
  for(let y=40;y<=60;y++)for(let x=41;x<=44;x++)shifted.data.set([130,80,60,255],(y*shifted.width+x)*4);
  let evidence=analyze(scene(true),0);
  for(let at=500,i=1;at<=8000;at+=500,i++)evidence=analyze(i%2?shifted:scene(true),at);
  expect(evidence.touched?.(card)).toBeGreaterThan(.12);
});

test('reset forgets the learned scenery',()=>{
  const analyze=createFieldAnalyzer(),still=scene(true);
  for(let at=0;at<=5500;at+=500)analyze(still,at);
  expect(analyze(still,6000).touched?.(card)).toBe(0);
  analyze.reset();
  expect(analyze(still,6500).touched?.(card)).toBeGreaterThan(.12);
});
