import { refinedCorners } from './detector/run';
import type { DetectedCard } from './detector/detector';
import type { RGBAImage } from './pixels';
import type { Point } from './types';
type Entry={card:DetectedCard;quad:Point[]};
/** One worker's last pass only. Keep the original box as the anchor to avoid accumulating drift. */
export class SceneRefiner {
  private previous:Entry[]=[];
  private current:Entry[]=[];
  private size='';
  constructor(private fit=refinedCorners) {}
  begin(width:number,height:number) {
    const size=`${width}x${height}`;
    this.previous=size===this.size?this.current:[];
    this.current=[];this.size=size;
  }
  refine(card:DetectedCard,image:RGBAImage):Point[] {
    const index=this.previous.findIndex(e=>e.card.kind===card.kind&&e.card.pts.every(([x,y],i)=>Math.hypot(x-card.pts[i][0],y-card.pts[i][1])<2));
    const cached=index<0?undefined:this.previous.splice(index,1)[0];
    const entry=cached??{card,quad:this.fit(card,image)};
    this.current.push(entry);
    return entry.quad;
  }
}
