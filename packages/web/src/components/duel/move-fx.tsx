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

type Tuning = { lift: number; settle: number; arc: number; ease: (t: number) => number; liftPx: number; peak: number; landScale: number };

function tuningFor(style: MoveStyle, cardH: number, dist: number): Tuning {
  switch (style) {
    case "toss":
      return { lift: 0.1, settle: 0, arc: clamp(dist * 0.22, 16, 96), ease: easeInOutSine, liftPx: cardH * 0.04, peak: 1.05, landScale: 0.9 };
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
    let opacity = 1;
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
      if (toss && v > 0.7) opacity = 1 - (v - 0.7) / 0.3;
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
  if (!toss) last.opacity = 1;
  shade[shade.length - 1].opacity = 0;
  const flip: [number, number] = toss ? [0.08, 0.6] : style === "draw" ? [0.12, 0.7] : [liftEnd, Math.max(liftEnd + 0.1, settleStart - 0.12)];
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

    if (plan.style === "fade" || !source) {
      track.play(el, [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }], {
        duration: plan.reduced ? plan.durationMs : Math.min(plan.durationMs, 240),
        easing: "ease-out",
      });
      if (flipper.current) flipper.current.style.transform = `rotateY(${endAngle}deg)`;
      el.style.transform = endDefense ? "rotate(90deg)" : "none";
    } else {
      const sx = source.rect.left - o.left + source.rect.width / 2;
      const sy = source.rect.top - o.top + source.rect.height / 2;
      const flight = buildFlight({
        style: plan.style,
        dx: sx - cx,
        dy: sy - cy,
        startScale: clamp(source.rect.height / h, 0.35, 2.4),
        startRot: source.defense ? 90 : 0,
        endRot: endDefense ? 90 : 0,
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
      landedRef.current();
      if (plan.holdMs > 0) {
        // A heavy summon's hologram rises out of the landed card: let it dissolve as that starts.
        const fade = new Track();
        fade.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: plan.holdMs, easing: "ease-out", fill: "both" });
        void fade.settled().then(() => {
          if (alive) doneRef.current();
        });
        track.anims.push(...fade.anims);
      } else {
        doneRef.current();
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
      if (!plan) continue;
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
