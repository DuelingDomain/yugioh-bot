"use client";

/**
 * Card flights for "move" events.
 *
 * A ghost of the card leaves where it was (a hand slot, a zone, the deck) and travels to where it
 * landed, at the pace of a person playing it: a small lift, an arc with ease-in-out, a soft settle
 * with a shadow bounce. Cards sent to the Graveyard, banished or returned to a deck are tossed: a
 * quicker arc with a little spin that fades into the pile. Draws slide from the deck into the hand.
 *
 * While the ghost is on its way the real card at the destination stays invisible (visibility) and
 * appears when the ghost lands, so the card is never seen twice. The timing of every flight comes
 * from move-plan.ts, which SummonFx also reads so its effects start once the card has landed.
 *
 * The hand slides too: when a card joins or leaves a hand the others glide (FLIP, the individual
 * `translate` property so the fan rotation and the hover lift are left alone) to their new places,
 * and a card that appears without a flight fades up into its slot. A flight ends by checking that
 * its destination did not move while it flew (the hand may have re-centred) and glides the last
 * few pixels, then the real card takes over under a short cross-fade so nothing snaps or flickers.
 *
 * Reduced motion: no travel, a 150 ms fade at the destination.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { cardArtUrl, LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_HAND, LOCATION_REMOVED } from "./constants";
import { collectFreshEvents, findZoneElement, maxEventId } from "./event-queue";
import {
  getMovePlan,
  planMoves,
  resetMoveSchedule,
  startZoneSnapshots,
  type MovePlan,
  type MoveStyle,
} from "./move-plan";
import styles from "./move-fx.module.css";
import { Track } from "./summon-fx";

export type MoveFxProps = {
  /** engine.events (a rolling window; ids only grow). Play only events newer than the first render. */
  events: DuelEvent[];
  /** Changes when the room changes; reset the cursor on change. */
  duelKey: string;
  reducedMotion: boolean;
};

const CARD_ASPECT = 0.686;
const SAMPLES = 18;
const HIDE_FAILSAFE_MS = 1500;
const MAX_GHOSTS = 12;
/** The ghost dissolves over the real card this long after landing. */
export const LAND_FADE_MS = 140;
/** A destination that moved during the flight is followed for this long, at the end. */
const GLIDE_MS = 140;
/** Moves smaller than this many px are not chased. */
const GLIDE_MIN_PX = 2;

/* ---------- easing ---------- */

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/* ---------- flight geometry (pure, so it can be tested) ---------- */

export type FlightParams = {
  style: MoveStyle;
  /** Start offset from the destination centre, px. */
  dx: number;
  dy: number;
  /** Start size relative to the destination card. */
  startScale: number;
  startRot: number;
  endRot: number;
  /** Card height at the destination, px (the lift and arc scale with it). */
  cardH: number;
  /** Signed spin for tosses, degrees. */
  spin: number;
};

export type Flight = {
  card: Keyframe[];
  shade: Keyframe[];
  /** Offsets (0..1) between which the card turns over, when it does. */
  flip: [number, number];
};

const easeSearch = (t: number) => {
  // Lifts out of the pile, holds face-up for a beat, then glides to the hand.
  if (t < 0.3) return 0.22 * easeOutCubic(t / 0.3);
  if (t < 0.5) return 0.22 + 0.03 * ((t - 0.3) / 0.2);
  return 0.25 + 0.75 * easeInOutCubic((t - 0.5) / 0.5);
};

type Tuning = { lift: number; settle: number; arc: number; ease: (t: number) => number; liftPx: number; peak: number; landScale: number };

function tuningFor(style: MoveStyle, cardH: number, dist: number): Tuning {
  switch (style) {
    case "toss":
      return { lift: 0.1, settle: 0, arc: clamp(dist * 0.22, 16, 96), ease: easeInOutSine, liftPx: cardH * 0.04, peak: 1.05, landScale: 1 };
    case "search":
      return { lift: 0.1, settle: 0.14, arc: clamp(dist * 0.06, 4, 22), ease: easeSearch, liftPx: cardH * 0.1, peak: 1.14, landScale: 1 };
    case "draw":
      return { lift: 0.06, settle: 0.16, arc: clamp(dist * 0.08, 6, 30), ease: easeOutCubic, liftPx: cardH * 0.03, peak: 1.05, landScale: 1 };
    case "return":
      return { lift: 0.12, settle: 0.16, arc: clamp(dist * 0.1, 8, 34), ease: easeInOutCubic, liftPx: cardH * 0.05, peak: 1.06, landScale: 1 };
    default:
      return { lift: 0.16, settle: 0.16, arc: clamp(dist * 0.1, 8, 36), ease: easeInOutCubic, liftPx: cardH * 0.07, peak: 1.08, landScale: 1 };
  }
}

