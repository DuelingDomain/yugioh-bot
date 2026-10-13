import { duelFxClock } from "../fx-clock";
import { mulberry, type CrackChunk, type Pt } from "./gen";

/* A chunk of the mat lets go: a piece of the mat falls away from the broken edge and a little dust rises.
   The pieces live in a layer BESIDE the mat (the mat itself is masked, so a piece inside it would be cut at the hole).
   They are Web Animations that end by themselves; nothing runs per frame. */

export interface ChunkPlacement {
  /** The mat's box in its offset parent's layout px. */
  face: HTMLElement;
  /** Where a generator point (x, y) lands on the mat. */
  ox: number;
  oy: number;
  kx: number;
  ky: number;
  /** Mat size in layout px. */
  w: number;
  h: number;
  /** Direction that looks like "down" on the screen, in the mat's own axes. */
  gravity: Pt;
  /** Layout px per screen px, so the fall covers the same screen distance on a small field. */
  unit: number;
  seed: number;
}

const layers = new WeakMap<HTMLElement, HTMLElement>();

function layerFor(face: HTMLElement): HTMLElement | null {
  const parent = face.offsetParent as HTMLElement | null;
  if (!parent) return null;
  let layer = layers.get(face);
  if (!layer || layer.parentElement !== parent) {
    layer?.remove();
    layer = document.createElement("div");
    layer.setAttribute("data-crack-debris", "");
    layer.setAttribute("data-crack-ambient", "");
    layer.setAttribute("aria-hidden", "true");
    layer.style.cssText = "position:absolute;pointer-events:none;z-index:3;overflow:visible;";
    parent.append(layer);
    layers.set(face, layer);
  }
  layer.style.left = `${face.offsetLeft + face.clientLeft}px`;
  layer.style.top = `${face.offsetTop + face.clientTop}px`;
  layer.style.width = `${face.clientWidth}px`;
  layer.style.height = `${face.clientHeight}px`;
  // A tilted mat (the 3D plane) lets its chunks fall from the tilted box: the layer takes the mat's own transform. The perspective is on an ancestor both share.
  const look = getComputedStyle(face);
  layer.style.transform = look.transform && look.transform !== "none" ? look.transform : "";
  layer.style.transformOrigin = look.transformOrigin || "";
  return layer;
}

export function removeDebrisLayer(face: HTMLElement) {
  layers.get(face)?.remove();
  layers.delete(face);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function dropChunk(chunk: CrackChunk, at: ChunkPlacement) {
  const layer = layerFor(at.face);
  if (!layer || typeof Element.prototype.animate !== "function") return;
  const pts = chunk.poly.map(([x, y]): Pt => [clamp(at.ox + x * at.kx, 0, at.w), clamp(at.oy + y * at.ky, 0, at.h)]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const bx = Math.min(...xs);
  const by = Math.min(...ys);
  const bw = Math.max(...xs) - bx;
  const bh = Math.max(...ys) - by;
  if (!(bw > 0.5) || !(bh > 0.5)) return;
  const rnd = mulberry(at.seed * 31 + Math.round(chunk.cx * 7 + chunk.cy * 3));
  const [gx, gy] = at.gravity;
  const lat: Pt = [gy, -gx];
  const unit = at.unit;

  const piece = document.createElement("div");
  piece.style.cssText = `position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;will-change:transform;filter:drop-shadow(0 0 0.6px rgb(205 220 245 / 0.45));`;
  const tile = document.createElement("div");
  const style = getComputedStyle(at.face);
  tile.style.cssText =
    `position:absolute;inset:0;clip-path:polygon(${pts.map((p) => `${(p[0] - bx).toFixed(1)}px ${(p[1] - by).toFixed(1)}px`).join(",")});` +
    `background-color:rgb(12 19 36 / 0.94);background-image:${style.backgroundImage};background-size:${at.w}px ${at.h}px;background-position:${-bx}px ${-by}px;`;
  piece.append(tile);
  layer.append(piece);

  const big = Math.min(1.6, 0.6 + (bw * bh) / 1800);
  const dist = (70 + rnd() * 90) * big * unit;
  const side = (rnd() - 0.5) * 70 * unit;
  const dur = 620 + rnd() * 260;
  const move = (dx: number, dy: number, rot: number) => `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
  const fall = duelFxClock.animate(
    piece,
    [
      { transform: move(0, 0, 0), offset: 0 },
      { transform: move(-gx * 1.5, -gy * 1.5, (rnd() - 0.5) * 3), offset: 0.12 },
      { transform: move(gx * dist + lat[0] * side, gy * dist + lat[1] * side, (rnd() - 0.5) * 70), offset: 1 },
    ],
    { duration: dur, easing: "cubic-bezier(.5, 0, .9, .55)" },
  );
  duelFxClock.animate(tile, [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: dur, easing: "linear" });
  const remove = () => piece.remove();
  fall.finished.then(remove, remove);

  const count = Math.min(6, 2 + Math.round(big * 2));
  for (let i = 0; i < count; i += 1) {
    const [dx, dy] = chunk.dust[i % Math.max(1, chunk.dust.length)] ?? [chunk.cx, chunk.cy];
    const px = clamp(at.ox + dx * at.kx, 0, at.w);
    const py = clamp(at.oy + dy * at.ky, 0, at.h);
    const dot = document.createElement("i");
    dot.style.cssText = `position:absolute;left:${px}px;top:${py}px;width:2.6px;height:2.6px;border-radius:50%;background:rgb(190 202 225 / 0.8);`;
    layer.append(dot);
    const run = (20 + rnd() * 40) * unit;
    const sd = (rnd() - 0.5) * 30 * unit;
    const up = (4 + rnd() * 10) * unit;
    const drift = duelFxClock.animate(
      dot,
      [
        { transform: "translate(0, 0)", opacity: 0 },
        { opacity: 0.7, offset: 0.18 },
        { transform: `translate(${gx * run + lat[0] * sd - gx * up}px, ${gy * run + lat[1] * sd - gy * up}px)`, opacity: 0 },
      ],
      { duration: 520 + rnd() * 380, delay: rnd() * 120, easing: "cubic-bezier(.3, .6, .5, 1)" },
    );
    const gone = () => dot.remove();
    drift.finished.then(gone, gone);
  }
}
