import { boundsOf, quadMap, warpQuad, type Quad } from './geometry';
import { sharpness } from './quality';
import type { DetectedQuad, FractionalBox } from './types';
import type { RGBAImage } from './pixels';
export type FieldFrame=ImageBitmap|ImageData;
/** Shadow evidence: share of the frame darker than its recent background with the same chromaticity, and the share that changed since the last frame. */
export interface FieldShadow { /** Mean RGB per grid cell (gx x gy x 3) of this frame. */ means?:Float32Array; share:number; changed:number; /** Per-cell flags (row-major, gx x gy) of shadow cells that turned on or off this frame: the watcher holds removals only where a shadow moves. */ moved?:Uint8Array; gx?:number; gy?:number }
export interface FieldSceneChange { /** Grid cells that changed since the last sample. */ moving:number; /** Grid cells that changed since mark(). */ sinceMark:number; /** The detector saw this frame in a full pass. */ mark():void }
export interface FieldAnalysis { /** Noise-proof change of the scene, for the detector budget; absent in injected analyzers. */ scene?:FieldSceneChange; motionRegion?:FractionalBox; shadow?:FieldShadow; /** Whole-frame sharpness (Laplacian variance of the downsampled grey frame); the watcher compares it with its recent baseline. */ frameSharpness?:number; crop?(card:DetectedQuad):RGBAImage|undefined; motion(card:DetectedQuad):number; occluded?(card:DetectedQuad):boolean; touched?(card:DetectedQuad):number; /** Share of the thin ring just outside the card (12% of its size) covered by skin connected to the crop edge (a hand or arm touching the card's edge). */ skinNear?(card:DetectedQuad):number; motionOutside?(card:DetectedQuad):number; sharpness(card:DetectedQuad):number; halo?(card:DetectedQuad):number[]; background?(card:DetectedQuad):number[]|undefined; appearance?(card:DetectedQuad):number[] }
export function closeFieldFrame(frame:FieldFrame) { if('close' in frame)frame.close(); }
export async function cloneFieldFrame(frame:FieldFrame):Promise<FieldFrame> {
  return 'close' in frame?createImageBitmap(frame):new ImageData(new Uint8ClampedArray(frame.data),frame.width,frame.height);
}
/** Only motion/sharpness are downsampled; inference and retained best frames stay native. */
export function createFieldAnalyzer() {
  let previous:RGBAImage|undefined,faceCanvas:OffscreenCanvas|undefined;
  let shadows=createShadowBaseline();
  let lastMeans:Float32Array|undefined,markMeans:Float32Array|undefined;
  /** A camera lock or exposure change: learn the shadow baseline and the motion reference again. */
  const reset=()=>{shadows=createShadowBaseline();previous=undefined;lastMeans=undefined;markMeans=undefined;};
  return Object.assign((frame:FieldFrame):FieldAnalysis=>{
    let image:RGBAImage;
    if(!('close' in frame))image=frame;
    else {
      const width=Math.min(320,frame.width),height=Math.max(3,Math.round(frame.height*width/frame.width));
      const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d',{willReadFrequently:true})!;
      context.drawImage(frame,0,0,width,height);image=context.getImageData(0,0,width,height);
    }
    const before=previous;previous=image;
    let motionRegion:FractionalBox|undefined;
    if(before&&before.width===image.width&&before.height===image.height){
      let left=image.width,top=image.height,right=0,bottom=0,changed=0;
      for(let y=0;y<image.height;y+=2)for(let x=0;x<image.width;x+=2){
        const i=(y*image.width+x)*4;
        const delta=(Math.abs(image.data[i]-before.data[i])+Math.abs(image.data[i+1]-before.data[i+1])+Math.abs(image.data[i+2]-before.data[i+2]))/(3*255);
        if(delta<=.08)continue;
        left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+2);bottom=Math.max(bottom,y+2);changed++;
      }
      if(changed>=4)motionRegion={x:left/image.width,y:top/image.height,w:(Math.min(right,image.width)-left)/image.width,h:(Math.min(bottom,image.height)-top)/image.height};
    }
    const crop=(card:DetectedQuad,padding:number)=>{const b=boundsOf(card.quad);return {left:Math.max(1,Math.floor((b.x-b.w*padding)*image.width)),top:Math.max(1,Math.floor((b.y-b.h*padding)*image.height)),right:Math.min(image.width-1,Math.ceil((b.x+b.w*(1+padding))*image.width)),bottom:Math.min(image.height-1,Math.ceil((b.y+b.h*(1+padding))*image.height))};};
    const occlusions=new WeakMap<DetectedQuad,number>(),nearSkin=new WeakMap<DetectedQuad,number>();
    const shadow=shadows(image),means=shadow.means,lastScene=lastMeans,markScene=markMeans;lastMeans=means;
    const scene:FieldSceneChange|undefined=means&&{moving:changedCells(means,lastScene),sinceMark:changedCells(means,markScene),mark(){markMeans=means;}};
    const analysis:FieldAnalysis={
      scene,motionRegion,shadow,frameSharpness:frameSharpness(image),
      crop(card) {
        // Detector corners are portrait ordered even for a card in Defense Position.
        if(!('close' in frame))return warpQuad(frame,card.quad.map(p=>({x:p.x*frame.width,y:p.y*frame.height})) as Quad,96,140)??undefined;
        const box=boundsOf(card.quad),x=Math.max(0,Math.floor(box.x*frame.width)),y=Math.max(0,Math.floor(box.y*frame.height));
        const w=Math.min(frame.width,Math.ceil((box.x+box.w)*frame.width))-x,h=Math.min(frame.height,Math.ceil((box.y+box.h)*frame.height))-y;
        if(w<3||h<3)return undefined;
        faceCanvas??=new OffscreenCanvas(96,140);
        const context=faceCanvas.getContext('2d',{willReadFrequently:true})!;
        context.globalCompositeOperation='copy';
        context.drawImage(frame,x,y,w,h,0,0,96,140);
        const patch=context.getImageData(0,0,96,140);
        return warpQuad(patch,card.quad.map(p=>({x:(p.x*frame.width-x)*96/w,y:(p.y*frame.height-y)*140/h})) as Quad,96,140)??undefined;
      },
      appearance(card) {
        const patch=warpQuad(image,card.quad.map(p=>({x:p.x*image.width,y:p.y*image.height})) as Quad,8,12);
        if(!patch)return [];
        return Array.from(patch.data).filter((_,i)=>i%4!==3).map(v=>v/255);
      },
      background(card) {
        // A detector quad may extend beyond the camera while a card slides out.
        // Warp padding is black, not mat evidence: inspect only visible pixels.
        if(card.quad.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1))return undefined;
        const b=crop(card,0),values:number[]=[];
        if(b.right<=b.left||b.bottom<=b.top)return [];
        for(let y=0;y<12;y++)for(let x=0;x<8;x++){
          const px=Math.min(b.right-1,Math.floor(b.left+(x+.5)*(b.right-b.left)/8));
          const py=Math.min(b.bottom-1,Math.floor(b.top+(y+.5)*(b.bottom-b.top)/12)),i=(py*image.width+px)*4;
          values.push(image.data[i]/255,image.data[i+1]/255,image.data[i+2]/255);
        }
        return values;
      },
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
      motionOutside(card) {
        if(!before||before.width!==image.width||before.height!==image.height)return 1;
        const b=crop(card,.18);let sum=0,n=0,changed=0;
        for(let y=1;y<image.height-1;y+=2)for(let x=1;x<image.width-1;x+=2){
          if(x>=b.left&&x<b.right&&y>=b.top&&y<b.bottom)continue;
          const i=(y*image.width+x)*4,d=(Math.abs(image.data[i]-before.data[i])+Math.abs(image.data[i+1]-before.data[i+1])+Math.abs(image.data[i+2]-before.data[i+2]))/(3*255);
          sum+=d;if(d>.08)changed++;n++;
        }
        return n?Math.max(sum/n,changed/n*.2):1;
      },
      occluded(card) {return analysis.touched!(card)>.12;},
      skinNear(card) {if(!nearSkin.has(card))analysis.touched!(card);return nearSkin.get(card)??0;},
      /** Fraction of the card covered by skin connected to the crop edge (a hand). */
      touched(card) {
        const cached=occlusions.get(card);if(cached!==undefined)return cached;
        // Skin must connect through the sleeve edge to the surrounding hand.
        // Warm printed artwork alone is not an occluder, even while stationary.
        const b=crop(card,.3),box=boundsOf(card.quad),step=2,w=Math.ceil((b.right-b.left)/step),h=Math.ceil((b.bottom-b.top)/step);
        if(w<=0||h<=0)return 0;
        const mask=new Uint8Array(w*h),inside=new Uint8Array(w*h),edge=new Uint8Array(w*h),queue:number[]=[];
        let total=0,covered=0,near=0;
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){
          const px=b.left+x*step,py=b.top+y*step,i=(py*image.width+px)*4,index=y*w+x;
          const r=image.data[i],g=image.data[i+1],blue=image.data[i+2];
          const cb=128-.168736*r-.331264*g+.5*blue,cr=128+.5*r-.418688*g-.081312*blue;
          mask[index]=Number(r>40&&r>g&&r>blue&&cb>=77&&cb<=127&&cr>=133&&cr<=173);
          const signs=card.quad.map((a,j)=>{const next=card.quad[(j+1)%4];return (next.x-a.x)*(py/image.height-a.y)-(next.y-a.y)*(px/image.width-a.x);});
          inside[index]=Number(signs.every(v=>v>=0)||signs.every(v=>v<=0));total+=inside[index];
          // The edge ring: just outside the card (12% of its size), not the neighbouring zone (an orange card frame there is not a hand).
          const fx=px/image.width,fy=py/image.height;edge[index]=Number(!inside[index]&&fx>=box.x-box.w*.12&&fx<=box.x+box.w*1.12&&fy>=box.y-box.h*.12&&fy<=box.y+box.h*1.12);
          if(mask[index]&&(x===0||y===0||x===w-1||y===h-1)){mask[index]=2;queue.push(index);}
        }
        for(let head=0;head<queue.length;head++){
          const index=queue[head],x=index%w,y=Math.floor(index/w);covered+=inside[index];near+=edge[index];
          for(const next of [x>0?index-1:-1,x+1<w?index+1:-1,y>0?index-w:-1,y+1<h?index+w:-1])
            if(next>=0&&mask[next]===1){mask[next]=2;queue.push(next);}
        }
        let ring=0;for(let i=0;i<w*h;i++)ring+=edge[i];
        const result=total>0?covered/total:0;occlusions.set(card,result);nearSkin.set(card,ring>0?near/ring:0);return result;
      },
      sharpness(card) {
        const b=crop(card,0),w=b.right-b.left,h=b.bottom-b.top;
        if(w<3||h<3)return 0;
        const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)data.set(image.data.subarray(((b.top+y)*image.width+b.left)*4,((b.top+y)*image.width+b.right)*4),y*w*4);
        return sharpness({width:w,height:h,data});
      },
    };
    return analysis;
  },{reset});
}

