/**
 * The attack effects themselves: SVG and DOM nodes driven by the Web Animations API.
 *
 * `runAttackFx` builds every node for one attack up front, each with its own animation delay, so
 * there is no render loop and no state: cancelling the returned function stops everything. Sparks
 * are tiny DOM dots on keyframes (not a canvas). All sizes scale with the attacker's card (`u`), so
 * it reads the same at any board scale. Geometry is in viewport pixels (the layer is fixed, inset 0).
 *
 * Ported from the approved prototype (designs/duel-ui/attack-fx/fx.js). The style table (which
 * effect a monster plays) lives in attack-styles.ts; this file only draws them.
 */
import { duelFxClock } from "./fx-clock";
import { safeFxAnimate as safeAnimate } from "./safe-animate";
import { battleSeekMs } from "./battle-clock";
import {
  COUNTER_GAP_MS,
  DESTROY_BEAT_MS,
  COUNTER_SCALE,
  hasCounterStrike,
  type AttackStyleId,
  type BattleKind,
  type BattleTiming,
  type Tint,
} from "./attack-styles";
import { ATTACK_PACE, ATTACK_TIMING } from "./duel-timing";

/** Shakes, rings and flashes at the point of impact stay this many times longer, so the hit is felt. */
const HIT_LINGER = ATTACK_TIMING.hitLinger;

export type Pt = { x: number; y: number };
export type Box = { left: number; top: number; width: number; height: number };

/** A card's art as it looked before the board updated: what gets broken up when it dies. */
export type FxCut = {
  box: Box;
  innerW: number;
  innerH: number;
  html: string;
  /** Degrees the card was turned on screen (a seat field of a multiplayer table is rotated). Default 0. */
  turn?: number;
};

export type FxSide = {
  box: Box;
  /** The live board element of the card's art (leaned or shaken briefly), if it is still on screen. */
  el: Element | null;
  style: AttackStyleId;
  tint: Tint;
  caption: string | null;
  cut: FxCut | null;
};

export type FxLpHit = {
  box: Box;
  /** ms after the play starts when the LP counter starts to roll. */
  at: number;
  /** The damage lands on the attacker's own seat. */
  toAttacker: boolean;
};

export type AttackFxPlan = {
  /** Shared duelFxClock.now() clock for the canvas, audio and DOM beats. */
  startedAt?: number;
  reduced: boolean;
  kind: BattleKind;
  attacker: FxSide;
  /** null for a direct attack. */
  defender: FxSide | null;
  /** Where the strike lands: the defender's art, or the defender's LP tally when direct. */
  hit: Box;
  /** The defender is in Defense Position (a held fight then shows a shield instead of a clash). */
  defenderInDefense: boolean;
  lpHits: FxLpHit[];
  seed: number;
  timing: BattleTiming;
  /** The 3D layer draws the strike, the counter strike and the breaks: the DOM keeps captions, jolts, clashes and LP flashes. */
  layer3d?: boolean;
};

export type FxClasses = { veil: string; frags: string; piece: string; inner: string; caption: string; lpFlash: string };

const SVG_NS = "http://www.w3.org/2000/svg";
const MAX_PARTICLES = 160;

/* ---------- small helpers ---------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const centre = (b: Box): Pt => ({ x: b.left + b.width / 2, y: b.top + b.height / 2 });
const f1 = (n: number): string => n.toFixed(1);
const deg = (rad: number): number => (rad * 180) / Math.PI;
const glow = (color: string, px: number): string => `drop-shadow(0 0 ${px}px ${color})`;

function edgePoint(box: Box, toward: Pt, gap: number): Pt {
  const c = centre(box);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return c;
  const ux = dx / len;
  const uy = dy / len;
  const tx = ux === 0 ? Infinity : box.width / 2 / Math.abs(ux);
  const ty = uy === 0 ? Infinity : box.height / 2 / Math.abs(uy);
  const t = Math.min(tx, ty);
  return { x: c.x + ux * (t + gap), y: c.y + uy * (t + gap) };
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const key of Object.keys(attrs)) el.setAttribute(key, String(attrs[key]));
  return el;
}

function boltPath(p: Pt, q: Pt, segments: number, amp: number, rnd: () => number): { d: string; pts: Pt[] } {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  let d = `M${f1(p.x)},${f1(p.y)}`;
  const pts: Pt[] = [p];
  for (let i = 1; i < segments; i++) {
    const u = i / segments;
    const off = (rnd() - 0.5) * 2 * amp * Math.sin(u * Math.PI);
    const x = p.x + dx * u + nx * off;
    const y = p.y + dy * u + ny * off;
    pts.push({ x, y });
    d += ` L${f1(x)},${f1(y)}`;
  }
  d += ` L${f1(q.x)},${f1(q.y)}`;
  pts.push(q);
  return { d, pts };
}

/* ---------- fragment geometry (percent of the card box) ---------- */

type Poly = Array<[number, number]>;

/** Two halves along a diagonal (mirror: TL->BR, else TR->BL). */
function halves(mirror: boolean): Poly[] {
  return mirror
    ? [[[0, 0], [100, 0], [100, 101], [0, 1]], [[0, 0], [100, 100], [0, 100]]]
    : [[[0, 0], [100, 0], [100, 1], [0, 101]], [[100, 0], [100, 100], [0, 100]]];
}

/** n diagonal bands. */
function bands(n: number, mirror: boolean): Poly[] {
  const out: Poly[] = [];
  const L = 300;
  for (let i = 0; i < n; i++) {
    const lo = mirror ? -100 : 0;
    const c0 = lo + (i / n) * 200;
    const c1 = lo + ((i + 1) / n) * 200 + 0.5;
    out.push(
      mirror
        ? [[c0 + L, L], [c0 - L, -L], [c1 - L, -L], [c1 + L, L]]
        : [[c0 + L, -L], [c0 - L, L], [c1 - L, L], [c1 + L, -L]],
    );
  }
  return out;
}

function tiles(cols: number, rows: number): Poly[] {
  const out: Poly[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = (c / cols) * 100;
      const x1 = ((c + 1) / cols) * 100 + 0.4;
      const y0 = (r / rows) * 100;
      const y1 = ((r + 1) / rows) * 100 + 0.4;
      out.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
    }
  }
  return out;
}

/** n shards radiating from (cx, cy), corners included. */
function shards(n: number, cx: number, cy: number, rnd: () => number): Poly[] {
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(((i + (rnd() - 0.5) * 0.6) / n) * Math.PI * 2);
  angles.sort((a, b) => a - b);
  const rim = (a: number): [number, number] => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tx = dx === 0 ? Infinity : dx > 0 ? (100 - cx) / dx : -cx / dx;
    const ty = dy === 0 ? Infinity : dy > 0 ? (100 - cy) / dy : -cy / dy;
    const t = Math.min(tx, ty);
    return [cx + dx * t, cy + dy * t];
  };
  const cornerAngle = (x: number, y: number) => Math.atan2(y - cy, x - cx);
  const corners = ([[100, 0], [100, 100], [0, 100], [0, 0]] as Array<[number, number]>).map((c) => ({ c, a: cornerAngle(c[0], c[1]) }));
  const out: Poly[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = angles[i];
    const a1 = angles[(i + 1) % n] + (i === n - 1 ? Math.PI * 2 : 0);
    const inserted: Array<[number, number]> = [];
    for (const k of corners) {
      let a = k.a;
      if (a < a0) a += Math.PI * 2;
      if (a > a0 && a < a1) inserted.push(k.c);
    }
    inserted.sort((p, q) => {
      let ap = cornerAngle(p[0], p[1]);
      let aq = cornerAngle(q[0], q[1]);
      if (ap < a0) ap += Math.PI * 2;
      if (aq < a0) aq += Math.PI * 2;
      return ap - aq;
    });
    out.push([[cx, cy], rim(a0), ...inserted, rim(a1 % (Math.PI * 2))]);
  }
  return out;
}

function polyCentre(poly: Poly): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return { x: x / poly.length, y: y / poly.length };
}

/* ---------- the play context ---------- */

type Anim = { at: number; dur: number; easing?: string; fill?: FillMode; composite?: CompositeOperation };

type Ctx = {
  html: HTMLElement;
  svg: SVGSVGElement;
  cls: FxClasses;
  animations: Animation[];
  nodes: Element[];
  particles: { budget: number };
  /** Scale of this attacker's card against the prototype's (78 px) card. */
  u: number;
  elapsedMs: number;
};

/** Geometry of one strike: attacker box, the box it lands on, and the resolved tint. */
type Geo = {
  from: Box;
  to: Box;
  fromEl: Element | null;
  toEl: Element | null;
  dir: Pt;
  len: number;
  /** Launch point (the attacker's edge). */
  s: Pt;
  /** Hit point (the target's centre). */
  e: Pt;
  tint: Tint;
  seed: number;
  direct: boolean;
  u: number;
};

function add(cx: Ctx, el: Element, keyframes: Keyframe[], o: Anim): Animation | null {
  if (typeof el.animate !== "function") return null;
  const a = safeAnimate(el, keyframes, {
    delay: Math.max(0, o.at) - cx.elapsedMs,
    duration: Math.max(1, o.dur),
    easing: o.easing ?? "linear",
    fill: o.fill ?? "both",
    composite: o.composite ?? "replace",
  });
  if (a) cx.animations.push(a);
  return a;
}

