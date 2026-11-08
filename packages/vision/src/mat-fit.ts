import {createFieldCalibration, FIELD_ZONE_PITCH, type FieldCalibration, type FieldOrientation, type PlayerSide} from './field-zones';
import type {Point} from './types';
import type {RGBAImage} from './pixels';
import {quadMap} from './geometry';

export interface MatFitOptions { playerSide?:PlayerSide; mirrored?:boolean }
export interface MatFitResult {
  /** Image-clockwise TL, TR, BR, BL, normalized like FieldCalibration. May extrapolate off camera. */
  corners:[Point,Point,Point,Point]|null;
  orientation:FieldOrientation;
  mirror:boolean;
  confidence:'high'|'low';
  flags:{colWindowAmbiguous:boolean;sideByPrior:boolean;zonesFound:number;reason:string};
  reason:string;
  /** Equally supported opposite side, including its row window (not just a label rotation). */
  flipped?:{corners:[Point,Point,Point,Point];orientation:FieldOrientation};
  metrics:{inliers:number;rows:number;columns:number;columnSpan:number;meanErrorPitch:number;maxErrorPitch:number};
}
interface Rect {nested?:boolean;edgeMin:number;printed?:boolean;score:number;cx:number;cy:number;w:number;h:number;angle:number}
interface Lattice {theta:number;rows:number[];cols:number[];rspan:number;cspan:number;nr:number;nc:number;px:number;py:number}
interface Hypothesis {side:'top'|'bottom';mirror:boolean;r0:number;c0:number;score:number}
const rad=Math.PI/180;
const median=(v:number[])=>{v.sort((a,b)=>a-b);return (v[(v.length-1)>>1]+v[v.length>>1])/2;};
const mod=(a:number,b:number)=>((a%b)+b)%b;

