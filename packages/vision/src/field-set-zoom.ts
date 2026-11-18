import { boundsOf } from './geometry';
import { cropRGBA } from './pixels';
import { closeFieldFrame, type FieldFrame } from './field-motion';
import type { Recognizer } from './client';
import type { DetectedQuad } from './types';

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