function place<T extends Element>(cx: Ctx, el: T, parent: Element = cx.svg): T {
  parent.appendChild(el);
  cx.nodes.push(el);
  return el;
}

/** A stroked path that can be drawn in with stroke-dashoffset. */
function stroke(cx: Ctx, d: string, color: string, width: number, opts: { blur?: number; glow?: number; extra?: Record<string, string | number> } = {}): SVGElement {
  const el = svgEl("path", { d, pathLength: 1, fill: "none", stroke: color, "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round", ...opts.extra });
  el.style.strokeDasharray = "1";
  if (opts.blur) el.style.filter = `blur(${opts.blur}px)`;
  else if (opts.glow) el.style.filter = glow(color, opts.glow);
  return place(cx, el);
}

const seg = (p: Pt, q: Pt): string => `M${f1(p.x)},${f1(p.y)} L${f1(q.x)},${f1(q.y)}`;

/** Draws `els` in from `at` over `dur`, holds, then hides them. */
function drawIn(cx: Ctx, els: Element[], at: number, dur: number, easing = "cubic-bezier(.55,0,.25,1)", holdTo = 0.4): void {
  for (const el of els) {
    add(cx, el, [{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: holdTo }, { strokeDashoffset: 0, opacity: 0 }], { at, dur, easing });
  }
}

/* ---------- shared beats ---------- */

function shake(cx: Ctx, el: Element | null, at: number, amp: number, dur = 220): void {
  dur *= HIT_LINGER;
  if (!el?.isConnected) return;
  add(cx, el, [
    { transform: "translate(0,0)" },
    { transform: `translate(${-amp}px,${amp * 0.4}px)` },
    { transform: `translate(${amp}px,${-amp * 0.4}px)` },
    { transform: `translate(${-amp * 0.6}px,${amp * 0.2}px)` },
    { transform: `translate(${amp * 0.4}px,0)` },
    { transform: "translate(0,0)" },
  ], { at, dur, composite: "add", fill: "none" });
}

function hitRing(cx: Ctx, box: Box, at: number, color: string, pad = 5): void {
  const p = pad * cx.u;
  const r = place(cx, svgEl("rect", { x: box.left - p, y: box.top - p, width: box.width + 2 * p, height: box.height + 2 * p, rx: 8, fill: "none", stroke: color, "stroke-width": 1.5 }));
  r.style.filter = glow(color, 6);
  add(cx, r, [{ opacity: 0, strokeWidth: 1 }, { opacity: 1, strokeWidth: 2.4, offset: 0.3 }, { opacity: 0, strokeWidth: 1.2 }], { at, dur: 380 * HIT_LINGER, easing: "ease-out" });
}

function flashDisc(cx: Ctx, c: Pt, at: number, color: string, r: number, dur = 320): void {
  dur *= HIT_LINGER;
  const d = place(cx, svgEl("circle", { cx: c.x, cy: c.y, r, fill: color }));
  d.style.filter = "blur(6px)";
  d.style.transformOrigin = `${c.x}px ${c.y}px`;
  add(cx, d, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 0.9, offset: 0.2 }, { opacity: 0, transform: "scale(1.6)" }], { at, dur, easing: "ease-out" });
}

