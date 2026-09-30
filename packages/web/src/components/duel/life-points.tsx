"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { formatLp } from "./constants";
import { duelFontClasses } from "./fonts";
import styles from "./life-points.module.css";

// Squared, heavy, near-tabular sans that reads like the anime duel-disk counter.
// Free (OFL). Digits are 0.578em wide at every weight, so cells never jitter.
// Oxanium comes from ./fonts (--font-duel-display).

export type LifePointsProps = {
  value: number | null;
  reducedMotion: boolean;
  /** "lg" is the desktop counter (~52px numeral), "sm" the mobile bar (~24px). Default "lg". */
  size?: "lg" | "sm";
  /** Match-sheet tally: struck previous value plus a -/+ delta chip after a change. Default true. */
  showChange?: boolean;
  /**
   * Wait this many ms before rolling down after a LOSS, so the roll starts when a battle
   * animation lands. Omit to use the hold a battle effect armed for this counter's seat
   * (see armLpHold). Ignored under reduced motion, which always snaps.
   */
  holdMs?: number;
};

/* ---------- hold store: lets a battle animation delay a roll it does not own ---------- */

type LpHold = { ms: number; until: number };
const lpHolds = new Map<number, LpHold>();
const lpHoldKeys = new Set<string>();

/**
 * Arm a one-shot delay for the next LP loss shown at `seat`. `key` de-duplicates re-renders
 * (use the damage event id). The hold expires after 2 s if no LP change consumes it.
 */
export function armLpHold(seat: number, ms: number, key: string): void {
  if (lpHoldKeys.has(key)) return;
  lpHoldKeys.add(key);
  if (lpHoldKeys.size > 200) lpHoldKeys.clear();
  lpHolds.set(seat, { ms, until: Date.now() + 2000 });
}

export function takeLpHold(seat: number): number {
  const hold = lpHolds.get(seat);
  lpHolds.delete(seat);
  if (!hold || hold.until < Date.now()) return 0;
  return hold.ms;
}

export function clearLpHolds(): void {
  lpHolds.clear();
  lpHoldKeys.clear();
}

type Tone = "loss" | "gain";

type DigitGlyph = { kind: "digit"; key: string; digit: number };
type Glyph =
  | DigitGlyph
  | { kind: "comma"; key: string }
  | { kind: "sign"; key: "sign" }
  | { kind: "dash"; key: "dash" };

type Plan =
  | { kind: "snap"; value: number | null; glyphs: Glyph[]; cue: Tone | null }
  | { kind: "roll"; from: number; to: number; glyphs: Glyph[] };

const UNSET = Symbol("lp-unset");
const STRIP: readonly number[] = Array.from({ length: 30 }, (_, i) => i % 10);
const MID = 10;

// Slot-machine timing. Whole roll is ROLL_MIN_MS..ROLL_MAX_MS, scaled by the size of the hit.
const ROLL_MIN_MS = 600;
const ROLL_MAX_MS = 900;
const BIG_HIT = 8000;
const FIRST_STOP = 0.56; // leftmost changing reel stops at 56% of the roll, the rightmost at 100%
const SOLO_STOP = 0.86; // a lone changing reel stops at 86%
const SPIN_RATE_MIN = 20; // average digits per second, small hit
const SPIN_RATE_MAX = 34; // average digits per second, big hit
const SETTLE_SPLIT = 0.84; // share of a reel's time spent spinning before the snap back
const OVERSHOOT = 0.08; // digits past the target before the snap
const BLUR_MAX_EM = 0.045;
const BLUR_FULL_SPEED = 55; // digits per second at which the blur is at its maximum
const DIM_MAX = 0.22;
const EPS = 0.001;
const FINISH_SLACK_MS = 140;
const CUE_MS = 500;

function wrap10(n: number): number {
  return ((n % 10) + 10) % 10;
}

function finiteLp(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function typographic(text: string): string {
  return text.replace("-", "−");
}

export function formatGlyphs(value: number | null): Glyph[] {
  const lp = finiteLp(value);
  if (lp == null) return [{ kind: "dash", key: "dash" }];
  const formatted = formatLp(lp);
  const glyphs: Glyph[] = [];
  let digits = 0;
  let commas = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    const ch = formatted[i];
    if (ch === ",") {
      glyphs.push({ kind: "comma", key: `c${commas++}` });
    } else if (ch === "-" || ch === "−") {
      glyphs.push({ kind: "sign", key: "sign" });
    } else if (ch != null && ch >= "0" && ch <= "9") {
      glyphs.push({ kind: "digit", key: `d${digits++}`, digit: ch.charCodeAt(0) - 48 });
    }
  }
  return glyphs.reverse();
}

