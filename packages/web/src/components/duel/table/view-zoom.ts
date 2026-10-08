/**
 * The board view of a flat table camera (home, overview, focus, look and the 4-way grid): a zoom and a pan of the
 * board, on top of the camera pose. The fly-in view keeps its own orbit and zoom (use-fly-gestures.ts); this view is
 * the identity there. Only the board layer moves: the HUD (life plates, controls, phase hub, prompts) stays fixed.
 *
 * A view is a scale `s` and a translation `x, y` in board-box px: a point `p` of the board at the camera pose shows at
 * `x + s * p`. The pure part (clamps, zoom about a point, the pinch, the click and drag split) has no DOM.
 */

export interface View {
  s: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const VIEW_IDENTITY: View = Object.freeze({ s: 1, x: 0, y: 0 });

/** The zoom limits: the camera pose (the fit of the board box) is the least, about 2.5 times that is the most. */
export const VIEW_ZOOM = { min: 1, max: 2.5 } as const;

/** A press that moves less than this (px) is a click; more is a drag (a pan). */
export const DRAG_THRESHOLD_PX = 6;

/** A scale this near 1 counts as not zoomed. */
const ZOOM_EPSILON = 0.005;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function isZoomed(view: View): boolean {
  return view.s > VIEW_ZOOM.min + ZOOM_EPSILON;
}

export function isIdentity(view: View): boolean {
  return Math.abs(view.s - 1) < 1e-4 && Math.abs(view.x) < 0.05 && Math.abs(view.y) < 0.05;
}

/** How far the HUD reaches into the board box from each edge (board-box px). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

/** The zoom over the camera pose at which a pan may use all of the HUD insets; it grows from none at 1x. */
const INSET_RAMP = 0.5;

/**
 * The view inside its limits: the scale between min and max, and a pan that keeps the board on the screen. A zoomed
 * board covers the whole board box except, at most, the bands that the HUD covers at the edges (`insets`): an edge of
 * the board may come in under the HUD, so every card can be panned out from under it into the free part of the box.
 * The allowance grows with the zoom from none at 1x (at 1x the board does not move).
 */
export function clampView(view: View, box: Size, insets: Insets = NO_INSETS): View {
  const s = clamp(Number.isFinite(view.s) ? view.s : 1, VIEW_ZOOM.min, VIEW_ZOOM.max);
  if (s <= VIEW_ZOOM.min) return { s: VIEW_ZOOM.min, x: 0, y: 0 };
  const t = clamp((s - VIEW_ZOOM.min) / INSET_RAMP, 0, 1);
  const edge = (value: number) => (Number.isFinite(value) && value > 0 ? value * t : 0);
  // x + s * 0 <= left inset (left edge) and x + s * width >= width - right inset (right edge).
  const x = clamp(Number.isFinite(view.x) ? view.x : 0, box.width * (1 - s) - edge(insets.right), edge(insets.left));
  const y = clamp(Number.isFinite(view.y) ? view.y : 0, box.height * (1 - s) - edge(insets.bottom), edge(insets.top));
  return { s, x, y };
}

/** A HUD rect counts for an edge only when its band reaches no deeper than this part of the box (see `edgeInsets`). */
export const EDGE_REACH = 0.25;

/**
 * The insets of the HUD rects (board-box px): each rect that is on the box is given to the edge it costs the least
 * free area to give up (the depth of its band times the length of that edge). A rect that is not at an edge (its band
 * would reach deeper than EDGE_REACH of the box, as a prompt panel in the middle does) is left out: the zoom alone can
 * take a card out from under it, and its band would let the pan show a half-empty box.
 */
export function edgeInsets(rects: readonly Rect[], box: Size): Insets {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const rect of rects) {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(box.width, rect.x + rect.width);
    const y1 = Math.min(box.height, rect.y + rect.height);
    if (x1 - x0 < 1 || y1 - y0 < 1) continue;
    const bands: [keyof Insets, number, number][] = [
      ["top", y1, box.width],
      ["bottom", box.height - y0, box.width],
      ["left", x1, box.height],
      ["right", box.width - x0, box.height],
    ];
    let best = bands[0];
    for (const band of bands) if (band[1] * band[2] < best[1] * best[2]) best = band;
    const reach = (best[0] === "top" || best[0] === "bottom" ? box.height : box.width) * EDGE_REACH;
    if (best[1] > reach) continue;
    out[best[0]] = Math.max(out[best[0]], best[1]);
  }
  return out;
}