function veil(cx: Ctx, box: Box, color: string, at: number, dur: number, peak: number, radius = 4): HTMLElement {
  const v = document.createElement("div");
  v.className = cx.cls.veil;
  v.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border-radius:${radius}px;background:${color};opacity:0;`;
  place(cx, v, cx.html);
  add(cx, v, [{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: 0 }], { at, dur });
  return v;
}

function caption(cx: Ctx, g: Geo, text: string, tint: Tint, at: number): void {
  const el = document.createElement("div");
  el.className = cx.cls.caption;
  el.textContent = text;
  const c = centre(g.from);
  // Away from the fight: below the attacker when the target is above it, and vice versa.
  const below = g.dir.y < 0 || g.from.top < 36;
  el.style.left = `${c.x}px`;
  el.style.top = `${below ? g.from.top + g.from.height + 10 : g.from.top - 10}px`;
  el.style.setProperty("--tint", tint.hi);
  el.style.setProperty("--tint-deep", tint.main);
  place(cx, el, cx.html);
  const dy = below ? 6 : -6;
  const ty = below ? 0 : -100;
  add(cx, el, [
    { opacity: 0, transform: `translate(-50%, ${ty}%) translateY(${dy}px)` },
    { opacity: 1, transform: `translate(-50%, ${ty}%) translateY(0)`, offset: 0.18 },
    { opacity: 1, offset: 0.8 },
    { opacity: 0, transform: `translate(-50%, ${ty}%) translateY(${-dy}px)` },
  ], { at, dur: 900, easing: "cubic-bezier(.16,1,.3,1)" });
}

/** The attacker's card leans into the strike. */
function lunge(cx: Ctx, g: Geo, at: number, k: number): void {
  if (!g.fromEl?.isConnected) return;
  const px = g.dir.x * 7 * g.u;
  const py = g.dir.y * 7 * g.u;
  add(cx, g.fromEl, [
    { transform: "translate(0,0) scale(1)" },
    { transform: `translate(${-px * 0.5}px,${-py * 0.5}px) scale(1.05)`, offset: 0.55 },
    { transform: `translate(${px}px,${py}px) scale(1.04)`, offset: 0.8 },
    { transform: "translate(0,0) scale(1)" },
  ], { at, dur: 360 * k, easing: "cubic-bezier(.3,.7,.3,1)", composite: "add", fill: "none" });
}

/* ---------- sparks (DOM dots on keyframes) ---------- */

type Spark = {
  at: number;
  life: number;
  count: number;
  x?: number;
  y?: number;
  color: string;
  size: number;
  mode?: "burst" | "converge" | "trail";
  angle?: number;
  spread?: number;
  speed?: number;
  speedVar?: number;
  gravity?: number;
  drag?: number;
  shape?: "streak" | "dot";
  shrink?: boolean;
  radius?: number;
  path?: { a: Pt; c: Pt; b: Pt; span: number };
  alpha?: number;
  seed: number;
};

function emit(cx: Ctx, spec: Spark): void {
  const count = Math.min(spec.count, cx.particles.budget);
  if (count <= 0) return;
  cx.particles.budget -= count;
  const u = cx.u;
  const rnd = mulberry32(spec.seed);
  const mode = spec.mode ?? "burst";
  const samples = [0, 0.15, 0.4, 0.7, 1];
  for (let i = 0; i < count; i++) {
    const a = (spec.angle ?? 0) + (rnd() - 0.5) * (spec.spread ?? Math.PI * 2);
    const sp = (spec.speed ?? 60) * u * (1 + (rnd() - 0.5) * (spec.speedVar ?? 0.7));
    const vx = Math.cos(a) * sp;
    const vy = Math.sin(a) * sp;
    const delay = mode === "trail" && spec.path ? (i / count) * spec.path.span : 0;
    const life = spec.life * (0.7 + rnd() * 0.5);
    const size = Math.max(1.2, spec.size * u * (0.6 + rnd() * 0.8));
    rnd();
    const keyframes: Keyframe[] = samples.map((k) => {
      const s = (k * life) / 1000;
      let x: number;
      let y: number;
      if (mode === "converge") {
        const R = (spec.radius ?? 40) * u;
        const ox = (spec.x ?? 0) + Math.cos(a) * R;
        const oy = (spec.y ?? 0) + Math.sin(a) * R;
        const ease = 1 - Math.pow(1 - k, 2);
        x = ox + ((spec.x ?? 0) - ox) * ease;
        y = oy + ((spec.y ?? 0) - oy) * ease;
      } else {
        let ox = spec.x ?? 0;
        let oy = spec.y ?? 0;
        if (mode === "trail" && spec.path) {
          const u2 = delay / spec.path.span;
          const P = spec.path;
          ox = (1 - u2) * (1 - u2) * P.a.x + 2 * (1 - u2) * u2 * P.c.x + u2 * u2 * P.b.x;
          oy = (1 - u2) * (1 - u2) * P.a.y + 2 * (1 - u2) * u2 * P.c.y + u2 * u2 * P.b.y;
        }
        const drag = spec.drag == null ? 1 : Math.exp(-spec.drag * s);
        x = ox + vx * s * drag;
        y = oy + vy * s * drag + 0.5 * (spec.gravity ?? 0) * u * s * s;
      }
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      const opacity = Math.max(0, Math.min(1, fade)) * (spec.alpha ?? 1);
      const scale = spec.shrink ? Math.max(0.05, 1 - k) : 1;
      const rot = spec.shape === "dot" ? "" : ` rotate(${deg(a).toFixed(0)}deg)`;
      return { offset: k, opacity, transform: `translate(${f1(x)}px,${f1(y)}px)${rot} scale(${scale.toFixed(2)})` };
    });
    const dot = document.createElement("i");
    const dotShape = spec.shape === "dot";
    dot.style.cssText = `position:absolute;left:0;top:0;width:${dotShape ? size : size * 4}px;height:${size}px;margin:${-size / 2}px 0 0 ${dotShape ? -size / 2 : -size * 2}px;border-radius:${size}px;background:${spec.color};opacity:0;pointer-events:none;`;
    place(cx, dot, cx.html);
    add(cx, dot, keyframes, { at: spec.at + delay, dur: life, easing: "linear" });
  }
}

/* ---------- fragments (the destroyed card) ---------- */

type PieceMotion = (piece: HTMLElement, index: number, centre: Pt) => void;

/**
 * How a box sits on screen: its edge lengths and the angle of its top edge. A seat field of a multiplayer table is
 * rotated (and scaled) as a whole, so anything drawn outside the field to stand in for a card must repeat that turn.
 * Three zero-size probes on the corners of `box` (which must be positioned) give the screen edges; null if unreadable.
 */
export function screenPose(box: HTMLElement): { w: number; h: number; turn: number } | null {
  if (getComputedStyle(box).position === "static") return null;
  const probe = (left: string, top: string): HTMLElement => {
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.style.cssText = `position:absolute;width:0;height:0;pointer-events:none;visibility:hidden;left:${left};top:${top};`;
    box.appendChild(dot);
    return dot;
  };
  const dots = [probe("0", "0"), probe("100%", "0"), probe("0", "100%")];
  const [a, b, c] = dots.map((dot) => dot.getBoundingClientRect());
  for (const dot of dots) dot.remove();
  const w = Math.hypot(b.left - a.left, b.top - a.top);
  const h = Math.hypot(c.left - a.left, c.top - a.top);
  if (!(w > 0 && h > 0)) return null;
  const turn = Math.atan2(b.top - a.top, b.left - a.left) * 180 / Math.PI;
  // An upright field reads a rounding error, not a turn.
  return { w, h, turn: Math.abs(turn) < 0.05 ? 0 : Math.round(turn * 100) / 100 };
}

/** The turn of a card copy that was cut from a rotated seat field: the copy lives outside the field, so it carries the turn itself. */
export function cutTurnStyle(cut: Pick<FxCut, "turn">): string {
  return cut.turn ? `rotate:${f1(cut.turn)}deg;` : "";
}

function fragments(cx: Ctx, cut: FxCut, role: string, polys: Poly[], motion: PieceMotion): void {
  const wrap = document.createElement("div");
  wrap.className = cx.cls.frags;
  wrap.dataset.role = role;
  wrap.style.cssText = `position:absolute;left:${cut.box.left}px;top:${cut.box.top}px;width:${cut.box.width}px;height:${cut.box.height}px;`;
  place(cx, wrap, cx.html);
  polys.forEach((poly, i) => {
    const piece = document.createElement("div");
    piece.className = cx.cls.piece;
    piece.style.cssText = `position:absolute;inset:0;will-change:transform,opacity;clip-path:polygon(${poly.map((p) => `${f1(p[0])}% ${f1(p[1])}%`).join(",")});`;
    const inner = document.createElement("div");
    inner.className = cx.cls.inner;
    // `rotate` (not `transform`) so the copy keeps the turn of its seat field while the piece moves in screen directions.
    inner.style.cssText = `position:absolute;top:50%;left:50%;width:${cut.innerW}px;height:${cut.innerH}px;translate:-50% -50%;${cutTurnStyle(cut)}`;
    inner.innerHTML = cut.html;
    piece.appendChild(inner);
    wrap.appendChild(piece);
    motion(piece, i, polyCentre(poly));
  });
}

/* ---------- the styles ---------- */

type StyleImpl = {
  strike: (cx: Ctx, g: Geo, t0: number, k: number) => void;
  destroy: (cx: Ctx, g: Geo, cut: FxCut, role: string, at: number) => void;
};

const STYLES: Record<AttackStyleId, StyleImpl> = {
  slash: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      const ang = Math.atan2(g.dir.y, g.dir.x);
      // wind-up: a glint arc at the launch point
      const R = 16 * u;
      const arc = place(cx, svgEl("path", {
        d: `M${f1(g.s.x + Math.cos(ang - 1.9) * R)},${f1(g.s.y + Math.sin(ang - 1.9) * R)} A${R},${R} 0 0 1 ${f1(g.s.x + Math.cos(ang + 1.9) * R)},${f1(g.s.y + Math.sin(ang + 1.9) * R)}`,
        pathLength: 1, fill: "none", stroke: tint.hi, "stroke-width": 2, "stroke-linecap": "round",
      }));
      arc.style.filter = glow(tint.main, 4);
      arc.style.strokeDasharray = "1";
      add(cx, arc, [{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.6 }, { strokeDashoffset: 0, opacity: 0 }], { at: T(40), dur: 260 * k, easing: "cubic-bezier(.3,.8,.3,1)" });
      lunge(cx, g, T(120), k);
      // travel: a crescent blade
      const blade = place(cx, svgEl("g", {}));
      const body = svgEl("path", { d: "M0,-17 A21,21 0 0 1 0,17 A12,12 0 0 0 0,-17 Z", fill: tint.main });
      body.style.filter = glow(tint.deep, 5);
      blade.appendChild(body);
      blade.appendChild(svgEl("path", { d: "M1,-12 A15,15 0 0 1 1,12 A9,9 0 0 0 1,-12 Z", fill: tint.hi }));
      const a0 = deg(ang) - 50;
      const a1 = deg(ang) + 40;
      add(cx, blade, [
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${a0}deg) scale(${0.6 * u})` },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, transform: `translate(${g.e.x}px,${g.e.y}px) rotate(${a1}deg) scale(${1.15 * u})`, offset: 0.9 },
        { opacity: 0, transform: `translate(${g.e.x + g.dir.x * 10 * u}px,${g.e.y + g.dir.y * 10 * u}px) rotate(${a1 + 10}deg) scale(${1.2 * u})` },
      ], { at: T(280), dur: 220 * k, easing: "cubic-bezier(.55,0,.9,.55)" });
      // impact: the cut across the target
      const mirror = g.dir.x < 0;
      const ext = 0.18;
      const b = g.to;
      const p = mirror ? { x: b.left, y: b.top } : { x: b.left + b.width, y: b.top };
      const q = mirror ? { x: b.left + b.width, y: b.top + b.height } : { x: b.left, y: b.top + b.height };
      const vx = q.x - p.x;
      const vy = q.y - p.y;
      const P = { x: p.x - vx * ext, y: p.y - vy * ext };
      const Q = { x: q.x + vx * ext, y: q.y + vy * ext };
      drawIn(cx, [stroke(cx, seg(P, Q), tint.main, 9 * u, { blur: 4 }), stroke(cx, seg(P, Q), tint.hi, 2.4 * u, { glow: 3 })], T(470), 360 * k);
      flashDisc(cx, g.e, T(505), tint.hi, Math.min(b.width, b.height) * (g.direct ? 0.9 : 0.5));
      hitRing(cx, b, T(500), tint.main);
      emit(cx, { at: T(515), life: 320, count: 10, x: g.e.x, y: g.e.y, color: tint.hi, size: 2, angle: Math.atan2(vy, vx), spread: 0.9, speed: 260, gravity: 300, seed: g.seed + 3 });
      emit(cx, { at: T(515), life: 320, count: 10, x: g.e.x, y: g.e.y, color: tint.main, size: 2, angle: Math.atan2(vy, vx) + Math.PI, spread: 0.9, speed: 260, gravity: 300, seed: g.seed + 4 });
      shake(cx, g.toEl, T(520), 3 * u);
    },
    destroy(cx, g, cut, role, at) {
      const m = g.dir.x < 0;
      const w = cut.box.width;
      const h = cut.box.height;
      const len = Math.hypot(w, h) || 1;
      const n = m ? [h / len, -w / len] : [-h / len, -w / len];
      const sep = Math.max(3, Math.min(8, w * 0.08));
      fragments(cx, cut, role, halves(m), (piece, i) => {
        const s = i === 0 ? 1 : -1;
        const rot = (m ? 1 : -1) * 2.2 * s;
        add(cx, piece, [
          { transform: "translate(0,0) rotate(0)", opacity: 1 },
          { transform: `translate(${n[0] * sep * s}px,${n[1] * sep * s}px) rotate(${rot}deg)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${n[0] * sep * s * 1.6}px,${n[1] * sep * s * 1.6 + 8}px) rotate(${rot}deg)`, opacity: 0 },
        ], { at, dur: 760, easing: "cubic-bezier(.2,.8,.2,1)" });
      });
    },
  },

  claw: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      const ang = Math.atan2(g.dir.y, g.dir.x);
      const nx = -g.dir.y;
      const ny = g.dir.x;
      // wind-up: the pounce crouch
      if (g.fromEl?.isConnected) {
        add(cx, g.fromEl, [{ transform: "scale(1)" }, { transform: "scale(.94) translateY(2px)", offset: 0.5 }, { transform: "scale(1.08)", offset: 0.8 }, { transform: "scale(1)" }], { at: T(60), dur: 320 * k, easing: "cubic-bezier(.3,.7,.3,1)", composite: "add", fill: "none" });
      }
      emit(cx, { at: T(100), life: 260, count: 8, x: g.s.x, y: g.s.y, color: tint.main, size: 1.6, mode: "converge", radius: 26, shape: "dot", seed: g.seed + 1 });
      // travel: three streaks in flight
      for (let i = -1; i <= 1; i++) {
        const off = i * 8 * u;
        const st = place(cx, svgEl("path", { d: `M0,0 L${-26 * u},0`, fill: "none", stroke: tint.hi, "stroke-width": 2.2 * u, "stroke-linecap": "round" }));
        st.style.filter = glow(tint.main, 4);
        const sx = g.s.x + nx * off;
        const sy = g.s.y + ny * off;
        const ex = g.e.x + nx * off - g.dir.x * 12 * u;
        const ey = g.e.y + ny * off - g.dir.y * 12 * u;
        add(cx, st, [
          { opacity: 0, transform: `translate(${sx}px,${sy}px) rotate(${deg(ang)}deg) scaleX(.4)` },
          { opacity: 1, offset: 0.2 },
          { opacity: 1, transform: `translate(${ex}px,${ey}px) rotate(${deg(ang)}deg) scaleX(1.2)`, offset: 0.92 },
          { opacity: 0, transform: `translate(${ex + g.dir.x * 8}px,${ey + g.dir.y * 8}px) rotate(${deg(ang)}deg) scaleX(1)` },
        ], { at: T(300 + (i + 1) * 20), dur: 200 * k, easing: "cubic-bezier(.5,0,.9,.5)" });
      }
      // impact: three raking tears across the card
      const b = g.to;
      const mirror = g.dir.x < 0;
      const cxm = b.left + b.width / 2;
      const cym = b.top + b.height / 2;
      const dirx = mirror ? 1 : -1;
      const tearAng = Math.atan2(b.height, dirx * b.width * 0.55);
      const tlen = Math.hypot(b.width * 0.55, b.height) * 1.05;
      for (let i = -1; i <= 1; i++) {
        const ox = -Math.sin(tearAng) * i * (b.width * 0.24);
        const oy = Math.cos(tearAng) * i * (b.width * 0.24);
        const P = { x: cxm + ox - (Math.cos(tearAng) * tlen) / 2, y: cym + oy - (Math.sin(tearAng) * tlen) / 2 };
        const Q = { x: cxm + ox + (Math.cos(tearAng) * tlen) / 2, y: cym + oy + (Math.sin(tearAng) * tlen) / 2 };
        drawIn(cx, [stroke(cx, seg(P, Q), tint.deep, 7 * u, { blur: 3 }), stroke(cx, seg(P, Q), tint.hi, 2 * u, { glow: 3 })], T(470 + (i + 1) * 45), 380 * k, "cubic-bezier(.6,0,.3,1)", 0.35);
      }
      hitRing(cx, b, T(490), tint.main);
      flashDisc(cx, g.e, T(500), tint.main, Math.min(b.width, b.height) * 0.45, 280);
      emit(cx, { at: T(505), life: 360, count: 14, x: g.e.x, y: g.e.y, color: tint.main, size: 2, angle: ang, spread: 1.4, speed: 200, gravity: 380, seed: g.seed + 5 });
      shake(cx, g.toEl, T(500), 3.5 * u, 260);
    },
    destroy(cx, g, cut, role, at) {
      const m = g.dir.x < 0;
      const w = cut.box.width;
      fragments(cx, cut, role, bands(3, m), (piece, i) => {
        const s = i === 1 ? -1 : 1;
        const dx = (m ? -1 : 1) * s * (i === 1 ? w * 0.16 : w * 0.12);
        const dy = s * 10 + 6;
        add(cx, piece, [
          { transform: "translate(0,0) rotate(0)", opacity: 1 },
          { transform: `translate(${dx * 0.5}px,${dy * 0.4}px) rotate(${s * 2}deg)`, opacity: 1, offset: 0.3 },
          { transform: `translate(${dx}px,${dy + 14}px) rotate(${s * 4}deg)`, opacity: 0 },
        ], { at: at + i * 40, dur: 700, easing: "cubic-bezier(.2,.8,.2,1)" });
      });
    },
  },

  beam: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      // wind-up: charge orb, converging motes, rotating ring
      const orb = place(cx, svgEl("circle", { cx: g.s.x, cy: g.s.y, r: 7 * u, fill: tint.hi }));
      orb.style.filter = glow(tint.main, 8);
      orb.style.transformOrigin = `${g.s.x}px ${g.s.y}px`;
      add(cx, orb, [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)", offset: 0.75 }, { opacity: 1, transform: "scale(1.5)", offset: 0.9 }, { opacity: 0, transform: "scale(.4)" }], { at: T(20), dur: 380 * k, easing: "cubic-bezier(.3,.6,.3,1)" });
      const ring = place(cx, svgEl("circle", { cx: g.s.x, cy: g.s.y, r: 14 * u, fill: "none", stroke: tint.main, "stroke-width": 1.4, "stroke-dasharray": "6 5" }));
      ring.style.transformOrigin = `${g.s.x}px ${g.s.y}px`;
      add(cx, ring, [{ opacity: 0, transform: "rotate(0) scale(1.6)" }, { opacity: 1, offset: 0.3 }, { opacity: 1, transform: "rotate(160deg) scale(.7)", offset: 0.85 }, { opacity: 0, transform: "rotate(200deg) scale(.3)" }], { at: T(0), dur: 400 * k, easing: "cubic-bezier(.4,0,.6,1)" });
      emit(cx, { at: T(40), life: 300, count: 14, x: g.s.x, y: g.s.y, color: tint.main, size: 1.5, mode: "converge", radius: 34, shape: "dot", seed: g.seed + 2 });
      lunge(cx, g, T(220), k);
      // fire: a beam that draws in, holds with a flicker, then retracts
      const d = seg(g.s, g.e);
      const wide = stroke(cx, d, tint.deep, 16 * u, { blur: 5 });
      const body = stroke(cx, d, tint.main, 6 * u, { glow: 6 });
      const core = stroke(cx, d, tint.hi, 2.2 * u);
      for (const el of [wide, body, core]) {
        add(cx, el, [
          { strokeDashoffset: 1, opacity: 0 },
          { strokeDashoffset: 0, opacity: 1, offset: 0.22 },
          { opacity: 0.75, offset: 0.4 }, { opacity: 1, offset: 0.5 }, { opacity: 0.8, offset: 0.62 }, { opacity: 1, offset: 0.72 },
          { strokeDashoffset: -1, opacity: 1 },
        ], { at: T(380), dur: 380 * k });
      }
      // impact: hot spot at the hit, sparks while the beam holds
      const hot = place(cx, svgEl("circle", { cx: g.e.x, cy: g.e.y, r: 10 * u, fill: tint.hi }));
      hot.style.filter = glow(tint.hi, 10);
      hot.style.transformOrigin = `${g.e.x}px ${g.e.y}px`;
      add(cx, hot, [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1)", offset: 0.15 }, { opacity: 1, transform: "scale(1.3)", offset: 0.7 }, { opacity: 0, transform: "scale(2)" }], { at: T(440), dur: 340 * k, easing: "ease-out" });
      hitRing(cx, g.to, T(440), tint.main);
      flashDisc(cx, g.e, T(445), tint.hi, Math.min(g.to.width, g.to.height) * (g.direct ? 0.9 : 0.55), 300);
      const back = Math.atan2(-g.dir.y, -g.dir.x);
      emit(cx, { at: T(445), life: 300, count: 12, x: g.e.x, y: g.e.y, color: tint.hi, size: 1.6, angle: back, spread: 2.2, speed: 180, gravity: 120, seed: g.seed + 6 });
      emit(cx, { at: T(560), life: 260, count: 8, x: g.e.x, y: g.e.y, color: tint.main, size: 1.4, angle: back, spread: 2.4, speed: 140, gravity: 120, seed: g.seed + 7 });
      shake(cx, g.toEl, T(445), 2.5 * u, 300);
    },
    destroy(cx, g, cut, role, at) {
      const b = cut.box;
      fragments(cx, cut, role, tiles(4, 6), (piece, i, c) => {
        // tiles nearest the beam entry leave first
        const px = b.left + (c.x / 100) * b.width;
        const py = b.top + (c.y / 100) * b.height;
        const along = (px - g.e.x) * g.dir.x + (py - g.e.y) * g.dir.y;
        const delay = Math.max(0, (along + b.height * 0.6) / (b.height * 1.2)) * 220;
        const jx = (((i * 37) % 11) - 5) * 1.2;
        const jy = (((i * 53) % 13) - 6) * 1.2;
        add(cx, piece, [
          { transform: "translate(0,0)", opacity: 1, filter: "brightness(1)" },
          { transform: `translate(${jx}px,${jy}px)`, opacity: 1, filter: "brightness(2.2)", offset: 0.25 },
          { transform: `translate(${g.dir.x * 26 + jx * 2}px,${g.dir.y * 26 + jy * 2}px)`, opacity: 0, filter: "brightness(2.6)" },
        ], { at: at + delay, dur: 560, easing: "cubic-bezier(.3,.6,.4,1)" });
      });
    },
  },

  arcane: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      // wind-up: rune ring + growing orb at the launch point
      const grp = place(cx, svgEl("g", {}));
      const ring = svgEl("circle", { cx: 0, cy: 0, r: 15, fill: "none", stroke: tint.main, "stroke-width": 1.3, "stroke-dasharray": "3 4 9 4" });
      const ticks = svgEl("g", {});
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ticks.appendChild(svgEl("path", { d: `M${f1(Math.cos(a) * 18)},${f1(Math.sin(a) * 18)} L${f1(Math.cos(a) * 22)},${f1(Math.sin(a) * 22)}`, stroke: tint.hi, "stroke-width": 1.4, "stroke-linecap": "round" }));
      }
      const orbDeep = svgEl("circle", { cx: 0, cy: 0, r: 10, fill: tint.deep });
      orbDeep.style.filter = "blur(4px)";
      const orb = svgEl("circle", { cx: 0, cy: 0, r: 6.5, fill: tint.main });
      orb.style.filter = glow(tint.main, 7);
      for (const part of [orbDeep, orb, svgEl("circle", { cx: 0, cy: 0, r: 2.6, fill: tint.hi }), ring, ticks]) grp.appendChild(part);
      // the whole group appears at the launch point, grows, travels on a curve to the target, and pops
      const mid = { x: (g.s.x + g.e.x) / 2 - g.dir.y * g.len * 0.18, y: (g.s.y + g.e.y) / 2 + g.dir.x * g.len * 0.18 };
      add(cx, grp, [
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) scale(${0.2 * u})` },
        { opacity: 1, transform: `translate(${g.s.x}px,${g.s.y}px) scale(${u})`, offset: 0.55 },
        { opacity: 1, transform: `translate(${g.s.x + g.dir.x * 4}px,${g.s.y + g.dir.y * 4}px) scale(${1.1 * u})`, offset: 0.6 },
        { opacity: 1, transform: `translate(${mid.x}px,${mid.y}px) scale(${1.1 * u})`, offset: 0.8 },
        { opacity: 1, transform: `translate(${g.e.x}px,${g.e.y}px) scale(${1.2 * u})`, offset: 0.97 },
        { opacity: 0, transform: `translate(${g.e.x}px,${g.e.y}px) scale(${1.8 * u})` },
      ], { at: T(0), dur: 570 * k });
      add(cx, ring, [{ transform: "rotate(0)" }, { transform: "rotate(300deg)" }], { at: T(0), dur: 570 * k });
      add(cx, ticks, [{ transform: "rotate(0)" }, { transform: "rotate(-200deg)" }], { at: T(0), dur: 570 * k });
      emit(cx, { at: T(60), life: 280, count: 12, x: g.s.x, y: g.s.y, color: tint.main, size: 1.6, mode: "converge", radius: 30, shape: "dot", seed: g.seed + 8 });
      lunge(cx, g, T(240), k);
      emit(cx, { at: T(340), life: 260, count: 18, color: tint.main, size: 1.8, mode: "trail", path: { a: g.s, c: mid, b: g.e, span: 210 * k }, speed: 20, gravity: -30, shape: "dot", shrink: true, seed: g.seed + 9 });
      // impact: burst, a second rune ring expands at the target
      flashDisc(cx, g.e, T(550), tint.hi, Math.min(g.to.width, g.to.height) * (g.direct ? 0.9 : 0.6), 340);
      const burst = place(cx, svgEl("circle", { cx: g.e.x, cy: g.e.y, r: 18 * u, fill: "none", stroke: tint.main, "stroke-width": 2, "stroke-dasharray": "5 3 12 3" }));
      burst.style.transformOrigin = `${g.e.x}px ${g.e.y}px`;
      burst.style.filter = glow(tint.main, 5);
      add(cx, burst, [{ opacity: 0, transform: "rotate(0) scale(.4)" }, { opacity: 1, offset: 0.15 }, { opacity: 0, transform: "rotate(120deg) scale(2.4)" }], { at: T(555), dur: 420 * k, easing: "cubic-bezier(.2,.7,.3,1)" });
      hitRing(cx, g.to, T(555), tint.main);
      emit(cx, { at: T(560), life: 420, count: 18, x: g.e.x, y: g.e.y, color: tint.hi, size: 2, speed: 150, gravity: -60, drag: 2, shape: "dot", shrink: true, seed: g.seed + 10 });
      shake(cx, g.toEl, T(560), 2.5 * u, 240);
    },
    destroy(cx, g, cut, role, at) {
      fragments(cx, cut, role, tiles(4, 6), (piece, i, c) => {
        const delay = ((100 - c.y) / 100) * 180 + ((i * 29) % 7) * 12; // bottom first, drifting up
        const dx = (((i * 41) % 9) - 4) * 2.5;
        add(cx, piece, [
          { transform: "translate(0,0)", opacity: 1, filter: "brightness(1) blur(0)" },
          { transform: `translate(${dx * 0.3}px,-6px)`, opacity: 1, filter: "brightness(1.6) blur(0)", offset: 0.3 },
          { transform: `translate(${dx}px,-34px)`, opacity: 0, filter: "brightness(2.4) blur(2px)" },
        ], { at: at + delay, dur: 700, easing: "cubic-bezier(.2,.7,.3,1)" });
      });
      veil(cx, cut.box, g.tint.deep, at, 840, 0.55);
    },
  },

  lightning: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      const rnd = mulberry32(g.seed + 11);
      // wind-up: crackles around the attacker's edge, a tinted charge on the card
      const b0 = g.from;
      for (let i = 0; i < 5; i++) {
        const a = rnd() * Math.PI * 2;
        const p = { x: b0.left + b0.width / 2 + Math.cos(a) * b0.width * 0.55, y: b0.top + b0.height / 2 + Math.sin(a) * b0.height * 0.55 };
        const q = { x: p.x + (rnd() - 0.5) * 30 * u, y: p.y + (rnd() - 0.5) * 30 * u };
        const el = place(cx, svgEl("path", { d: boltPath(p, q, 4, 5 * u, rnd).d, fill: "none", stroke: tint.hi, "stroke-width": 1.4, "stroke-linecap": "round", "stroke-linejoin": "round" }));
        el.style.filter = glow(tint.main, 3);
        add(cx, el, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 0.2, offset: 0.4 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { at: T(60 + i * 55), dur: 160 * k, easing: "steps(4, end)" });
      }
      veil(cx, b0, tint.main, T(40), 420 * k, 0.35);
      lunge(cx, g, T(240), k);
      // the bolt: main + branches, two seeds flashing in turn
      const mkBolt = (seed: number, at: number, dur: number, amp: number) => {
        const r = mulberry32(seed);
        const main = boltPath(g.s, g.e, 9, amp * u, r);
        const grp = place(cx, svgEl("g", {}));
        const gl = svgEl("path", { d: main.d, fill: "none", stroke: tint.main, "stroke-width": 7 * u, "stroke-linejoin": "round" });
        gl.style.filter = "blur(3px)";
        const ln = svgEl("path", { d: main.d, fill: "none", stroke: tint.hi, "stroke-width": 2.2 * u, "stroke-linecap": "round", "stroke-linejoin": "round" });
        ln.style.filter = glow(tint.hi, 3);
        grp.appendChild(gl);
        grp.appendChild(ln);
        for (let i = 0; i < 3; i++) {
          const from = main.pts[2 + Math.floor(r() * Math.max(1, main.pts.length - 4))];
          const a = Math.atan2(g.dir.y, g.dir.x) + (r() - 0.5) * 2.2;
          const L = (14 + r() * 26) * u;
          const to = { x: from.x + Math.cos(a) * L, y: from.y + Math.sin(a) * L };
          grp.appendChild(svgEl("path", { d: boltPath(from, to, 4, 5 * u, r).d, fill: "none", stroke: tint.hi, "stroke-width": 1.2, "stroke-linecap": "round", "stroke-linejoin": "round", opacity: 0.85 }));
        }
        add(cx, grp, [{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 1, offset: 0.4 }, { opacity: 0.25, offset: 0.55 }, { opacity: 0.9, offset: 0.7 }, { opacity: 0 }], { at, dur });
      };
      mkBolt(g.seed + 21, T(380), 220 * k, 16);
      mkBolt(g.seed + 22, T(430), 200 * k, 12);
      // impact: whiteout on the target, ring, residual arcs, sparks
      const b = g.to;
      const white = veil(cx, b, tint.hi, T(440), 300 * k, 0.95);
      add(cx, white, [{ opacity: 0 }, { opacity: 0.95, offset: 0.1 }, { opacity: 0.5, offset: 0.35 }, { opacity: 0.85, offset: 0.5 }, { opacity: 0 }], { at: T(440), dur: 300 * k });
      flashDisc(cx, g.e, T(445), tint.hi, Math.min(b.width, b.height) * (g.direct ? 0.9 : 0.7), 320);
      hitRing(cx, b, T(445), tint.main);
      for (let i = 0; i < 3; i++) {
        const p = { x: b.left + rnd() * b.width, y: b.top + rnd() * b.height };
        const q = { x: p.x + (rnd() - 0.5) * 34 * u, y: p.y + (rnd() - 0.5) * 34 * u };
        const el = place(cx, svgEl("path", { d: boltPath(p, q, 4, 5 * u, rnd).d, fill: "none", stroke: tint.hi, "stroke-width": 1.3, "stroke-linecap": "round", "stroke-linejoin": "round" }));
        add(cx, el, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0, offset: 0.5 }, { opacity: 0.8, offset: 0.7 }, { opacity: 0 }], { at: T(520 + i * 60), dur: 200 * k, easing: "steps(3, end)" });
      }
      emit(cx, { at: T(450), life: 340, count: 16, x: g.e.x, y: g.e.y, color: tint.hi, size: 1.6, speed: 230, gravity: 200, seed: g.seed + 12 });
      shake(cx, g.toEl, T(450), 3 * u);
    },
    destroy(cx, g, cut, role, at) {
      const rnd = mulberry32(g.seed + 13);
      fragments(cx, cut, role, shards(7, 44 + rnd() * 12, 40 + rnd() * 20, rnd), (piece, _i, c) => {
        const ax = c.x - 50;
        const ay = c.y - 50;
        const L = Math.hypot(ax, ay) || 1;
        const dist = 18 + rnd() * 22;
        const rot = (rnd() - 0.5) * 50;
        add(cx, piece, [
          { transform: "translate(0,0) rotate(0)", opacity: 1, filter: "brightness(2.5)" },
          { transform: `translate(${(ax / L) * dist * 0.6}px,${(ay / L) * dist * 0.6}px) rotate(${rot * 0.6}deg)`, opacity: 1, filter: "brightness(1.2)", offset: 0.35 },
          { transform: `translate(${(ax / L) * dist}px,${(ay / L) * dist + 16}px) rotate(${rot}deg)`, opacity: 0, filter: "brightness(1)" },
        ], { at: at + 30, dur: 700, easing: "cubic-bezier(.2,.8,.3,1)" });
      });
      emit(cx, { at: at + 40, life: 380, count: 12, x: g.e.x, y: g.e.y, color: g.tint.main, size: 1.4, speed: 120, gravity: 260, shape: "dot", seed: g.seed + 14 });
    },
  },

  flame: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      const ang = Math.atan2(g.dir.y, g.dir.x);
      // wind-up: embers gather, a flame lick flickers at the launch point
      emit(cx, { at: T(40), life: 320, count: 14, x: g.s.x, y: g.s.y, color: tint.main, size: 1.8, mode: "converge", radius: 32, shape: "dot", seed: g.seed + 15 });
      const lick = place(cx, svgEl("path", { d: "M0,0 C-6,-6 -4,-16 0,-22 C4,-16 6,-6 0,0 Z", fill: tint.main }));
      lick.style.filter = glow(tint.main, 6);
      const la = deg(ang) + 90;
      add(cx, lick, [
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${la}deg) scale(${0.4 * u})` },
        { opacity: 1, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${la - 8}deg) scale(${u})`, offset: 0.4 },
        { opacity: 1, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${la + 8}deg) scale(${1.2 * u})`, offset: 0.7 },
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${la}deg) scale(${0.6 * u})` },
      ], { at: T(120), dur: 260 * k, easing: "ease-in-out" });
      lunge(cx, g, T(220), k);
      // travel: layered fireball on a shallow arc, ember trail
      const mid = { x: (g.s.x + g.e.x) / 2 - g.dir.y * g.len * 0.1, y: (g.s.y + g.e.y) / 2 + g.dir.x * g.len * 0.1 };
      const ball = place(cx, svgEl("g", {}));
      const outer = svgEl("circle", { cx: 0, cy: 0, r: 13, fill: tint.deep });
      outer.style.filter = "blur(5px)";
      const body = svgEl("circle", { cx: 0, cy: 0, r: 8, fill: tint.main });
      body.style.filter = glow(tint.main, 8);
      const tail = svgEl("path", { d: "M0,-7 Q-18,0 -30,0 Q-18,0 0,7 Z", fill: tint.main, opacity: 0.8 });
      tail.style.filter = "blur(1.5px)";
      for (const part of [tail, outer, body, svgEl("circle", { cx: 0, cy: 0, r: 3.5, fill: tint.hi })]) ball.appendChild(part);
      add(cx, ball, [
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(${deg(ang)}deg) scale(${0.5 * u})` },
        { opacity: 1, offset: 0.12 },
        { opacity: 1, transform: `translate(${mid.x}px,${mid.y}px) rotate(${deg(ang)}deg) scale(${1.05 * u})`, offset: 0.55 },
        { opacity: 1, transform: `translate(${g.e.x}px,${g.e.y}px) rotate(${deg(ang)}deg) scale(${1.2 * u})`, offset: 0.96 },
        { opacity: 0, transform: `translate(${g.e.x}px,${g.e.y}px) rotate(${deg(ang)}deg) scale(${1.8 * u})` },
      ], { at: T(330), dur: 220 * k, easing: "cubic-bezier(.4,0,.8,.6)" });
      emit(cx, { at: T(340), life: 300, count: 16, color: tint.main, size: 1.8, mode: "trail", path: { a: g.s, c: mid, b: g.e, span: 190 * k }, speed: 30, gravity: -80, shape: "dot", shrink: true, seed: g.seed + 16 });
      // impact: bloom + ember burst
      const bloom = place(cx, svgEl("circle", { cx: g.e.x, cy: g.e.y, r: 12 * u, fill: tint.main }));
      bloom.style.filter = "blur(5px)";
      bloom.style.transformOrigin = `${g.e.x}px ${g.e.y}px`;
      add(cx, bloom, [{ opacity: 0, transform: "scale(.4)" }, { opacity: 0.95, transform: "scale(1.6)", offset: 0.25 }, { opacity: 0, transform: "scale(3.2)" }], { at: T(535), dur: 420 * k, easing: "cubic-bezier(.2,.7,.3,1)" });
      flashDisc(cx, g.e, T(540), tint.hi, Math.min(g.to.width, g.to.height) * (g.direct ? 0.9 : 0.55), 300);
      hitRing(cx, g.to, T(540), tint.main);
      emit(cx, { at: T(545), life: 520, count: 20, x: g.e.x, y: g.e.y, color: tint.main, size: 2.2, speed: 170, gravity: -90, drag: 1.6, shape: "dot", shrink: true, seed: g.seed + 17 });
      emit(cx, { at: T(545), life: 300, count: 8, x: g.e.x, y: g.e.y, color: tint.hi, size: 1.6, speed: 240, gravity: 100, seed: g.seed + 18 });
      shake(cx, g.toEl, T(540), 3 * u, 260);
    },
    destroy(cx, g, cut, role, at) {
      const b = cut.box;
      fragments(cx, cut, role, tiles(4, 6), (piece, i, c) => {
        const px = b.left + (c.x / 100) * b.width;
        const py = b.top + (c.y / 100) * b.height;
        const dist = Math.hypot(px - g.e.x, py - g.e.y);
        const delay = (dist / (Math.hypot(b.width, b.height) || 1)) * 260;
        const dx = (((i * 31) % 9) - 4) * 2;
        add(cx, piece, [
          { transform: "translate(0,0) rotate(0)", opacity: 1, filter: "brightness(1) sepia(0)" },
          { transform: "translate(0,0) rotate(0)", opacity: 1, filter: "brightness(.25) sepia(1) saturate(4) hue-rotate(-20deg)", offset: 0.3 },
          { transform: `translate(${dx}px,${28 + (i % 4) * 8}px) rotate(${dx * 2}deg)`, opacity: 0, filter: "brightness(.1) sepia(1)" },
        ], { at: at + delay, dur: 760, easing: "cubic-bezier(.4,0,.6,1)" });
      });
      emit(cx, { at: at + 80, life: 520, count: 12, x: g.e.x, y: g.e.y, color: g.tint.main, size: 1.6, speed: 60, gravity: -70, shape: "dot", shrink: true, seed: g.seed + 19 });
    },
  },

  impact: {
    strike(cx, g, t0, k) {
      const T = (t: number) => t0 + t * k;
      const { tint, u } = g;
      const rnd = mulberry32(g.seed + 23);
      const ang = Math.atan2(g.dir.y, g.dir.x);
      // wind-up: the card rears back, a ground ring pulses under it
      if (g.fromEl?.isConnected) {
        add(cx, g.fromEl, [
          { transform: "translate(0,0) scale(1)" },
          { transform: `translate(${-g.dir.x * 8 * u}px,${-g.dir.y * 8 * u}px) scale(1.08)`, offset: 0.7 },
          { transform: `translate(${g.dir.x * 10 * u}px,${g.dir.y * 10 * u}px) scale(1.02)`, offset: 0.9 },
          { transform: "translate(0,0) scale(1)" },
        ], { at: T(20), dur: 440 * k, easing: "cubic-bezier(.4,0,.5,1)", composite: "add", fill: "none" });
      }
      const c0 = centre(g.from);
      const gy = c0.y + g.from.height * 0.5;
      const ground = place(cx, svgEl("ellipse", { cx: c0.x, cy: gy, rx: g.from.width * 0.5, ry: 6 * u, fill: "none", stroke: tint.main, "stroke-width": 1.5 }));
      ground.style.transformOrigin = `${c0.x}px ${gy}px`;
      add(cx, ground, [{ opacity: 0, transform: "scale(.6)" }, { opacity: 0.9, transform: "scale(1)", offset: 0.5 }, { opacity: 0, transform: "scale(1.5)" }], { at: T(80), dur: 320 * k, easing: "ease-out" });
      // travel: a dense mass with a comet tail, fast, ease-in
      const mass = place(cx, svgEl("g", {}));
      const halo = svgEl("circle", { cx: 0, cy: 0, r: 12, fill: tint.deep });
      halo.style.filter = "blur(5px)";
      const rock = svgEl("path", { d: "M-8,-7 L3,-9 L9,-2 L7,7 L-3,9 L-9,3 Z", fill: tint.main, stroke: tint.hi, "stroke-width": 1 });
      rock.style.filter = glow(tint.main, 4);
      mass.appendChild(halo);
      mass.appendChild(rock);
      add(cx, mass, [
        { opacity: 0, transform: `translate(${g.s.x}px,${g.s.y}px) rotate(0) scale(${0.6 * u})` },
        { opacity: 1, offset: 0.15 },
        { opacity: 1, transform: `translate(${g.e.x}px,${g.e.y}px) rotate(200deg) scale(${1.2 * u})`, offset: 0.95 },
        { opacity: 0, transform: `translate(${g.e.x}px,${g.e.y}px) rotate(220deg) scale(${0.4 * u})` },
      ], { at: T(300), dur: 170 * k, easing: "cubic-bezier(.6,0,.9,.5)" });
      emit(cx, { at: T(300), life: 240, count: 10, color: tint.main, size: 1.6, mode: "trail", path: { a: g.s, c: { x: (g.s.x + g.e.x) / 2, y: (g.s.y + g.e.y) / 2 }, b: g.e, span: 150 * k }, speed: 25, shape: "dot", shrink: true, seed: g.seed + 24 });
      // impact: the card is pressed, a shock ring, cracks radiate, dust
      const b = g.to;
      if (g.toEl?.isConnected) {
        add(cx, g.toEl, [{ transform: "scale(1)" }, { transform: "scale(.93)", offset: 0.25 }, { transform: "scale(1.02)", offset: 0.7 }, { transform: "scale(1)" }], { at: T(465), dur: 300 * k, easing: "cubic-bezier(.3,.7,.3,1)", composite: "add", fill: "none" });
      }
      const ring = place(cx, svgEl("circle", { cx: g.e.x, cy: g.e.y, r: 16 * u, fill: "none", stroke: tint.hi, "stroke-width": 5 }));
      ring.style.transformOrigin = `${g.e.x}px ${g.e.y}px`;
      ring.style.filter = glow(tint.main, 6);
      add(cx, ring, [{ opacity: 0, transform: "scale(.3)", strokeWidth: 6 }, { opacity: 1, offset: 0.1 }, { opacity: 0, transform: "scale(3.4)", strokeWidth: 1 }], { at: T(465), dur: 380 * k, easing: "cubic-bezier(.2,.7,.3,1)" });
      const cracks: SVGElement[] = [];
      for (let i = 0; i < 5; i++) {
        const a = ang + Math.PI + (i - 2) * 0.8 + (rnd() - 0.5) * 0.4;
        const L = (20 + rnd() * 22) * u;
        const q = { x: g.e.x + Math.cos(a) * L, y: g.e.y + Math.sin(a) * L };
        cracks.push(stroke(cx, boltPath(g.e, q, 4, 4 * u, rnd).d, tint.hi, 1.4));
      }
      for (const el of cracks) {
        add(cx, el, [{ strokeDashoffset: 1, opacity: 1 }, { strokeDashoffset: 0, opacity: 1, offset: 0.3 }, { strokeDashoffset: 0, opacity: 1, offset: 0.7 }, { strokeDashoffset: 0, opacity: 0 }], { at: T(470), dur: 480 * k, easing: "cubic-bezier(.2,.7,.3,1)" });
      }
      flashDisc(cx, g.e, T(470), tint.hi, Math.min(b.width, b.height) * (g.direct ? 0.9 : 0.5), 260);
      hitRing(cx, b, T(470), tint.main);
      emit(cx, { at: T(475), life: 520, count: 18, x: g.e.x, y: g.e.y, color: tint.main, size: 2.4, angle: -Math.PI / 2, spread: 2.6, speed: 150, gravity: 420, drag: 1.2, shape: "dot", alpha: 0.85, seed: g.seed + 25 });
      shake(cx, g.toEl, T(470), 4.5 * u, 300);
    },
    destroy(cx, g, cut, role, at) {
      const rnd = mulberry32(g.seed + 26);
      fragments(cx, cut, role, shards(5, 40 + rnd() * 20, 35 + rnd() * 20, rnd), (piece, i, c) => {
        const ax = c.x - 50;
        const rot = (rnd() - 0.5) * 30;
        const fall = 40 + rnd() * 30;
        add(cx, piece, [
          { transform: "translate(0,0) rotate(0)", opacity: 1 },
          { transform: `translate(${ax * 0.06}px,${-3 - rnd() * 4}px) rotate(${rot * 0.3}deg)`, opacity: 1, offset: 0.18 },
          { transform: `translate(${ax * 0.16}px,${fall}px) rotate(${rot}deg)`, opacity: 0 },
        ], { at: at + 40 + i * 30, dur: 760, easing: "cubic-bezier(.5,0,.8,.6)" });
      });
    },
  },
};