export function mergeGlyphs(from: Glyph[], to: Glyph[]): Glyph[] {
  if (to.length === 1 && to[0]?.kind === "dash") return to;
  if (from.length === 1 && from[0]?.kind === "dash") return to;

  const present: Record<string, true> = {};
  const digits: Record<string, number> = {};
  for (const glyph of from) {
    present[glyph.key] = true;
    if (glyph.kind === "digit") digits[glyph.key] = glyph.digit;
  }
  for (const glyph of to) {
    present[glyph.key] = true;
    if (glyph.kind === "digit" && digits[glyph.key] == null) digits[glyph.key] = 0;
  }

  const result: Glyph[] = [];
  if (present.sign) result.push({ kind: "sign", key: "sign" });

  let maxPlace = -1;
  for (const key of Object.keys(present)) {
    if (key.startsWith("d")) maxPlace = Math.max(maxPlace, Number(key.slice(1)));
  }
  for (let place = maxPlace; place >= 0; place--) {
    const digitKey = `d${place}`;
    if (present[digitKey]) {
      result.push({ kind: "digit", key: digitKey, digit: digits[digitKey] ?? 0 });
    }
    if (place > 0 && place % 3 === 0) {
      const commaKey = `c${place / 3 - 1}`;
      if (present[commaKey]) result.push({ kind: "comma", key: commaKey });
    }
  }
  return result;
}

/* ---------- reel planning (pure) ---------- */

export type ReelColumn = { key: string; pos: number; target: number };
export type ReelPlan = { key: string; from: number; target: number; travel: number; duration: number };

/** Total roll time for a hit of `magnitude` LP: 0.6 s for a scratch, 0.9 s for a full 8000. */
export function rollDurationMs(magnitude: number): number {
  const f = Math.sqrt(Math.min(1, Math.max(0, magnitude) / BIG_HIT));
  return Math.round(ROLL_MIN_MS + (ROLL_MAX_MS - ROLL_MIN_MS) * f);
}

/**
 * Plans one spinning reel per column whose digit changes. Columns arrive left to right and
 * stop in that order, the rightmost last. `dir` is +1 for a gain (reel scrolls up, counting up)
 * and -1 for a loss (reel scrolls down, counting down). `travel` is signed, in digits.
 */
export function planReels(
  columns: ReelColumn[],
  dir: 1 | -1,
  magnitude: number,
): { reels: ReelPlan[]; total: number } {
  const changing = columns
    .map((column) => ({ column, net: wrap10((column.target - column.pos) * dir) }))
    .filter(({ net }) => net > EPS && net < 10 - EPS);
  const total = rollDurationMs(magnitude);
  const f = Math.sqrt(Math.min(1, Math.max(0, magnitude) / BIG_HIT));
  const rate = SPIN_RATE_MIN + (SPIN_RATE_MAX - SPIN_RATE_MIN) * f;
  const last = changing.length - 1;

  const reels = changing.map(({ column, net }, index) => {
    const share = last === 0 ? SOLO_STOP : FIRST_STOP + (1 - FIRST_STOP) * (index / last);
    const duration = Math.round(total * share);
    const cycles = Math.max(1, Math.round((duration / 1000) * (rate / 10)));
    return {
      key: column.key,
      from: column.pos,
      target: column.target,
      travel: dir * (net + cycles * 10),
      duration,
    };
  });
  return { reels, total: reels.reduce((max, reel) => Math.max(max, reel.duration), 0) };
}

/**
 * Distance a reel has travelled at progress `t` (0..1) of its own duration, in digits.
 * It spins down with a long ease-out, runs slightly past the target, then snaps back.
 */
export function reelDistance(t: number, travel: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return travel;
  if (t < SETTLE_SPLIT) {
    const u = t / SETTLE_SPLIT;
    return (travel + OVERSHOOT) * (1 - Math.pow(1 - u, 3));
  }
  const v = (t - SETTLE_SPLIT) / (1 - SETTLE_SPLIT);
  return travel + OVERSHOOT * Math.pow(1 - v, 2);
}

export function describeChange(from: number, to: number): { tone: Tone; text: string; was: string } {
  const delta = to - from;
  return {
    tone: delta < 0 ? "loss" : "gain",
    text: `${delta < 0 ? "−" : "+"}${formatLp(Math.abs(delta))}`,
    was: typographic(formatLp(from)),
  };
}