/** Keyframes for one flight. Position, tilt, size and shadow are sampled along a quadratic arc. */
export function buildFlight(params: FlightParams): Flight {
  const { style, dx, dy, startScale, startRot, endRot, cardH, spin } = params;
  const dist = Math.hypot(dx, dy);
  const tune = tuningFor(style, cardH, dist);
  const toss = style === "toss";
  const tilt = (dx > 0 ? -1 : 1) * (toss ? 3 : 5);
  const liftEnd = tune.lift;
  const settleStart = 1 - tune.settle;
  const p0 = { x: dx, y: dy - tune.liftPx };
  const c = { x: dx / 2, y: (dy - tune.liftPx) / 2 - tune.arc };
  const bez = (t: number) => {
    const m = 1 - t;
    return { x: m * m * p0.x + 2 * m * t * c.x, y: m * m * p0.y + 2 * m * t * c.y };
  };
  const card: Keyframe[] = [];
  const shade: Keyframe[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const u = i / SAMPLES;
    let x: number;
    let y: number;
    let rot: number;
    let scale: number;
    const opacity = 1;
    let shadeOpacity: number;
    if (u <= liftEnd) {
      const q = easeOutCubic(liftEnd === 0 ? 1 : u / liftEnd);
      x = dx;
      y = dy - tune.liftPx * q;
      rot = startRot + tilt * q;
      scale = startScale * lerp(1, tune.peak, q);
      shadeOpacity = 0.6 * q;
    } else if (u < settleStart || tune.settle === 0) {
      const v = (u - liftEnd) / Math.max(0.0001, settleStart - liftEnd);
      const e = tune.ease(clamp(v, 0, 1));
      const at = bez(e);
      x = at.x;
      y = at.y;
      rot = lerp(startRot + tilt, endRot, e) + (toss ? spin * e : 0);
      scale = lerp(startScale * tune.peak, toss ? tune.landScale : 1.05, e);
      shadeOpacity = toss ? lerp(0.6, 0.2, e) : lerp(0.6, 0.5, e);
    } else {
      const w = (u - settleStart) / tune.settle;
      x = 0;
      y = 0;
      rot = endRot;
      // 1.05 -> touches down slightly under size -> rests at 1.
      scale = w < 0.55 ? lerp(1.05, 0.982, easeInOutSine(w / 0.55)) : lerp(0.982, 1, easeOutCubic((w - 0.55) / 0.45));
      shadeOpacity = w < 0.35 ? lerp(0.5, 0.72, w / 0.35) : lerp(0.72, 0, (w - 0.35) / 0.65);
    }
    const offset = i / SAMPLES;
    card.push({
      offset,
      opacity,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    });
    shade.push({ offset, opacity: Math.max(0, shadeOpacity) });
  }
  // Land exactly on the destination.
  const last = card[card.length - 1];
  last.transform = `translate3d(0px, 0px, 0) rotate(${endRot}deg) scale(${toss ? tune.landScale : 1})`;
  last.opacity = 1;
  shade[shade.length - 1].opacity = 0;
  const flip: [number, number] =
    style === "search" ? [0.06, 0.34] : toss ? [0.08, 0.6] : style === "draw" ? [0.12, 0.7] : [liftEnd, Math.max(liftEnd + 0.1, settleStart - 0.12)];
  return { card, shade, flip };
}

/* ---------- hiding the real card while its ghost travels ---------- */

const hiddenCounts = new WeakMap<HTMLElement, number>();

function hideElement(el: HTMLElement): () => void {
  hiddenCounts.set(el, (hiddenCounts.get(el) ?? 0) + 1);
  el.style.visibility = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const left = (hiddenCounts.get(el) ?? 1) - 1;
    hiddenCounts.set(el, left);
    if (left <= 0) el.style.removeProperty("visibility");
  };
}

