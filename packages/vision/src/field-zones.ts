import { boundsOf, polygonArea } from './geometry';
import type { DetectedQuad, Point } from './types';

export type FieldZone = `M${1|2|3|4|5}` | `S${1|2|3|4|5}` | 'FIELD' | 'EMZ1' | 'EMZ2' | 'GY' | 'BANISHED' | 'DECK' | 'EXTRA';
export type FieldFormat = 'normal' | 'domain' | 'genesys' | 'genesys-domain';
export const hasExtraMonsterZones = (format:FieldFormat='normal') => format==='normal'||format==='domain';
/** One column in mat units. The mat has 7 equal columns (Field/Extra, M1-M5/S1-S5, GY/Deck/Banished), as on the real mat. */
export const FIELD_ZONE_PITCH=.136;
/** One row in mat units: three equal rows (Extra Monster + Banished, monsters, spells/traps), so every zone is one card-sized slot. */
export const FIELD_ROW=1/3;
export const normalizeZoneSpacing=(value=1)=>Number.isFinite(value)?Math.max(.85,Math.min(1.4,value)):1;
/** Horizontal zoom around M3/S3: spacing scales both the pitch and cell width. */
export const fieldZoneLayout=(zoneSpacing=1)=>{const spacing=normalizeZoneSpacing(zoneSpacing),pitch=FIELD_ZONE_PITCH*spacing;return {pitch,start:.5-2.5*pitch,end:.5+2.5*pitch,minX:.5-.5*spacing,maxX:.5+.5*spacing};};
const FIELD_ZONE_START=.5-2.5*FIELD_ZONE_PITCH,FIELD_ZONE_END=.5+2.5*FIELD_ZONE_PITCH;
const inExtraMonsterRow = ({x,y}:Point,format:FieldFormat='normal') => hasExtraMonsterZones(format)&&y<FIELD_ROW&&((x>=FIELD_ZONE_START+FIELD_ZONE_PITCH&&x<=FIELD_ZONE_START+2*FIELD_ZONE_PITCH)||(x>=FIELD_ZONE_START+3*FIELD_ZONE_PITCH&&x<=FIELD_ZONE_START+4*FIELD_ZONE_PITCH));
/** A zone rectangle in mat units (0..1 across and down, seen from the owner's seat). */
export interface ZoneRect { x: number; y: number; w: number; h: number }
/** Per-zone rectangles the player moved or resized, by zone id. Other zones keep the default layout. */
export type ZoneOverrides = Record<string, ZoneRect>;
export interface FieldZoneCell extends ZoneRect { zone: string; label: string }
export const FIELD_ZONE_IDS = ['FIELD','EXTRA','BANISHED','GY','DECK','M1','M2','M3','M4','M5','S1','S2','S3','S4','S5','EMZ1','EMZ2'] as const;
export const MIN_ZONE_SIZE = .03;
/** Keeps known zone ids with finite, bounded rectangles. Returns undefined when nothing is left. */
export function normalizeZones(value?: unknown): ZoneOverrides | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: ZoneOverrides = {}, bound = (n: number) => Math.max(-.5, Math.min(1.5, n));
  for (const id of FIELD_ZONE_IDS) {
    const r = (value as Record<string, Partial<ZoneRect> | undefined>)[id];
    if (!r || ![r.x, r.y, r.w, r.h].every(n => typeof n === 'number' && Number.isFinite(n))) continue;
    out[id] = { x: bound(r.x!), y: bound(r.y!), w: Math.max(MIN_ZONE_SIZE, Math.min(2, r.w!)), h: Math.max(MIN_ZONE_SIZE, Math.min(2, r.h!)) };
  }
  return Object.keys(out).length ? out : undefined;
}
/** Override rectangles are stored for spacing 1 (as drawn by default); spacing then widens them around M3/S3 like the default zones. */
export const scaleZoneRect=(r:ZoneRect,zoneSpacing=1):ZoneRect=>{const spacing=normalizeZoneSpacing(zoneSpacing);return {x:.5+(r.x-.5)*spacing,y:r.y,w:r.w*spacing,h:r.h};};
export const unscaleZoneRect=(r:ZoneRect,zoneSpacing=1):ZoneRect=>{const spacing=normalizeZoneSpacing(zoneSpacing);return {x:.5+(r.x-.5)/spacing,y:r.y,w:r.w/spacing,h:r.h};};
/**
 * The single zone geometry: the default Master Rule layout (zoneSpacing widens it around M3/S3), with the player's
 * per-zone rectangles on top. Overrides are kept at spacing 1 and scaled with the spacing, so the gaps stay as edited.
 * Every zone is one slot of the same size: 7 columns by 3 rows. The top row holds the two Extra Monster Zones (above M2 and M4)
 * and Banished (above GY); Field and Extra sit left of the M and S rows, GY and Deck right of them.
 */