/** Linear-time selection; copies only the eligible values, never sorts image-sized JS arrays. */
function percentile(input:Float32Array,p:number,positive=false):number {
  const a=new Float32Array(input.length);let n=0;
  for(let i=0;i<input.length;i++)if(!positive||input[i]>0)a[n++]=input[i];
  if(!n)return Infinity;
  const k=Math.floor((n-1)*p);let lo=0,hi=n-1;
  while(lo<hi){
    const pivot=a[(lo+hi)>>1];let i=lo,j=hi;
    while(i<=j){while(a[i]<pivot)i++;while(a[j]>pivot)j--;if(i<=j){const t=a[i];a[i++]=a[j];a[j--]=t;}}
    if(k<=j)hi=j;else if(k>=i)lo=i;else break;
  }
  return a[k];
}
function blur(a:Float32Array,w:number,h:number,sigma:number):Float32Array {
  const r=Math.ceil(4*sigma),kernel=new Float32Array(2*r+1);let sum=0;
  for(let k=-r;k<=r;k++)sum+=kernel[k+r]=Math.exp(-k*k/(2*sigma*sigma));
  for(let k=0;k<kernel.length;k++)kernel[k]/=sum;
  const tmp=new Float32Array(a.length),out=new Float32Array(a.length);
  const reflect=(v:number,n:number)=>v<0?-v:v>=n?2*n-2-v:v;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let s=0;for(let k=-r;k<=r;k++)s+=a[y*w+reflect(x+k,w)]*kernel[k+r];tmp[y*w+x]=s;
  }
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let s=0;for(let k=-r;k<=r;k++)s+=tmp[reflect(y+k,h)*w+x]*kernel[k+r];out[y*w+x]=s;
  }
  return out;
}
function ridges(image:RGBAImage) {
  // Half resolution, bounded for 4K cameras. Rectangle search never processes more than 832x600.
  const scale=Math.min(.5,832/image.width,600/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale);
  const gray=new Float32Array(w*h),{data}=image;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    // Four subpixel samples approximate area downsampling and suppress thin camera noise.
    let g=0;
    for(const dy of [.25,.75])for(const dx of [.25,.75]){
      const ix=Math.min(image.width-1,Math.floor((x+dx)/scale)),iy=Math.min(image.height-1,Math.floor((y+dy)/scale)),i=(iy*image.width+ix)*4;
      g+=.299*data[i]+.587*data[i+1]+.114*data[i+2];
    }
    gray[y*w+x]=Math.round(g/4)/255;
  }
  const mean=blur(gray,w,h,10);
  for(let i=0;i<gray.length;i++)gray[i]/=mean[i]+.08;
  const gs=blur(gray,w,h,1.1),strength=new Float32Array(w*h),angle=new Float32Array(w*h);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=y*w+x,a=gs[i-w-1],b=gs[i-w],c=gs[i-w+1],d=gs[i-1],e=gs[i],f=gs[i+1],g=gs[i+w-1],j=gs[i+w],k=gs[i+w+1];
    const xx=a-2*b+c+2*d-4*e+2*f+g-2*j+k,yy=a+2*b+c-2*d-4*e-2*f+g+2*j+k,xy=a-c-g+k;
    const mid=(xx+yy)/2,delta=Math.hypot((xx-yy)/2,xy),l1=mid-delta,l2=mid+delta;
    const bright=Math.max(0,-l1)-.5*Math.abs(l2),dark=Math.max(0,l2)-.5*Math.abs(l1);
    strength[i]=Math.max(0,bright,dark);
    angle[i]=mod(.5*Math.atan2(2*xy,xx-yy)+(bright>=dark?0:Math.PI/2),Math.PI);
  }
  return {strength,angle,w,h};
}
function estimateTilt(r:Float32Array,phi:Float32Array,w:number):number {
  const threshold=percentile(r,.94),points:{x:number;y:number;a:number;v:number}[]=[];let re=0,im=0;
  for(let i=0;i<r.length;i++)if(r[i]>threshold){const a=phi[i];re+=r[i]*Math.cos(4*a);im+=r[i]*Math.sin(4*a);points.push({x:i%w,y:Math.floor(i/w),a,v:r[i]});}
  const theta=Math.atan2(im,re)/4/rad;let best=-1,chosen=theta;
  const extent=Math.ceil(2*Math.hypot(w,r.length/w));
  for(let delta=-4;delta<=4;delta+=.5){
    const t=(theta+delta)*rad,c=Math.cos(t),s=Math.sin(t),hor=new Float32Array(extent*2),vert=new Float32Array(extent*2);
    for(const p of points){
      if(Math.abs(mod(p.a-t+Math.PI/4,Math.PI/2)-Math.PI/4)>=10*rad)continue;
      const isH=Math.abs(mod(p.a-t+Math.PI/2,Math.PI)-Math.PI/2)<Math.PI/4;
      const v=isH?-p.x*s+p.y*c:p.x*c+p.y*s;(isH?hor:vert)[Math.round(v)+extent]+=p.v;
    }
    let score=0;
    for(const hist of [hor,vert])for(let i=3;i<hist.length-3;i++){
      const v=.39905*hist[i]+.24204*(hist[i-1]+hist[i+1])+.05401*(hist[i-2]+hist[i+2])+.00443*(hist[i-3]+hist[i+3]);score+=v*v;
    }
    if(score>best){best=score;chosen=theta+delta;}
  }
  return chosen;
}
/** Rectify each ridge family, suppress across-line maxima, threshold and grow only across lines. */
function lineMasks(r:Float32Array,phi:Float32Array,w:number,h:number,theta:number) {
  const t=theta*rad,c=Math.cos(t),s=Math.sin(t),hor=new Float32Array(r.length),vert=new Float32Array(r.length);
  for(let i=0;i<r.length;i++){
    if(Math.abs(mod(phi[i]-t+Math.PI/4,Math.PI/2)-Math.PI/4)>=14*rad)continue;
    const isH=Math.abs(mod(phi[i]-t+Math.PI/2,Math.PI)-Math.PI/2)<Math.PI/4;(isH?hor:vert)[i]=r[i];
  }
  return [hor,vert].map((src,family)=>{
    const warped=new Float32Array(r.length),thin=new Float32Array(r.length),mask=new Uint8Array(r.length),step=family===0?w:1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const ox=w/2+c*(x-w/2)-s*(y-h/2),oy=h/2+s*(x-w/2)+c*(y-h/2),ix=Math.floor(ox),iy=Math.floor(oy);
      if(ix<0||iy<0||ix>=w-1||iy>=h-1)continue;
      const fx=ox-ix,fy=oy-iy,i=iy*w+ix;
      warped[y*w+x]=(1-fy)*(src[i]*(1-fx)+src[i+1]*fx)+fy*(src[i+w]*(1-fx)+src[i+w+1]*fx);
    }
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=y*w+x;if(warped[i]>=warped[i-step]&&warped[i]>=warped[i+step])thin[i]=warped[i];
    }
    const threshold=percentile(thin,.88,true);
    for(let y=2;y<h-2;y++)for(let x=2;x<w-2;x++){
      const i=y*w+x;if(thin[i]>threshold)for(let d=-2;d<=2;d++)mask[i+d*step]=1;
    }
    return mask;
  });
}
function search(hor:Uint8Array,vert:Uint8Array,w:number,h:number,angle:number):Rect[] {
  // Directional integral images give each side's support in O(1).
  const ch=new Uint32Array((w+1)*h),cv=new Uint32Array(w*(h+1));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    ch[y*(w+1)+x+1]=ch[y*(w+1)+x]+hor[y*w+x];cv[(y+1)*w+x]=cv[y*w+x]+vert[y*w+x];
  }
  const found:Rect[]=[];
  for(let rh=Math.floor(.12*h);rh<=Math.floor(.3*h);rh+=6)for(const aspect of [.62,.68,.74]){
    const rw=Math.round(rh*aspect);
    for(let y=0;y+rh<h;y+=3){
      const ht=y*(w+1),hb=(y+rh)*(w+1),vt=y*w,vb=(y+rh)*w;
      for(let x=0;x+rw<w;x+=3){
        const top=(ch[ht+x+rw]-ch[ht+x])/rw,bottom=(ch[hb+x+rw]-ch[hb+x])/rw,left=(cv[vb+x]-cv[vt+x])/rh,right=(cv[vb+x+rw]-cv[vt+x+rw])/rh;
        const worst=Math.min(top,bottom,left,right),sum=top+bottom+left+right;
        // At least three supported sides; the missing side can be occluded by a hand or card.
        if(Number(top>=.3)+Number(bottom>=.3)+Number(left>=.3)+Number(right>=.3)<3)continue;
        const score=.8*(sum-worst)/3+.2*worst;
        if(score>=.5)found.push({score,edgeMin:worst,cx:x+rw/2,cy:y+rh/2,w:rw,h:rh,angle});
      }
    }
  }
  found.sort((a,b)=>b.score-a.score);const groups:Rect[][]=[];
  for(const a of found){
    const group=groups.find(([b])=>{
      const ix=Math.max(0,Math.min(a.cx+a.w/2,b.cx+b.w/2)-Math.max(a.cx-a.w/2,b.cx-b.w/2)),iy=Math.max(0,Math.min(a.cy+a.h/2,b.cy+b.h/2)-Math.max(a.cy-a.h/2,b.cy-b.h/2)),inter=ix*iy;
      return inter/(a.w*a.h+b.w*b.h-inter)>.25;
    });
    if(group)group.push(a);else if(groups.length<40)groups.push([a]);
  }
  const keep=groups.flatMap(group=>{
    const anchor=group[0],sizes=new Map<string,Rect>();
    for(const a of group)if(Math.hypot(a.cx-anchor.cx,a.cy-anchor.cy)<=.1*Math.max(a.h,anchor.h)&&a.h/anchor.h>=.8&&a.h/anchor.h<=1.25){
      const key=`${a.w}:${a.h}`;if(!sizes.has(key))sizes.set(key,a);
    }
    return [...sizes.values()];
  });
  const c=Math.cos(angle*rad),s=Math.sin(angle*rad);
  return keep.map(a=>({...a,cx:w/2+c*(a.cx-w/2)-s*(a.cy-h/2),cy:h/2+s*(a.cx-w/2)+c*(a.cy-h/2)}));
}
/** An aligned outer outline wins over a stronger card edge inside it. */
function outerFrame(outer:Rect,inner:Rect):boolean {
  const ratio=outer.h/inner.h;
  return outer.edgeMin>=.3&&ratio>=1.05&&ratio<=1.25&&Math.hypot(outer.cx-inner.cx,outer.cy-inner.cy)<=.1*outer.h&&outer.w>=inner.w;
}
function outline(group:Rect[]):Rect {
  const anchor=group[0];
  return group.filter(a=>a===anchor||outerFrame(a,anchor)).sort((a,b)=>b.h-a.h||b.score-a.score)[0];
}
function neighbours(a:Rect,b:Rect):boolean {
  const dx=b.cx-a.cx,dy=b.cy-a.cy,w=(a.w+b.w)/2,h=(a.h+b.h)/2,dist=Math.hypot(dx,dy);
  return dist>=w&&dist<=3.2*w&&Math.abs(dy)<.36*Math.abs(dx)+.15*h&&Math.abs(dx)>.8*w
    ||dist>=.95*h&&dist<=1.6*h&&Math.abs(dx)<.36*Math.abs(dy)+.15*w&&Math.abs(dy)>.8*h;
}
function filter(rects:Rect[]):Rect[] {
  const groups:Rect[][]=[];rects.sort((a,b)=>b.score-a.score);
  for(const a of rects){
    const group=groups.find(([b])=>Math.hypot(a.cx-b.cx,a.cy-b.cy)<=.45*Math.min(a.h,b.h));
    if(group)group.push(a);else groups.push([a]);
  }
  // Vote once per physical centre at each size, so repeated angle searches
  // and strong card edges cannot outweigh a connected set of printed frames.
  const sizes=new Map<string,Rect>();
  for(const a of rects)sizes.set(`${a.w}:${a.h}`,a);
  let frames:Rect[]=[],support=-1,height=0,width=0;
  for(const target of sizes.values()){
    const candidates=groups.map(group=>{const sized=group.filter(a=>Math.abs(a.h-target.h)<.09*target.h&&Math.abs(a.w-target.w)<.17*target.w);return sized.length?outline(sized):undefined;}).filter((a):a is Rect=>!!a);
    const lat=candidates.length>=3?lattice(candidates):null;
    const bands:Rect[][]=[];
    const y=(a:Rect)=>a.cy*Math.cos((lat?.theta??0)*rad)-a.cx*Math.sin((lat?.theta??0)*rad);
    for(const a of [...candidates].sort((a,b)=>y(a)-y(b))){
      const last=bands.at(-1);if(!last||y(a)-y(last.at(-1)!)>.35*target.h)bands.push([a]);else last.push(a);
    }
    const aligned=bands.filter(row=>row.length>=2).sort((a,b)=>b.length-a.length).slice(0,2).flat();
    const connected=aligned.filter(a=>aligned.some(b=>a!==b&&neighbours(a,b)));
    const count=(connected.length>=3&&lattice(connected).nc>=4?1:0)*connected.reduce((sum,a)=>sum+connected.filter(b=>a!==b&&neighbours(a,b)).length,0);
    if(count>support||count===support&&target.h>height){support=count;frames=connected;height=target.h;width=target.w;}
  }
  frames=frames.filter(a=>a.score>=.55).sort((a,b)=>b.score-a.score).filter((a,i,all)=>!all.slice(0,i).some(b=>Math.hypot(a.cx-b.cx,a.cy-b.cy)<.3*Math.min(a.h,b.h)));
  const printedHeight=frames.length?median(frames.map(a=>a.h)):height;
  frames=frames.map(a=>{
    const group=groups.find(group=>group.includes(a))!;
    const inner=group.find(b=>b.h<=a.h/1.05&&b.h>=a.h/1.25);
    const concentric=!inner||Math.hypot(a.cx-inner.cx,a.cy-inner.cy)<=.08*a.h;
    const nested=group.some(b=>a.h-b.h>=.14*a.h&&outerFrame(a,b));
    return {...a,nested,printed:a.h>=printedHeight/1.05&&concentric};
  });
  // Smaller card centres can support the fit, but cannot establish its outer columns.
  const angle=frames.length?median(frames.map(a=>a.angle))*rad:0;
  const sameRow=(a:Rect,b:Rect)=>Math.abs((a.cy-b.cy)*Math.cos(angle)-(a.cx-b.cx)*Math.sin(angle))<.2*height;
  const cards=groups.filter(group=>!frames.some(b=>Math.hypot(group[0].cx-b.cx,group[0].cy-b.cy)<.45*height))
    .map(group=>group.find(a=>a.score>=.55&&a.h<height/1.05&&a.h>=height/1.25&&a.w<width*1.05&&frames.some(b=>sameRow(a,b)&&neighbours(a,b))))
    .filter((a):a is Rect=>!!a).map(a=>({...a,printed:false}));
  return [...frames,...cards];
}