/** Zoom by `factor` about `point` (board-box px): the board point under it stays under it, then the clamps. */
export function zoomAt(view: View, point: Point, factor: number, box: Size, insets: Insets = NO_INSETS): View {
  const s = clamp(view.s * (Number.isFinite(factor) && factor > 0 ? factor : 1), VIEW_ZOOM.min, VIEW_ZOOM.max);
  const ratio = s / view.s;
  return clampView({ s, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio }, box, insets);
}

export function panBy(view: View, dx: number, dy: number, box: Size, insets: Insets = NO_INSETS): View {
  return clampView({ s: view.s, x: view.x + dx, y: view.y + dy }, box, insets);
}

/**
 * The zoom factor of one wheel event. A mouse wheel notch (100 px) zooms about 14 %; a trackpad pinch (a wheel event
 * with ctrlKey, small deltas) is more sensitive so a pinch feels direct. Line and page deltas are turned into px.
 */
export function wheelFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const step = clamp(px, -240, 240);
  return Math.exp(-step * (ctrlKey ? 0.01 : 0.0015));
}

/**
 * A two-finger pinch: the view that keeps the board point under the first midpoint under the new midpoint, scaled by
 * how far the fingers moved apart.
 */
export function pinchView(start: View, a0: Point, b0: Point, a: Point, b: Point, box: Size, insets: Insets = NO_INSETS): View {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y);
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const s = clamp(start.s * (d0 > 1 ? d / d0 : 1), VIEW_ZOOM.min, VIEW_ZOOM.max);
  const m0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 };
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // The board point under the first midpoint.
  const px = (m0.x - start.x) / start.s;
  const py = (m0.y - start.y) / start.s;
  return clampView({ s, x: m.x - px * s, y: m.y - py * s }, box, insets);
}

/** One frame of the ease toward `target`: exponential, `tauMs` is the time constant. Snaps when close. */
export function stepView(current: View, target: View, dtMs: number, tauMs: number): View {
  const k = 1 - Math.exp(-Math.max(0, dtMs) / Math.max(1, tauMs));
  const next = { s: current.s + (target.s - current.s) * k, x: current.x + (target.x - current.x) * k, y: current.y + (target.y - current.y) * k };
  return viewsClose(next, target) ? target : next;
}

export function viewsClose(a: View, b: View): boolean {
  return Math.abs(a.s - b.s) < 0.0015 && Math.abs(a.x - b.x) < 0.4 && Math.abs(a.y - b.y) < 0.4;
}

/**
 * Where the board layer sits in its parent: board-box px map to the parent by `box = x + k * parent` (the plaza canvas
 * is translated and scaled to fit; the grid world is the board box itself, x = y = 0 and k = 1).
 */
export interface LayerFrame {
  x: number;
  y: number;
  k: number;
}

export const FLAT_FRAME: LayerFrame = Object.freeze({ x: 0, y: 0, k: 1 });

/**
 * The translation of the layer in its parent (px of the parent, before the scale). From
 * `frame.x + frame.k * (u + s * p) = view.x + view.s * (frame.x + frame.k * p)`: u = (view.x + (s - 1) * frame.x) / k.
 */
export function layerOffset(view: View, frame: LayerFrame = FLAT_FRAME): Point {
  const k = frame.k > 0 ? frame.k : 1;
  return { x: (view.x + (view.s - 1) * frame.x) / k, y: (view.y + (view.s - 1) * frame.y) / k };
}

/** The CSS transform of the layer (transform-origin 0 0 in its parent) that shows the view. */
export function layerTransform(view: View, frame: LayerFrame = FLAT_FRAME): string {
  if (isIdentity(view)) return "";
  const u = layerOffset(view, frame);
  return `translate(${u.x.toFixed(2)}px, ${u.y.toFixed(2)}px) scale(${view.s.toFixed(4)})`;
}

/**
 * A HUD element that belongs to a place on the board (a life plate, the phase hub) follows the view at its own size:
 * its anchor (a point inside it, px of the layer's parent) goes where the board takes that point. A plate that covers no
 * card at 1x covers none at any zoom: it stays inside the zoomed box of its 1x place. The CSS left (or top) of an element
 * at `base` px is this calc; the view hook writes --vz-x, --vz-y (the layer offset, px) and --vz-s (the scale).
 */
export function followCss(base: number, anchor: number, axis: "x" | "y"): string {
  return `calc(${round2(base)}px + var(--vz-${axis}, 0px) + (var(--vz-s, 1) - 1) * ${round2(anchor)}px)`;
}

