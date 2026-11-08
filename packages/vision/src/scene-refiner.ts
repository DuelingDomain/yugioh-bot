import { refinedCorners } from './detector/run';
import type { DetectedCard } from './detector/detector';
import { cropRGBA, type RGBAImage } from './pixels';
import type { Point } from './types';
import { boundsOf } from './geometry';
type Entry={card:DetectedCard;quad:Point[];fittedAt:number;pixels?:RGBAImage};
const samePixels=(a?:RGBAImage,b?:RGBAImage)=>{
  if(!a?.data.length||a.width!==b?.width||a.height!==b?.height)return false;
  let error=0;for(let i=0;i<a.data.length;i++)if(i%4!==3)error+=(a.data[i]-b.data[i])**2;
  return error/(a.data.length/4*3)<=25; // Five RGB levels RMS admits camera noise, not changed edges.
};
/** One worker's last pass only. Refit stationary edges every 1.5 s; keep the accepted quad through native-pixel jitter. */
export class SceneRefiner {
  private previous:Entry[]=[];
  private current:Entry[]=[];
  private size='';
  private width=0;
  private height=0;
  constructor(private fit=refinedCorners,private now=()=>performance.now()) {}
  begin(width:number,height:number) {
    const size=`${width}x${height}`;
    this.previous=size===this.size?this.current:[];
    this.current=[];this.size=size;this.width=width;this.height=height;
  }
  private sample(quad:Point[],image:RGBAImage) {
    if(quad.length!==4)return;
    const b=boundsOf(quad.map(p=>({x:p.x*image.width/this.width,y:p.y*image.height/this.height})));
    // Keep edges and a halo, not just interior samples: a plain sleeve can move at its boundary alone.
    return cropRGBA(image,Math.floor(b.x-b.w*.2),Math.floor(b.y-b.h*.2),Math.ceil(b.w*1.4)+1,Math.ceil(b.h*1.4)+1);
  }
  refine(card:DetectedCard,image:RGBAImage,fit=this.fit):Point[] {
    const index=this.previous.findIndex(e=>e.card.kind===card.kind&&e.card.pts.every(([x,y],i)=>Math.hypot(x-card.pts[i][0],y-card.pts[i][1])<2));
    const cached=index<0?undefined:this.previous.splice(index,1)[0];
    const at=this.now();
    let entry:Entry;
    if(cached&&at-cached.fittedAt<1500)entry=cached;
    else {
      const quad=fit(card,image);
      // Compare with the accepted quad, so ignored jitter cannot accumulate into drift.
      // Keep its detector box anchor too; a genuinely moved box must still refit.
      // Noise can also make the edge search jump to a neighbouring printed line.
      // A larger jump needs changed pixels at the accepted quad, sampled from the full detector image.
      entry=cached&&quad.length===4&&cached.quad.length===4&&(
        quad.every((p,i)=>Math.hypot(p.x-cached.quad[i].x,p.y-cached.quad[i].y)<=3)||samePixels(cached.pixels,this.sample(cached.quad,image)))
        ?{...cached,fittedAt:at}:{card,quad,fittedAt:at,pixels:this.sample(quad,image)};
    }
    this.current.push(entry);
    return entry.quad;
  }
}