/** The part of the destination that shows the arriving card: the whole card frame, or a pile's top card. */
function hideTargetOf(dest: HTMLElement, plan: MovePlan): HTMLElement | null {
  const location = plan.event.zone?.location ?? 0;
  if (location === LOCATION_GRAVE || location === LOCATION_REMOVED) {
    return dest.querySelector<HTMLElement>('[data-fi="0"]');
  }
  if (location === LOCATION_EXTRA || location === LOCATION_DECK) return null;
  const art = dest.querySelector<HTMLElement>("[data-card-art]");
  if (!art) return null;
  const body = art.parentElement?.parentElement;
  return body && body !== dest && dest.contains(body) ? body : art;
}

/* ---------- the ghost ---------- */

type GhostProps = {
  plan: MovePlan;
  overlay: HTMLElement;
  landed: () => void;
  done: () => void;
};

/** How far the destination centre moved (in overlay space) since the flight was aimed, or null when it stayed put. */
export function destinationShift(overlay: HTMLElement, dest: HTMLElement, cx: number, cy: number): { dx: number; dy: number } | null {
  const o = overlay.getBoundingClientRect();
  const z = dest.getBoundingClientRect();
  if (z.width < 4 || z.height < 4) return null;
  const dx = z.left - o.left + z.width / 2 - cx;
  const dy = z.top - o.top + z.height / 2 - cy;
  return Math.hypot(dx, dy) < GLIDE_MIN_PX ? null : { dx, dy };
}

/**
 * Turn of a card as it rests on the board, in degrees: a quarter for Defense Position, plus a half turn
 * on the opponent's side of the table (field.module.css turns their cards the same way).
 */
export function cardTurn(side: "you" | "opp", defense: boolean): number {
  return (side === "opp" ? 180 : 0) + (defense ? 90 : 0);
}

function seededSign(id: number): number {
  return (id * 2654435761) % 2 === 0 ? 1 : -1;
}

