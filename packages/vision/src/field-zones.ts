import { boundsOf, polygonArea } from './geometry';
import type { DetectedQuad, Point } from './types';

export type FieldZone = `M${1|2|3|4|5}` | `S${1|2|3|4|5}` | 'FIELD' | 'EMZ1' | 'EMZ2' | 'GY' | 'BANISHED' | 'DECK' | 'EXTRA';
export type FieldFormat = 'normal' | 'domain' | 'genesys' | 'genesys-domain';
export const hasExtraMonsterZones = (format:FieldFormat='normal') => format==='normal'||format==='domain';
export const FIELD_ZONE_PITCH=.164;
export const normalizeZoneSpacing=(value=1)=>Number.isFinite(value)?Math.max(.85,Math.min(1.4,value)):1;
/** Horizontal zoom around M3/S3: spacing scales both the pitch and cell width. */
export const fieldZoneLayout=(zoneSpacing=1)=>{const spacing=normalizeZoneSpacing(zoneSpacing),pitch=FIELD_ZONE_PITCH*spacing;return {pitch,start:.5-2.5*pitch,end:.5+2.5*pitch,minX:.5-.5*spacing,maxX:.5+.5*spacing};};
const inExtraMonsterRow = ({x,y}:Point,format:FieldFormat='normal') => hasExtraMonsterZones(format)&&y<.2&&((x>=.254&&x<=.418)||(x>=.582&&x<=.746));
export type PlayerSide = 'bottom' | 'left' | 'top' | 'right';
export interface FieldOrientation { playerSide: PlayerSide; mirrored: boolean }
/** Corners are image-clockwise from image top-left. Missing orientation is legacy/unconfirmed. */
export interface FieldCalibration { version: 1; corners: Point[]; orientation?: FieldOrientation; zoneSpacing?: number }
export const DEFAULT_FIELD_ORIENTATION: FieldOrientation = {playerSide:'bottom',mirrored:false};
const sides: PlayerSide[] = ['bottom','left','top','right'];
function orient(point:Point, orientation:FieldOrientation, inverse=false):Point {
  let {x,y}=point;
  if(!inverse&&orientation.mirrored)x=1-x;
  const turns=sides.indexOf(orientation.playerSide);
  for(let i=0;i<(inverse?(4-turns)%4:turns);i++)[x,y]=[1-y,x];
  if(inverse&&orientation.mirrored)x=1-x;
  return {x,y};
}
/** Rotate the mapping in image coordinates; the video pixels themselves stay untouched. */
export function rotateFieldCalibration(calibration:FieldCalibration, degrees:90|180):FieldCalibration {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  return createFieldCalibration(calibration.corners,{...orientation,playerSide:sides[(sides.indexOf(orientation.playerSide)+degrees/90)%4]},calibration.zoneSpacing);
}
export function mirrorFieldCalibration(calibration:FieldCalibration):FieldCalibration {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  return createFieldCalibration(calibration.corners,{...orientation,mirrored:!orientation.mirrored},calibration.zoneSpacing);
}
/** The two near corners, identified by the player's LEFT then RIGHT hand, remove mirror ambiguity. */
export function orientFieldFromHands(calibration:FieldCalibration,left:number,right:number):FieldCalibration {
  for(const playerSide of sides)for(const mirrored of [false,true]){
    const orientation={playerSide,mirrored};
    const nearLeft=orient({x:0,y:1},orientation),nearRight=orient({x:1,y:1},orientation);
    const index=(p:Point)=>unitCorners.findIndex(c=>c.x===p.x&&c.y===p.y);
    if(index(nearLeft)===left&&index(nearRight)===right)return createFieldCalibration(calibration.corners,orientation,calibration.zoneSpacing);
  }
  throw new Error('Choose two adjacent corners along your edge of the mat.');
}