/* ---------- outcome beats ---------- */

/** The defender holds: a hard flash and a contracting dashed ring. */
function clash(cx: Ctx, box: Box, at: number, tint: Tint): void {
  flashDisc(cx, centre(box), at, "#ffffff", Math.min(box.width, box.height) * 0.6, 280);
  const p = 14 * cx.u;
  const ring = place(cx, svgEl("rect", { x: box.left - p, y: box.top - p, width: box.width + p * 2, height: box.height + p * 2, rx: 10, fill: "none", stroke: tint.hi, "stroke-width": 2, "stroke-dasharray": "6 4" }));
  const c = centre(box);
  ring.style.transformOrigin = `${c.x}px ${c.y}px`;
  ring.style.filter = glow(tint.main, 5);
  add(cx, ring, [{ opacity: 0, transform: "scale(1.25)" }, { opacity: 1, transform: "scale(1)", offset: 0.35 }, { opacity: 1, offset: 0.7 }, { opacity: 0, transform: "scale(.96)" }], { at, dur: 520, easing: "cubic-bezier(.2,.8,.3,1)" });
}

/** A monster in Defense Position takes the blow: three steel-white ripples. */
function shield(cx: Ctx, g: Geo, box: Box, at: number): void {
  const c = centre(box);
  for (let i = 0; i < 3; i++) {
    const r = place(cx, svgEl("rect", { x: box.left - 4, y: box.top - 4, width: box.width + 8, height: box.height + 8, rx: 9, fill: "none", stroke: i === 0 ? "#ffffff" : "#bfd6ff", "stroke-width": 2 - i * 0.4 }));
    r.style.transformOrigin = `${c.x}px ${c.y}px`;
    r.style.filter = glow("#9fc4ff", 5);
    add(cx, r, [{ opacity: 0, transform: "scale(.96)" }, { opacity: 0.95, offset: 0.12 }, { opacity: 0, transform: `scale(${1.25 + i * 0.18})` }], { at: at + i * 90, dur: 600, easing: "cubic-bezier(.2,.7,.3,1)" });
  }
  veil(cx, box, "#dbe9ff", at, 540, 0.55);
  if (g.toEl?.isConnected) {
    add(cx, g.toEl, [{ transform: "translate(0,0)" }, { transform: `translate(${g.dir.x * 5}px,${g.dir.y * 5}px)`, offset: 0.3 }, { transform: "translate(0,0)" }], { at, dur: 460, easing: "cubic-bezier(.2,.8,.3,1)", composite: "add", fill: "none" });
  }
}