function Ghost({ plan, overlay, landed, done }: GhostProps) {
  const root = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLSpanElement>(null);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const doneRef = useRef(done);
  doneRef.current = done;
  const card = plan.event.card != null && plan.event.card.code > 0 ? plan.event.card : null;
  const sleeve = plan.event.from?.location === LOCATION_EXTRA || plan.event.zone?.location === LOCATION_EXTRA ? "extra" : "deck";

  // Face at the start: the sleeve unless the card was showing its face where it was.
  const source = plan.source;
  const startUp = card != null && (source ? source.faceUp || (source.side === "you" && plan.event.from?.location === LOCATION_HAND) : true);
  const endUp = card != null && plan.event.faceDown !== true;
  const startAngle = card == null ? 0 : startUp ? 0 : 180;
  const endAngle = card == null ? 0 : endUp ? 0 : 180;

  useLayoutEffect(() => {
    const dest = findZoneElement(plan.event.zone);
    const el = root.current;
    if (!dest || !el) {
      landedRef.current();
      doneRef.current();
      return undefined;
    }
    const o = overlay.getBoundingClientRect();
    const z = dest.getBoundingClientRect();
    if (z.width < 4 || z.height < 4 || o.width < 4) {
      landedRef.current();
      doneRef.current();
      return undefined;
    }
    const h = z.height;
    const w = Math.min(z.width, h * CARD_ASPECT);
    const cx = z.left - o.left + z.width / 2;
    const cy = z.top - o.top + z.height / 2;
    el.style.left = `${cx - w / 2}px`;
    el.style.top = `${cy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.setProperty("--fx-r", `${Math.max(2, w * 0.05)}px`);

    const track = new Track();
    let alive = true;
    const endDefense = dest.dataset.defense === "true";
    const endTurn = cardTurn(dest.dataset.side === "opp" ? "opp" : "you", endDefense);

    if (plan.style === "fade" || !source) {
      track.play(el, [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], {
        duration: plan.reduced ? plan.durationMs : Math.min(plan.durationMs, 300),
        easing: "ease-out",
      });
      if (flipper.current) flipper.current.style.transform = `rotateY(${endAngle}deg)`;
      el.style.transform = endTurn !== 0 ? `rotate(${endTurn}deg)` : "none";
    } else {
      const sx = source.rect.left - o.left + source.rect.width / 2;
      const sy = source.rect.top - o.top + source.rect.height / 2;
      const flight = buildFlight({
        style: plan.style,
        dx: sx - cx,
        dy: sy - cy,
        startScale: clamp(source.rect.height / h, 0.35, 2.4),
        startRot: cardTurn(source.side, source.defense),
        endRot: endTurn,
        cardH: h,
        spin: seededSign(plan.id) * (14 + (plan.id % 5) * 3),
      });
      const options: KeyframeAnimationOptions = { duration: plan.durationMs, easing: "linear", fill: "both" };
      track.play(el, flight.card, options);
      track.play(shade.current, flight.shade, options);
      if (startAngle !== endAngle && flipper.current) {
        const [a, b] = flight.flip;
        track.play(
          flipper.current,
          [
            { transform: `rotateY(${startAngle}deg)`, offset: 0 },
            { transform: `rotateY(${startAngle}deg)`, offset: a, easing: "ease-in-out" },
            { transform: `rotateY(${endAngle}deg)`, offset: b },
            { transform: `rotateY(${endAngle}deg)`, offset: 1 },
          ],
          options,
        );
      }
    }

    void track.settled().then(() => {
      if (!alive) return;
      const finish = () => {
        if (!alive) return;
        // The real card takes over under the ghost, which dissolves: no pop, no gap between the two.
        landedRef.current();
        const tail = plan.style === "fade" || !source ? plan.holdMs : Math.max(plan.holdMs, LAND_FADE_MS);
        if (tail > 0) {
          // A heavy summon's hologram rises out of the landed card: it dissolves as that starts.
          const fade = new Track();
          fade.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: tail, easing: "ease-out", fill: "both" });
          void fade.settled().then(() => {
            if (alive) doneRef.current();
          });
          track.anims.push(...fade.anims);
        } else {
          doneRef.current();
        }
      };
      // The destination may have moved while the card flew (a hand re-centres): glide the last pixels.
      const shift = plan.style === "fade" || !source ? null : destinationShift(overlay, dest, cx, cy);
      if (shift) {
        const rest = `translate3d(0px, 0px, 0) rotate(${endTurn}deg) scale(1)`;
        const glide = new Track();
        glide.play(
          el,
          [
            { transform: rest },
            { transform: `translate3d(${shift.dx.toFixed(2)}px, ${shift.dy.toFixed(2)}px, 0) rotate(${endTurn}deg) scale(1)` },
          ],
          { duration: GLIDE_MS, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "both" },
        );
        track.anims.push(...glide.anims);
        void glide.settled().then(finish);
      } else {
        finish();
      }
    });
    return () => {
      alive = false;
      track.dispose();
    };
    // A flight is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} className={styles.ghost} data-style={plan.style} style={{ opacity: 0 } as CSSProperties}>
      <span ref={shade} className={styles.shade} />
      <div ref={flipper} className={styles.flipper} style={{ transform: `rotateY(${startAngle}deg)` }}>
        {card ? (
          <div className={styles.face}>
            <img className={styles.art} src={cardArtUrl(card.code, "small")} alt="" draggable={false} />
          </div>
        ) : null}
        <div className={styles.back} data-sleeve={sleeve} style={{ transform: `rotateY(${card ? 180 : 0}deg)` }} />
      </div>
    </div>
  );
}

/* ---------- the hand slides (FLIP) ---------- */

export const HAND_FLIP_MS = 320;
export const HAND_ENTER_MS = 320;
const HAND_FLIP_ID = "duel-hand-flip";
const HAND_FLIP_EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export type FlipPoint = { left: number; top: number };

/**
 * Identity of each hand card, in order. A card with a face is known by its picture; sleeves are
 * anonymous. The n-th copy of the same picture gets its own key, so two copies never swap.
 */
export function handCardKeys(ids: ReadonlyArray<string | null>): string[] {
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const base = id ?? "back";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}#${n}`;
  });
}

export type HandFlipResult = {
  /** Cards that were in the hand and moved: slide them by (dx, dy) back to rest. */
  moves: Array<{ key: string; dx: number; dy: number }>;
  /** Cards that were not in the hand before. */
  entered: string[];
};

