import type {Recognizer} from '../src/client';
import type {DetectedQuad,RecognitionResult} from '../src/types';
import {boundsOf,warpQuad,type Quad} from '../src/geometry';
import {appearanceError} from './tracker';
import type {Box} from './session';
export class MotionGate {
  private previous?:Uint8ClampedArray;private sweep=-Infinity;
  inspect(pixels:Uint8ClampedArray,width:number,height:number,at:number) {
    const full=at-this.sweep>=1500||this.previous?.length!==pixels.length;
    let x0=width,y0=height,x1=0,y1=0,changed=0;
    if(this.previous?.length===pixels.length)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=(y*width+x)*4,d=(Math.abs(pixels[i]-this.previous[i])+Math.abs(pixels[i+1]-this.previous[i+1])+Math.abs(pixels[i+2]-this.previous[i+2]))/3;
      if(d>18){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x+1);y1=Math.max(y1,y+1);changed++;}
    }
    this.previous=new Uint8ClampedArray(pixels);if(full)this.sweep=at;
    const pad=.12,roi:Box={x:Math.max(0,x0/width-pad),y:Math.max(0,y0/height-pad),w:0,h:0};
    roi.w=Math.min(1,x1/width+pad)-roi.x;roi.h=Math.min(1,y1/height+pad)-roi.y;
    return {run:full||changed>0,full,roi:changed?roi:undefined};
  }
}
function pixels(frame:ImageData|ImageBitmap,width?:number):ImageData {
  const w=width??frame.width,h=Math.max(2,Math.round(frame.height*w/frame.width)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true})!;
  if('data' in frame){if(!width)return frame;const original=new OffscreenCanvas(frame.width,frame.height);original.getContext('2d')!.putImageData(frame,0,0);ctx.drawImage(original,0,0,w,h);}else ctx.drawImage(frame,0,0,w,h);
  return ctx.getImageData(0,0,w,h);
}
export function cropAppearance(frame:ImageData|ImageBitmap,card:DetectedQuad):number[] {
  const image=pixels(frame,Math.min(640,frame.width));
  const patch=warpQuad(image,card.quad.map(p=>({x:p.x*image.width,y:p.y*image.height})) as Quad,16,24);
  return patch?Array.from(patch.data).filter((_,i)=>i%4!==3).map(v=>v/255):[];
}
/** Original-size frames always reach recognition. Only detector input is cropped. */
export function efficientRecognizer(base:Recognizer,clock:()=>number) {
  const gate=new MotionGate(),stats={detectorCalls:0,motionSkips:0,roiCalls:0,cacheHits:0,recognitionCalls:0};
  let last:DetectedQuad[]=[];const cache:{appearance:number[];result:RecognitionResult}[]=[];
  return {stats,prepare:()=>base.prepare(),
    async detectCards(frame:ImageBitmap|ImageData) {
      const small=pixels(frame,64),change=gate.inspect(small.data,small.width,small.height,clock());
      if(!change.run){stats.motionSkips++;if('close' in frame)frame.close();return structuredClone(last);}
      stats.detectorCalls++;
      if(!change.full&&change.roi&&change.roi.w*change.roi.h<.65&&'close' in frame){
        const sourceWidth=frame.width,sourceHeight=frame.height,roi=change.roi,x=Math.floor(roi.x*frame.width),y=Math.floor(roi.y*frame.height),w=Math.min(frame.width-x,Math.ceil(roi.w*frame.width)),h=Math.min(frame.height-y,Math.ceil(roi.h*frame.height));
        const cropped=await createImageBitmap(frame,x,y,w,h);frame.close();stats.roiCalls++;
        const detected=await base.detectCards(cropped);
        const cards=detected.map(c=>({...c,quad:c.quad.map(p=>({x:(x+p.x*w)/sourceWidth,y:(y+p.y*h)/sourceHeight})) as DetectedQuad['quad']}));
        last=[...last.filter(c=>{const b=boundsOf(c.quad);return b.x+b.w<roi.x||b.x>roi.x+roi.w||b.y+b.h<roi.y||b.y>roi.y+roi.h;}),...cards];return structuredClone(last);
      }
      last=await base.detectCards(frame);return structuredClone(last);
    },
    async recognize(frames:ImageBitmap[]|ImageData[],opts:Parameters<Recognizer['recognize']>[1]) {
      const appearance=opts?.card?cropAppearance(frames[0],opts.card):[];
      const ranked=cache.map(c=>({c,error:appearanceError(c.appearance,appearance)})).sort((a,b)=>a.error-b.error);
      if(ranked[0]?.error<.0025&&(!ranked[1]||ranked[1].c.result.candidates[0]?.cardId===ranked[0].c.result.candidates[0]?.cardId||ranked[1].error-ranked[0].error>.005)&&!opts?.card?.covered&&!opts?.card?.partial&&opts?.card?.kind==='face-up'){
        stats.cacheHits++;frames.forEach(f=>{if('close' in f)f.close();});return {...structuredClone(ranked[0].c.result),detectedCard:opts.card,timingsMs:{sharpness:0,detect:0,warp:0,embed:0,search:0,total:0}};
      }
      stats.recognitionCalls++;const result=await base.recognize(frames,opts);
      if(appearance.length&&result.tier==='sure'&&!result.quality.covered&&!result.quality.partial&&!result.quality.fallback&&!result.quality.faceDown){cache.push({appearance,result:structuredClone(result)});if(cache.length>60)cache.shift();}
      return result;
    },
  };
}
