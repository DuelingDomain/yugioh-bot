import { boundsOf, polygonArea } from './geometry';
import type { DetectedQuad, Point } from './types';

export type FieldZone = `M${1|2|3|4|5}` | `S${1|2|3|4|5}` | 'FIELD' | 'EMZ1' | 'EMZ2' | 'GY' | 'BANISHED' | 'DECK' | 'EXTRA';
export type FieldFormat = 'normal' | 'domain' | 'genesys' | 'genesys-domain';
export const hasExtraMonsterZones = (format:FieldFormat='normal') => format==='normal'||format==='domain';
const inExtraMonsterRow = ({x,y}:Point,format:FieldFormat='normal') => hasExtraMonsterZones(format)&&y<.2&&((x>=.308&&x<=.436)||(x>=.564&&x<=.692));
export interface FieldCalibration { version: 1; corners: Point[] }
export const fieldCenter = (card: Pick<DetectedQuad,'quad'>): Point => ({x:card.quad.reduce((s,p)=>s+p.x,0)/4,y:card.quad.reduce((s,p)=>s+p.y,0)/4});
/** Clockwise TL, TR, BR, BL of the owner's mat. Two opposite corners also work. */
export function createFieldCalibration(points: Point[]): FieldCalibration {
  const corners=points.length===2?[points[0],{x:points[1].x,y:points[0].y},points[1],{x:points[0].x,y:points[1].y}]:points;
  if(corners.length!==4 || corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>1||p.y>1) || polygonArea(corners)<.02) throw new Error('Invalid field calibration: click opposite corners or four clockwise mat corners');
  const crosses=corners.map((a,i)=>{const b=corners[(i+1)%4],c=corners[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  if(crosses.some(c=>c<=0))throw new Error('Invalid field calibration: corners must be clockwise from top left');
  return {version:1,corners:corners.map(p=>({...p}))};
}
/** Inverse bilinear mat coordinates; handles skew without a dependency or stored pixels. */
export function onMat(p:Point, calibration?:FieldCalibration):Point {
  if(!calibration)return p;
  const [a,b,c,d]=calibration.corners;let u=.5,v=.5;
  for(let i=0;i<12;i++) {
    const ex=a.x+(b.x-a.x)*u+(d.x-a.x)*v+(a.x-b.x+c.x-d.x)*u*v-p.x;
    const ey=a.y+(b.y-a.y)*u+(d.y-a.y)*v+(a.y-b.y+c.y-d.y)*u*v-p.y;
    const ux=b.x-a.x+(a.x-b.x+c.x-d.x)*v,uy=b.y-a.y+(a.y-b.y+c.y-d.y)*v;
    const vx=d.x-a.x+(a.x-b.x+c.x-d.x)*u,vy=d.y-a.y+(a.y-b.y+c.y-d.y)*u,det=ux*vy-uy*vx;
    if(Math.abs(det)<1e-8)break;u-=(ex*vy-ey*vx)/det;v-=(ey*ux-ex*uy)/det;
  }
  return {x:u,y:v};
}
export function mapFieldZone(card:DetectedQuad, calibration?:FieldCalibration, peers:DetectedQuad[]=[], format:FieldFormat='normal'):{zone:FieldZone;calibrated:boolean} {
  const {x,y}=onMat(fieldCenter(card),calibration);
  let zone:FieldZone;
  if(inExtraMonsterRow({x,y},format))zone=x<.5?'EMZ1':'EMZ2';
  else if(x<.18)zone=y<.56?'FIELD':'EXTRA';
  else if(x>.82)zone=y<.25?'BANISHED':y<.56?'GY':'DECK';
  else {
    const row=y<.56?'M':'S';
    const col=Math.max(1,Math.min(5,Math.floor((x-.18)/.128)+1));
    zone=`${row}${col}` as FieldZone;
  }
  return {zone,calibrated:!!calibration};
}
/** Detector corners are portrait ordered; measure the long axis in native pixels. */
export function fieldOrientation(card:DetectedQuad,width:number,height:number):'attack'|'defense' {
  const p=card.quad.map(q=>({x:q.x*width,y:q.y*height}));
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
