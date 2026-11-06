// Quad selection adapted from Duel Lens src/content/outlines.ts (Apache-2.0).
// Uses normalized source coordinates; see licenses/duel-lens.LICENSE.
import { polygonArea } from './geometry';
import type { DetectedQuad, Point } from './types';
export function hitTestQuad(cards: DetectedQuad[], point: Point, display?: {width:number;height:number}): number {
  const hits=cards.map((card,index)=>({card,index,area:polygonArea(card.quad)})).filter(({card,area})=>{
    if(area<=0) return false;
    let sign=0;
    for(let i=0;i<card.quad.length;i++) {
      const a=card.quad[i],b=card.quad[(i+1)%card.quad.length];
      const cross=(b.x-a.x)*(point.y-a.y)-(b.y-a.y)*(point.x-a.x);
      if(cross && sign && Math.sign(cross)!==sign) return false;
      if(cross) sign=Math.sign(cross);
    }
    return true;
  }).sort((a,b)=>a.area-b.area);
  if(!hits.length && display) {
    const padded=cards.map((card,index)=>({card,index})).filter(({card})=>{
      if(card.quad.length!==4) return false;
      const q=card.quad.map(p=>({x:p.x*display.width,y:p.y*display.height}));
      const cx=q.reduce((s,p)=>s+p.x,0)/4,cy=q.reduce((s,p)=>s+p.y,0)/4;
      const angle=Math.atan2(q[1].y-q[0].y,q[1].x-q[0].x),cos=Math.cos(angle),sin=Math.sin(angle);
      const dx=point.x*display.width-cx,dy=point.y*display.height-cy;
      const w=(Math.hypot(q[1].x-q[0].x,q[1].y-q[0].y)+Math.hypot(q[2].x-q[3].x,q[2].y-q[3].y))/2;
      const h=(Math.hypot(q[3].x-q[0].x,q[3].y-q[0].y)+Math.hypot(q[2].x-q[1].x,q[2].y-q[1].y))/2;
      return Math.abs(dx*cos+dy*sin)<=Math.max(12,w/2) && Math.abs(-dx*sin+dy*cos)<=Math.max(12,h/2);
    });
    if(padded.length) return padded.sort((a,b)=>polygonArea(a.card.quad)-polygonArea(b.card.quad))[0].index;
  }
  if(!hits.length) return -1;
  const near=hits.filter(h=>h.area<=hits[0].area*1.1);
  const distance=(h:typeof hits[number])=>{const q=h.card.quad;const x=q.reduce((s,p)=>s+p.x,0)/q.length,y=q.reduce((s,p)=>s+p.y,0)/q.length;return Math.hypot(point.x-x,point.y-y)/Math.sqrt(h.area);};
  return near.sort((a,b)=>distance(a)-distance(b))[0].index;
}