/** Which hand cards slide, and by how much, between two layouts. Moves under `minPx` are ignored. */
export function handFlipMoves(
  prev: ReadonlyMap<string, FlipPoint>,
  next: ReadonlyMap<string, FlipPoint>,
  minPx = 1.5,
): HandFlipResult {
  const moves: HandFlipResult["moves"] = [];
  const entered: string[] = [];
  for (const [key, at] of next) {
    const before = prev.get(key);
    if (!before) {
      entered.push(key);
      continue;
    }
    const dx = before.left - at.left;
    const dy = before.top - at.top;
    if (Math.hypot(dx, dy) >= minPx) moves.push({ key, dx, dy });
  }
  return { moves, entered };
}

export type HandState = {
  hand: HTMLElement;
  layout: Map<string, FlipPoint>;
  /** What each card element was last told to do: its key, and the offset it started from. */
  applied: Map<Element, { key: string; dx: number; dy: number }>;
};

function isFlipAnimation(anim: Animation): boolean {
  return anim.id === HAND_FLIP_ID;
}

/** Where an animated hand card is right now, relative to its resting place: what is left of its slide. */
function residualOf(el: Element, applied: { dx: number; dy: number }): { dx: number; dy: number } {
  for (const anim of el.getAnimations()) {
    if (!isFlipAnimation(anim)) continue;
    const progress = anim.effect?.getComputedTiming().progress;
    const left = typeof progress === "number" ? 1 - clamp(progress, 0, 1) : 1;
    return { dx: applied.dx * left, dy: applied.dy * left };
  }
  return { dx: 0, dy: 0 };
}

/**
 * One FLIP pass over every hand in `root`: measure where each card rests now, compare with where it
 * was drawn (plus whatever was left of a slide still running), and slide the difference away.
 */
