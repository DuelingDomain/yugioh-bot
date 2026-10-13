/* Field cracks: the pure, seeded generator (no DOM, no React).
   Two rules shape everything here:
   1. Cracks run ONLY in the gutters between zones and along the margins of the mat. The measured zone rects are the mask.
   2. Crumbling removes chunks from the mat EDGE only (notches, corner bites). A chunk never touches a zone.
   Same seed and same layout give the same result. The layout is normalised to a fixed reference width first, so a
   resized window gives the same cracks. Port of the owner-approved demo (.fx-demo/field-cracks/cracks-gen.js). */

export type Pt = readonly [number, number];
/** A zone rect: x0, y0, x1, y1 (any unit; see toRefLayout). */
export type Rect = readonly [number, number, number, number];
export interface FieldLayout {
  w: number;
  h: number;
  zones: readonly Rect[];
}
export type CrackKind = "m" | "b" | "t";
export interface CrackSeg {
  /** 1..3 = the stage that draws it, 4 = the connecting cracks at 0 LP. */
  stage: 1 | 2 | 3 | 4;
  kind: CrackKind;
  d: string;
  len: number;
  /** Growth window inside the stage spread (0..1). */
  t0: number;
  t1: number;
}
export interface CrackChunk {
  stage: 1 | 2 | 3;
  /** The removed area (closed polygon; first and last point sit outside the mat). */
  poly: readonly Pt[];
  /** Path of the removed area. */
  d: string;
  /** Path of the broken rim (the inner boundary of the chunk). */
  rim: string;
  /** A few rim points that give off dust when the chunk falls. */
  dust: readonly Pt[];
  cx: number;
  cy: number;
  /** Order key inside the stage (0..1). */
  t: number;
}
export interface CrackField {
  seed: number;
  /** Reference size the paths are in. */
  cw: number;
  ch: number;
  segs: readonly CrackSeg[];
  chunks: readonly CrackChunk[];
  origin: Pt;
}

/** Reference width of the generator space. */
export const REF_W = 653;
/** Clear space kept around every zone for cracks (reference px). Tests demand at least 1.5. */
export const PAD = 2.2;
const CPAD = 2.5;
/** A lane is only used when it keeps at least this much room to the zones on both sides. */
const LANE_CLEAR = 1.8;
/** Exact check margin for walked lanes and twigs (larger than the 1.5 the tests demand, to cover sampling). */
const CHECK_PAD = 2.0;

export const mulberry = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Hash of a string (duel slug) to a seed. */
export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Scales a measured layout to the reference width. Rounds to 0.5 so sub-pixel measure noise does not reshuffle the cracks. */
export function toRefLayout(layout: FieldLayout): FieldLayout {
  const k = REF_W / Math.max(1, layout.w);
  const q = (n: number) => Math.round(n * k * 2) / 2;
  return {
    w: REF_W,
    h: Math.max(60, q(layout.h)),
    zones: layout.zones.map((z) => [q(z[0]), q(z[1]), q(z[2]), q(z[3])] as const),
  };
}

/** A string that changes only when the reference layout changes (used as a memo key). */
export function layoutKey(layout: FieldLayout): string {
  const ref = toRefLayout(layout);
  return `${ref.h}:${ref.zones.map((z) => z.join(",")).join(";")}`;
}

const f1 = (n: number) => Math.round(n * 10) / 10;
const dOf = (pts: readonly Pt[]) => "M" + pts.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L");

/** Distance from a point to a rect (0 inside). */
export const rectDist = (x: number, y: number, z: Rect) => Math.hypot(Math.max(z[0] - x, 0, x - z[2]), Math.max(z[1] - y, 0, y - z[3]));

/** Lane positions along one axis: the margins and the middle of every gap between merged zone intervals. */
function lanesOf(intervals: [number, number][], total: number): number[] {
  const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  if (!merged.length) return [total / 2];
  const out: number[] = [];
  if (merged[0][0] >= 2 * LANE_CLEAR) out.push(merged[0][0] / 2);
  for (let i = 1; i < merged.length; i++) {
    const gap = merged[i][0] - merged[i - 1][1];
    if (gap >= 2 * LANE_CLEAR) out.push((merged[i][0] + merged[i - 1][1]) / 2);
  }
  const end = merged[merged.length - 1][1];
  if (total - end >= 2 * LANE_CLEAR) out.push((end + total) / 2);
  return out;
}