/** Reflected damage: a red pulse runs from the defender to the attacker's LP tally. */
function reflectPulse(cx: Ctx, from: Box, lp: Box, at: number): void {
  const a = centre(from);
  const b = centre(lp);
  const bow = { x: (a.x + b.x) / 2 + (b.y - a.y) * 0.15, y: (a.y + b.y) / 2 - (b.x - a.x) * 0.15 };
  const trail = place(cx, svgEl("path", { d: `M${f1(a.x)},${f1(a.y)} Q${f1(bow.x)},${f1(bow.y)} ${f1(b.x)},${f1(b.y)}`, pathLength: 1, fill: "none", stroke: "#ff9489", "stroke-width": 2.2, "stroke-linecap": "round" }));
  trail.style.filter = glow("#e45a4d", 5);
  trail.style.strokeDasharray = "0.18 1";
  add(cx, trail, [{ strokeDashoffset: 0.18, opacity: 0 }, { opacity: 1, offset: 0.1 }, { strokeDashoffset: -1, opacity: 1, offset: 0.9 }, { strokeDashoffset: -1.05, opacity: 0 }], { at, dur: 420, easing: "cubic-bezier(.5,0,.8,.5)" });
}

/** A direct attack lands heavier than a blow on a card: a second, wider ring and a long white-hot flash on the LP plate. */
function directImpact(cx: Ctx, box: Box, at: number, tint: Tint): void {
  flashDisc(cx, centre(box), at, "#ffffff", Math.max(box.width, box.height) * 0.7, 480);
  hitRing(cx, box, at + 60, tint.hi, 14);
}

