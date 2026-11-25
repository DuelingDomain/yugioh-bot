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
interface Rect {edgeMin:number;printed?:boolean;score:number;cx:number;cy:number;w:number;h:number;angle:number}
interface Lattice {theta:number;rows:number[];cols:number[];rspan:number;cspan:number;nr:number;nc:number;px:number;py:number}
interface Hypothesis {side:'top'|'bottom';mirror:boolean;r0:number;c0:number;score:number}
const rad=Math.PI/180;
const MIN_SPARSE_BOXES=4;
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
function ridges(image:RGBAImage,workingWidth:number) {
  // Exact area averages keep thin strokes stable across camera resolutions.
  // Every ridge kernel and rectangle step runs on a bounded working raster.
  const scale=Math.min(workingWidth/image.width,600/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale);
  const gray=new Float32Array(w*h),{data}=image;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const x0=x*image.width/w,x1=(x+1)*image.width/w,y0=y*image.height/h,y1=(y+1)*image.height/h;
    let g=0;
    for(let iy=Math.floor(y0);iy<Math.ceil(y1);iy++)for(let ix=Math.floor(x0);ix<Math.ceil(x1);ix++){
      const weight=(Math.min(ix+1,x1)-Math.max(ix,x0))*(Math.min(iy+1,y1)-Math.max(iy,y0));
      const i=(iy*image.width+ix)*4;g+=weight*(.299*data[i]+.587*data[i+1]+.114*data[i+2]);
    }
    gray[y*w+x]=g/((x1-x0)*(y1-y0)*255);
  }
  const tone=gray.slice(),mean=blur(gray,w,h,10);
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
  return {strength,angle,w,h,tone};
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
  for(let rh=Math.floor(.12*h);rh<=Math.floor(.3*h);rh+=2)for(const aspect of [.62,.68,.74]){
    const rw=Math.round(rh*aspect);
    for(let y=0;y+rh<h;y+=2){
      const ht=y*(w+1),hb=(y+rh)*(w+1),vt=y*w,vb=(y+rh)*w;
      for(let x=0;x+rw<w;x+=2){
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
function filter(rects:Rect[],sparseCandidates?:Rect[][]):Rect[] {
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
    if(sparseCandidates){
      const clear=candidates.filter(a=>a.score>=.66&&a.edgeMin>=.38);
      if(clear.length>=MIN_SPARSE_BOXES&&clear.length<=5&&Math.max(...clear.map(a=>a.cx))-Math.min(...clear.map(a=>a.cx))>6.7*target.w){
        sparseCandidates.push(clear);
      }
    }
  }
  frames=frames.filter(a=>a.score>=.55).sort((a,b)=>b.score-a.score).filter((a,i,all)=>!all.slice(0,i).some(b=>Math.hypot(a.cx-b.cx,a.cy-b.cy)<.3*Math.min(a.h,b.h)));
  const printedHeight=frames.length?median(frames.map(a=>a.h)):height;
  frames=frames.map(a=>{
    const group=groups.find(group=>group.includes(a))!;
    const inner=group.find(b=>b.h<=a.h/1.05&&b.h>=a.h/1.25);
    const concentric=!inner||Math.hypot(a.cx-inner.cx,a.cy-inner.cy)<=.08*a.h;
    return {...a,printed:a.h>=printedHeight/1.05&&concentric};
  });
  // Smaller card centres can support the fit, but cannot establish its outer columns.
  const angle=frames.length?median(frames.map(a=>a.angle))*rad:0;
  const sameRow=(a:Rect,b:Rect)=>Math.abs((a.cy-b.cy)*Math.cos(angle)-(a.cx-b.cx)*Math.sin(angle))<.2*height;
  const cards=groups.filter(group=>!frames.some(b=>Math.hypot(group[0].cx-b.cx,group[0].cy-b.cy)<.45*height))
    .map(group=>group.find(a=>a.score>=.55&&a.h<height/1.05&&a.h>=height/1.25&&a.w<width*1.05&&frames.some(b=>sameRow(a,b)&&neighbours(a,b))))
    .filter((a):a is Rect=>!!a).map(a=>({...a,printed:false}));
  return [...frames,...cards];
}

function luminanceAt(image:Float32Array,w:number,h:number,x:number,y:number):number {
  if(x<0||y<0||x>w-1||y>h-1)return NaN;
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,nx=Math.min(ix+1,w-1),ny=Math.min(iy+1,h-1);
  return (1-fy)*((1-fx)*image[iy*w+ix]+fx*image[iy*w+nx])+fy*((1-fx)*image[ny*w+ix]+fx*image[ny*w+nx]);
}

/** Inspect actual line peaks before comparing inside/outside tones. Rectangle
 * search tolerates a missing side, so its sampled border can sit off a card edge. */
function outlineEvidence(a:Rect,image:Float32Array,w:number,h:number) {
  const c=Math.cos(a.angle*rad),s=Math.sin(a.angle*rad),step=.5,radius=Math.max(1,.025*a.h),reach=Math.ceil(.22*a.h/step),outside=Math.ceil(.18*a.h/step),r=Math.max(16,Math.ceil(radius/step)),ridgeRadius=Math.ceil(radius/step);
  let nestedSides=0;const differences:number[]=[];
  for(let side=0;side<4;side++){
    const profile:number[]=[];
    for(let k=-reach-r;k<=outside+r;k++){
      let sum=0,count=0;
      for(let j=4;j<16;j++){
        const u=(j+.5)/20-.5,sign=side%2?1:-1;
        const x=side<2?u*a.w:sign*(a.w/2+k*step),y=side<2?sign*(a.h/2+k*step):u*a.h;
        const value=luminanceAt(image,w,h,a.cx+c*x-s*y,a.cy+s*x+c*y);
        if(Number.isFinite(value)){sum+=value;count++;}
      }
      profile.push(count?sum/count:NaN);
    }
    const peaks:number[]=[];
    for(let k=r;k<profile.length-r;k++){
      const mid=profile[k],lo=profile[k-ridgeRadius],hi=profile[k+ridgeRadius];
      if(Math.abs(mid-(lo+hi)/2)-Math.abs(lo-hi)/2>.025)peaks.push(k);
    }
    const position=(k:number)=>(k-reach-r)*step;
    // A card has one outline; a printed frame around it has two distinct peaks.
    if(peaks.some(outer=>Math.abs(position(outer))<.1*a.h&&peaks.some(inner=>(outer-inner)*step>.04*a.h&&(outer-inner)*step<.18*a.h)))nestedSides++;
    peaks.sort((i,j)=>Math.abs(position(i))-Math.abs(position(j)));
    if(peaks.length){
      // Six/eight working pixels clear the stroke before comparing tones.
      const k=peaks[0];differences.push((profile[k+12]+profile[k+16]-profile[k-12]-profile[k-16])/2);
    }
  }
  return {nested:nestedSides>=3,filled:differences.filter(d=>d>.06).length>=3||differences.filter(d=>d<-.06).length>=3};
}

/** Check faint outer frames directly in the ridges: the global edge threshold
 * can hide them when many brighter card outlines occupy the mat. */
function recoverOuterFrames(rects:Rect[],strength:Float32Array,phi:Float32Array,w:number,h:number,image:Float32Array):Rect[] {
  if(rects.length<4)return rects;
  const threshold=percentile(strength,.8,true),lat=lattice(rects),theta=lat.theta*rad,c=Math.cos(theta),s=Math.sin(theta);
  const supported=(x:number,y:number,family:number)=>{
    const px=Math.round(x),py=Math.round(y);
    if(px<0||py<0||px>=w||py>=h)return false;
    const i=py*w+px,expected=theta+(family?0:Math.PI/2);
    return strength[i]>threshold&&Math.abs(mod(phi[i]-expected+Math.PI/2,Math.PI)-Math.PI/2)<14*rad;
  };
  const outlines=rects.map(a=>outlineEvidence(a,image,w,h));
  // Direct evidence can recover printed frames that lost the global size vote.
  // Mask dilation alone cannot turn a single card outline into printed proof.
  rects=rects.map((a,i)=>({...a,printed:outlines[i].nested||(a.printed&&!outlines[i].filled)}));
  const outer=rects.map((a,i)=>{
    let best:Rect|undefined,quality=0;const filled=outlines[i].filled;
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
      const candidate={...a,w:rw,h:rh,printed:true};
      if(min>=.5&&mean>quality&&(!filled||outlineEvidence(candidate,image,w,h).nested)){quality=mean;best=candidate;}
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
function lattice(d:Rect[],rowAngle?:number):Lattice {
  const w=median(d.map(a=>a.w)),h=median(d.map(a=>a.h));let best=-1,theta=rowAngle??0;
  // Broad enough for the same rotated fixtures as the seven-angle ridge search.
  const middle=theta,range=rowAngle===undefined?18:3;
  for(let deg=middle-range;deg<=middle+range;deg+=.5){
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

type Plane=(p:Point)=>Point;
const unitCorners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];

function fitSparseLattice(groups:Rect[][],tone:Float32Array,w:number,h:number,theta:number,options:MatFitOptions):MatFitResult|undefined {
  const evidence=new Map<Rect,boolean>();
  let best:MatFitResult|undefined;
  for(const group of groups){
    const printed=group.filter(a=>{
      if(!evidence.has(a)){
        const {nested,filled}=outlineEvidence(a,tone,w,h);
        evidence.set(a,nested||!filled);
      }
      return evidence.get(a);
    }).map(a=>({...a,printed:true}));
    // Three centres can fit an affine transform exactly, even for unrelated rectangles.
    if(printed.length<MIN_SPARSE_BOXES)continue;
    // The borders give a separate estimate of the row angle when there are few centres.
    const lat=lattice(printed,theta);
    const boxWidth=median(printed.map(a=>a.w)),boxHeight=median(printed.map(a=>a.h));
    // Verify a one-column gap as well as the full span, so a shorter crop
    // cannot masquerade as seven columns at an artificially small pitch.
    const columns=[...new Set(lat.cols)].sort((a,b)=>a-b);
    if(lat.nr!==2||lat.rspan!==1||columns.length<3||lat.cspan!==6||!columns.some((c,i)=>c-columns[i-1]===1))continue;
    if(lat.px<1.18*boxWidth||lat.px>1.85*boxWidth||lat.py<1.04*boxHeight||lat.py>1.6*boxHeight)continue;
    const result=fitLattice(printed,lat,w,h,options,true);
    if(!result.corners)continue;
    if(best){
      const near=best.corners!.every((p,i)=>Math.hypot((p.x-result.corners![i].x)*w,(p.y-result.corners![i].y)*h)<.22*lat.px);
      if(!near)return;
      if(best.metrics.inliers>result.metrics.inliers||best.metrics.inliers===result.metrics.inliers&&best.metrics.meanErrorPitch<=result.metrics.meanErrorPitch)continue;
    }
    best=result;
  }
  return best;
}

/** A pale printed stroke is brighter than the art on both sides of it. Sum
 * its clipped contrast along a straight line so a few bright pixels or a
 * sharp step at the edge of a card cannot supply a whole side. */
function paleOutline(at:Point,map:Plane,tone:Float32Array,w:number,h:number) {
  const corners=unitCorners.map(p=>map({x:at.x+(p.x-.5)*.68,y:at.y+(p.y-.5)*.78}));
  const center=map(at);
  const lines=corners.map((a,i)=>{
    const b=corners[(i+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    const nx=-dy/len,ny=dx/len,radius=Math.min(10,len*.14);
    let best={score:0,offset:0},quality=0;
    for(let offset=-radius;offset<=radius;offset+=1.25)for(const skew of [-5,0,5]){
      let score=0;
      for(let j=0;j<20;j++){
        const t=(j+.5)/20,d=offset+skew*(t-.5),x=a.x+t*dx+nx*d,y=a.y+t*dy+ny*d;
        const mid=luminanceAt(tone,w,h,x,y);
        const lo=luminanceAt(tone,w,h,x-2.5*nx,y-2.5*ny),hi=luminanceAt(tone,w,h,x+2.5*nx,y+2.5*ny);
        if(Number.isFinite(mid+lo+hi))score+=Math.max(0,Math.min(.09,mid-Math.max(lo,hi)));
      }
      score/=20;
      const rank=score-.0005*Math.abs(offset);
      if(rank>quality){quality=rank;best={score,offset};}
    }
    return {...best,nx,ny};
  });
  // Opposite sides bracket the centre. A lone edge proves a partial outline,
  // but its offset alone also includes any error in the predicted box size.
  for(const [a,b] of [[lines[0],lines[2]],[lines[1],lines[3]]]){
    const weightA=a.score>=.02?1:0,weightB=b.score>=.02?1:0;
    center.x+=(a.offset*a.nx*weightA+b.offset*b.nx*weightB)/2;
    center.y+=(a.offset*a.ny*weightA+b.offset*b.ny*weightB)/2;
  }
  const horizontal=Math.max(lines[0].score,lines[2].score),vertical=Math.max(lines[1].score,lines[3].score);
  const scores=lines.map(line=>line.score).sort((a,b)=>b-a);
  return {at,center,corner:horizontal>=.035&&vertical>=.035,three:scores[1]>=.035&&scores[2]>=.024,score:scores.reduce((a,b)=>a+b,0)};
}

// Older printed mats have staggered outer boxes and a Pendulum Zone between
// Extra and Field. Use those offsets as detection evidence. The returned
// calibration is still the current, equally spaced gameplay grid.
const legacyMat={
  spell:{x:0,y:0},oppositeSpell:{x:4,y:0},field:{x:-1,y:1.34},pendulum:{x:-.84,y:.48},
  extra:{x:-.9,y:-.32},deck:{x:4.9,y:-.32},
};
function fitStaggeredMat(rects:Rect[],tone:Float32Array,w:number,h:number,theta:number,options:MatFitOptions) {
  const seeds:Rect[]=[];
  // filter() already sorted the search results by outline score.
  for(const rect of rects){
    if(rect.score<.59||seeds.length>=55)break;
    if(!seeds.some(a=>Math.hypot(a.cx-rect.cx,a.cy-rect.cy)<.23*Math.min(a.h,rect.h)))seeds.push(rect);
  }
  const {spell,oppositeSpell,field,pendulum,extra,deck}=legacyMat;
  const candidates:{map:Plane;side:'top'|'bottom';mirror:boolean;score:number;count:number;columns:number;mean:number;max:number}[]=[];
  const slope=Math.tan(theta*rad);
  for(const s of seeds){
    if(s.score<.67)break;
    for(const f of seeds){
      const dx=f.cx-s.cx,dy=f.cy-s.cy-slope*dx;
      if(Math.abs(dx)<1.15*s.w||Math.abs(dx)>2*s.w||Math.abs(dy)<1.5*s.h||Math.abs(dy)>2.15*s.h||f.h/s.h<.85||f.h/s.h>1.3)continue;
      const direction=dx>0?-1:1,away=dy>0?1:-1,py=dy/field.y;
      const side=away>0?'top':'bottom',mirror=(side==='top'?direction>0:direction<0);
      for(let px=Math.max(s.w/.82,Math.abs(dx)-.17*Math.abs(dy));px<=Math.min(s.w/.55,Math.abs(dx)+.17*Math.abs(dy));px+=2){
        const vx=direction*px,vy=slope*vx;
        // The nearer row is generally wider in an angled camera. Probe both
        // parallel and slightly converging sides before refitting the centres.
        for(const keystone of [0,.055*away]){
          const farScale=1-keystone*field.y,shear=(dx*farScale+vx)/field.y;
          const map:Plane=({x,y})=>{
            const den=1-keystone*y;
            return {x:s.cx+(vx*x+shear*y)/den,y:s.cy+(vy*x+(py*farScale+slope*shear)*y)/den};
          };
          const check=(at:Point)=>paleOutline(at,map,tone,w,h);
          const start=check(spell);
          if(!start.three)continue;
          const end=check(oppositeSpell);
          if(!end.corner)continue;
          const outer=check(field),between=check(pendulum);
          if(!outer.three||!between.three)continue;
          // Confirm the arrangement with an exposed pile outline or an
          // independent monster box if the piles hide both printed corners.
          const piles=[check(extra),check(deck)].filter(a=>a.corner);
          const inner=[{x:1,y:0},{x:2,y:1},{x:3,y:0}].map(check).filter(a=>a.three);
          if(!piles.length&&!inner.some(a=>a.at.y===1))continue;
          const matches=[start,end,outer,between,...piles,...inner];
          const points=matches.map(a=>a.at),centers=matches.map(a=>a.center);
          const fitted=fitPlane(points,centers,false);
          if(!fitted)continue;
          const errors=points.map((p,i)=>{const q=fitted(p);return Math.hypot(q.x-centers[i].x,q.y-centers[i].y)/px;});
          const mean=errors.reduce((a,b)=>a+b)/errors.length,max=Math.max(...errors);
          if(mean>=.065||max>=.13)continue;
          const score=start.score+end.score+outer.score+between.score+
            .6*piles.reduce((sum,a)=>sum+a.score,0)+.4*inner.reduce((sum,a)=>sum+a.score,0)-mean;
          const columns=new Set(points.map(p=>Math.round(p.x))).size;
          candidates.push({map:fitted,side,mirror,score,count:matches.length,columns,mean,max});
        }
      }
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  let best=candidates[0],alternate:typeof best|undefined;
  if(!best)return;
  const distance=(a:Point,b:Point)=>Math.hypot(a.x-b.x,a.y-b.y);
  const pitch=distance(best.map(spell),best.map(oppositeSpell))/4;
  const disagrees=(a:typeof best,b:typeof best)=>
    [spell,oppositeSpell,field].some(p=>distance(a.map(p),b.map(p))>.3*pitch);
  for(const candidate of candidates.slice(1)){
    if(best.score-candidate.score>=.06)break;
    if(candidate.mirror!==best.mirror)return;
    if(candidate.side===best.side){
      if(disagrees(candidate,best))return;
      continue;
    }
    // Opposite sides exchange the two main rows and reverse their columns.
    // Use the camera prior only if both fits cover the same observed grid.
    const rowEnds=[spell,oppositeSpell,{...spell,y:1},{...oppositeSpell,y:1}];
    if(rowEnds.some(p=>distance(best.map(p),candidate.map({x:oppositeSpell.x-p.x,y:1-p.y}))>.3*pitch))return;
    if(alternate&&disagrees(candidate,alternate))return;
    alternate??=candidate;
  }
  if(alternate?.side===(options.playerSide??'bottom'))[best,alternate]=[alternate,best];
  const calibration=(candidate:typeof best)=>{
    const corners=unitCorners.map(p=>{
      let {x,y}=p;
      if(candidate.side==='top'){x=1-x;y=1-y;}
      if(candidate.mirror)x=1-x;
      const q=candidate.map({x:(x-(.5-2*FIELD_ZONE_PITCH))/FIELD_ZONE_PITCH,y:2.5-3*y});
      return {x:q.x/w,y:q.y/h};
    }) as NonNullable<MatFitResult['corners']>;
    const orientation={playerSide:candidate.side,mirrored:candidate.mirror};
    try{createFieldCalibration(corners,orientation);return {corners,orientation};}catch{return;}
  };
  const primary=calibration(best),flipped=alternate&&calibration(alternate);
  if(!primary||alternate&&!flipped)return;
  const reason='sparse-printed-zones';
  return {...primary,...(flipped?{flipped}:{}),mirror:best.mirror,confidence:'low',reason,
    flags:{colWindowAmbiguous:false,sideByPrior:!!flipped,zonesFound:best.count,reason},
    metrics:{inliers:best.count,rows:2,columns:best.columns,columnSpan:7,meanErrorPitch:best.mean,maxErrorPitch:best.max}} satisfies MatFitResult;
}

function emptyResult(options:MatFitOptions,reason=''):MatFitResult {
  return {corners:null,orientation:{playerSide:options.playerSide??'bottom',mirrored:options.mirrored??false},mirror:options.mirrored??false,confidence:'low',flags:{colWindowAmbiguous:false,sideByPrior:false,zonesFound:0,reason},reason,metrics:{inliers:0,rows:0,columns:0,columnSpan:0,meanErrorPitch:0,maxErrorPitch:0}};
}

function fitLattice(d:Rect[],lat:Lattice,w:number,h:number,options:MatFitOptions,sparse=false):MatFitResult {
  const result=emptyResult(options);
  const fail=(reason:string)=>{result.reason=result.flags.reason=reason;return result;};
  result.flags.zonesFound=d.length;
  result.metrics.rows=lat.nr;result.metrics.columns=lat.nc;result.metrics.columnSpan=lat.cspan+1;
  result.flags.colWindowAmbiguous=lat.cspan!==6;
  const minColumns=sparse?3:4,minInliers=sparse?MIN_SPARSE_BOXES:6;
  const meanLimit=sparse?.065:.1,maxLimit=sparse?.13:.2;
  if(lat.nr<2||lat.nc<minColumns)return fail('too-few-rows-or-columns');
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
  if(!sparse){
    active=active.filter(i=>distance(map!(model[i]),dest[i])<.35);
    if(active.length<minInliers)return fail('too-few-inliers');
    map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);
    if(!map)return fail('unstable-fit');
    const inliers=active.filter(i=>distance(map!(model[i]),dest[i])<.35);
    if(inliers.length!==active.length){active=inliers;map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);}
    // Refit after removing a centre that disagrees with the others.
    while(map&&active.length>minInliers){
      const errors=active.map(i=>distance(map!(model[i]),dest[i]));
      const max=Math.max(...errors),mean=errors.reduce((a,b)=>a+b)/errors.length;
      if(mean<.1&&max<.2)break;
      active=active.filter((_,i)=>i!==errors.indexOf(max));
      map=fitPlane(active.map(i=>model[i]),active.map(i=>dest[i]),true);
    }
  }
  result.metrics.inliers=active.length;
  if(!map||active.length<minInliers)return fail('too-few-inliers');
  const errors=active.map(i=>distance(map!(model[i]),dest[i]));
  result.metrics.meanErrorPitch=errors.reduce((a,b)=>a+b)/errors.length;result.metrics.maxErrorPitch=Math.max(...errors);
  // Recheck coverage AFTER outlier rejection; an outlier cannot prove a seventh column.
  const rows=new Set(active.map(i=>lat.rows[i])),cols=new Set(active.map(i=>lat.cols[i])),printedCols=active.filter(i=>d[i].printed).map(i=>lat.cols[i]);
  result.metrics.rows=rows.size;result.metrics.columns=cols.size;result.metrics.columnSpan=Math.max(...cols)-Math.min(...cols)+1;
  result.flags.colWindowAmbiguous ||= Math.max(...printedCols)-Math.min(...printedCols)!==6;
  if(result.flags.colWindowAmbiguous)return fail('show-whole-mat-width');
  if(rows.size<2||cols.size<minColumns)return fail('too-few-rows-or-columns');
  if(Math.max(...rows)-Math.min(...rows)!==lat.rspan)return fail('inconsistent-zones');
  if(result.metrics.meanErrorPitch>=meanLimit||result.metrics.maxErrorPitch>=maxLimit)return fail('inconsistent-zones');
  result.corners=unitCorners.map(map) as NonNullable<MatFitResult['corners']>;
  try{createFieldCalibration(result.corners,result.orientation);}catch{result.corners=null;return fail('unstable-fit');}
  const opposite=ties.find(h=>h.side!==best.side&&h.mirror===best.mirror);
  if(opposite){
    const plane=quadMap(result.corners);
    if(plane){
      const dx=(best.c0-opposite.c0)*FIELD_ZONE_PITCH,dy=(best.r0-opposite.r0)/3;
      const corners=unitCorners.map(p=>plane(p.x+dx,p.y+dy)) as NonNullable<MatFitResult['corners']>;
      const orientation={playerSide:opposite.side,mirrored:opposite.mirror};
      try{createFieldCalibration(corners,orientation);result.flipped={corners,orientation};}catch{/* Keep the primary fit; manual side controls remain available. */}
    }
  }
  if(result.flags.sideByPrior&&!result.flipped){result.corners=null;return fail('side-not-clear');}
  if(sparse)result.reason=result.flags.reason='sparse-printed-zones';
  else result.confidence='high';
  return result;
}

/** Pure, one-shot CPU detector. Supply RAW camera pixels before drawing any grid or labels. */
function fitMatAtScale(image:RGBAImage,options:MatFitOptions,workingWidth:number):MatFitResult {
  if(!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<128||image.height<128||image.width*image.height>16_000_000||image.data.length!==image.width*image.height*4)return emptyResult(options,'invalid-frame');
  if(Math.max(image.width/image.height,image.height/image.width)>6)return emptyResult(options,'invalid-frame');
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
  const {strength,angle,w,h,tone}=ridges(image,workingWidth);
  if(percentile(strength,.99)<.001)return emptyResult(options,'no-zones');
  const theta=estimateTilt(strength,angle,w),rects:Rect[]=[];
  for(const delta of [-6,-4,-2,0,2,4,6]){
    const [bh,bv]=lineMasks(strength,angle,w,h,theta+delta);rects.push(...search(bh,bv,w,h,theta+delta));
  }
  const sparseCandidates:Rect[][]=[];
  const filtered=filter(rects,workingWidth===832?sparseCandidates:undefined);
  const d=recoverOuterFrames(filtered,strength,angle,w,h,tone);
  const result=d.length>=3?fitLattice(d,lattice(d),w,h,options):emptyResult(options,'too-few-zones');
  result.flags.zonesFound=d.length;
  if(result.corners||workingWidth!==832)return result;
  return fitStaggeredMat(rects,tone,w,h,theta,options)??fitSparseLattice(sparseCandidates,tone,w,h,theta,options)??result;
}
/** Normalize camera pixels before detection. Thin printed strokes and wider
 * occupied outlines need different ridge scales; each must pass every fit gate.
 * These sizes bound the ridge and rectangle search cost. */
export function fitMat(image:RGBAImage,options:MatFitOptions={}):MatFitResult {
  let preview:MatFitResult|undefined,refusal:MatFitResult|undefined;
  for(const width of [832,768,512,480,448,416]){
    const result=fitMatAtScale(image,options,width);
    if(result.reason==='invalid-frame'||options.playerSide==='left'||options.playerSide==='right')return result;
    if(result.corners){
      if(result.confidence==='high')return result;
      preview??=result;
    }else refusal??=result;
  }
  return preview??refusal!;
}
/** A preview requires a resolved column window, even for a sparse fit. */
export function matFitCalibration(result:MatFitResult):FieldCalibration|undefined {
  if(result.flags.colWindowAmbiguous||!result.corners)return undefined;
  try{return createFieldCalibration(result.corners,result.orientation);}catch{return undefined;}
}