/** Which mat edges may crumble: top, right, bottom, left. A half of a shared mat (1v1) keeps its inner edge whole. */
export type EdgeSides = readonly [boolean, boolean, boolean, boolean];
const ALL_SIDES: EdgeSides = [true, true, true, true];

export function genField(seed: number, input: FieldLayout, sides: EdgeSides = ALL_SIDES): CrackField {
  const lay = toRefLayout(input);
  const CW = lay.w;
  const CH = lay.h;
  const ZONES = lay.zones;

  const zoneDist = (x: number, y: number) => {
    let d = 1e9;
    for (const z of ZONES) d = Math.min(d, rectDist(x, y, z));
    return d;
  };
  const inZone = (x: number, y: number, pad: number) => ZONES.some((z) => x > z[0] - pad && x < z[2] + pad && y > z[1] - pad && y < z[3] + pad);
  const polyHitsZone = (pts: readonly Pt[], pad: number) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.5));
      for (let k = 0; k <= n; k++) if (inZone(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n, pad)) return true;
    }
    return false;
  };
  const pointInPoly = (x: number, y: number, poly: readonly Pt[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const edgeSamples = (poly: readonly Pt[], step: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  };
  const polyHitsZoneArea = (poly: readonly Pt[], pad: number) => {
    if (edgeSamples(poly, 0.5).some(([x, y]) => inZone(x, y, pad))) return true;
    return ZONES.some((z) =>
      ([[z[0] - pad, z[1] - pad], [z[2] + pad, z[1] - pad], [z[2] + pad, z[3] + pad], [z[0] - pad, z[3] + pad]] as Pt[]).some(([x, y]) => pointInPoly(x, y, poly)),
    );
  };
  const polysOverlap = (a: readonly Pt[], b: readonly Pt[]) =>
    edgeSamples(a, 1).some(([x, y]) => pointInPoly(x, y, b)) || edgeSamples(b, 1).some(([x, y]) => pointInPoly(x, y, a));

  /* ------------------------------------------------------------ the gutter graph */
  const VX = lanesOf(ZONES.map((z) => [z[0], z[2]] as [number, number]), CW);
  const HY = lanesOf(ZONES.map((z) => [z[1], z[3]] as [number, number]), CH);
  const NV = VX.length;
  const NH = HY.length;
  const nodeXY = (i: number, j: number): Pt => [VX[i], HY[j]];
  const isBorder = (i: number, j: number) => i === 0 || j === 0 || i === NV - 1 || j === NH - 1;
  const DIRS: readonly Pt[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  const r = mulberry(seed * 7919 + 13);
  const rr = (a: number, b: number) => a + (b - a) * r();
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(r() * arr.length)];

  const empty: CrackField = { seed, cw: CW, ch: CH, segs: [], chunks: [], origin: [CW / 2, 0] };

  /* ------------------------------------------------------------ cracks */
  interface Walk { pts: Pt[]; nodes: { idx: number; i: number; j: number }[] }
  interface Crack { pts: Pt[]; arc: number[]; kind: CrackKind; first: number; ends: Record<number, number>; d0: number; nodes: { idx: number; i: number; j: number }[] }
  const used = new Set<string>();
  const ek = (i: number, j: number, ni: number, nj: number) => (i + j * 64 < ni + nj * 64 ? `${i},${j}|${ni},${nj}` : `${ni},${nj}|${i},${j}`);

  /* points along one lane between two nodes: jitter bounded by the free space to the nearest zone, kinks every ~14..26 px */
  function laneFrom(a: Pt, b: Pt, frac: number, jitter: boolean): Pt[] {
    const [x0, y0] = a;
    const [x1, y1] = b;
    const full = Math.hypot(x1 - x0, y1 - y0);
    const L = full * frac;
    const ux = (x1 - x0) / full;
    const uy = (y1 - y0) / full;
    const nx = -uy;
    const ny = ux;
    const pts: Pt[] = [];
    let s = 0;
    let sign = r() < 0.5 ? -1 : 1;
    while (s < L - 1) {
      s = Math.min(L, s + rr(13, 26));
      const bx = x0 + ux * s;
      const by = y0 + uy * s;
      const free = zoneDist(bx, by) - PAD;
      const amp = jitter ? Math.max(0, Math.min(3.2, free * 0.7)) : 0;
      sign = r() < 0.7 ? -sign : sign;
      const off = s >= L - 0.5 && frac >= 1 ? 0 : sign * amp * rr(0.3, 1);
      let px = bx + nx * off;
      let py = by + ny * off;
      if (inZone(px, py, PAD * 0.6)) {
        px = bx;
        py = by;
      }
      pts.push([px, py]);
    }
    if (frac >= 1) pts[pts.length - 1] = [b[0], b[1]];
    return pts;
  }

  /* a crack: a random walk along the lanes from a start node */
  function walkFrom(i0: number, j0: number, maxLen: number, jitter: boolean, dir?: Pt | null): Walk {
    const pts: Pt[] = [nodeXY(i0, j0)];
    const nodes = [{ idx: 0, i: i0, j: j0 }];
    const claimed: string[] = [];
    let i = i0;
    let j = j0;
    let len = 0;
    let prev: Pt | null = dir ?? null;
    while (len < maxLen) {
      const cand = DIRS.filter(([dx, dy]) => {
        const ni = i + dx;
        const nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= NV || nj >= NH) return false;
        if (prev && dx === -prev[0] && dy === -prev[1]) return false;
        return !used.has(ek(i, j, ni, nj));
      });
      if (!cand.length) break;
      const straight = prev && cand.find(([dx, dy]) => dx === prev![0] && dy === prev![1]);
      const d = straight && r() < 0.62 ? straight : pick(cand);
      const ni = i + d[0];
      const nj = j + d[1];
      const a = nodeXY(i, j);
      const b = nodeXY(ni, nj);
      const full = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const left = maxLen - len;
      const frac = left >= full ? 1 : Math.max(0.25, left / full);
      pts.push(...laneFrom(a, b, frac, jitter));
      len += full * frac;
      if (frac < 1) break;
      claimed.push(ek(i, j, ni, nj));
      used.add(ek(i, j, ni, nj));
      i = ni;
      j = nj;
      prev = d;
      nodes.push({ idx: pts.length - 1, i, j });
    }
    /* a jittered walk that came too close to a zone is walked again on the bare lanes (always clear) */
    if (jitter && polyHitsZone(pts, CHECK_PAD)) {
      claimed.forEach((k) => used.delete(k));
      return walkFrom(i0, j0, maxLen, false, dir);
    }
    return { pts, nodes };
  }

  const arcOf = (pts: readonly Pt[]) => {
    const a = [0];
    for (let k = 1; k < pts.length; k++) a.push(a[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    return a;
  };
  const idxAtFrac = (arc: readonly number[], f: number) => {
    const tot = arc[arc.length - 1] * f;
    for (let k = 0; k < arc.length; k++) if (arc[k] >= tot) return k;
    return arc.length - 1;
  };

  const cracks: Crack[] = [];
  function addMain(i: number, j: number, maxLen: number, fr: Record<number, number>, first: number): Crack | null {
    const w = walkFrom(i, j, maxLen, true);
    if (w.pts.length < 3) return null;
    const arc = arcOf(w.pts);
    const ends: Record<number, number> = {};
    Object.keys(fr).forEach((s) => {
      ends[+s] = fr[+s] >= 1 ? w.pts.length - 1 : Math.max(1, idxAtFrac(arc, fr[+s]));
    });
    const c: Crack = { pts: w.pts, arc, kind: "m", first, ends, d0: 0, nodes: w.nodes };
    cracks.push(c);
    return c;
  }
  /* a branch leaves an existing crack at one of its lane crossings and follows a free lane */
  function addBranch(stage: number, lo: number, hi: number, kind: CrackKind) {
    const pool: { c: Crack; n: { idx: number; i: number; j: number } }[] = [];
    cracks.forEach((c) => {
      const lim = Math.max(...Object.keys(c.ends).filter((s) => +s <= stage).map((s) => c.ends[+s]), -1);
      if (c.first > stage) return;
      c.nodes.forEach((n) => {
        if (n.idx > 0 && n.idx <= lim) pool.push({ c, n });
      });
    });
    for (let tries = 0; tries < 24 && pool.length; tries++) {
      const { c, n } = pick(pool);
      const w = walkFrom(n.i, n.j, rr(lo, hi), true);
      if (w.pts.length < 3) continue;
      const arc = arcOf(w.pts);
      const br: Crack = { pts: w.pts, arc, kind, first: stage, ends: { [stage]: w.pts.length - 1 }, d0: 0, nodes: w.nodes };
      const prevEnd = (() => {
        let b = 0;
        for (const s in c.ends) if (+s < stage && c.ends[+s] > b) b = c.ends[+s];
        return b;
      })();
      br.d0 = c.first === stage || n.idx > prevEnd ? Math.max(0, c.arc[n.idx] - c.arc[c.first === stage ? 0 : prevEnd]) : rr(0, 40);
      cracks.push(br);
      return;
    }
  }
  /* a twig: a short diagonal tick off a crack point, kept inside the free space */
  function addTwig(stage: number) {
    for (let tries = 0; tries < 30; tries++) {
      const c = pick(cracks);
      if (c.first > stage || c.pts.length < 4) continue;
      const k = 1 + Math.floor(r() * (c.pts.length - 2));
      const p = c.pts[k];
      const q = c.pts[k + 1] || c.pts[k - 1];
      const h = Math.atan2(q[1] - p[1], q[0] - p[0]) + (r() < 0.5 ? -1 : 1) * rr(0.35, 0.8);
      const len = rr(8, 20);
      const pts: Pt[] = [
        [p[0], p[1]],
        [p[0] + Math.cos(h) * len * 0.55, p[1] + Math.sin(h) * len * 0.55],
        [p[0] + Math.cos(h + rr(-0.35, 0.35)) * len, p[1] + Math.sin(h + rr(-0.35, 0.35)) * len],
      ];
      if (polyHitsZone(pts, CHECK_PAD)) continue;
      if (pts.some((pt) => pt[0] < 2 || pt[0] > CW - 2 || pt[1] < 2 || pt[1] > CH - 2)) continue;
      cracks.push({ pts, arc: arcOf(pts), kind: "t", first: stage, ends: { [stage]: 2 }, d0: rr(0, 80), nodes: [] });
      return;
    }
  }

  /* stage 1: two cracks from one border node; stage 2 a third + branches; stage 3 a fourth + more + twigs */
  const borders: [number, number][] = [];
  for (let j = 0; j < NH; j++) for (let i = 0; i < NV; i++) if (isBorder(i, j)) borders.push([i, j]);
  if (!borders.length || NV < 2 || NH < 2) return empty;
  const bFar = (a: [number, number]) => borders.filter(([i, j]) => Math.abs(i - a[0]) >= 3 || Math.abs(j - a[1]) >= 2);
  const s1 = pick(borders);
  addMain(s1[0], s1[1], rr(240, 300), { 1: 0.34, 2: 0.68, 3: 1 }, 1);
  const near = borders.filter(([i, j]) => Math.abs(i - s1[0]) + Math.abs(j - s1[1]) >= 1 && Math.abs(i - s1[0]) + Math.abs(j - s1[1]) <= 3);
  const s2 = pick(near.length ? near : borders);
  addMain(s2[0], s2[1], rr(160, 220), { 1: 0.4, 2: 0.72, 3: 1 }, 1);
  addBranch(1, 40, 90, "b");
  const far1 = bFar(s1);
  const s3 = pick(far1.length ? far1 : borders);
  addMain(s3[0], s3[1], rr(200, 270), { 2: 0.55, 3: 1 }, 2);
  for (let n = 0; n < 3; n++) addBranch(2, 40, 110, "b");
  const far3 = bFar(s3);
  const s4 = pick(far3.length ? far3 : borders);
  addMain(s4[0], s4[1], rr(160, 240), { 3: 1 }, 3);
  for (let n = 0; n < 5; n++) addBranch(3, 36, 100, "b");
  for (let n = 0; n < 6; n++) addTwig(3);

  /* portions: the part of each crack that appears in one stage */
  const segs: CrackSeg[] = [];
  cracks.forEach((c) => {
    let prev = 0;
    Object.keys(c.ends).map(Number).sort().forEach((s) => {
      const end = c.ends[s];
      const pts = c.pts.slice(prev, end + 1);
      if (pts.length >= 2) {
        const len = c.arc[end] - c.arc[prev];
        segs.push({ stage: s as 1 | 2 | 3, kind: c.kind, d: dOf(pts), len, t0: c.kind === "m" ? 0 : c.d0, t1: 0 });
      }
      prev = end;
    });
  });
  /* t0 holds the delay in px for now; turn delay and length into 0..1 growth windows per stage */
  const growth = (list: CrackSeg[]) => {
    const max = Math.max(1, ...list.map((g) => g.t0 + g.len));
    list.forEach((g) => {
      const d0 = g.t0;
      g.t0 = d0 / max;
      g.t1 = Math.min(1, (d0 + g.len) / max);
    });
  };
  ([1, 2, 3] as const).forEach((s) => growth(segs.filter((g) => g.stage === s)));

  /* stage 4 (0 LP): the cracks connect. Every lane that touches a crack node and is still free joins in, outward from the first crack. */
  const nodeSet = new Set<string>();
  cracks.forEach((c) => c.nodes.forEach((n) => nodeSet.add(`${n.i},${n.j}`)));
  const joins: { a: Pt; b: Pt; dist: number }[] = [];
  const origin: Pt = cracks[0] ? cracks[0].pts[0] : [CW / 2, 0];
  for (let j = 0; j < NH; j++) {
    for (let i = 0; i < NV; i++) {
      for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
        const ni = i + dx;
        const nj = j + dy;
        if (ni >= NV || nj >= NH || used.has(ek(i, j, ni, nj))) continue;
        if (!nodeSet.has(`${i},${j}`) && !nodeSet.has(`${ni},${nj}`)) continue;
        const a = nodeXY(i, j);
        const b = nodeXY(ni, nj);
        joins.push({ a, b, dist: Math.hypot((a[0] + b[0]) / 2 - origin[0], (a[1] + b[1]) / 2 - origin[1]) });
      }
    }
  }
  joins.sort((p, q) => p.dist - q.dist);
  const maxJ = Math.max(1, ...joins.map((x) => x.dist));
  joins.slice(0, 16).forEach((jn) => {
    const len = Math.hypot(jn.b[0] - jn.a[0], jn.b[1] - jn.a[1]);
    const t0 = (jn.dist / maxJ) * 0.5;
    segs.push({ stage: 4, kind: "b", d: dOf([jn.a, jn.b]), len, t0, t1: Math.min(1, t0 + 0.5) });
  });

  /* ------------------------------------------------------------ crumbling edge chunks */
  const chunks: CrackChunk[] = [];
  /* local frame of a side: u runs along the edge, v runs inward. side 0 top, 1 right, 2 bottom, 3 left */
  const toXY = (side: number, u: number, v: number): Pt => (side === 0 ? [u, v] : side === 1 ? [CW - v, u] : side === 2 ? [CW - u, CH - v] : [v, CH - u]);
  const sideLen = (side: number) => (side % 2 === 0 ? CW : CH);
  /* free depth from a side's edge over the span [u0, u0+L]: how far a notch may reach before it nears a zone */
  const depthCap = (side: number, u0: number, L: number) => {
    let cap = side % 2 === 0 ? CH : CW;
    for (const z of ZONES) {
      const [uA, uB, vNear] =
        side === 0 ? [z[0], z[2], z[1]] : side === 1 ? [z[1], z[3], CW - z[2]] : side === 2 ? [CW - z[2], CW - z[0], CH - z[3]] : [CH - z[3], CH - z[1], z[0]];
      if (uB > u0 - 4 && uA < u0 + L + 4) cap = Math.min(cap, vNear);
    }
    return cap - CPAD - 0.6;
  };

  function edgeChunk(side: number, u0: number, L: number, D: number): Pt[] {
    const n = 3 + Math.floor(r() * 2);
    const loc: [number, number][] = [[u0 - 0.5, -3], [u0, D * rr(0.15, 0.4)]];
    for (let k = 1; k <= n; k++) loc.push([u0 + (L * k) / (n + 1) + rr(-L * 0.06, L * 0.06), D * rr(0.35, 1)]);
    loc.push([u0 + L, D * rr(0.1, 0.4)], [u0 + L + 0.5, -3]);
    return loc.map(([u, v]) => toXY(side, u, v));
  }
  function cornerChunk(corner: number, a: number, b: number): Pt[] {
    /* corner 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left; a along the horizontal edge, b along the vertical one */
    const pts: [number, number][] = [[a, -3]];
    const n = 2 + Math.floor(r() * 2);
    for (let k = 1; k <= n; k++) {
      const s = k / (n + 1);
      const push = Math.min(a, b) * rr(0.05, 0.3);
      pts.push([a * (1 - s) + push, b * s + push]);
    }
    pts.push([-3, b]);
    pts.unshift([-3, -3]);
    return pts.map(([x, y]): Pt => (corner === 0 ? [x, y] : corner === 1 ? [CW - x, y] : corner === 2 ? [CW - x, CH - y] : [x, CH - y]));
  }
  const openSides = [0, 1, 2, 3].filter((k) => sides[k]);
  /** Corner k (0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left) crumbles when both its edges may. */
  const cornerOpen = (k: number) => sides[k] && sides[(k + 3) % 4];
  interface ChunkKind { corner?: number; a?: [number, number]; b?: [number, number]; side?: number; L?: [number, number]; D?: [number, number] }
  function tryChunk(stage: 1 | 2 | 3, kind: ChunkKind) {
    if (!openSides.length) return;
    for (let attempt = 0; attempt < 18; attempt++) {
      let shrink = 1;
      for (let t = 0; t < 9; t++) {
        let poly: Pt[];
        if (kind.corner != null) {
          const a = rr(kind.a![0], kind.a![1]) * shrink;
          const b = rr(kind.b![0], kind.b![1]) * shrink;
          poly = cornerChunk(kind.corner, a, b);
        } else {
          const side = kind.side != null ? kind.side : openSides[Math.floor(r() * openSides.length)];
          const L = rr(kind.L![0], kind.L![1]) * shrink;
          const u0 = rr(14, Math.max(15, sideLen(side) - 14 - L));
          /* shallow where the edge is near the zones */
          const cap = depthCap(side, u0, L);
          const hi = Math.min(kind.D![1] * shrink, cap);
          if (hi < 2) {
            shrink *= 0.8;
            continue;
          }
          const lo = Math.min(kind.D![0] * shrink, hi * 0.6);
          poly = edgeChunk(side, u0, L, rr(lo, hi));
        }
        const bad = polyHitsZoneArea(poly, CPAD) || chunks.some((c) => polysOverlap(poly, c.poly));
        if (!bad) {
          const xs = poly.map((p) => p[0]);
          const ys = poly.map((p) => p[1]);
          const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
          if (area > 40) {
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
            const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            const inner = poly.slice(1, -1);
            chunks.push({
              stage,
              poly,
              d: "M" + poly.map((p) => `${f1(p[0])} ${f1(p[1])}`).join("L") + "Z",
              rim: dOf(inner),
              dust: inner.filter((_, k) => k % 2 === 0).slice(0, 4).map((p) => [f1(p[0]), f1(p[1])] as Pt),
              cx,
              cy,
              t: r(),
            });
            return;
          }
          break;
        }
        shrink *= 0.8;
      }
    }
  }
  /* stage 1: a few small notches and corner chips (4). Stage 2: bigger bites (5). Stage 3: ragged nicks all round (8). */
  const cOrder = [0, 1, 2, 3].filter(cornerOpen).sort(() => r() - 0.5);
  /** A corner bite where the mat has the corner; a wide notch on an open edge where it has not (a half of a shared mat). */
  const corner = (stage: 1 | 2 | 3, k: number | null, a: [number, number], b: [number, number]) => {
    const which = k == null ? (cOrder[0] != null && cornerOpen((cOrder[0] + 2) % 4) ? (cOrder[0] + 2) % 4 : undefined) : cOrder[k];
    tryChunk(stage, which != null ? { corner: which, a, b } : { L: [a[0] * 1.6, a[1] * 1.6], D: [b[0] * 0.5, b[1] * 0.5] });
  };
  corner(1, 0, [10, 20], [8, 18]);
  for (let n = 0; n < 3; n++) tryChunk(1, { L: [16, 34], D: [4, 8] });
  corner(2, 1, [34, 66], [30, 70]);
  corner(2, 2, [22, 44], [20, 40]);
  for (let n = 0; n < 3; n++) tryChunk(2, { L: [36, 84], D: [10, 34] });
  corner(3, 3, [26, 54], [22, 54]);
  corner(3, null, [8, 16], [8, 16]);
  for (let n = 0; n < 7 && chunks.filter((c) => c.stage === 3).length < 8; n++) tryChunk(3, { L: [12, 40], D: [3, 16] });

  return { seed, cw: CW, ch: CH, segs, chunks, origin };
}

/** The chunk polygons of stages <= stage as one evenodd path (in reference units). Empty string when none. */
export function chunkPath(chunks: readonly CrackChunk[], stage: number): string {
  return chunks.filter((c) => c.stage <= stage).map((c) => c.d).join(" ");
}

/** A CSS mask-image url that is opaque everywhere except the chunks of stages <= stage. The svg viewBox is the
    element box (0..1) with 1.5 units of slack on each side, so shadows and glows outside the mat keep drawing
    (pair it with mask-size 400% and mask-position 50%, see mask.ts). */
export function maskImageUrl(field: CrackField, stage: number): string | undefined {
  const holes = chunkPath(field.chunks, stage);
  if (!holes) return undefined;
  const { cw, ch } = field;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1.5 -1.5 4 4' preserveAspectRatio='none'>` +
    `<g transform='scale(${(1 / cw).toFixed(6)} ${(1 / ch).toFixed(6)})'>` +
    `<path fill='black' fill-rule='evenodd' d='M${-1.5 * cw} ${-1.5 * ch}H${2.5 * cw}V${2.5 * ch}H${-1.5 * cw}Z ${holes}'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** Chunks of one generated field, placed on a larger element: a ref point (x, y) lands at (ox + x * k, oy + y * k). */
export interface MaskPart {
  chunks: readonly CrackChunk[];
  ox: number;
  oy: number;
  k: number;
  /** Vertical scale when it differs from k (default k). */
  ky?: number;
}

/** Like maskImageUrl, for an element of w x h px that holds one or more fields (1v1 has two halves on one mat). */
export function maskImageOf(w: number, h: number, parts: readonly MaskPart[]): string | undefined {
  const holes = parts
    .flatMap((part) => part.chunks.map((c) => "M" + c.poly.map((p) => `${f1(part.ox + p[0] * part.k)} ${f1(part.oy + p[1] * (part.ky ?? part.k))}`).join("L") + "Z"))
    .join(" ");
  if (!holes || !(w > 0) || !(h > 0)) return undefined;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-1.5 -1.5 4 4' preserveAspectRatio='none'>` +
    `<g transform='scale(${(1 / w).toFixed(6)} ${(1 / h).toFixed(6)})'>` +
    `<path fill='black' fill-rule='evenodd' d='M${-1.5 * w} ${-1.5 * h}H${2.5 * w}V${2.5 * h}H${-1.5 * w}Z ${holes}'/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