/** A red wash and ring on an LP tally when its counter starts to roll. */
function lpFlash(cx: Ctx, box: Box, at: number): void {
  const fl = document.createElement("div");
  fl.className = cx.cls.lpFlash;
  fl.style.cssText = `position:absolute;left:${box.left - 8}px;top:${box.top - 4}px;width:${box.width + 16}px;height:${box.height + 8}px;border-radius:8px;background:rgb(228 90 77 / .3);box-shadow:0 0 22px rgb(228 90 77 / .55);opacity:0;`;
  place(cx, fl, cx.html);
  add(cx, fl, [{ opacity: 0 }, { opacity: 1, offset: 0.18 }, { opacity: 0 }], { at, dur: 760, easing: "ease-out" });
  hitRing(cx, box, at, "#e45a4d", 6);
}

function geoFor(from: FxSide, to: Box, toEl: Element | null, tint: Tint, seed: number, direct: boolean, u: number): Geo {
  const c0 = centre(from.box);
  const c1 = centre(to);
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    from: from.box, to, fromEl: from.el, toEl,
    dir: { x: dx / len, y: dy / len }, len,
    s: edgePoint(from.box, c1, 3), e: c1, tint, seed, direct, u,
  };
}

/* ---------- reduced motion: flash and fade only ---------- */

