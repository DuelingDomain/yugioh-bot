import { useEffect } from "react";

/** A card of your own hand: the field hand wraps it in `data-hand-card`, the Tag hand is the button itself. */
const OWN_HAND_CARD = '[data-hand-seat][data-side="you"] :is([data-hand-card], button[data-zones])';
/** How far a hovered card is followed after the pointer leaves it: the card shrinks back over about half a second. */
const COVER_HOLD_MS = 700;
/** A layer may draw pills, a crown or a glow outside its box; a hole this near the box can still touch them. */
const COVER_REACH = 40;

/**
 * A hovered (or keyboard focused) card of your hand must lie over everything on the board so you can read all of it and click
 * it. The hand sits inside the board's own stacking contexts (different in every table shell), while the Deck Master emblem, the
 * chain badges and callout, the chain card ring and the equip links are layers above the whole board (some are portaled to the
 * page body or the duel root), so no z-index can lift the card over them. Instead such a layer gets a hole where the card is:
 * `--hand-cut` (a `clip-path`, `clip-path: var(--hand-cut, none)` on the layer) follows the card's real box every frame while it
 * grows and shrinks. A clip-path also removes the hole from hit testing, so the pointer there reaches the card, and the rest of
 * the layer stays whole. Field cards need no hole: the hand strip rises over them by CSS (`field.module.css`).
 *
 * The open card inspector (and any open edge drawer) is cut out of the same layers in the same way: it is a panel over the whole
 * board, but in the live table the shell is one fixed stacking context, so a body-level layer such as the emblem would draw over it.
 *
 * One tracker serves every layer: a single set of document listeners and a single frame loop, however many layers use the hook.
 * The loop runs while the card grows or shrinks and stops once nothing moved for a few frames; the tracker then re-checks at a
 * slow pace while the card stays hovered (a layer may be remounted or the board resized without any event).
 */
type Layer = { wrap: { current: HTMLElement | null } };

/** Frames without any box change before the fast loop stops. */
const STILL_FRAMES = 3;
/** The slow re-check while a card stays hovered after the fast loop stopped. */
const SLOW_MS = 250;

const layers = new Set<Layer>();
let card: HTMLElement | null = null;
let holdUntil = 0;
let frame = 0;
let slow = 0;
let still = 0;
let signature = "";

const hovered = (el: HTMLElement) => el.matches(":hover, :focus-visible, :has(:focus-visible)");

function setCut(layer: Layer, value: string) {
  const el = layer.wrap.current;
  // Compare with the element itself: a layer remounted during a hover (a new element) has no hole yet.
  if (!el || value === el.style.getPropertyValue("--hand-cut")) return;
  if (value) el.style.setProperty("--hand-cut", value);
  else el.style.removeProperty("--hand-cut");
}

function clearAll() {
  card = null;
  for (const layer of layers) setCut(layer, "");
}