export function fieldZoneCells(format: FieldFormat = 'normal', zoneSpacing = 1, zones?: ZoneOverrides): FieldZoneCell[] {
  const emz = hasExtraMonsterZones(format), { pitch, start, end } = fieldZoneLayout(zoneSpacing), R = FIELD_ROW;
  const base: FieldZoneCell[] = [
    { zone: 'FIELD', label: 'Field', x: start - pitch, y: R, w: pitch, h: R }, { zone: 'EXTRA', label: 'Extra', x: start - pitch, y: 2 * R, w: pitch, h: R },
    { zone: 'BANISHED', label: 'Banished', x: end, y: 0, w: pitch, h: R }, { zone: 'GY', label: 'GY', x: end, y: R, w: pitch, h: R }, { zone: 'DECK', label: 'Deck', x: end, y: 2 * R, w: pitch, h: R },
    ...Array.from({ length: 5 }, (_, i) => ({ zone: `M${i + 1}`, label: `M${i + 1}`, x: start + pitch * i, y: R, w: pitch, h: R })),
    ...Array.from({ length: 5 }, (_, i) => ({ zone: `S${i + 1}`, label: `S${i + 1}`, x: start + pitch * i, y: 2 * R, w: pitch, h: R })),
    ...(emz ? [{ zone: 'EMZ1', label: 'EMZ', x: start + pitch, y: 0, w: pitch, h: R }, { zone: 'EMZ2', label: 'EMZ', x: start + 3 * pitch, y: 0, w: pitch, h: R }] : []),
  ];
  const own = normalizeZones(zones);
  return own ? base.map(c => own[c.zone] ? { ...c, ...scaleZoneRect(own[c.zone], zoneSpacing) } : c) : base;
}
const cellCache = new WeakMap<object, Map<string, { cells: FieldZoneCell[]; custom: ReadonlySet<string> }>>(), defaultCache = new Map<string, { cells: FieldZoneCell[]; custom: ReadonlySet<string> }>();
function zoneLayoutOf(calibration: Pick<FieldCalibration, 'zoneSpacing' | 'zones'> | undefined, format: FieldFormat) {
  const make = () => ({ cells: fieldZoneCells(format, calibration?.zoneSpacing, calibration?.zones), custom: new Set(Object.keys(normalizeZones(calibration?.zones) ?? {})) });
  if (!calibration) { const key = `${format}`; let value = defaultCache.get(key); if (!value) defaultCache.set(key, value = make()); return value; }
  let byFormat = cellCache.get(calibration); if (!byFormat) cellCache.set(calibration, byFormat = new Map());
  let value = byFormat.get(format); if (!value) byFormat.set(format, value = make());
  return value;
}
/** The cell holding a mat point; the smallest wins where cells overlap. Null in a gap or off the mat. */
export function zoneCellAt<T extends ZoneRect>(point: Point, cells: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const c of cells) if (point.x >= c.x && point.x < c.x + c.w && point.y >= c.y && point.y < c.y + c.h && (!best || c.w * c.h < best.w * best.h)) best = c;
  return best;
}
/** The Master Rule bands, used for gaps and for points off the mat (the default layout without gaps). */
function bandZone({ x: mx, y }: Point, zoneSpacing: number | undefined, format: FieldFormat): FieldZone {
  const x = .5 + (mx - .5) / normalizeZoneSpacing(zoneSpacing);
  if (inExtraMonsterRow({ x, y }, format)) return x < .5 ? 'EMZ1' : 'EMZ2';
  if (x < FIELD_ZONE_START) return y < 2 * FIELD_ROW ? 'FIELD' : 'EXTRA';
  if (x >= FIELD_ZONE_END - 1e-9) return y < FIELD_ROW ? 'BANISHED' : y < 2 * FIELD_ROW ? 'GY' : 'DECK';
  return `${y < 2 * FIELD_ROW ? 'M' : 'S'}${Math.max(1, Math.min(5, Math.floor((x - FIELD_ZONE_START) / FIELD_ZONE_PITCH) + 1))}` as FieldZone;
}
/**
 * The one "which zone is at this mat point" rule, for card assignment, hover and click, straddle checks and the editor.
 * The smallest cell holding the point wins (edits included). In a gap, the default band applies unless the player moved
 * that zone away; then the nearest cell wins. Nothing falls back to a zone that no longer claims the point.
 */
