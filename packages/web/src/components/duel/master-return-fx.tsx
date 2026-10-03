"use client";

/**
 * The Deck Master zipping back to its dock.
 *
 * When the master goes back to the Deck Master Zone (see master-return.ts for how that is read), a
 * copy of the card lifts off where the master was (Graveyard, banish pile, a field zone, the hand),
 * zips along an arc to the dock in the side rail with a short trail, and lands with a small settle
 * and a glow pulse in the master's accent. About 660 ms of flight, then a 120 ms cross-fade into the
 * real card. The real dock picture stays invisible until the copy lands, so it is never seen twice.
 *
 * Order: the flight starts after the card flights already planned by move-plan.ts are over (a master
 * that was just destroyed first reaches the Graveyard), waiting at most the queue cap of the move
 * layer. The layer is pointer-transparent, so a prompt is never blocked by it.
 *
 * The layer covers the window (the dock sits beside the board, outside the board's effect layer).
 * Only transform and opacity are animated. A master returning from the opponent's side starts
 * turned half a circle, as the far player's cards rest on the board (cardTurn), and turns upright
 * on the way, because the dock shows it upright.
 *
 * Reduced motion: no flight, a 200 ms fade-in of the real picture at the dock.
 */
import { duelFxClock } from "./fx-clock";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { DuelEvent, DuelSeatView, DuelZoneRef } from "@yugidraft/shared/duels";
import { cardArtUrl, LOCATION_DECK, LOCATION_EXTRA, LOCATION_GRAVE, LOCATION_REMOVED } from "./constants";
import { auraTintOf, collectFreshEvents, maxEventId } from "./event-queue";
import { detectMasterReturns } from "./master-return";
import { cardTurn } from "./move-fx";
import { MOVE_TIMING, movesSettleAt, planMoves, resolveSource, type ZoneSnapshot } from "./move-plan";
import styles from "./master-return-fx.module.css";
import { Track } from "./summon-fx";

export type MasterReturnFxProps = {
  /** engine.events (a rolling window; ids only grow). */
  events: DuelEvent[];
  /** engine.seats: the return is read from two consecutive views. */
  seats: DuelSeatView[];
  duelKey: string;
  reducedMotion: boolean;
  /** The viewer's seat (their side of the table is the bottom); null for a spectator. */
  mySeat: number | null;
};

export const MASTER_RETURN = {
  flightMs: 780,
  /** A beat after the last card flight lands, so the Graveyard toss reads first. */
  gapMs: 240,
  /** Never wait longer than the move layer's own queue cap. */
  waitCapMs: MOVE_TIMING.queueCapMs,
  reducedFadeMs: 200,
  landFadeMs: 120,
  pulseMs: 520,
  /** The pulse starts this long before the card lands. */
  pulseLeadMs: 100,
  echoes: [
    { delay: 34, strength: 0.34 },
    { delay: 68, strength: 0.2 },
    { delay: 102, strength: 0.1 },
  ],
} as const;