/** A filled card has a sustained tone step across its edges; an empty printed
 * outline is a thin ridge on the same mat. Use all four sides conservatively. */
function filledRectangle(a:Rect,image:RGBAImage,w:number,h:number,theta:number):boolean {
  const c=Math.cos(theta*rad),s=Math.sin(theta*rad),differences:number[]=[];
  const value=(x:number,y:number)=>{
    const ix=Math.round(x*image.width/w),iy=Math.round(y*image.height/h);
    if(ix<0||iy<0||ix>=image.width||iy>=image.height)return NaN;
    const i=(iy*image.width+ix)*4;return (.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2])/255;
  };
  for(let side=0;side<4;side++){
    let difference=0,count=0;
    for(let j=2;j<18;j++)for(const offset of [4,6]){
      const u=(j+.5)/20-.5,sign=side%2?1:-1;
      const x=side<2?u*a.w:sign*a.w/2,y=side<2?sign*a.h/2:u*a.h;
      const nx=side<2?0:sign,ny=side<2?sign:0;
      const point=(d:number)=>value(a.cx+c*(x+nx*d)-s*(y+ny*d),a.cy+s*(x+nx*d)+c*(y+ny*d));
      const delta=point(offset)-point(-offset);if(Number.isFinite(delta)){difference+=delta;count++;}
    }
    if(!count)return false;differences.push(difference/count);
  }
  return differences.every(d=>d>.06)||differences.every(d=>d<-.06);
}