function stop() {
  if (frame) cancelAnimationFrame(frame);
  if (slow) window.clearTimeout(slow);
  frame = 0;
  slow = 0;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** An open card inspector or edge drawer panel: it lies over the whole board, so these layers must not draw over it either. */
const OPEN_DRAWER = "[data-testid='hover-preview'][data-open='true'], [data-edge-drawer][data-state='open'] [role='dialog']";

const near = (r: Box, box: DOMRect) =>
  r.right > box.left - COVER_REACH && r.left < box.right + COVER_REACH && r.bottom > box.top - COVER_REACH && r.top < box.bottom + COVER_REACH;

/** Holes that touch each other become one box: an even-odd polygon would fill their overlap again. */
function mergeBoxes(list: Box[]): Box[] {
  // A DOMRect keeps its sides on the prototype: copy them one by one.
  const out = list.map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  for (let i = 0; i < out.length; i += 1) {
    for (let j = i + 1; j < out.length; j += 1) {
      const a = out[i];
      const b = out[j];
      if (a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top) continue;
      out[i] = { left: Math.min(a.left, b.left), top: Math.min(a.top, b.top), right: Math.max(a.right, b.right), bottom: Math.max(a.bottom, b.bottom) };
      out.splice(j, 1);
      i = -1;
      break;
    }
  }
  return out;
}

function tick() {
  frame = 0;
  slow = 0;
  if (card && !card.isConnected) card = null;
  const holes: Box[] = [];
  if (card) holes.push((card.querySelector<HTMLElement>("[data-card-frame]") ?? card).getBoundingClientRect());
  for (const drawer of document.querySelectorAll<HTMLElement>(OPEN_DRAWER)) {
    const box = drawer.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) holes.push(box);
  }
  if (holes.length === 0) {
    clearAll();
    return;
  }
  // Read every box first, then write: one layout for all layers.
  const reads: Array<[Layer, DOMRect | null]> = [];
  let next = holes.map((r) => `${r.left},${r.top},${r.right},${r.bottom}`).join(";");
  for (const layer of layers) {
    const box = layer.wrap.current?.getBoundingClientRect() ?? null;
    reads.push([layer, box]);
    next += box ? `|${box.left},${box.top},${box.width},${box.height}` : "|";
  }
  for (const [layer, box] of reads) {
    const el = layer.wrap.current;
    if (!el || !box) continue;
    const cuts = mergeBoxes(holes.filter((r) => near(r, box)));
    if (cuts.length === 0) {
      setCut(layer, "");
      continue;
    }
    // A scaled layer (a camera zoom) draws its clip-path in its own, unscaled pixels.
    const scale = el.offsetWidth > 0 && Math.abs(box.width / el.offsetWidth - 1) > 0.01 ? box.width / el.offsetWidth : 1;
    let path = "polygon(evenodd, -400px -400px, calc(100% + 400px) -400px, calc(100% + 400px) calc(100% + 400px), -400px calc(100% + 400px), -400px -400px";
    for (const r of cuts) {
      const x1 = Math.round((r.left - box.left) / scale);
      const y1 = Math.round((r.top - box.top) / scale);
      const x2 = Math.round((r.right - box.left) / scale);
      const y2 = Math.round((r.bottom - box.top) / scale);
      // Each hole starts and ends at the outer corner, so one polygon holds all of them.
      path += `, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px, -400px -400px`;
    }
    setCut(layer, `${path})`);
  }
  still = next === signature ? still + 1 : 0;
  signature = next;
  const holding = card !== null && (hovered(card) || performance.now() < holdUntil);
  if (card && !holding) {
    // The card was left and its hold ran out: only the drawers keep a hole.
    card = null;
    still = 0;
  }
  if (still >= STILL_FRAMES) slow = window.setTimeout(tick, SLOW_MS);
  else frame = requestAnimationFrame(tick);
}

/** Starts (or restarts at full speed) the frame loop for the tracked card and the open drawers. */
function wake() {
  still = 0;
  stop();
  frame = requestAnimationFrame(tick);
}

function enter(target: EventTarget | null) {
  const hit = target instanceof Element ? target.closest<HTMLElement>(OWN_HAND_CARD) : null;
  if (!hit) return;
  card = hit.closest<HTMLElement>("[data-hand-card]") ?? hit;
  holdUntil = 0;
  wake();
}

function leave() {
  holdUntil = performance.now() + COVER_HOLD_MS;
  wake();
}

const onOver = (e: Event) => enter(e.target);
const onResize = () => wake();

/** A drawer opening or closing (its data attribute flips) starts the loop; no pointer event tells the tracker. */
let drawerWatch: MutationObserver | null = null;

function install() {
  drawerWatch = new MutationObserver(onResize);
  drawerWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["data-open", "data-state"] });
  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", leave, true);
  document.addEventListener("focusin", onOver, true);
  document.addEventListener("focusout", leave, true);
  document.addEventListener("transitionend", onResize, true);
  window.addEventListener("resize", onResize);
}

function uninstall() {
  drawerWatch?.disconnect();
  drawerWatch = null;
  document.removeEventListener("pointerover", onOver, true);
  document.removeEventListener("pointerout", leave, true);
  document.removeEventListener("focusin", onOver, true);
  document.removeEventListener("focusout", leave, true);
  document.removeEventListener("transitionend", onResize, true);
  window.removeEventListener("resize", onResize);
  stop();
  card = null;
}

export function useHandCover(wrap: { current: HTMLElement | null }, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const layer: Layer = { wrap };
    if (layers.size === 0) install();
    layers.add(layer);
    // A layer mounted while a card is hovered gets its hole at once.
    wake();
    return () => {
      setCut(layer, "");
      layers.delete(layer);
      if (layers.size === 0) uninstall();
    };
  }, [wrap, enabled]);
}