/* ---------- imperative reel engine ---------- */

type LiveReel = ReelPlan & { el: HTMLElement; lastDist: number; lastT: number; done: boolean };

type Engine = {
  raf: number | null;
  timer: number | null;
  cueTimer: number | null;
  active: boolean;
  pos: Map<string, number>;
  live: LiveReel[];
};

type Ctx = {
  engine: Engine;
  rootRef: RefObject<HTMLSpanElement | null>;
  rollRef: RefObject<HTMLSpanElement | null>;
  valueRef: RefObject<number | null>;
  setShown: (glyphs: Glyph[]) => void;
};

function createEngine(): Engine {
  return { raf: null, timer: null, cueTimer: null, active: false, pos: new Map(), live: [] };
}

function clearReelFx(el: HTMLElement) {
  el.style.filter = "";
  el.style.opacity = "";
  el.style.willChange = "";
}

function stopMotion(engine: Engine) {
  if (engine.raf != null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(engine.raf);
  engine.raf = null;
  if (engine.timer != null) window.clearTimeout(engine.timer);
  engine.timer = null;
  for (const reel of engine.live) clearReelFx(reel.el);
  engine.live = [];
  engine.active = false;
}

function stopCue(engine: Engine, root: HTMLElement | null) {
  if (engine.cueTimer != null) window.clearTimeout(engine.cueTimer);
  engine.cueTimer = null;
  root?.removeAttribute("data-tone");
}

function stripEl(roll: HTMLElement | null, key: string): HTMLElement | null {
  return roll?.querySelector<HTMLElement>(`[data-place="${key}"]`) ?? null;
}

function setStrip(el: HTMLElement, pos: number) {
  el.style.transform = `translateY(-${(MID + wrap10(pos)).toFixed(3)}em)`;
}

function snapStrips(ctx: Ctx, value: number | null) {
  for (const glyph of formatGlyphs(value)) {
    if (glyph.kind !== "digit") continue;
    const el = stripEl(ctx.rollRef.current, glyph.key);
    if (el) {
      setStrip(el, glyph.digit);
      showWindow(el);
    }
    ctx.engine.pos.set(glyph.key, glyph.digit);
  }
}

function showWindow(strip: HTMLElement) {
  if (strip.parentElement) strip.parentElement.style.visibility = "";
}

function pulse(el: HTMLElement | null) {
  if (!el || typeof el.animate !== "function") return;
  try {
    el.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 240, easing: "ease-out" });
  } catch {
    /* ignore */
  }
}

function finishRoll(ctx: Ctx) {
  stopMotion(ctx.engine);
  const latest = finiteLp(ctx.valueRef.current);
  snapStrips(ctx, latest);
  ctx.rootRef.current?.removeAttribute("data-tone");
  ctx.setShown(formatGlyphs(latest));
}