export function fieldZoneAt(point: Point, calibration?: Pick<FieldCalibration, 'zoneSpacing' | 'zones'>, format: FieldFormat = 'normal'): FieldZone {
  const { cells, custom } = zoneLayoutOf(calibration, format), hit = zoneCellAt(point, cells);
  if (hit) return hit.zone as FieldZone;
  const band = bandZone(point, calibration?.zoneSpacing, format);
  if (!custom.has(band) && cells.some(c => c.zone === band)) return band;
  let best = cells[0], bestDistance = Infinity;
  for (const c of cells) {
    const d = Math.hypot(Math.max(c.x - point.x, 0, point.x - c.x - c.w), Math.max(c.y - point.y, 0, point.y - c.y - c.h));
    if (d < bestDistance - 1e-12 || (Math.abs(d - bestDistance) <= 1e-12 && c.w * c.h < best.w * best.h)) { best = c; bestDistance = d; }
  }
  return best.zone as FieldZone;
}
/** Where a new card may appear: all zones together, so a zone moved past the mat edge still reads. */
export function fieldZoneBounds(calibration?: Pick<FieldCalibration, 'zoneSpacing' | 'zones'>, format: FieldFormat = 'normal') {
  const { cells } = zoneLayoutOf(calibration, format);
  return { minX: Math.min(...cells.map(c => c.x)), maxX: Math.max(...cells.map(c => c.x + c.w)), minY: Math.min(...cells.map(c => c.y)), maxY: Math.max(...cells.map(c => c.y + c.h)) };
}
export type PlayerSide = 'bottom' | 'left' | 'top' | 'right';
export interface FieldOrientation { playerSide: PlayerSide; mirrored: boolean }
/** Corners are image-clockwise from image top-left. Missing orientation is legacy/unconfirmed. */
/** `layout: 3` = made with the current zone layout (7 columns by 3 rows of equal slots). A saved calibration without it lines its zones up differently and must be checked again. */
export const FIELD_ZONE_LAYOUT = 3;
export interface FieldCalibration { version: 1; layout?: typeof FIELD_ZONE_LAYOUT; corners: Point[]; orientation?: FieldOrientation; zoneSpacing?: number; zones?: ZoneOverrides }
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
  return createFieldCalibration(calibration.corners,{...orientation,playerSide:sides[(sides.indexOf(orientation.playerSide)+degrees/90)%4]},calibration.zoneSpacing,calibration.zones);
}
export function mirrorFieldCalibration(calibration:FieldCalibration):FieldCalibration {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  return createFieldCalibration(calibration.corners,{...orientation,mirrored:!orientation.mirrored},calibration.zoneSpacing,calibration.zones);
}
/** The two near corners, identified by the player's LEFT then RIGHT hand, remove mirror ambiguity. */
export function orientFieldFromHands(calibration:FieldCalibration,left:number,right:number):FieldCalibration {
  for(const playerSide of sides)for(const mirrored of [false,true]){
    const orientation={playerSide,mirrored};
    const nearLeft=orient({x:0,y:1},orientation),nearRight=orient({x:1,y:1},orientation);
    const index=(p:Point)=>unitCorners.findIndex(c=>c.x===p.x&&c.y===p.y);
    if(index(nearLeft)===left&&index(nearRight)===right)return createFieldCalibration(calibration.corners,orientation,calibration.zoneSpacing,calibration.zones);
  }
  throw new Error('Choose two adjacent corners along your edge of the mat.');
}

/**
 * The same grid moved by whole rows along the mat (positive = toward the player). New mat point (x, y) lands where the old (x, y - rows) was.
 * Throws when the moved grid would leave the picture.
 */
export function shiftFieldCalibrationRows(calibration:FieldCalibration, rows:number):FieldCalibration {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION,dy=rows*FIELD_ROW;
  const corners=unitCorners.map(u=>{const m=orient(u,orientation,true);return fieldMatPoint({x:m.x,y:m.y-dy},calibration);});
  return createFieldCalibration(corners,calibration.orientation,calibration.zoneSpacing,calibration.zones);
}
/**
 * Fix for monster and spell cards placed in swapped rows (monster in S, spell/trap in M): the quick setup then reads a
 * reflected mat. This reflects the rows (M becomes S and S becomes M) in the same picture plane.
 */
