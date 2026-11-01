import { boundsOf } from './geometry';
import { sharpness } from './quality';
import type { DetectedQuad } from './types';
import type { RGBAImage } from './pixels';
export type FieldFrame=ImageBitmap|ImageData;
export interface FieldAnalysis { motion(card:DetectedQuad):number; sharpness(card:DetectedQuad):number; halo?(card:DetectedQuad):number[] }
export function closeFieldFrame(frame:FieldFrame) { if('close' in frame)frame.close(); }
export async function cloneFieldFrame(frame:FieldFrame):Promise<FieldFrame> {
  return 'close' in frame?createImageBitmap(frame):new ImageData(new Uint8ClampedArray(frame.data),frame.width,frame.height);
}
/** Only motion/sharpness are downsampled; inference and retained best frames stay native. */
export function createFieldAnalyzer() {
  let previous:RGBAImage|undefined;
  return (frame:FieldFrame):FieldAnalysis=>{
    let image:RGBAImage;
    if(!('close' in frame))image=frame;
    else {
      const width=Math.min(320,frame.width),height=Math.max(3,Math.round(frame.height*width/frame.width));
      const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',{willReadFrequently:true})!;
      context.drawImage(frame,0,0,width,height);image=context.getImageData(0,0,width,height);
    }
    const before=previous;previous=image;
    const crop=(card:DetectedQuad,padding:number)=>{const b=boundsOf(card.quad);return {left:Math.max(1,Math.floor((b.x-b.w*padding)*image.width)),top:Math.max(1,Math.floor((b.y-b.h*padding)*image.height)),right:Math.min(image.width-1,Math.ceil((b.x+b.w*(1+padding))*image.width)),bottom:Math.min(image.height-1,Math.ceil((b.y+b.h*(1+padding))*image.height))};};
    return {
      halo(card) {
        const b=boundsOf(card.quad),values:number[]=[];
        // Sparse RGB ring outside the card: a stationary hand/arm must clear it
        // before an absent card can produce a removal suggestion.
        for(let y=0;y<10;y++)for(let x=0;x<10;x++) {
          if(x>1&&x<8&&y>1&&y<8)continue;
          const px=Math.max(0,Math.min(image.width-1,Math.round((b.x+b.w*(-.3+1.6*x/9))*image.width)));
          const py=Math.max(0,Math.min(image.height-1,Math.round((b.y+b.h*(-.3+1.6*y/9))*image.height))),i=(py*image.width+px)*4;
          values.push(image.data[i]/255,image.data[i+1]/255,image.data[i+2]/255);
        }
        return values;
      },
      motion(card) {
        if(!before||before.width!==image.width||before.height!==image.height)return 1;
        const b=crop(card,.18);let sum=0,n=0,changed=0;
        for(let y=b.top;y<b.bottom;y++)for(let x=b.left;x<b.right;x++) {
          const i=(y*image.width+x)*4,d=(Math.abs(image.data[i]-before.data[i])+Math.abs(image.data[i+1]-before.data[i+1])+Math.abs(image.data[i+2]-before.data[i+2]))/(3*255);
          sum+=d;if(d>.08)changed++;n++;
        }
        return n?Math.max(sum/n,changed/n*.2):1;
      },
      sharpness(card) {
        const b=crop(card,0),w=b.right-b.left,h=b.bottom-b.top;
        if(w<3||h<3)return 0;
        const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)data.set(image.data.subarray(((b.top+y)*image.width+b.left)*4,((b.top+y)*image.width+b.right)*4),y*w*4);
        return sharpness({width:w,height:h,data});
      },
    };
  };
}