function startRoll(ctx: Ctx, from: number, to: number, glyphs: Glyph[]) {
  const { engine } = ctx;
  stopMotion(engine);

  const targets: Record<string, number> = {};
  for (const glyph of formatGlyphs(to)) {
    if (glyph.kind === "digit") targets[glyph.key] = glyph.digit;
  }
  const columns: ReelColumn[] = [];
  for (const glyph of glyphs) {
    if (glyph.kind !== "digit") continue;
    columns.push({
      key: glyph.key,
      pos: engine.pos.get(glyph.key) ?? glyph.digit,
      target: targets[glyph.key] ?? 0,
    });
  }

  const dir = to >= from ? 1 : -1;
  const plan = planReels(columns, dir, Math.abs(to - from));
  const spinning = new Set(plan.reels.map((reel) => reel.key));
  for (const column of columns) {
    if (spinning.has(column.key)) continue;
    const el = stripEl(ctx.rollRef.current, column.key);
    if (el) setStrip(el, column.target);
    engine.pos.set(column.key, column.target);
  }
  for (const column of columns) {
    const el = stripEl(ctx.rollRef.current, column.key);
    if (el) showWindow(el);
  }

  const live: LiveReel[] = [];
  for (const reel of plan.reels) {
    const el = stripEl(ctx.rollRef.current, reel.key);
    if (!el) {
      engine.pos.set(reel.key, reel.target);
      continue;
    }
    setStrip(el, reel.from);
    el.style.willChange = "transform, filter";
    live.push({ ...reel, el, lastDist: 0, lastT: 0, done: false });
  }
  if (live.length === 0 || typeof requestAnimationFrame !== "function") {
    for (const reel of live) setStrip(reel.el, reel.target);
    finishRoll(ctx);
    return;
  }

  engine.live = live;
  engine.active = true;
  if (engine.cueTimer != null) window.clearTimeout(engine.cueTimer);
  engine.cueTimer = null;
  ctx.rootRef.current?.setAttribute("data-tone", dir < 0 ? "loss" : "gain");

  let t0: number | null = null;
  const frame = (now: number) => {
    if (t0 == null) t0 = now;
    const t = now - t0;
    let running = false;
    for (const reel of live) {
      if (reel.done) continue;
      if (t >= reel.duration) {
        reel.done = true;
        setStrip(reel.el, reel.target);
        engine.pos.set(reel.key, reel.target);
        clearReelFx(reel.el);
        // A column that is not in the final number (10,000 -> 9,000) goes blank, not "0".
        if (targets[reel.key] == null && reel.el.parentElement) reel.el.parentElement.style.visibility = "hidden";
        continue;
      }
      running = true;
      const dist = reelDistance(t / reel.duration, Math.abs(reel.travel));
      const p = reel.from + Math.sign(reel.travel) * dist;
      setStrip(reel.el, p);
      engine.pos.set(reel.key, wrap10(p));
      const dt = t - reel.lastT;
      if (dt > 0) {
        const speed = (Math.abs(dist - reel.lastDist) / dt) * 1000;
        const k = Math.min(1, speed / BLUR_FULL_SPEED);
        const blur = Math.round(k * BLUR_MAX_EM * 200) / 200;
        reel.el.style.filter = blur > 0.004 ? `blur(${blur}em)` : "";
        reel.el.style.opacity = k > 0.02 ? String(Math.round((1 - DIM_MAX * k) * 100) / 100) : "";
      }
      reel.lastDist = dist;
      reel.lastT = t;
    }
    if (running) {
      engine.raf = requestAnimationFrame(frame);
    } else {
      engine.raf = null;
      finishRoll(ctx);
    }
  };
  engine.raf = requestAnimationFrame(frame);
  // If frames are throttled (background tab), still land on the right number.
  engine.timer = window.setTimeout(() => finishRoll(ctx), plan.total + FINISH_SLACK_MS);
}

function applyPlan(plan: Plan, ctx: Ctx) {
  if (plan.kind === "roll") {
    startRoll(ctx, plan.from, plan.to, plan.glyphs);
    return;
  }
  const { engine } = ctx;
  stopMotion(engine);
  stopCue(engine, ctx.rootRef.current);
  snapStrips(ctx, plan.value);
  if (plan.cue) {
    // Reduced motion: no spin, just a short pulse and a brief tone flash.
    pulse(ctx.rollRef.current);
    ctx.rootRef.current?.setAttribute("data-tone", plan.cue);
    engine.cueTimer = window.setTimeout(() => {
      engine.cueTimer = null;
      ctx.rootRef.current?.removeAttribute("data-tone");
    }, CUE_MS);
  }
}

function keysOf(glyphs: Glyph[]): string {
  return glyphs.map((glyph) => glyph.key).join("|");
}

/* ---------- component ---------- */

function DigitColumn({ placeKey, initialDigit }: { placeKey: string; initialDigit: number }) {
  const from = useRef(initialDigit);
  return (
    <span className={styles.digit}>
      <span
        className={styles.strip}
        data-place={placeKey}
        style={{ transform: `translateY(-${MID + from.current}em)` }}
      >
        {STRIP.map((digit, index) => (
          <span key={index} className={styles.glyph}>
            {digit}
          </span>
        ))}
      </span>
    </span>
  );
}

type Tally = { seq: number; from: number; to: number };