export function swapFieldCalibrationRows(calibration:FieldCalibration):FieldCalibration {
  const orientation=calibration.orientation??DEFAULT_FIELD_ORIENTATION;
  const flipped=createFieldCalibration(calibration.corners,{playerSide:sides[(sides.indexOf(orientation.playerSide)+2)%4],mirrored:!orientation.mirrored},calibration.zoneSpacing,calibration.zones);
  return shiftFieldCalibrationRows(flipped,1);
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
export function createFieldCalibration(points: Point[], orientation?:FieldOrientation,zoneSpacing=1,zones?:ZoneOverrides): FieldCalibration {
  const corners=points.length===2?[points[0],{x:points[1].x,y:points[0].y},points[1],{x:points[0].x,y:points[1].y}]:points;
  if(corners.length!==4 || corners.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.y<0||p.x>1||p.y>1) || polygonArea(corners)<.02) throw new Error('Invalid field calibration: click opposite corners or four clockwise mat corners');
  const crosses=corners.map((a,i)=>{const b=corners[(i+1)%4],c=corners[(i+2)%4];return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);});
  if(crosses.some(c=>c<=0))throw new Error('Invalid field calibration: corners must be clockwise from top left');
  if(orientation&&(!sides.includes(orientation.playerSide)||typeof orientation.mirrored!=='boolean'))throw new Error('Invalid field orientation');
  return {version:1,layout:FIELD_ZONE_LAYOUT,corners:corners.map(p=>({...p})),zoneSpacing:normalizeZoneSpacing(zoneSpacing),...(normalizeZones(zones)?{zones:normalizeZones(zones)}:{}),...(orientation?{orientation:{...orientation}}:{})};
}
/** The whole-field transform the calibration screen edits. `scale` grows both axes, `width` and `height` stretch one axis each; all are factors around the grid centre (1 = unchanged). */
export interface FieldTransform { dx: number; dy: number; scale: number; width: number; height: number }
export const IDENTITY_FIELD_TRANSFORM: FieldTransform = { dx: 0, dy: 0, scale: 1, width: 1, height: 1 };
/**
 * Apply a whole-field transform to a base quad. Stretching follows the mat axes (so perspective stays right).
 * The result is shifted to stay inside the image; `applied` is the transform with that shift folded into dx/dy (so repeated
 * nudges at the edge do not pile up). Null when the field cannot fit.
 */