/**
 * The follow as a shift (the CSS `translate` value "x y"): the element keeps its 1x left and top, and moves by a
 * transform, so a zoom frame costs no layout. The element carries `data-vz-follow`: the view hook writes the --vz-*
 * vars on it on every frame (on the board root only when the view comes to rest, so a frame recalcs no other style).
 */
export function followShift(anchorX: number, anchorY: number): string {
  return `${followCss(0, anchorX, "x")} ${followCss(0, anchorY, "y")}`;
}

/** The same follow as a `transform` value, for an element whose `translate` is taken (a glide) or set by its CSS. */
export function followTransform(anchorX: number, anchorY: number): string {
  return `translate(${followCss(0, anchorX, "x")}, ${followCss(0, anchorY, "y")})`;
}

/** The attribute of an element that follows the view (see followShift). */
export const FOLLOW_ATTR = "data-vz-follow";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** A board-box rect at the camera pose as it shows on the screen under the view (board-box px). */
export function viewRect(view: View, rect: Rect): Rect {
  return { x: view.x + view.s * rect.x, y: view.y + view.s * rect.y, width: rect.width * view.s, height: rect.height * view.s };
}

/** The part of a rect under the view that is on the board box, or null when none of it is. */
export function visibleRect(view: View, rect: Rect, box: Size): Rect | null {
  const shown = viewRect(view, rect);
  const x = Math.max(0, shown.x);
  const y = Math.max(0, shown.y);
  const right = Math.min(box.width, shown.x + shown.width);
  const bottom = Math.min(box.height, shown.y + shown.height);
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The click and drag split of one press. A press becomes a drag (a pan) only when the pointer moves more than the
 * threshold from where it went down; it stays a drag to the end. A press that never passed the threshold is a click.
 * One press is one of the two, never both: a drag drops the click that ends it, and a click never moves the view.
 */
export class PressSplit {
  private start: Point | null = null;
  private dragging = false;

  constructor(private readonly threshold = DRAG_THRESHOLD_PX) {}

  get active(): boolean {
    return this.start != null;
  }

  get isDrag(): boolean {
    return this.dragging;
  }

  down(point: Point): void {
    this.start = { ...point };
    this.dragging = false;
  }

  /** "idle" (no press, or under the threshold), "start" (this move passed it), "drag" (a later move of a drag). */
  move(point: Point): "idle" | "start" | "drag" {
    if (!this.start) return "idle";
    if (this.dragging) return "drag";
    if (Math.hypot(point.x - this.start.x, point.y - this.start.y) <= this.threshold) return "idle";
    this.dragging = true;
    return "start";
  }

  /** Ends the press: "click" when it never passed the threshold, "drag" when it did, null with no press. */
  up(): "click" | "drag" | null {
    if (!this.start) return null;
    const result = this.dragging ? "drag" : "click";
    this.start = null;
    this.dragging = false;
    return result;
  }

  /** A press that is cancelled (pointercancel, a second finger) is neither. */
  cancel(): void {
    this.start = null;
    this.dragging = false;
  }
}

/**
 * One thing the camera fit must keep on screen, in board-box px at the camera pose (the identity view). A board item
 * (the field) scales with the view. An item with an `anchor` (a life plate, the phase hub) follows the board at its own
 * size: its anchor goes where the board takes that point (see followShift), the rest of its rect keeps its offset.
 */
export interface FitItem {
  rect: Rect;
  anchor?: Point;
}

/** The bounds of the fit items under a view of scale `s` (before the translation: the view's x and y are not in them). */
function fitBounds(items: readonly FitItem[], s: number): { l: number; t: number; r: number; b: number } {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const { rect, anchor } of items) {
    const x0 = anchor ? s * anchor.x + (rect.x - anchor.x) : s * rect.x;
    const y0 = anchor ? s * anchor.y + (rect.y - anchor.y) : s * rect.y;
    const w = anchor ? rect.width : s * rect.width;
    const h = anchor ? rect.height : s * rect.height;
    l = Math.min(l, x0);
    t = Math.min(t, y0);
    r = Math.max(r, x0 + w);
    b = Math.max(b, y0 + h);
  }
  return { l, t, r, b };
}

/**
 * The view of a camera zoom on a field: the largest scale (up to `maxScale`) at which all the fit items are inside the
 * free box, and the translation that centres them in it. The box is the board box minus the HUD (board-box px). The
 * scale never goes under 1: a free box too small for the items at the camera pose gets the identity scale, centred.
 */