const SAMPLES = 24;
const CARD_ASPECT = 0.686;
const HIDE_FAILSAFE_MS = 1500;
const LIFT_END = 0.14;
const SETTLE_START = 0.8;

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
/** Quick out of the lift, a fast middle, a soft arrival: the zip. */
const zip = (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** The shortest way round to upright: 270 deg becomes -90, so a turned card does not spin 270 deg. */
export function shortestTurn(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/* ---------- timing (pure) ---------- */

export type MasterReturnTiming = { startAt: number; landAt: number; durationMs: number };

/**
 * When the flight starts and lands. `settleAt` is when the planned card flights are over. With reduced
 * motion there is no wait and no flight: the picture fades in at once.
 */
export function planMasterReturnTiming(now: number, settleAt: number, reduced: boolean): MasterReturnTiming {
  if (reduced) return { startAt: now, landAt: now + MASTER_RETURN.reducedFadeMs, durationMs: MASTER_RETURN.reducedFadeMs };
  const wait = settleAt > now ? Math.min(settleAt - now + MASTER_RETURN.gapMs, MASTER_RETURN.waitCapMs) : 0;
  const startAt = now + wait;
  return { startAt, landAt: startAt + MASTER_RETURN.flightMs, durationMs: MASTER_RETURN.flightMs };
}

/* ---------- flight geometry (pure, so it can be tested) ---------- */

export type MasterFlightParams = {
  /** Start offset from the dock centre, px. */
  dx: number;
  dy: number;
  /** Start size relative to the dock card. */
  startScale: number;
  startRot: number;
  endRot: number;
  /** Card height at the dock, px. */
  cardH: number;
};

export type MasterFlight = {
  card: Keyframe[];
  shade: Keyframe[];
  /** Per-sample strength 0..1 of the trail copies (rises on the lift, gone on arrival). */
  trail: number[];
};

/** Keyframes of one return: a small lift, a fast arc to the dock, a settle. */
export function buildMasterFlight(params: MasterFlightParams): MasterFlight {
  const { dx, dy, startScale, endRot, cardH } = params;
  const startRot = shortestTurn(params.startRot);
  const dist = Math.hypot(dx, dy);
  const liftPx = cardH * 0.08;
  const arc = clamp(dist * 0.2, 24, 160);
  const tilt = (dx > 0 ? -1 : 1) * 8;
  const p0 = { x: dx, y: dy - liftPx };
  const c = { x: dx / 2, y: (dy - liftPx) / 2 - arc };
  const bez = (t: number) => {
    const m = 1 - t;
    return { x: m * m * p0.x + 2 * m * t * c.x, y: m * m * p0.y + 2 * m * t * c.y };
  };
  const card: Keyframe[] = [];
  const shade: Keyframe[] = [];
  const trail: number[] = [];
  for (let i = 0; i <= SAMPLES; i += 1) {
    const u = i / SAMPLES;
    let x: number;
    let y: number;
    let rot: number;
    let scale: number;
    let glow: number;
    let tr: number;
    if (u <= LIFT_END) {
      const q = easeOutCubic(u / LIFT_END);
      x = dx;
      y = dy - liftPx * q;
      rot = startRot + tilt * q;
      scale = startScale * lerp(1, 1.12, q);
      glow = 0.9 * q;
      tr = 0;
    } else if (u < SETTLE_START) {
      const v = (u - LIFT_END) / (SETTLE_START - LIFT_END);
      const e = zip(clamp(v, 0, 1));
      const at = bez(e);
      x = at.x;
      y = at.y;
      rot = lerp(startRot + tilt, endRot, e);
      scale = lerp(startScale * 1.12, 1.06, e);
      glow = lerp(0.9, 0.6, e);
      tr = v > 0.85 ? clamp((1 - v) / 0.15, 0, 1) : 1;
    } else {
      const w = (u - SETTLE_START) / (1 - SETTLE_START);
      x = 0;
      y = 0;
      rot = endRot;
      scale = w < 0.5 ? lerp(1.06, 0.975, easeInOutSine(w / 0.5)) : lerp(0.975, 1, easeOutCubic((w - 0.5) / 0.5));
      glow = lerp(0.6, 0, w);
      tr = 0;
    }
    card.push({
      offset: u,
      opacity: 1,
      transform: `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${scale.toFixed(4)})`,
    });
    shade.push({ offset: u, opacity: Math.max(0, glow) });
    trail.push(tr);
  }
  // Land exactly on the dock.
  card[card.length - 1].transform = `translate3d(0px, 0px, 0) rotate(${endRot}deg) scale(1)`;
  shade[shade.length - 1].opacity = 0;
  trail[trail.length - 1] = 0;
  return { card, shade, trail };
}

/** The trail copy `strength` strong: the same path, faded by the flight's trail curve. */
export function echoFrames(flight: MasterFlight, strength: number): Keyframe[] {
  return flight.card.map((frame, index) => ({ ...frame, opacity: strength * flight.trail[index] }));
}

/* ---------- DOM helpers ---------- */

/** The dock pictures of one seat. Both the side rail and the Masters sheet may be mounted. */
function dockArts(seat: number): HTMLElement[] {
  if (typeof document === "undefined") return [];
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-master-dock="${seat}"]`)).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  });
}

function dockImages(arts: HTMLElement[]): HTMLElement[] {
  return arts.flatMap((art) => Array.from(art.querySelectorAll<HTMLElement>("img")));
}

function hideImages(images: HTMLElement[]): () => void {
  for (const img of images) img.style.visibility = "hidden";
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const img of images) img.style.removeProperty("visibility");
  };
}

const PILE_KIND: Record<number, string> = {
  [LOCATION_GRAVE]: "gy",
  [LOCATION_REMOVED]: "banish",
  [LOCATION_EXTRA]: "extra",
  [LOCATION_DECK]: "deck",
};

function snapshotOf(el: HTMLElement, side: "you" | "opp"): ZoneSnapshot | null {
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return null;
  return { rect: { left: r.left, top: r.top, width: r.width, height: r.height }, side, faceUp: true, defense: false };
}

/**
 * Where the master was, on screen. The exact zone first (the last snapshot of its anchor); a pile
 * whose key for this card is gone falls back to the pile itself, then to that player's Graveyard.
 */
export function resolveReturnSource(from: DuelZoneRef, seat: number, mySeat: number | null): ZoneSnapshot | null {
  const exact = resolveSource(from);
  if (exact) return { ...exact, faceUp: true };
  if (typeof document === "undefined") return null;
  const side: "you" | "opp" = seat === (mySeat ?? 0) ? "you" : "opp";
  for (const kind of [PILE_KIND[from.location], "gy"]) {
    if (!kind) continue;
    const pile = document.querySelector<HTMLElement>(`[data-kind="${kind}"][data-side="${side}"]`);
    const snap = pile ? snapshotOf(pile, side) : null;
    if (snap) return snap;
  }
  return null;
}

/* ---------- the ghost ---------- */

type Item = {
  id: number;
  seat: number;
  code: number;
  tint: [string, string];
  source: ZoneSnapshot | null;
  timing: MasterReturnTiming;
};

function Ghost({ item, landed, done }: { item: Item; landed: () => void; done: () => void }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLSpanElement>(null);
  const pulseRef = useRef<HTMLDivElement>(null);
  const echoRefs = useRef<Array<HTMLDivElement | null>>([]);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const doneRef = useRef(done);
  doneRef.current = done;

  useLayoutEffect(() => {
    const art = dockArts(item.seat)[0];
    const el = cardRef.current;
    if (!art || !el) {
      landedRef.current();
      doneRef.current();
      return undefined;
    }
    const z = art.getBoundingClientRect();
    const h = z.height;
    const w = Math.min(z.width, h * CARD_ASPECT);
    const cx = z.left + z.width / 2;
    const cy = z.top + z.height / 2;
    const parts = [el, pulseRef.current, ...echoRefs.current].filter((part): part is HTMLDivElement => part != null);
    for (const part of parts) {
      part.style.left = `${cx - w / 2}px`;
      part.style.top = `${cy - h / 2}px`;
      part.style.width = `${w}px`;
      part.style.height = `${h}px`;
      part.style.setProperty("--fx-r", `${Math.max(2, w * 0.05)}px`);
    }

    const flightTrack = new Track();
    const fxTrack = new Track();
    let alive = true;
    const { durationMs } = item.timing;
    const options: KeyframeAnimationOptions = { duration: durationMs, easing: "linear", fill: "both" };

    if (item.source) {
      const s = item.source;
      const flight = buildMasterFlight({
        dx: s.rect.left + s.rect.width / 2 - cx,
        dy: s.rect.top + s.rect.height / 2 - cy,
        startScale: clamp(s.rect.height / h, 0.35, 2.4),
        // The far player's cards rest turned; the dock shows the master upright.
        startRot: cardTurn(s.side, s.defense),
        endRot: 0,
        cardH: h,
      });
      flightTrack.play(el, flight.card, options);
      flightTrack.play(shadeRef.current, flight.shade, options);
      MASTER_RETURN.echoes.forEach((echo, index) => {
        const part = echoRefs.current[index];
        // Each copy trails a beat and still lands with the card.
        fxTrack.play(part, echoFrames(flight, echo.strength), { ...options, delay: echo.delay, duration: durationMs - echo.delay });
      });
    } else {
      // No known source: the card rises into the dock.
      flightTrack.play(
        el,
        [
          { opacity: 0, transform: "translate3d(0px, 14px, 0) scale(0.82)" },
          { opacity: 1, transform: "translate3d(0px, 0px, 0) scale(1.06)", offset: 0.7 },
          { opacity: 1, transform: "translate3d(0px, 0px, 0) scale(1)" },
        ],
        { ...options, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
      );
    }
    // The glow pulse on the dock, starting just before the card lands.
    fxTrack.play(
      pulseRef.current,
      [
        { opacity: 0, transform: "scale(0.94)" },
        { opacity: 0.95, transform: "scale(1)", offset: 0.25 },
        { opacity: 0, transform: "scale(1.12)" },
      ],
      { duration: MASTER_RETURN.pulseMs, delay: Math.max(0, durationMs - MASTER_RETURN.pulseLeadMs), easing: "ease-out", fill: "both" },
    );

    void flightTrack.settled().then(() => {
      if (!alive) return;
      // The real card takes over under the copy, which dissolves.
      landedRef.current();
      fxTrack.play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: MASTER_RETURN.landFadeMs, easing: "ease-out", fill: "both" });
      void fxTrack.settled().then(() => {
        if (alive) doneRef.current();
      });
    });
    return () => {
      alive = false;
      flightTrack.dispose();
      fxTrack.dispose();
    };
    // A flight is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tint = { "--mr-a": item.tint[0], "--mr-b": item.tint[1] } as CSSProperties;
  const src = cardArtUrl(item.code, "full");
  return (
    <div style={tint}>
      {MASTER_RETURN.echoes.map((echo, index) => (
        <div
          key={echo.delay}
          ref={(node) => {
            echoRefs.current[index] = node;
          }}
          className={`${styles.ghost} ${styles.echo}`}
        >
          <div className={styles.face}>
            <img src={src} alt="" draggable={false} />
          </div>
        </div>
      ))}
      <div ref={pulseRef} className={styles.pulse} />
      <div ref={cardRef} className={styles.ghost}>
        <span ref={shadeRef} className={styles.shade} />
        <div className={styles.face}>
          <img src={src} alt="" draggable={false} />
        </div>
      </div>
    </div>
  );
}

/* ---------- layer ---------- */

export function MasterReturnFx({ events, seats, duelKey, reducedMotion, mySeat }: MasterReturnFxProps) {
  const [mounted, setMounted] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const cursorRef = useRef<number | null>(null);
  const prevSeatsRef = useRef<DuelSeatView[] | null>(null);
  const keyRef = useRef(duelKey);
  const idRef = useRef(0);
  const timersRef = useRef<Set<number>>(new Set());
  const releasesRef = useRef<Map<number, () => void>>(new Map());
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;

  useEffect(() => {
    setMounted(true);
  }, []);

  const clearAll = () => {
    for (const timer of timersRef.current) duelFxClock.clearTimeout(timer);
    timersRef.current.clear();
    for (const release of releasesRef.current.values()) release();
    releasesRef.current.clear();
  };
  useEffect(() => () => clearAll(), []);

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      prevSeatsRef.current = null;
      clearAll();
      setItems([]);
    }
    if (cursorRef.current == null) {
      cursorRef.current = maxEventId(events) ?? 0;
      prevSeatsRef.current = seats;
      return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    const prev = prevSeatsRef.current;
    prevSeatsRef.current = seats;
    if (typeof document !== "undefined" && document.hidden) return;
    const found = detectMasterReturns(prev, seats, fresh);
    if (found.length === 0) return;

    const now = duelFxClock.now();
    const reduced = reducedRef.current;
    // The move layer plans a batch once; planning it here too makes sure its flights are known.
    planMoves(fresh, { now, reduced, duelKey });
    for (const hit of found) {
      const arts = dockArts(hit.seat);
      if (arts.length === 0) continue;
      const images = dockImages(arts);
      if (reduced) {
        for (const img of images) {
          if (typeof img.animate === "function") {
            duelFxClock.animate(img, [{ opacity: 0 }, { opacity: 1 }], { duration: MASTER_RETURN.reducedFadeMs, easing: "ease-out", fill: "backwards" });
          }
        }
        continue;
      }
      const id = (idRef.current += 1);
      const timing = planMasterReturnTiming(now, movesSettleAt(now), false);
      const attribute = seats.find((seat) => seat.seat === hit.seat)?.deckMaster?.card.attribute;
      const item: Item = {
        id,
        seat: hit.seat,
        code: hit.code,
        tint: auraTintOf(attribute),
        source: resolveReturnSource(hit.from, hit.seat, mySeat),
        timing,
      };
      // The real picture waits invisible until the copy lands on it.
      const release = hideImages(images);
      releasesRef.current.set(id, release);
      const failsafe = duelFxClock.setTimeout(release, Math.max(0, timing.landAt - now) + HIDE_FAILSAFE_MS);
      timersRef.current.add(failsafe);
      const wait = timing.startAt - now;
      if (wait <= 16) {
        setItems((current) => [...current, item].slice(-4));
      } else {
        const timer = duelFxClock.setTimeout(() => {
          timersRef.current.delete(timer);
          setItems((current) => [...current, item].slice(-4));
        }, wait);
        timersRef.current.add(timer);
      }
    }
  }, [duelKey, events, seats, mySeat]);

  const release = (id: number) => {
    releasesRef.current.get(id)?.();
    releasesRef.current.delete(id);
  };
  const finish = (id: number) => {
    release(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  if (!mounted) return null;
  // Not a portal at the page root: a fixed layer there would sit above the prompt panels in the board.
  return (
    <div className={styles.layer} aria-hidden="true">
      {items.map((item) => (
        <Ghost key={item.id} item={item} landed={() => release(item.id)} done={() => finish(item.id)} />
      ))}
    </div>
  );
}