export const fieldCenter = (card: Pick<DetectedQuad,'quad'>): Point => ({x:card.quad.reduce((s,p)=>s+p.x,0)/4,y:card.quad.reduce((s,p)=>s+p.y,0)/4});
type Homography=number[];
const unitCorners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
/** Least-squares projective fit; four pairs fix the plane, eight also check two card outlines. */
function fitPlane(from:Point[],to:Point[]):Homography {
  const matrix=Array.from({length:8},()=>Array(9).fill(0) as number[]);
  for(let i=0;i<from.length;i++){
    const {x,y}=from[i],u=to[i].x,v=to[i].y;
    for(const row of [[x,y,1,0,0,0,-u*x,-u*y,u],[0,0,0,x,y,1,-v*x,-v*y,v]])for(let a=0;a<8;a++)for(let b=0;b<9;b++)matrix[a][b]+=row[a]*row[b];
  }
  for(let col=0;col<8;col++){
    let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col]))pivot=row;
    if(Math.abs(matrix[pivot][col])<1e-12)throw new Error('Card or field corners do not define a stable plane.');
    [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
    const scale=matrix[col][col];for(let k=col;k<9;k++)matrix[col][k]/=scale;
    for(let row=0;row<8;row++)if(row!==col){const factor=matrix[row][col];for(let k=col;k<9;k++)matrix[row][k]-=factor*matrix[col][k];}
  }
  return [...matrix.map(row=>row[8]),1];
}
const project=(h:Homography,{x,y}:Point):Point=>{const w=h[6]*x+h[7]*y+1;return Math.abs(w)<1e-10?{x:Infinity,y:Infinity}:{x:(h[0]*x+h[1]*y+h[2])/w,y:(h[3]*x+h[4]*y+h[5])/w};};
const planes=new WeakMap<FieldCalibration,{forward:Homography;inverse:Homography}>();
function plane(calibration:FieldCalibration){let value=planes.get(calibration);if(!value){value={forward:fitPlane(unitCorners,calibration.corners),inverse:fitPlane(calibration.corners,unitCorners)};planes.set(calibration,value);}return value;}
/** Project a mat point into normalized camera pixels; the preview and tracker share this map. */
export const fieldMatPoint=(point:Point,calibration:FieldCalibration):Point=>project(plane(calibration).forward,orient(point,calibration.orientation??DEFAULT_FIELD_ORIENTATION));
/** Clockwise TL, TR, BR, BL of the owner's mat. Two opposite corners also work. */
export function createFieldCalibration(points: Point[], orientation?:FieldOrientation,zoneSpacing=1): FieldCalibration {
  const corners=points.length===2?[points[0],{x:points[1].x,y:points[0].y},points[1],{x:points[0].x,y:points[1].y}]:points;
  if(corners.length!==4 || corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>1||p.y>1) || polygonArea(corners)<.02) throw new Error('Invalid field calibration: click opposite corners or four clockwise mat corners');
  const crosses=corners.map((a,i)=>{const b=corners[(i+1)%4],c=corners[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  if(crosses.some(c=>c<=0))throw new Error('Invalid field calibration: corners must be clockwise from top left');
  if(orientation&&(!sides.includes(orientation.playerSide)||typeof orientation.mirrored!=='boolean'))throw new Error('Invalid field orientation');
  return {version:1,corners:corners.map(p=>({...p})),zoneSpacing:normalizeZoneSpacing(zoneSpacing),...(orientation?{orientation:{...orientation}}:{})};
}
/** True inverse homography for a flat mat under perspective; matrices stay out of persisted data. */
export function onMat(p:Point, calibration?:FieldCalibration):Point {
  return calibration?orient(project(plane(calibration).inverse,p),calibration.orientation??DEFAULT_FIELD_ORIENTATION,true):p;
}
/**
 * Two same-size 59:86 cards, upright/parallel on one plane, centred in M1 and M5.
 * Full quads determine perspective and scale; four column pitches determine width.
 * Vertical pitch assumes the same physical gap as horizontal pitch. It is a preview,
 * not evidence of the mat's unknown row spacing: the owner may adjust before saving.
 */
export function createTwoCardCalibration(cards:DetectedQuad[],monsterIndex?:number):FieldCalibration {
  if(monsterIndex!==undefined)return createTwoRowCalibration(cards,monsterIndex);
  if(cards.length!==2)throw new Error('Show exactly two cards: one in M1 and one in M5. Clear the rest of the mat.');
  const outlines=cards.map(card=>{
    if(card.partial||card.covered||card.confidence<.7||card.quad.length!==4||card.quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))throw new Error('Both cards need four clear corners, without a hand or overlap.');
    const crosses=card.quad.map((a,i)=>{const b=card.quad[(i+1)%4],c=card.quad[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
    if(crosses.some(c=>Math.abs(c)<1e-8)||crosses.some(c=>c*crosses[0]<0))throw new Error('Both card quads must have four distinct, convex corners.');
    return crosses[0]<0?[card.quad[0],card.quad[3],card.quad[2],card.quad[1]]:card.quad;
  }).sort((a,b)=>fieldCenter({quad:a}).x-fieldCenter({quad:b}).x);
  const aspect=86/59,rectangle=[{x:-.5,y:-aspect/2},{x:.5,y:-aspect/2},{x:.5,y:aspect/2},{x:-.5,y:aspect/2}],cycle=(quad:Point[],start:number)=>[...quad.slice(start),...quad.slice(0,start)];
  let best:{error:number;calibration:FieldCalibration}|undefined;
  for(let first=0;first<4;first++)try{
    const a=cycle(outlines[0],first),rectify=fitPlane(a,rectangle),other=outlines[1].map(p=>project(rectify,p)),center=fieldCenter({quad:other}),pitch=Math.hypot(center.x,center.y)/4;
    if(center.x<=0||pitch<1||pitch>2.5||Math.abs(center.y)>.15*aspect)continue;
    for(let second=0;second<4;second++){
      const ordered=cycle(other,second),shapeError=Math.sqrt(ordered.reduce((sum,p,i)=>sum+(p.x-center.x-rectangle[i].x)**2+(p.y-center.y-rectangle[i].y)**2,0)/4);if(shapeError>.15)continue;
      const b=cycle(outlines[1],second),world=[...rectangle,...rectangle.map(p=>({x:p.x+4*pitch,y:p.y}))],image=[...a,...b],h=fitPlane(world,image);
      const error=Math.sqrt(world.reduce((sum,p,i)=>{const q=project(h,p);return sum+(q.x-image[i].x)**2+(q.y-image[i].y)**2;},0)/8);if(error>.12*Math.sqrt(polygonArea(a)))continue;
      const width=pitch/FIELD_ZONE_PITCH,height=(aspect+pitch-1)/.4,corners=unitCorners.map(p=>({x:(p.x-(.5-2*FIELD_ZONE_PITCH))*width,y:(p.y-.38)*height})),denominators=corners.map(p=>h[6]*p.x+h[7]*p.y+1);
      if(!denominators.every(w=>w>1e-6)&&!denominators.every(w=>w< -1e-6))continue;
      const calibration=createFieldCalibration(corners.map(p=>project(h,p)));if(!best||error<best.error)best={error,calibration};
    }
  }catch{/* Another corner assignment may fit; otherwise use the manual grid. */}
  if(!best)throw new Error('Could not align the two cards. Keep them upright, parallel and flat in M1 and M5 with the full field in view, or drag the grid.');
  return best.calibration;
}
/**
 * Labelled M1 (monster) and S5 (spell/trap) determine both axes, including reflection.
 * The UI asks which outline is the monster, so no OCR or card identity guess is needed.
 * Equal gaps are assumed; reject ambiguous fits and let the owner adjust the preview.
 */
function createTwoRowCalibration(cards:DetectedQuad[],monsterIndex:number):FieldCalibration {
  if(cards.length!==2||![0,1].includes(monsterIndex))throw new Error('Show exactly two cards: a MONSTER in M1 and a SPELL/TRAP in S5.');
  const outlines=[cards[monsterIndex],cards[1-monsterIndex]].map(card=>{
    if(card.partial||card.covered||card.confidence<.7||card.quad.length!==4||card.quad.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))
      throw new Error('Both cards need four clear corners, without a hand or overlap.');
    const crosses=card.quad.map((a,i)=>{const b=card.quad[(i+1)%4],c=card.quad[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
    if(crosses.some(c=>Math.abs(c)<1e-8||c*crosses[0]<0))throw new Error('Both cards need convex outlines.');
    return crosses[0]<0?[card.quad[0],card.quad[3],card.quad[2],card.quad[1]]:card.quad;
  });
  const aspect=86/59,rectangle=[{x:-.5,y:-aspect/2},{x:.5,y:-aspect/2},{x:.5,y:aspect/2},{x:-.5,y:aspect/2}];
  const cycle=(quad:Point[],start:number,reverse:boolean)=>Array.from({length:4},(_,i)=>quad[(start+(reverse?-i:i)+4)%4]);
  let best:{error:number;calibration:FieldCalibration}|undefined;
  for(const reverse of [false,true])for(let first=0;first<4;first++)try{
    const a=cycle(outlines[0],first,reverse),rectify=fitPlane(a,rectangle),other=outlines[1].map(p=>project(rectify,p)),center=fieldCenter({quad:other}),pitch=center.x/4,rowPitch=aspect+pitch-1;
    if(pitch<1||pitch>2.5||Math.abs(center.y-rowPitch)>.2)continue;
    for(let second=0;second<4;second++){
      const ordered=cycle(other,second,reverse);
      const shapeError=Math.sqrt(ordered.reduce((sum,p,i)=>sum+(p.x-center.x-rectangle[i].x)**2+(p.y-center.y-rectangle[i].y)**2,0)/4);
      if(shapeError>.15)continue;
      const b=cycle(outlines[1],second,reverse),world=[...rectangle,...rectangle.map(p=>({x:p.x+4*pitch,y:p.y+rowPitch}))],image=[...a,...b],h=fitPlane(world,image);
      const error=Math.sqrt(world.reduce((sum,p,i)=>{const q=project(h,p);return sum+(q.x-image[i].x)**2+(q.y-image[i].y)**2;},0)/8);
      if(error>.12*Math.sqrt(polygonArea(a)))continue;
      const width=pitch/FIELD_ZONE_PITCH,height=rowPitch/.4,worldCorners=unitCorners.map(p=>({x:(p.x-(.5-2*FIELD_ZONE_PITCH))*width,y:(p.y-.38)*height}));
      const denominators=worldCorners.map(p=>h[6]*p.x+h[7]*p.y+1);
      if(!denominators.every(w=>w>1e-6)&&!denominators.every(w=>w< -1e-6))continue;
      const playerCorners=worldCorners.map(p=>project(h,p)),middle=fieldCenter({quad:playerCorners});
      const orderedCorners=[...playerCorners].sort((a,b)=>Math.atan2(a.y-middle.y,a.x-middle.x)-Math.atan2(b.y-middle.y,b.x-middle.x));
      const start=orderedCorners.reduce((best,p,i)=>p.x+p.y<orderedCorners[best].x+orderedCorners[best].y?i:best,0);
      const corners=cycle(orderedCorners,start,false),base=createFieldCalibration(corners);
      const calibration=orientFieldFromHands(base,corners.indexOf(playerCorners[3]),corners.indexOf(playerCorners[2]));
      if(!best||error<best.error)best={error,calibration};
    }
  }catch{/* Try the remaining corner assignments before falling back to manual calibration. */}
  if(!best)throw new Error('Could not align M1 and S5. Keep both cards upright from your seat, flat, with equal gaps and the full field in view, or adjust the four corners.');
  return best.calibration;
}
export function mapFieldZone(card:DetectedQuad, calibration?:FieldCalibration, peers:DetectedQuad[]=[], format:FieldFormat='normal'):{zone:FieldZone;calibrated:boolean} {
  const center=onMat(fieldCenter(card),calibration),x=.5+(center.x-.5)/normalizeZoneSpacing(calibration?.zoneSpacing),y=center.y;
  let zone:FieldZone;
  if(inExtraMonsterRow({x,y},format))zone=x<.5?'EMZ1':'EMZ2';
  else if(x<.09)zone=y<.56?'FIELD':'EXTRA';
  else if(x>=.91-1e-9)zone=y<.25?'BANISHED':y<.56?'GY':'DECK';
  else {
    const row=y<.56?'M':'S';
    const col=Math.max(1,Math.min(5,Math.floor((x-.09)/FIELD_ZONE_PITCH)+1));
    zone=`${row}${col}` as FieldZone;
  }
  return {zone,calibrated:!!calibration};
}
/** Detector corners are portrait ordered; measure the long axis in native pixels. */
export function fieldOrientation(card:DetectedQuad,width:number,height:number,calibration?:FieldCalibration):'attack'|'defense' {
  const p=card.quad.map(q=>{
    if(!calibration)return {x:q.x*width,y:q.y*height};
    const mat=onMat(q,calibration);
    // A row pitch spans .4. Portrait cards are 59:86.
    return {x:mat.x/(FIELD_ZONE_PITCH*normalizeZoneSpacing(calibration?.zoneSpacing)),y:mat.y/.4*(86/59)};
  });
  const edges=p.map((a,i)=>{const b=p[(i+1)%4];return {dx:b.x-a.x,dy:b.y-a.y,length:Math.hypot(b.x-a.x,b.y-a.y)};}).sort((a,b)=>b.length-a.length);
  const axis=edges[0];return Math.abs(axis.dx)>Math.abs(axis.dy)*1.15?'defense':'attack';
}
export function fieldZoneLocation(zone:FieldZone):{zone:string;slot?:number} {
  if(/^[MS][1-5]$/.test(zone))return {zone:zone[0]==='M'?'monster':'spell-trap',slot:Number(zone[1])};
  if(zone.startsWith('EMZ'))return {zone:'extra-monster',slot:Number(zone.at(-1))};
  return {zone:({FIELD:'field',GY:'graveyard',BANISHED:'banished',DECK:'deck',EXTRA:'extra'} as Record<string,string>)[zone]};
}
export function quadIou(a:DetectedQuad,b:DetectedQuad):number {
  const x=boundsOf(a.quad),y=boundsOf(b.quad),intersection=Math.max(0,Math.min(x.x+x.w,y.x+y.w)-Math.max(x.x,y.x))*Math.max(0,Math.min(x.y+x.h,y.y+y.h)-Math.max(x.y,y.y));
  return intersection/(x.w*x.h+y.w*y.h-intersection || 1);
}