export function LifePoints({ value, reducedMotion, size = "lg", showChange = true, holdMs }: LifePointsProps) {
  const [shown, setShown] = useState(() => formatGlyphs(value));
  const [engine] = useState(createEngine);
  const shownRef = useRef(shown);
  const prevValueRef = useRef<number | null | typeof UNSET>(UNSET);
  const valueRef = useRef(value);
  const rootRef = useRef<HTMLSpanElement>(null);
  const rollRef = useRef<HTMLSpanElement>(null);
  const pendingRef = useRef<Plan | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const [tallyHold, setTallyHold] = useState(0);
  const holdMsRef = useRef(holdMs);

  holdMsRef.current = holdMs;
  shownRef.current = shown;
  valueRef.current = value;

  const lp = finiteLp(value);

  // Tally: previous value struck through + delta, kept until the next change.
  const [seen, setSeen] = useState(lp);
  const [tally, setTally] = useState<Tally | null>(null);
  if (lp !== seen) {
    setSeen(lp);
    setTally(lp != null && seen != null ? { seq: (tally?.seq ?? 0) + 1, from: seen, to: lp } : null);
  }

  useLayoutEffect(() => {
    return () => {
      if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
      stopMotion(engine);
      if (engine.cueTimer != null) window.clearTimeout(engine.cueTimer);
      engine.cueTimer = null;
    };
  }, [engine]);

  useLayoutEffect(() => {
    if (holdTimerRef.current != null) window.clearTimeout(holdTimerRef.current);
    holdTimerRef.current = null;
    const ctx: Ctx = { engine, rootRef, rollRef, valueRef, setShown };
    const prev = prevValueRef.current;
    const next = finiteLp(value);
    const unchanged = prev !== UNSET && prev === next;

    if (unchanged && !(reducedMotion && engine.active)) return;

    const from = prev === UNSET ? null : prev;

    const run = () => {
      let plan: Plan;
      if (reducedMotion || from == null || next == null) {
        const cue: Tone | null =
          reducedMotion && !unchanged && from != null && next != null ? (next < from ? "loss" : "gain") : null;
        plan = { kind: "snap", value: next, glyphs: formatGlyphs(next), cue };
      } else {
        plan = { kind: "roll", from, to: next, glyphs: mergeGlyphs(shownRef.current, formatGlyphs(next)) };
      }
      prevValueRef.current = next;

      if (keysOf(shownRef.current) !== keysOf(plan.glyphs)) {
        stopMotion(engine);
        pendingRef.current = plan;
        setShown(plan.glyphs);
        return;
      }
      pendingRef.current = null;
      applyPlan(plan, ctx);
    };

    // A battle animation may ask the roll to wait until its slash lands. Losses only.
    let hold = 0;
    if (!reducedMotion && !unchanged && from != null && next != null && next < from) {
      const seat = Number(rootRef.current?.closest("[data-lp-seat]")?.getAttribute("data-lp-seat"));
      hold = holdMsRef.current ?? (Number.isFinite(seat) ? takeLpHold(seat) : 0);
    }
    setTallyHold(hold > 0 ? hold : 0);
    if (hold > 0) {
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        run();
      }, hold);
      return;
    }
    run();
  }, [value, reducedMotion, engine]);

  useLayoutEffect(() => {
    const keys = new Set(shown.map((glyph) => glyph.key));
    for (const key of Array.from(engine.pos.keys())) {
      if (!keys.has(key)) engine.pos.delete(key);
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    applyPlan(pending, { engine, rootRef, rollRef, valueRef, setShown });
  }, [shown, engine]);

  const label = lp == null ? "—" : formatLp(lp);
  const change = showChange && tally ? describeChange(tally.from, tally.to) : null;
  const tallyDelay = reducedMotion || !tally ? 0 : Math.round(rollDurationMs(Math.abs(tally.to - tally.from)) * 0.5) + tallyHold;

  const rootClass = [
    duelFontClasses,
    styles.root,
    size === "sm" ? styles.sm : styles.lg,
    reducedMotion ? styles.reduced : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={rootClass} ref={rootRef} data-size={size}>
      <span className={styles.srOnly} aria-live="polite" aria-atomic="true">
        {label}
      </span>
      <span className={styles.roll} ref={rollRef} aria-hidden="true">
        {shown.map((glyph) => {
          if (glyph.kind === "digit") {
            return <DigitColumn key={glyph.key} placeKey={glyph.key} initialDigit={glyph.digit} />;
          }
          if (glyph.kind === "comma") {
            return (
              <span key={glyph.key} className={styles.comma}>
                ,
              </span>
            );
          }
          if (glyph.kind === "sign") {
            return (
              <span key={glyph.key} className={styles.sign}>
                −
              </span>
            );
          }
          return (
            <span key={glyph.key} className={styles.dash}>
              —
            </span>
          );
        })}
      </span>
      {showChange ? (
        <span className={styles.tally} aria-hidden="true">
          {tally && change ? (
            <span
              key={tally.seq}
              className={`${styles.tallyInner} ${change.tone === "gain" ? styles.gain : ""}`}
              data-change={change.tone}
              style={{ "--lp-tally-delay": `${tallyDelay}ms` } as CSSProperties}
            >
              <span className={styles.old}>
                {change.was}
                <span className={styles.strike} />
              </span>
              <span className={styles.chip}>{change.text}</span>
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}