/** Laplacian variance of the grey frame (every 2nd pixel): drops when the camera is blurred (focus hunting, motion blur). */
export function frameSharpness(image:RGBAImage):number {
  const {width:w,height:h,data:d}=image,grey=(x:number,y:number)=>{const i=(y*w+x)*4;return d[i]*.299+d[i+1]*.587+d[i+2]*.114;};
  let sum=0,sq=0,n=0;
  for(let y=2;y<h-2;y+=2)for(let x=2;x<w-2;x+=2){const v=4*grey(x,y)-grey(x-2,y)-grey(x+2,y)-grey(x,y-2)-grey(x,y+2);sum+=v;sq+=v*v;n++;}
  return n?sq/n-(sum/n)**2:0;
}
/**
 * Grid cells whose mean colour changed, after the median shift of all cells is removed (exposure and flicker).
 * A cell averages about 19 samples, so camera noise stays low while a card moved by 6 camera pixels at 1080p still shows. No reference counts as changed: the detector has not seen this scene.
 */
export function changedCells(now:Float32Array,before?:Float32Array):number {
  if(!before||before.length!==now.length)return now.length/3;
  const cells=now.length/3,shift=[0,0,0],values=new Float32Array(cells);
  for(let k=0;k<3;k++){for(let c=0;c<cells;c++)values[c]=now[c*3+k]-before[c*3+k];values.sort();shift[k]=values[cells>>1];}
  for(let c=0;c<cells;c++)values[c]=(Math.abs(now[c*3]-before[c*3]-shift[0])+Math.abs(now[c*3+1]-before[c*3+1]-shift[1])+Math.abs(now[c*3+2]-before[c*3+2]-shift[2]))/3;
  // Noise floor from this frame's own cells: a real change touches few cells, so the median stays camera noise.
  const deltas=values.slice().sort(),floor=deltas[cells>>1];
  if(floor>SCENE_WHOLE_DELTA)return cells;
  const limit=Math.max(SCENE_CELL_DELTA,floor*SCENE_NOISE_FACTOR);
  let changed=0;for(let c=0;c<cells;c++)if(values[c]>limit)changed++;
  return changed;
}
/** About 5 sigma of the median absolute cell delta. Above SCENE_WHOLE_DELTA the median cell itself moved: the whole view changed. */
const SCENE_CELL_DELTA=4,SCENE_NOISE_FACTOR=7.4,SCENE_WHOLE_DELTA=8;
const SHADOW_GX=32,SHADOW_GY=24;
/**
 * Shadow = a cell that is 20-65% darker than its recent background but keeps
 * the same chromaticity (a lifted card or a hand changes the colour too). The
 * background follows brighter or equal light fast and darker light slowly (~15 s),
 * so a shadow from above that covers the whole board still counts as a shadow.
 */
