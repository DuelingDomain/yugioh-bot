/**
 * The real outline of a (possibly rotated) element on the screen.
 *
 * getBoundingClientRect of a turned card is the straight box around it, so a highlight drawn from it does
 * not follow a tilted field (3-way plaza, 4-way grid). The outline is rebuilt from the layout size of the
 * element and the turn/scale of it and of its ancestors (computed `transform`, `rotate`, `scale`), then fitted
 * to the bounding rect, so it still lands on the card under a perspective tilt. Reads only: no DOM change.
 */

export type Pt = { x: number; y: number };
/** Top-left, top-right, bottom-right, bottom-left of the element's own box, as they are on the screen. */
export type Quad = [Pt, Pt, Pt, Pt];
export type Rect = { left: number; top: number; width: number; height: number };
/** The 2x2 part of a transform: x' = a*x + c*y, y' = b*x + d*y. */
export type Linear = readonly [a: number, b: number, c: number, d: number];

const IDENTITY: Linear = [1, 0, 0, 1];

export function rectQuad(box: Rect): Quad {
  const { left, top, width, height } = box;
  return [{ x: left, y: top }, { x: left + width, y: top }, { x: left + width, y: top + height }, { x: left, y: top + height }];
}

export function quadBox(quad: Quad): Rect {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function centerOfQuad(quad: Quad): Pt {
  return { x: (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4, y: (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4 };
}

/** True when the outline is no straight box (a turn or a tilt shows). */
export function isTurned(quad: Quad): boolean {
  return Math.abs(quad[0].y - quad[1].y) > 0.75 || Math.abs(quad[0].x - quad[3].x) > 0.75;
}

const mul = (m: Linear, n: Linear): Linear => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
];

const ANGLE_UNIT: Record<string, number> = { deg: Math.PI / 180, rad: 1, grad: Math.PI / 200, turn: Math.PI * 2 };

/** The 2x2 part of a computed `transform` value ("none", "matrix(...)" or "matrix3d(...)"). */
function parseTransform(value: string): Linear | null {
  const match = /^matrix(3d)?\(([^)]*)\)$/.exec(value.trim());
  if (!match) return null;
  const v = match[2].split(",").map(Number);
  if (v.some((n) => !Number.isFinite(n))) return null;
  if (match[1] && v.length === 16) return [v[0], v[1], v[4], v[5]];
  return v.length === 6 ? [v[0], v[1], v[2], v[3]] : null;
}

/** The turn and scale one element adds: `rotate` and `scale` apply before `transform`. */
function linearOfStyle(style: CSSStyleDeclaration): Linear {
  let m: Linear = IDENTITY;
  const rotate = /^(-?[\d.]+(?:e-?\d+)?)(deg|rad|grad|turn)$/.exec((style.getPropertyValue("rotate") || "").trim());
  if (rotate) {
    const angle = Number(rotate[1]) * ANGLE_UNIT[rotate[2]];
    m = mul(m, [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle)]);
  }
  const scale = (style.getPropertyValue("scale") || "").trim().split(/\s+/).map(Number);
  if (scale.length > 0 && scale.every((n) => Number.isFinite(n) && n !== 0)) m = mul(m, [scale[0], 0, 0, scale[1] ?? scale[0]]);
  const transform = parseTransform(style.getPropertyValue("transform") || "");
  return transform ? mul(m, transform) : m;
}

/** Everything that turns or scales the element, from its own style out to the root. */
export function linearOf(el: Element): Linear {
  let total: Linear = IDENTITY;
  for (let node: Element | null = el; node; node = node.parentElement) {
    total = mul(linearOfStyle(getComputedStyle(node)), total);
  }
  return total;
}

/** The outline of a box of `width` x `height` laid out in the element, mapped by `lin` and fitted to the bounding `rect`. */
export function fitQuad(rect: Rect, width: number, height: number, lin: Linear): Quad {
  const hw = width / 2;
  const hh = height / 2;
  const mapped = ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(([x, y]) => ({ x: lin[0] * x + lin[2] * y, y: lin[1] * x + lin[3] * y })) as Quad;
  const span = quadBox(mapped);
  if (span.width < 0.5 || span.height < 0.5) return rectQuad(rect);
  const fx = rect.width / span.width;
  const fy = rect.height / span.height;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const centre = centerOfQuad(mapped);
  return mapped.map((p) => ({ x: cx + (p.x - centre.x) * fx, y: cy + (p.y - centre.y) * fy })) as Quad;
}

/** The on-screen outline of an element: its true quad when it is turned, else the plain bounding rect. */
export function elementQuad(el: Element): Quad {
  const r = el.getBoundingClientRect();
  const rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  const width = el instanceof HTMLElement ? el.offsetWidth : 0;
  const height = el instanceof HTMLElement ? el.offsetHeight : 0;
  if (!(width > 0 && height > 0 && rect.width > 0 && rect.height > 0) || typeof getComputedStyle !== "function") return rectQuad(rect);
  return fitQuad(rect, width, height, linearOf(el));
}

/** The quad pushed out by `pad` on every side (exact for a rectangle). */
export function growQuad(quad: Quad, pad: number): Quad {
  const unit = (a: Pt, b: Pt): Pt => {
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  const centre = centerOfQuad(quad);
  // The outward normal of edge i (from corner i to i+1).
  const normal = (i: number): Pt => {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const e = unit(a, b);
    const n = { x: e.y, y: -e.x };
    const mid = { x: (a.x + b.x) / 2 - centre.x, y: (a.y + b.y) / 2 - centre.y };
    return n.x * mid.x + n.y * mid.y >= 0 ? n : { x: -n.x, y: -n.y };
  };
  return quad.map((p, i) => {
    const before = normal((i + 3) % 4);
    const after = normal(i);
    return { x: p.x + (before.x + after.x) * pad, y: p.y + (before.y + after.y) * pad };
  }) as Quad;
}

/** SVG path of the quad with rounded corners of radius `radius`. */
export function roundedQuadPath(quad: Quad, radius: number): string {
  const f = (n: number) => n.toFixed(1);
  const parts = quad.map((p, i) => {
    const prev = quad[(i + 3) % 4];
    const next = quad[(i + 1) % 4];
    const toward = (q: Pt): Pt => {
      const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
      const r = Math.min(radius, len / 2);
      return { x: p.x + ((q.x - p.x) / len) * r, y: p.y + ((q.y - p.y) / len) * r };
    };
    const a = toward(prev);
    const b = toward(next);
    return `${i === 0 ? "M" : "L"}${f(a.x)},${f(a.y)} Q${f(p.x)},${f(p.y)} ${f(b.x)},${f(b.y)}`;
  });
  return `${parts.join(" ")} Z`;
}

/** Where a ray from the quad's centre toward `toward` leaves the quad, pushed out by `gap`. */
export function quadEdgePoint(quad: Quad, toward: Pt, gap: number): Pt {
  const c = centerOfQuad(quad);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return c;
  const ux = dx / len;
  const uy = dy / len;
  let best = Infinity;
  for (let i = 0; i < 4; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const det = ux * ey - uy * ex;
    if (Math.abs(det) < 1e-9) continue;
    // c + t*u = a + s*e
    const t = ((a.x - c.x) * ey - (a.y - c.y) * ex) / det;
    const s = ((a.x - c.x) * uy - (a.y - c.y) * ux) / det;
    if (t > 0 && s >= -1e-6 && s <= 1 + 1e-6 && t < best) best = t;
  }
  return best === Infinity ? c : { x: c.x + ux * (best + gap), y: c.y + uy * (best + gap) };
}