/** Check faint outer frames directly in the ridges: the global edge threshold
 * can hide them when many brighter card outlines occupy the mat. */
function recoverOuterFrames(rects:Rect[],strength:Float32Array,phi:Float32Array,w:number,h:number,image:RGBAImage):Rect[] {
  if(rects.length<4)return rects;
  const threshold=percentile(strength,.8,true),lat=lattice(rects),theta=lat.theta*rad,c=Math.cos(theta),s=Math.sin(theta);
  const supported=(x:number,y:number,family:number)=>{
    const px=Math.round(x),py=Math.round(y);
    if(px<0||py<0||px>=w||py>=h)return false;
    const i=py*w+px,expected=theta+(family?0:Math.PI/2);
    return strength[i]>threshold&&Math.abs(mod(phi[i]-expected+Math.PI/2,Math.PI)-Math.PI/2)<14*rad;
  };
  rects=rects.map(a=>a.nested?a:{...a,printed:a.printed&&!filledRectangle(a,image,w,h,lat.theta)});
  const outer=rects.map(a=>{
    let best:Rect|undefined,quality=0;
    for(const kh of [1.15,1.2,1.25])for(const kw of [1.18,1.24,1.3]){
      const rw=a.w*kw,rh=a.h*kh,sides=[0,0,0,0];
      // Keep clear of the card's own short edges, including ridge blur.
      if(rw<a.h*.78)continue;
      for(let j=0;j<20;j++){
        const u=(j+.5)/20;
        for(let side=0;side<4;side++){
          const x=side<2?(u-.5)*rw:(side===2?-.5:.5)*rw,y=side<2?(side===0?-.5:.5)*rh:(u-.5)*rh;
          if(supported(a.cx+c*x-s*y,a.cy+s*x+c*y,side<2?1:0))sides[side]++;
        }
      }
      const min=Math.min(...sides)/20,mean=sides.reduce((v,n)=>v+n)/80;
      if(min>=.5&&mean>quality){quality=mean;best={...a,w:rw,h:rh,printed:true};}
    }
    return best;
  });
  const evidence=outer.filter((a):a is Rect=>!!a);
  if(evidence.length<2)return rects;
  const proof=lattice(evidence);if(proof.nc<2)return rects;
  const cardHeight=median(rects.filter((_,i)=>outer[i]).map(a=>a.h));
  return rects.map((a,i)=>outer[i]??(Math.abs(a.h-cardHeight)<.09*cardHeight?{...a,printed:false}:a));
}

