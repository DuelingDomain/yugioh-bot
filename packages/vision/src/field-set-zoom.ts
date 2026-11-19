import { boundsOf } from './geometry';
import { cropRGBA, type RGBAImage } from './pixels';
import { closeFieldFrame, type FieldFrame } from './field-motion';
import type { Recognizer } from './client';
import { detect } from './detector/run';
import { CARD_DETECTOR } from './detector/spec';
import type { ModelSession } from './runtime';
import type { TensorCtor } from './embed';
import type { DetectedQuad } from './types';

/** One detector pass on the native crop. The watcher checks which cell owns each result. */
export async function detectFieldCellOutlines(frame:RGBAImage,detector:ModelSession,Tensor:TensorCtor):Promise<DetectedQuad[]> {
  const {width,height}=frame;
  if(width<3||height<3||width*height>16_000_000||frame.data.length!==width*height*4)throw new Error('Invalid frame');
  const cards=await detect(detector,Tensor,frame,CARD_DETECTOR.cropLongSide,CARD_DETECTOR.minScore,true);
  return cards.filter(c=>c.conf>=CARD_DETECTOR.minConfidence&&c.pts.every(([x,y])=>x>2&&y>2&&x<width-2&&y<height-2))
    .map(c=>({quad:c.pts.map(([x,y])=>({x:x/width,y:y/height})),kind:c.kind,confidence:c.conf,partial:false}));
}

/** Upscaling a cell with too few native pixels magnifies noise and mat print. */
export function canZoomCell(frame:FieldFrame,cell:DetectedQuad):boolean {
  const b=boundsOf(cell.quad);
  const width=(Math.min(1,b.x+b.w)-Math.max(0,b.x))*frame.width;
  const height=(Math.min(1,b.y+b.h)-Math.max(0,b.y))*frame.height;
  return Math.min(width,height)>=96;
}

/** Crop before transferring to the worker, keeping the native pixels and the original sample's timestamp. */
export async function detectZoomedCell(frame:FieldFrame,cell:DetectedQuad,recognizer:Pick<Recognizer,'detectCards'>):Promise<DetectedQuad[]> {
  const {width,height}=frame,b=boundsOf(cell.quad);
  const x=Math.max(0,Math.floor((b.x-b.w*.30)*width)),y=Math.max(0,Math.floor((b.y-b.h*.30)*height));
  const w=Math.min(width,Math.ceil((b.x+b.w*1.30)*width))-x,h=Math.min(height,Math.ceil((b.y+b.h*1.30)*height))-y;
  if(w<3||h<3)return [];
  const crop='close' in frame?await createImageBitmap(frame,x,y,w,h):{...cropRGBA(frame,x,y,w,h),colorSpace:frame.colorSpace} as ImageData;
  try {
    const cards=await recognizer.detectCards(crop,{zoom:true});
    return cards.map(c=>({...c,quad:c.quad.map(p=>({x:(x+p.x*w)/width,y:(y+p.y*h)/height}))}));
  } finally { closeFieldFrame(crop); }
}