export function createShadowBaseline() {
  let base:Float32Array|undefined,flags:Uint8Array|undefined,size='';
  return (image:RGBAImage):FieldShadow=>{
    const cells=SHADOW_GX*SHADOW_GY,sum=new Float32Array(cells*4),key=`${image.width}x${image.height}`;
    for(let y=0;y<image.height;y+=2)for(let x=0;x<image.width;x+=2){
      const i=(y*image.width+x)*4,c=(Math.min(SHADOW_GY-1,Math.floor(y*SHADOW_GY/image.height))*SHADOW_GX+Math.min(SHADOW_GX-1,Math.floor(x*SHADOW_GX/image.width)))*4;
      sum[c]+=image.data[i];sum[c+1]+=image.data[i+1];sum[c+2]+=image.data[i+2];sum[c+3]++;
    }
    const means=new Float32Array(cells*3);for(let c=0;c<cells;c++)for(let k=0;k<3;k++)means[c*3+k]=sum[c*4+k]/Math.max(1,sum[c*4+3]);
    if(!base||size!==key){base=means.slice();flags=new Uint8Array(cells);size=key;return {means,share:0,changed:0};}
    let dark=0,changed=0;const moved=new Uint8Array(cells);
    for(let c=0;c<cells;c++){
      const n=Math.max(1,sum[c*4+3]),r=sum[c*4]/n,g=sum[c*4+1]/n,b=sum[c*4+2]/n,l=r+g+b,br=base[c*3],bg=base[c*3+1],bb=base[c*3+2],bl=br+bg+bb;
      const chroma=l>15&&bl>15?Math.abs(r/l-br/bl)+Math.abs(g/l-bg/bl):1;
      // Much darker than a shadow (a white card lifted off a dark mat): new content, not light. The
      // baseline takes it at once; a slow fade would show a moving "shadow" there for many seconds.
      if(bl>30&&l<=bl*.35){base[c*3]=r;base[c*3+1]=g;base[c*3+2]=b;if(flags![c]){changed++;moved[c]=1;}flags![c]=0;continue;}
      const shadow=bl>30&&l<bl*.8&&chroma<=.05?1:0;
      if(shadow)dark++;if(shadow!==flags![c]){changed++;moved[c]=1;}flags![c]=shadow;
      const rate=l>=bl*.92?.25:.01;
      base[c*3]+=(r-br)*rate;base[c*3+1]+=(g-bg)*rate;base[c*3+2]+=(b-bb)*rate;
    }
    return {means,share:dark/cells,changed:changed/cells,moved,gx:SHADOW_GX,gy:SHADOW_GY};
  };
}