function cluster(values:number[],gap:number,minPitch:number,maxPitch:number,maxSpan:number) {
  const order=values.map((_,i)=>i).sort((a,b)=>values[a]-values[b]),groups:number[][]=[];
  for(const i of order){const last=groups.at(-1);if(!last||values[i]-values[last.at(-1)!]>gap)groups.push([i]);else last.push(i);}
  const centers=groups.map(g=>g.reduce((s,i)=>s+values[i],0)/g.length),gaps=centers.slice(1).map((v,i)=>v-centers[i]);
  if(!gaps.length)return {indices:values.map(()=>0),span:0,count:1,pitch:minPitch};
  // Vote for a whole lattice, rather than treating the shortest noisy gap as
  // a pitch. Missing columns and perspective can make that gap misleading.
  let pitch=minPitch,best=Infinity;
  for(let candidate=minPitch;candidate<=maxPitch;candidate+=.25){
    const indices=centers.map(c=>Math.round((c-centers[0])/candidate));
    if(Math.max(...indices)>maxSpan)continue;
    const error=centers.reduce((sum,c,i)=>sum+Math.min(.04,((c-centers[0])/candidate-indices[i])**2),0);
    if(error<best){best=error;pitch=candidate;}
  }
  let k=centers.map(c=>Math.round((c-centers[0])/pitch));
  const mx=k.reduce((a,b)=>a+b)/k.length,my=centers.reduce((a,b)=>a+b)/k.length;
  const den=k.reduce((s,x)=>s+(x-mx)**2,0);
  if(den>0)pitch=k.reduce((s,x,i)=>s+(x-mx)*(centers[i]-my),0)/den;
  k=centers.map(c=>Math.round((c-centers[0])/pitch));const indices:number[]=[];
  groups.forEach((g,i)=>g.forEach(j=>indices[j]=k[i]));
  return {indices,span:Math.max(...k),count:groups.length,pitch};
}
function lattice(d:Rect[]):Lattice {
  const w=median(d.map(a=>a.w)),h=median(d.map(a=>a.h));let best=-1,theta=0;
  // Broad enough for the same rotated fixtures as the seven-angle ridge search.
  for(let deg=-18;deg<=18;deg+=.5){
    const c=Math.cos(deg*rad),s=Math.sin(deg*rad),ys=d.map(p=>p.cy*c-p.cx*s);let score=0;
    for(const y of ys)for(const y2 of ys)score+=Math.exp(-.5*((y-y2)/(.1*h))**2);
    if(score>best){best=score;theta=deg;}
  }
  const c=Math.cos(theta*rad),s=Math.sin(theta*rad),rows=cluster(d.map(p=>p.cy*c-p.cx*s),.45*h,.95*h,1.7*h,2),cols=cluster(d.map(p=>p.cx*c+p.cy*s),.55*w,.95*w,2.6*w,6);
  return {theta,rows:rows.indices,cols:cols.indices,rspan:rows.span,cspan:cols.span,nr:rows.count,nc:cols.count,px:cols.pitch,py:rows.pitch};
}
function hypotheses(lat:Lattice,n:number,options:MatFitOptions):Hypothesis[] {
  const out:Hypothesis[]=[];
  for(let r0=0;r0<3-lat.rspan;r0++)for(let c0=0;c0<7-lat.cspan;c0++)for(const side of ['bottom','top'] as const)for(const mirror of [false,true]){
    let good=0,bad=0;
    for(let i=0;i<n;i++){
      let col=c0+lat.cols[i],row=r0+lat.rows[i];if(side==='top'){col=6-col;row=2-row;}if(mirror)col=6-col;
      if(row===1||row===2||row===0&&(col===2||col===4))good++;
      else if(row===0&&col===6)good+=.3;else bad++;
    }
    const prior=.02*Number(side===(options.playerSide??'bottom'))+.01*Number(mirror===(options.mirrored??false));
    out.push({side,mirror,r0,c0,score:good-1.5*bad+prior});
  }
  return out.sort((a,b)=>b.score-a.score);
}
/** Small least-squares solver with pivoting. Coordinates are normalized before the projective fit. */
function leastSquares(rows:number[][],n:number):number[]|null {
  const a=Array.from({length:n},()=>new Float64Array(n+1));
  for(const row of rows)for(let i=0;i<n;i++)for(let j=0;j<=n;j++)a[i][j]+=row[i]*row[j];
  for(let col=0;col<n;col++){
    let pivot=col;for(let i=col+1;i<n;i++)if(Math.abs(a[i][col])>Math.abs(a[pivot][col]))pivot=i;
    if(Math.abs(a[pivot][col])<1e-10)return null;
    [a[col],a[pivot]]=[a[pivot],a[col]];const den=a[col][col];for(let j=col;j<=n;j++)a[col][j]/=den;
    for(let i=0;i<n;i++)if(i!==col){const f=a[i][col];for(let j=col;j<=n;j++)a[i][j]-=f*a[col][j];}
  }
  return a.map(row=>row[n]);
}
function fitPlane(src:Point[],dst:Point[],projective:boolean):((p:Point)=>Point)|null {
  const rows:number[][]=[];
  for(let i=0;i<src.length;i++){
    const {x,y}=src[i],u=dst[i].x,v=dst[i].y;
    rows.push(projective?[x,y,1,0,0,0,-u*x,-u*y,u]:[x,y,1,0,0,0,u]);
    rows.push(projective?[0,0,0,x,y,1,-v*x,-v*y,v]:[0,0,0,x,y,1,v]);
  }
  const h=leastSquares(rows,projective?8:6);if(!h)return null;
  return ({x,y})=>{const den=projective?h[6]*x+h[7]*y+1:1;return {x:(h[0]*x+h[1]*y+h[2])/den,y:(h[3]*x+h[4]*y+h[5])/den};};
}