export function flipHands(root: ParentNode, states: Map<string, HandState>, reduced: boolean): void {
  root.querySelectorAll<HTMLElement>("[data-hand-seat]").forEach((hand) => {
    const seat = hand.dataset.handSeat ?? "";
    const cards = Array.from(hand.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    let state = states.get(seat);
    if (state && state.hand !== hand) state = undefined;

    // Where each card is on screen right now, before its old slide is cancelled.
    const visual = new Map<string, FlipPoint>();
    if (state) {
      for (const [key, at] of state.layout) visual.set(key, at);
      for (const card of cards) {
        const applied = state.applied.get(card);
        if (!applied) continue;
        const rest = state.layout.get(applied.key);
        if (!rest) continue;
        const res = residualOf(card, applied);
        visual.set(applied.key, { left: rest.left + res.dx, top: rest.top + res.dy });
      }
    }
    for (const card of cards) {
      for (const anim of card.getAnimations()) if (isFlipAnimation(anim)) anim.cancel();
    }

    const keys = handCardKeys(cards.map((card) => card.querySelector("img")?.getAttribute("src") ?? null));
    const layout = new Map<string, FlipPoint>();
    cards.forEach((card, index) => {
      const r = card.getBoundingClientRect();
      layout.set(keys[index], { left: r.left, top: r.top });
    });
    const applied = new Map<Element, { key: string; dx: number; dy: number }>();
    const next: HandState = { hand, layout, applied };
    states.set(seat, next);
    if (!state) return;

    const { moves, entered } = handFlipMoves(visual, layout);
    const byKey = new Map(keys.map((key, index) => [key, cards[index]] as const));
    if (!reduced) {
      for (const move of moves) {
        const card = byKey.get(move.key);
        if (!card || typeof card.animate !== "function") continue;
        applied.set(card, { key: move.key, dx: move.dx, dy: move.dy });
        card.animate(
          [{ translate: `${move.dx}px ${move.dy}px` }, { translate: "0px 0px" }],
          { duration: HAND_FLIP_MS, easing: HAND_FLIP_EASE, id: HAND_FLIP_ID },
        );
      }
    }
    // A card with no flight (an older server, a missing anchor) still eases into its slot.
    if (entered.length > 0 && entered.length <= 4) {
      for (const key of entered) {
        const card = byKey.get(key);
        if (!card || typeof card.animate !== "function") continue;
        if (card.querySelector('[style*="visibility"]')) continue; // a flight is bringing it
        const rise = reduced ? "0px 0px" : `0px ${Math.round(card.getBoundingClientRect().height * 0.22)}px`;
        card.animate(
          [{ opacity: 0, translate: rise }, { opacity: 1, translate: "0px 0px" }],
          { duration: reduced ? 150 : HAND_ENTER_MS, easing: HAND_FLIP_EASE },
        );
      }
    }
  });
}

/** Keeps the hands sliding while the board is showing. */
function useHandFlip(boardOf: () => HTMLElement | null, reducedRef: { current: boolean }): void {
  useEffect(() => {
    const board = boardOf();
    if (!board || typeof MutationObserver === "undefined") return undefined;
    const states = new Map<string, HandState>();
    flipHands(board, states, reducedRef.current);
    const observer = new MutationObserver((records) => {
      const inHand = records.some((record) => {
        const target = record.target;
        const el = target instanceof Element ? target : target.parentElement;
        return el?.closest("[data-hand-seat]") != null;
      });
      if (inHand) flipHands(board, states, reducedRef.current);
    });
    observer.observe(board, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "style", "data-many"] });
    return () => {
      observer.disconnect();
      board.querySelectorAll<HTMLElement>("[data-hand-seat] > *").forEach((card) => {
        for (const anim of card.getAnimations()) if (isFlipAnimation(anim)) anim.cancel();
      });
    };
    // The board element and the ref are stable for the layer's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/* ---------- layer ---------- */

export function MoveFx({ events, duelKey, reducedMotion }: MoveFxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<MovePlan[]>([]);
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const timersRef = useRef<Set<number>>(new Set());
  const releasesRef = useRef<Map<number, () => void>>(new Map());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useLayoutEffect(() => {
    setOverlay(overlayRef.current);
  }, []);

  // Where cards were, kept fresh so a flight can start from a hand slot that has already closed up.
  useEffect(() => startZoneSnapshots(), []);

  // The hands close up and make room with a slide instead of a jump.
  useHandFlip(() => overlayRef.current?.parentElement ?? null, reducedRef);

  const clearAll = () => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
    for (const release of releasesRef.current.values()) release();
    releasesRef.current.clear();
  };

  useEffect(() => () => clearAll(), []);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      clearAll();
      resetMoveSchedule(duelKey);
      setItems([]);
    }
    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;

    const now = performance.now();
    planMoves(fresh, { now, reduced: reducedRef.current, duelKey });
    const started: MovePlan[] = [];
    for (const event of fresh) {
      const plan = event.kind === "move" ? getMovePlan(event.id) : null;
      // A big summon draws its own arrival (SummonFx): no ghost, and it hides the real card itself.
      if (!plan || plan.silent) continue;
      // The real card waits invisible at its destination until the ghost lands on it.
      const dest = findZoneElement(plan.event.zone);
      const target = dest ? hideTargetOf(dest, plan) : null;
      if (target) {
        const release = hideElement(target);
        releasesRef.current.set(plan.id, release);
        const failsafe = window.setTimeout(release, Math.max(0, plan.landAt + plan.holdMs - now) + HIDE_FAILSAFE_MS);
        timersRef.current.add(failsafe);
      }
      const wait = plan.startAt - now;
      if (wait <= 16) {
        started.push(plan);
      } else {
        const timer = window.setTimeout(() => {
          timersRef.current.delete(timer);
          setItems((current) => [...current, plan].slice(-MAX_GHOSTS));
        }, wait);
        timersRef.current.add(timer);
      }
    }
    if (started.length > 0) setItems((current) => [...current, ...started].slice(-MAX_GHOSTS));
  }, [duelKey, events]);

  const release = (id: number) => {
    const fn = releasesRef.current.get(id);
    if (fn) {
      fn();
      releasesRef.current.delete(id);
    }
  };
  const finish = (id: number) => {
    release(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div ref={overlayRef} className={styles.layer} aria-hidden="true">
      {overlay
        ? items.map((plan) => (
            <Ghost key={plan.id} plan={plan} overlay={overlay} landed={() => release(plan.id)} done={() => finish(plan.id)} />
          ))
        : null}
    </div>
  );
}