/**
 * Illumination-invariant match of two8x12 RGB patches: a light gain per tile
 * (4x4 tiles, shared by the three channels) is fitted from a to b, so a soft shadow
 * over the card (30-70% darker, soft edge) still matches while a clear mat
 * (no texture) or another card does not. Also tries the 180° turn.
 */
export function sameShadedFieldAppearance(a?:number[],b?:number[]):boolean {
  if(!a?.length||a.length!==b?.length||a.length%3)return false;
  const n=a.length/3,w=n===96?8:Math.round(Math.sqrt(n)),h=Math.max(1,Math.round(n/w));
  // Texture floor (all channels): a flat patch has no structure to keep (a plain sleeve, the mat).
  const mean=[0,1,2].map(k=>a.reduce((sum,v,i)=>sum+(i%3===k?v:0),0)/n);
  const spread=Math.sqrt(a.reduce((sum,v,i)=>sum+(v-mean[i%3])**2,0)/a.length);
  if(spread<.04)return false;
  const fit=(reverse:boolean)=>{
    const at=(i:number)=>reverse?n-1-i:i,tx=4,ty=4,tile=(i:number)=>Math.min(ty-1,Math.floor(Math.floor(i/w)*ty/h))*tx+Math.min(tx-1,Math.floor((i%w)*tx/w));
    // Least squares per tile: b_k ~ a_k * gain(tile), one gain for all three channels (a shadow is neutral).
    const xy=new Float64Array(tx*ty),xx=new Float64Array(tx*ty);
    for(let i=0;i<n;i++)for(let k=0;k<3;k++){const x=a[at(i)*3+k],t=tile(i);xy[t]+=x*b[i*3+k];xx[t]+=x*x;}
    const gains=Array.from(xx,(v,t)=>v>1e-9?xy[t]/v:NaN);
    if(gains.some(g=>!(g>=.2&&g<=1.3)))return Infinity;
    // Neighbouring tiles under one soft shadow cannot differ wildly.
    const sorted=[...gains].sort((p,q)=>p-q);if(sorted[0]<sorted.at(-1)!*.25)return Infinity;
    let error=0;for(let i=0;i<n;i++)for(let k=0;k<3;k++)error+=(b[i*3+k]-a[at(i)*3+k]*gains[tile(i)])**2;
    // Residual relative to the remaining light and the card's own texture.
    const g2=(gains.reduce((s,v)=>s+v,0)/gains.length)**2;return error/(3*n)/Math.max(.04,g2)/Math.max(1e-6,spread*spread);
  };
  return Math.min(fit(false),fit(true))<.12;
}