function runReduced(cx: Ctx, plan: AttackFxPlan): void {
  const { attacker, defender } = plan;
  const mark = (box: Box, at: number, color: string) => {
    veil(cx, box, color, at, 700, 0.6);
    const r = place(cx, svgEl("rect", { x: box.left - 5, y: box.top - 5, width: box.width + 10, height: box.height + 10, rx: 8, fill: "none", stroke: color, "stroke-width": 1.5 }));
    add(cx, r, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], { at, dur: 840 });
  };
  const fade = (cut: FxCut | null, role: string, at: number) => {
    if (!cut) return;
    // The card stands whole until the break and is gone in the next frame: the flight to the pile starts at
    // `at`, so a slow fade here would show the card twice (on the field and in the air).
    fragments(cx, cut, role, [[[0, 0], [100, 0], [100, 100], [0, 100]]], (piece) => {
      add(cx, piece, [{ opacity: 1 }, { opacity: 0 }], { at, dur: 1 });
    });
  };
  if (attacker.caption) caption(cx, geoFor(attacker, plan.hit, null, attacker.tint, plan.seed, !defender, cx.u), attacker.caption, attacker.tint, 0);
  mark(attacker.box, 0, attacker.tint.main);
  mark(plan.hit, 200, (plan.kind === "held" || plan.kind === "bounce") && plan.defenderInDefense ? "#dbe9ff" : attacker.tint.main);
  // The counter flash on the attacker comes before any break: hit, counter, then the loser fades.
  if (hasCounterStrike(plan.kind) && defender) mark(attacker.box, plan.timing.attackerDamageMs, defender.tint.main);
  if (plan.kind === "win" || plan.kind === "tie") fade(defender?.cut ?? null, "target", plan.timing.targetBreakMs ?? 300);
  if (plan.kind === "lose" || plan.kind === "tie") fade(attacker.cut, "attacker", plan.timing.attackerBreakMs ?? 520);
  for (const hit of plan.lpHits) lpFlash(cx, hit.box, hit.at);
}