export function transformFieldCorners(base: Point[], t: FieldTransform): { corners: Point[]; applied: FieldTransform } | null {
  const flat: FieldCalibration = { version: 1, corners: base };
  const kx = t.scale * t.width, ky = t.scale * t.height;
  if (![t.dx, t.dy, kx, ky].every(Number.isFinite) || kx < .2 || ky < .2 || kx > 4 || ky > 4) return null;
  const moved = unitCorners.map(u => { const p = fieldMatPoint({ x: .5 + (u.x - .5) * kx, y: .5 + (u.y - .5) * ky }, flat); return { x: p.x + t.dx, y: p.y + t.dy }; });
  if (moved.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const b = boundsOf(moved);
  if (b.w > 1 || b.h > 1) return null;
  const sx = b.x < 0 ? -b.x : b.x + b.w > 1 ? 1 - (b.x + b.w) : 0, sy = b.y < 0 ? -b.y : b.y + b.h > 1 ? 1 - (b.y + b.h) : 0;
  const corners = moved.map(p => ({ x: Math.max(0, Math.min(1, p.x + sx)), y: Math.max(0, Math.min(1, p.y + sy)) }));
  try { createFieldCalibration(corners); } catch { return null; }
  return { corners, applied: { ...t, dx: t.dx + sx, dy: t.dy + sy } };
}
/**
 * Migration for records saved with per-zone rectangles or a zone spacing: the same orientation and the default zone layout,
 * with the mat quad fitted to the OUTER box of the old zones. Fixed zone proportions can then never drift apart from the picture.
 * Falls back to the plain corners if the fitted quad would leave the image.
 */
export function flattenFieldCalibration(calibration: FieldCalibration, format: FieldFormat = 'normal'): FieldCalibration {
  const orientation = calibration.orientation, plain = () => createFieldCalibration(calibration.corners, orientation);
  const custom = !!normalizeZones(calibration.zones) || (calibration.zoneSpacing !== undefined && Math.abs(normalizeZoneSpacing(calibration.zoneSpacing) - 1) > 1e-6);
  if (!custom) return calibration.zones === undefined && calibration.zoneSpacing === undefined ? calibration : plain();
  try {
    const old = fieldZoneBounds(calibration, format), def = fieldZoneBounds(undefined, format), turned = orientation ?? DEFAULT_FIELD_ORIENTATION;
    for (let shrink = 1, i = 0; i < 24; i++, shrink *= .96) {
      const cx = (old.minX + old.maxX) / 2, cy = (old.minY + old.maxY) / 2;
      const corners = unitCorners.map(v => {
        const u = orient(v, turned, true);
        const m = { x: cx + ((u.x - def.minX) / (def.maxX - def.minX) - .5) * (old.maxX - old.minX) * shrink, y: cy + ((u.y - def.minY) / (def.maxY - def.minY) - .5) * (old.maxY - old.minY) * shrink };
        return fieldMatPoint(m, calibration);
      });
      try { return createFieldCalibration(corners, orientation); } catch { /* shrink the fitted box until it fits the image */ }
    }
  } catch { /* fall through */ }
  return plain();
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
      const width=pitch/FIELD_ZONE_PITCH,height=(aspect+pitch-1)/FIELD_ROW,corners=unitCorners.map(p=>({x:(p.x-(.5-2*FIELD_ZONE_PITCH))*width,y:(p.y-1.5*FIELD_ROW)*height})),denominators=corners.map(p=>h[6]*p.x+h[7]*p.y+1);
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
      const width=pitch/FIELD_ZONE_PITCH,height=rowPitch/FIELD_ROW,worldCorners=unitCorners.map(p=>({x:(p.x-(.5-2*FIELD_ZONE_PITCH))*width,y:(p.y-1.5*FIELD_ROW)*height}));
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
/**
 * How a detector quad lies on the calibrated mat plane (the inverse homography). A card resting ON the mat keeps
 * its shape there: opposite edges stay parallel and of equal length (an affine property, so it holds whatever the
 * unknown cell aspect is), and its size in cell units is the same at every position. A card held above the mat is
 * closer to the camera, so it maps larger; tilted toward the camera, its opposite edges stop being parallel.
 * `size`: sqrt(area) in default cell units (one cell = 1). `tilt`: worst angle between opposite edges (degrees).
 * `sides`: worst opposite-edge length ratio (1 = equal). `cellShare`: share of its mat box inside its own cell.
 */
export interface MatRestGeometry { size:number; tilt:number; sides:number; cellShare:number; zone:FieldZone }
export function matRestGeometry(card:Pick<DetectedQuad,'quad'>, calibration:FieldCalibration, format:FieldFormat='normal'):MatRestGeometry|undefined {
  if(card.quad.length!==4)return;
  const m=card.quad.map(p=>onMat(p,calibration));
  if(m.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))return;
  const w=FIELD_ZONE_PITCH*normalizeZoneSpacing(calibration.zoneSpacing),h=FIELD_ROW,uv=m.map(p=>({x:p.x/w,y:p.y/h}));
  const edges=uv.map((a,i)=>{const b=uv[(i+1)%4];return {x:b.x-a.x,y:b.y-a.y,length:Math.hypot(b.x-a.x,b.y-a.y)};});
  if(edges.some(e=>!(e.length>1e-6)))return;
  let tilt=0,sides=1;
  for(const [i,j] of [[0,2],[1,3]]){
    const a=edges[i],b=edges[j],cos=Math.max(-1,Math.min(1,-(a.x*b.x+a.y*b.y)/(a.length*b.length)));
    tilt=Math.max(tilt,Math.acos(cos)*180/Math.PI);sides=Math.min(sides,Math.min(a.length,b.length)/Math.max(a.length,b.length));
  }
  const zone=fieldZoneAt(fieldCenter({quad:m}),calibration,format),cell=zoneLayoutOf(calibration,format).cells.find(c=>c.zone===zone),box=boundsOf(m);
  const cellShare=cell&&box.w*box.h>0?Math.max(0,Math.min(box.x+box.w,cell.x+cell.w)-Math.max(box.x,cell.x))*Math.max(0,Math.min(box.y+box.h,cell.y+cell.h)-Math.max(box.y,cell.y))/(box.w*box.h):0;
  return {size:Math.sqrt(polygonArea(uv)),tilt,sides,cellShare,zone};
}
export function mapFieldZone(card:DetectedQuad, calibration?:FieldCalibration, peers:DetectedQuad[]=[], format:FieldFormat='normal'):{zone:FieldZone;calibrated:boolean} {
  return {zone:fieldZoneAt(onMat(fieldCenter(card),calibration),calibration,format),calibrated:!!calibration};
}
/** Detector corners are portrait ordered; measure the long axis in native pixels. */
export function fieldOrientation(card:DetectedQuad,width:number,height:number,calibration?:FieldCalibration):'attack'|'defense' {
  const p=card.quad.map(q=>{
    if(!calibration)return {x:q.x*width,y:q.y*height};
    const mat=onMat(q,calibration);
    // A row pitch spans one third. Portrait cards are 59:86.
    return {x:mat.x/(FIELD_ZONE_PITCH*normalizeZoneSpacing(calibration?.zoneSpacing)),y:mat.y/FIELD_ROW*(86/59)};
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