/** Cheap pixel evidence for reconnecting a temporarily hidden card, never an identity decision. */
export function sameFieldAppearance(a?:number[],b?:number[]):boolean {
  return fieldAppearanceDistance(a,b)<.009;
}

/** Remove bounded exposure/white-balance drift, retaining structural changes. */
export function fieldAppearanceDistance(a?:number[],b?:number[]):number {
  if(!a?.length||a.length!==b?.length)return Infinity;
  const shift=[0,1,2].map(c=>Math.max(-.18,Math.min(.18,a.reduce((sum,v,i)=>sum+(i%3===c?v-b[i]:0),0)/(a.length/3))));
  const error=(reverse:boolean)=>a.reduce((sum,v,i)=>{const j=reverse?(Math.floor((a.length-1-i)/3)*3+i%3):i;return sum+(v-b[j]-shift[i%3])**2;},0)/a.length;
  return Math.min(error(false),error(true));
}

/** Compare local identity references only within the same embedding space. */
export function fieldEmbeddingSimilarity(a?:{values:number[];space:string},b?:{values:number[];space:string}):number|undefined {
  if(!a?.values.length||a.space!==b?.space||a.values.length!==b.values.length)return;
  let dot=0,aa=0,bb=0;
  for(let i=0;i<a.values.length;i++){const x=a.values[i],y=b.values[i];if(!Number.isFinite(x)||!Number.isFinite(y))return;dot+=x*y;aa+=x*x;bb+=y*y;}
  return aa>0&&bb>0?dot/Math.sqrt(aa*bb):undefined;
}

