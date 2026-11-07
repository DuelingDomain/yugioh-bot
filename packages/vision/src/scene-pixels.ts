import type { DetectedCard } from './detector/detector';
import { refinedCorners } from './detector/run';
import type { FractionalBox, Point } from './types';
import type { RGBAImage } from './pixels';
export interface ScenePixelSource {
  width:number; height:number;
  sample(region:FractionalBox|undefined,longSide:number):RGBAImage;
  refine(card:DetectedCard):Point[];
}
/** Retain the bitmap on the canvas side. CPU reads contain only detector input or a card's edge search. */
export class ScenePixels implements ScenePixelSource {
  readonly width:number; readonly height:number;
  private canvas=new OffscreenCanvas(1,1);
  constructor(private frame:ImageBitmap) {
    this.width=frame.width;this.height=frame.height;
    if(this.width<3||this.height<3||this.width*this.height>16_000_000)throw new Error('Invalid frame');
  }
  private read(x:number,y:number,w:number,h:number,width:number,height:number):RGBAImage {
    if(this.canvas.width!==width)this.canvas.width=width;
    if(this.canvas.height!==height)this.canvas.height=height;
    const context=this.canvas.getContext('2d',{willReadFrequently:true})!;
    context.globalCompositeOperation='copy';
    context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
    context.drawImage(this.frame,x,y,w,h,0,0,width,height);
    return context.getImageData(0,0,width,height);
  }
  sample(region:FractionalBox|undefined,longSide:number):RGBAImage {
    const x=region?Math.floor(region.x*this.width):0,y=region?Math.floor(region.y*this.height):0;
    const w=region?Math.min(this.width-x,Math.max(3,Math.ceil(region.w*this.width))):this.width;
    const h=region?Math.min(this.height-y,Math.max(3,Math.ceil(region.h*this.height))):this.height;
    const scale=region?longSide/Math.max(w,h):Math.min(1,longSide/Math.max(w,h));
    return this.read(x,y,w,h,Math.max(3,Math.round(w*scale)),Math.max(3,Math.round(h*scale)));
  }
  refine(card:DetectedCard):Point[] {
    // Include every possible tilt (±30°) and the refine margin, plus Sobel's border.
    const radius=Math.hypot(card.w,card.h)/2+Math.max(card.w,card.h)*.2+3;
    const x=Math.max(0,Math.floor(card.cx-radius)),y=Math.max(0,Math.floor(card.cy-radius));
    const w=Math.min(this.width,Math.ceil(card.cx+radius))-x,h=Math.min(this.height,Math.ceil(card.cy+radius))-y;
    if(w<3||h<3)return [];
    const image=this.read(x,y,w,h,w,h);
    return refinedCorners({...card,cx:card.cx-x,cy:card.cy-y,pts:card.pts.map(([px,py])=>[px-x,py-y])},image).map(p=>({x:p.x+x,y:p.y+y}));
  }
}