/* ---------- entry point ---------- */

/**
 * Builds and starts every effect of one attack into `html` (DOM effects) and `svg` (vector effects).
 * Returns a cleanup that cancels the animations and removes every node it added.
 */
export function runAttackFx(html: HTMLElement, svg: SVGSVGElement, plan: AttackFxPlan, cls: FxClasses): () => void {
  const u = Math.max(0.55, Math.min(2, plan.attacker.box.width / 78));
  const elapsedMs = battleSeekMs(plan.startedAt);
  const cx: Ctx = { html, svg, cls, animations: [], nodes: [], particles: { budget: MAX_PARTICLES }, u, elapsedMs };
  if (plan.reduced) {
    runReduced(cx, plan);
  } else {
    playFull(cx, plan);
  }
  return () => {
    for (const a of cx.animations) {
      try {
        a.cancel();
      } catch {
        /* already gone */
      }
    }
    for (const n of cx.nodes) n.remove();
  };
}

/** When the attacker leans in, per style (the same beats the DOM strikes use). */
const LUNGE_AT: Record<AttackStyleId, number> = { slash: 120, claw: 220, beam: 240, arcane: 240, lightning: 220, flame: 220, impact: 220 };

/**
 * The 3D layer draws the strikes and the breaks. What stays in the DOM: the lean of the attacker
 * card, the jolt of the card that is hit (at the exact impact time), the clash or shield of a held
 * fight, the counter's jolt and ring on the attacker, and the LP flashes.
 */
function playBeats3d(cx: Ctx, plan: AttackFxPlan, gA: Geo, geo: typeof geoFor): void {
  const { attacker, defender } = plan;
  const u = cx.u;
  const impact = plan.timing.impactMs;
  lunge(cx, gA, LUNGE_AT[attacker.style] * ATTACK_PACE, ATTACK_PACE);
  if (!defender) directImpact(cx, plan.hit, impact, attacker.tint);
  if (defender) shake(cx, defender.el, impact, 3.5 * u, 240);
  switch (plan.kind) {
    case "held":
      if (defender) {
        if (plan.defenderInDefense) shield(cx, gA, defender.box, impact);
        else clash(cx, defender.box, impact, attacker.tint);
      }
      break;
    case "tie":
    case "lose":
    case "bounce":
      if (defender) {
        // The first strike lands, a short pause, then the defender strikes back in its own style.
        if (plan.kind === "bounce" && plan.defenderInDefense) shield(cx, gA, defender.box, impact);
        else clash(cx, defender.box, impact, attacker.tint);
        const gD = geo(defender, attacker.box, attacker.el, defender.tint, plan.seed + 100, false, u);
        const t0 = impact + COUNTER_GAP_MS;
        if (defender.caption) caption(cx, gD, defender.caption, defender.tint, t0);
        lunge(cx, gD, t0 + LUNGE_AT[defender.style] * COUNTER_SCALE * ATTACK_PACE, COUNTER_SCALE * ATTACK_PACE);
        const counterAt = plan.timing.attackerDamageMs;
        shake(cx, attacker.el, counterAt, 3.5 * u, 240);
        if (plan.kind !== "lose") hitRing(cx, attacker.box, counterAt, defender.tint.main);
      }
      break;
    default:
      break;
  }
  for (const lp of plan.lpHits) {
    lpFlash(cx, lp.box, lp.at);
    if (lp.toAttacker && defender && !hasCounterStrike(plan.kind)) reflectPulse(cx, defender.box, lp.box, Math.max(0, lp.at - 140));
  }
}

function playFull(cx: Ctx, plan: AttackFxPlan): void {
  const { attacker, defender, hit } = plan;
  const u = cx.u;
  const impact = plan.timing.impactMs;
  const gA = geoFor(attacker, hit, defender?.el ?? null, attacker.tint, plan.seed, !defender, u);
  const styleA = STYLES[attacker.style];
  if (attacker.caption) caption(cx, gA, attacker.caption, attacker.tint, 0);
  if (plan.layer3d) {
    playBeats3d(cx, plan, gA, geoFor);
    return;
  }
  styleA.strike(cx, gA, 0, ATTACK_PACE);
  if (!defender) directImpact(cx, plan.hit, impact, attacker.tint);

  switch (plan.kind) {
    case "win":
      if (defender?.cut) styleA.destroy(cx, gA, defender.cut, "target", plan.timing.targetBreakMs ?? impact + DESTROY_BEAT_MS);
      break;
    case "held":
      if (defender) {
        if (plan.defenderInDefense) shield(cx, gA, defender.box, impact);
        else clash(cx, defender.box, impact, attacker.tint);
      }
      break;
    case "tie":
    case "lose":
    case "bounce":
      if (defender) {
        // 1 the first strike lands, 2 a short pause, 3 the defender strikes back in its own style,
        // 4 that strike lands on the attacker, 5 only then the loser is sliced (never before the counter).
        if (plan.kind === "bounce" && plan.defenderInDefense) shield(cx, gA, defender.box, impact);
        else clash(cx, defender.box, impact, attacker.tint);
        const gD = geoFor(defender, attacker.box, attacker.el, defender.tint, plan.seed + 100, false, u);
        const styleD = STYLES[defender.style];
        const t0 = impact + COUNTER_GAP_MS;
        if (defender.caption) caption(cx, gD, defender.caption, defender.tint, t0);
        styleD.strike(cx, gD, t0, COUNTER_SCALE * ATTACK_PACE);
        const counterAt = plan.timing.attackerDamageMs;
        if (plan.kind === "bounce") hitRing(cx, attacker.box, counterAt, defender.tint.main);
        // a tie slices the target in the attacker's style, together with the attacker
        if (plan.kind === "tie" && defender.cut) styleA.destroy(cx, gA, defender.cut, "target", plan.timing.targetBreakMs ?? counterAt + DESTROY_BEAT_MS);
        if (plan.kind !== "bounce" && attacker.cut) styleD.destroy(cx, gD, attacker.cut, "attacker", plan.timing.attackerBreakMs ?? counterAt + DESTROY_BEAT_MS);
      }
      break;
    default:
      break;
  }

  for (const lp of plan.lpHits) {
    lpFlash(cx, lp.box, lp.at);
    if (lp.toAttacker && defender && !hasCounterStrike(plan.kind)) reflectPulse(cx, defender.box, lp.box, Math.max(0, lp.at - 140));
  }
}