/** A detector miss is only absence when the old footprint looks like clear mat.
 * Unknown or patterned surroundings abstain rather than classify a still hand. */
export function clearFieldBackground(inside?:number[],halo?:number[]):boolean {
  if(!inside?.length||inside.length%3||!halo?.length||halo.length%3)return false;
  const center=[0,1,2].map(c=>halo.filter((_,i)=>i%3===c).sort((a,b)=>a-b)[Math.floor(halo.length/6)]);
  const distances=(pixels:number[])=>Array.from({length:pixels.length/3},(_,i)=>(Math.abs(pixels[i*3]-center[0])+Math.abs(pixels[i*3+1]-center[1])+Math.abs(pixels[i*3+2]-center[2]))/3);
  const ring=distances(halo).sort((a,b)=>a-b),spread=ring[Math.ceil(ring.length*.9)-1];
  if(!Number.isFinite(spread)||spread>.055)return false;
  const tolerance=Math.max(.035,spread*1.5),patch=distances(inside);
  return patch.filter(d=>Number.isFinite(d)&&d<=tolerance).length/patch.length>=.95;
}

/** Quarter-turn comparison of the small8x12 RGB tracker patch; no model inference. */
export function sameRotatedFieldAppearance(a?:number[],b?:number[]):boolean {
  if(sameFieldAppearance(a,b))return true;
  if(a?.length!==288||b?.length!==288)return false;
  for(const clockwise of [false,true]){
    const rotated=Array.from({length:288},(_,i)=>{
      const pixel=Math.floor(i/3),x=pixel%8,y=Math.floor(pixel/8);
      const sx=Math.round((clockwise?y/11:1-y/11)*7),sy=Math.round((clockwise?1-x/7:x/7)*11);
      return a[(sy*8+sx)*3+i%3];
    });
    if(sameFieldAppearance(rotated,b))return true;
  }
  return false;
}

/** Clear old mat for a transfer, excluding only the observed incoming card.
 * Never used for disappearance: removal still needs the entire original footprint.
 */
export function clearFieldTransfer(evidence:FieldAnalysis,old:DetectedQuad,incoming:DetectedQuad,reference?:number[]):boolean {
  const patch=evidence.appearance?.(old),halo=evidence.halo?.(old);
  if(!patch?.length||!halo?.length||halo.length!==reference?.length)return false;
  // Production samples are8x12 RGB and a64-point RGB ring. Injected analyzers
  // without that geometry keep the original conservative whole-footprint check.
  if(patch.length!==288||halo.length!==192)return halo.filter((v,i)=>Math.abs(v-reference[i])>.06).length/halo.length<=.08&&clearFieldBackground(patch,reference);
  const map=quadMap(old.quad as Quad);if(!map)return false;
  const box=boundsOf(old.quad),next=boundsOf(incoming.quad),padX=box.w*.04,padY=box.h*.04;
  const exposed=(x:number,y:number)=>x<next.x-padX||x>next.x+next.w+padX||y<next.y-padY||y>next.y+next.h+padY;
  const inside:number[]=[],ring:number[]=[],saved:number[]=[];
  for(let y=0;y<12;y++)for(let x=0;x<8;x++){
    const point=map((x+.5)/8,(y+.5)/12),i=(y*8+x)*3;
    if(exposed(point.x,point.y))inside.push(...patch.slice(i,i+3));
  }
  let i=0;
  for(let y=0;y<10;y++)for(let x=0;x<10;x++){
    if(x>1&&x<8&&y>1&&y<8)continue;
    if(exposed(box.x+box.w*(-.3+1.6*x/9),box.y+box.h*(-.3+1.6*y/9))){ring.push(...halo.slice(i,i+3));saved.push(...reference.slice(i,i+3));}
    i+=3;
  }
  // A hand or another card must not be hidden by an overwhelmingly large mask.
  return inside.length>=patch.length*.5&&ring.length>=halo.length*.5&&ring.filter((v,i)=>Math.abs(v-saved[i])>.06).length/ring.length<=.08&&clearFieldBackground(inside,saved);
}