/** Pure, one-shot CPU detector. Supply RAW camera pixels before drawing any grid or labels. */
export function fitMat(image:RGBAImage,options:MatFitOptions={}):MatFitResult {
  const result:MatFitResult={corners:null,orientation:{playerSide:options.playerSide??'bottom',mirrored:options.mirrored??false},mirror:options.mirrored??false,confidence:'low',flags:{colWindowAmbiguous:false,sideByPrior:false,zonesFound:0,reason:''},reason:'',metrics:{inliers:0,rows:0,columns:0,columnSpan:0,meanErrorPitch:0,maxErrorPitch:0}};
  const fail=(reason:string)=>{result.reason=result.flags.reason=reason;return result;};
  if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<128||image.height<128||image.width*image.height>16_000_000||image.data.length!==image.width*image.height*4)return fail('invalid-frame');
  if(Math.max(image.width/image.height,image.height/image.width)>6)return fail('invalid-frame');
  // A side camera sees the seven columns vertically. Normalize its raw pixels,
  // then restore image-clockwise corners and the player's original side.
  if(options.playerSide==='left'||options.playerSide==='right'){
    const left=options.playerSide==='left',data=new Uint8ClampedArray(image.data.length);
    for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
      const rx=left?y:image.height-1-y,ry=left?image.width-1-x:x;
      const src=(y*image.width+x)*4,dst=(ry*image.height+rx)*4;
      for(let k=0;k<4;k++)data[dst+k]=image.data[src+k];
    }
    const fitted=fitMat({data,width:image.height,height:image.width},{...options,playerSide:'bottom'});
    const restore=(corners:NonNullable<MatFitResult['corners']>)=>{
      const order=left?[3,0,1,2]:[1,2,3,0];
      return order.map(i=>left?{x:1-corners[i].y,y:corners[i].x}:{x:corners[i].y,y:1-corners[i].x}) as NonNullable<MatFitResult['corners']>;
    };
    const orientation=(o:FieldOrientation):FieldOrientation=>({...o,playerSide:o.playerSide==='bottom'?options.playerSide!:left?'right':'left'});
    fitted.orientation=orientation(fitted.orientation);
    if(fitted.corners)fitted.corners=restore(fitted.corners);
    if(fitted.flipped)fitted.flipped={corners:restore(fitted.flipped.corners),orientation:orientation(fitted.flipped.orientation)};
    return fitted;
  }
  const {strength,angle,w,h}=ridges(image);
  if(percentile(strength,.99)<.001)return fail('no-zones');
  const theta=estimateTilt(strength,angle,w),rects:Rect[]=[];
  for(const delta of [-6,-4,-2,0,2,4,6]){
    const [bh,bv]=lineMasks(strength,angle,w,h,theta+delta);rects.push(...search(bh,bv,w,h,theta+delta));
  }
  const d=recoverOuterFrames(filter(rects),strength,angle,w,h,image);result.flags.zonesFound=d.length;
  if(d.length<3)return fail('too-few-zones');
  const lat=lattice(d);result.metrics.rows=lat.nr;result.metrics.columns=lat.nc;result.metrics.columnSpan=lat.cspan+1;
  result.flags.colWindowAmbiguous=lat.cspan!==6;
  if(lat.nr<2||lat.nc<4)return fail('too-few-rows-or-columns');
  const hy=hypotheses(lat,d.length,options);if(!hy.length)return fail('not-a-zone-lattice');
  const best=hy[0],ties=hy.filter(h=>best.score-h.score<.05);
  result.flags.colWindowAmbiguous ||= ties.some(h=>h.c0!==best.c0);
  result.flags.sideByPrior=ties.some(h=>h.side!==best.side);
  result.orientation={playerSide:best.side,mirrored:best.mirror};result.mirror=best.mirror;
  // The same seven pitches as fieldZoneCells: its outer cells span .024..976, not 0..1.
  const minX=.5-3.5*FIELD_ZONE_PITCH;
  const model=d.map((_,i)=>({x:minX+(best.c0+lat.cols[i]+.5)*FIELD_ZONE_PITCH,y:(best.r0+lat.rows[i]+.5)/3}));
  const dest=d.map(a=>({x:a.cx/w,y:a.cy/h})),pitch=Math.min(lat.px,lat.py);
  const distance=(p:Point,q:Point)=>Math.hypot((p.x-q.x)*w,(p.y-q.y)*h)/pitch;
  let active=d.map((_,i)=>i),map=fitPlane(model,dest,false);
  if(!map)return fail('unstable-fit');
  active=active.filter(i=>distance(map!(model[i]),dest[i])<.35);
  if(active.length<6)return fail('too-few-inliers');
  map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);
  if(!map)return fail('unstable-fit');
  const inliers=active.filter(i=>distance(map!(model[i]),dest[i])<.35);
  if(inliers.length!==active.length){active=inliers;map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);}
  // Trim inconsistent centres before the coverage check. The minimum of six
  // inliers and the printed-frame span still have to survive this rejection.
  while(map&&active.length>6){
    const errors=active.map(i=>distance(map!(model[i]),dest[i]));
    const max=Math.max(...errors),mean=errors.reduce((a,b)=>a+b)/errors.length;
    if(mean<.1&&max<.2)break;
    active=active.filter((_,i)=>i!==errors.indexOf(max));
    map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);
  }
  result.metrics.inliers=active.length;
  if(!map||active.length<6)return fail('too-few-inliers');
  const errors=active.map(i=>distance(map!(model[i]),dest[i]));
  result.metrics.meanErrorPitch=errors.reduce((a,b)=>a+b)/errors.length;result.metrics.maxErrorPitch=Math.max(...errors);
  // Recheck coverage AFTER outlier rejection; an outlier cannot prove a seventh column.
  const rows=new Set(active.map(i=>lat.rows[i])),cols=new Set(active.map(i=>lat.cols[i])),printedCols=active.filter(i=>d[i].printed).map(i=>lat.cols[i]);
  result.metrics.rows=rows.size;result.metrics.columns=cols.size;result.metrics.columnSpan=Math.max(...cols)-Math.min(...cols)+1;
  result.flags.colWindowAmbiguous ||= Math.max(...printedCols)-Math.min(...printedCols)!==6;
  if(result.flags.colWindowAmbiguous)return fail('show-whole-mat-width');
  if(rows.size<2||cols.size<4)return fail('too-few-rows-or-columns');
  if(Math.max(...rows)-Math.min(...rows)!==lat.rspan)return fail('inconsistent-zones');
  if(result.metrics.meanErrorPitch>=.1||result.metrics.maxErrorPitch>=.2)return fail('inconsistent-zones');
  result.corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(map) as [Point,Point,Point,Point];
  try{createFieldCalibration(result.corners,result.orientation);}catch{result.corners=null;return fail('unstable-fit');}
  const opposite=ties.find(h=>h.side!==best.side&&h.mirror===best.mirror);
  if(opposite){
    const plane=quadMap(result.corners);
    if(plane){
      const dx=(best.c0-opposite.c0)*FIELD_ZONE_PITCH,dy=(best.r0-opposite.r0)/3;
      const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}].map(p=>plane(p.x+dx,p.y+dy)) as [Point,Point,Point,Point];
      const orientation={playerSide:opposite.side,mirrored:opposite.mirror};
      try{createFieldCalibration(corners,orientation);result.flipped={corners,orientation};}catch{/* Keep the primary fit; manual side controls remain available. */}
    }
  }
  if(result.flags.sideByPrior&&!result.flipped){result.corners=null;return fail('side-not-clear');}
  result.confidence='high';return result;
}
/** The owner rule in one place: callers can only apply a high-confidence, unambiguous fit. */
export function matFitCalibration(result:MatFitResult):FieldCalibration|undefined {
  if(result.confidence!=='high'||result.flags.colWindowAmbiguous||!result.corners)return undefined;
  try{return createFieldCalibration(result.corners,result.orientation);}catch{return undefined;}
}