export function fitView(items: readonly FitItem[], free: Rect, maxScale: number = VIEW_ZOOM.max): View {
  if (items.length === 0 || !(free.width > 0 && free.height > 0)) return VIEW_IDENTITY;
  const fits = (s: number) => {
    const b = fitBounds(items, s);
    return b.r - b.l <= free.width && b.b - b.t <= free.height;
  };
  const top = clamp(maxScale, VIEW_ZOOM.min, VIEW_ZOOM.max);
  let s: number = VIEW_ZOOM.min;
  if (fits(top)) {
    s = top;
  } else if (fits(VIEW_ZOOM.min)) {
    let lo: number = VIEW_ZOOM.min;
    let hi = top;
    for (let i = 0; i < 32; i += 1) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
    s = lo;
  }
  const b = fitBounds(items, s);
  return { s, x: free.x + (free.width - (b.r - b.l)) / 2 - b.l, y: free.y + (free.height - (b.b - b.t)) / 2 - b.t };
}

/**
 * The transform that keeps a node inside the board layer at its 1x place and size under a view (the hand of your own
 * field: it is HUD, only the field zooms). `origin` is the top left of the node in the layer's parent px (canvas px) at
 * the identity view; the layer maps p to u + s * p, so the node draws p = origin + translate, scaled by 1 / s about its top
 * left, which the layer maps back onto itself. The node needs `transform-origin: 0 0`.
 */
export function counterTransform(view: View, origin: Point, frame: LayerFrame = FLAT_FRAME): string {
  if (isIdentity(view)) return "";
  const u = layerOffset(view, frame);
  const s = view.s;
  const tx = (-u.x + (1 - s) * origin.x) / s;
  const ty = (-u.y + (1 - s) * origin.y) / s;
  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${(1 / s).toFixed(5)})`;
}

/** Where a fit item stands on screen under a view (board-box px): a board item scales with it, a follower keeps its size and follows its anchor. */
export function fitItemRect(item: FitItem, view: View): Rect {
  const { rect, anchor } = item;
  if (!anchor) return { x: view.x + view.s * rect.x, y: view.y + view.s * rect.y, width: view.s * rect.width, height: view.s * rect.height };
  return { x: view.x + view.s * anchor.x + (rect.x - anchor.x), y: view.y + view.s * anchor.y + (rect.y - anchor.y), width: rect.width, height: rect.height };
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * A prompt room moved off the obstacles it covers (the zoomed field, the plates that follow it), inside the box. The room
 * keeps its size and goes to the nearest place that touches no obstacle: beside an obstacle edge or an edge of the box.
 * It stays where it is when it is clear, or when no place is clear.
 */
export function clearRoom(room: Rect, obstacles: readonly Rect[], box: Size, margin: number = 8): Rect {
  const hit = (r: Rect) => obstacles.some((o) => overlaps(r, o));
  if (!hit(room)) return room;
  const xs = [room.x, margin, box.width - room.width - margin, ...obstacles.flatMap((o) => [o.x + o.width + margin, o.x - room.width - margin])];
  const ys = [room.y, margin, box.height - room.height - margin, ...obstacles.flatMap((o) => [o.y + o.height + margin, o.y - room.height - margin])];
  let best: Rect | null = null;
  let bestCost = Infinity;
  for (const x of xs) {
    for (const y of ys) {
      if (x < margin || y < margin || x + room.width > box.width - margin || y + room.height > box.height - margin) continue;
      const candidate = { x: Math.round(x), y: Math.round(y), width: room.width, height: room.height };
      if (hit(candidate)) continue;
      const cost = Math.hypot(x - room.x, y - room.y);
      if (cost < bestCost) {
        best = candidate;
        bestCost = cost;
      }
    }
  }
  return best ?? room;
}

/**
 * A clear place for a prompt room: `clearRoom`, and when the full room has no clear place it gets shorter, then narrower (the panel sits at
 * the bottom edge of its room and is lower than the room most of the time), down to `min`. Null when no size has a clear place.
 */
export function fitRoom(room: Rect, obstacles: readonly Rect[], box: Size, min: Size, margin: number = 8): Rect | null {
  const hit = (r: Rect) => obstacles.some((o) => overlaps(r, o));
  for (let width = room.width; ; width = Math.max(min.width, width - 40)) {
    for (let height = room.height; ; height = Math.max(min.height, height - 40)) {
      const moved = clearRoom({ ...room, width, y: room.y + room.height - height, height }, obstacles, box, margin);
      if (!hit(moved)) return moved;
      if (height <= min.height) break;
    }
    if (width <= min.width) return null;
  }
}
