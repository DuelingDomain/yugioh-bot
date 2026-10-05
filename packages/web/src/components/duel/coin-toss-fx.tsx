"use client";

// The coin toss (Barrel Dragon, Time Wizard and the like). One layer for every duel screen: the 1v1 room,
// the 3D room, the 3-way and 4-way table, Tag and the replay. It draws a dim cover over the WHOLE screen
// with the gold coin in the centre, in a portal at the page root above every other duel layer
// (--duel-z-coin), so what was open before (a menu, a prompt, a dialog, a pile) stays open under it and
// shows again, unchanged, when the cover leaves.
//
// While the toss plays:
//   - the input lock is on (coin-toss-lock.ts): no click, tap or key reaches the duel, Surrender included;
//   - the next prompt, the next chain beat and the log line of the toss wait for the last result;
//   - the result shows only after the coin has landed and stopped.
// Several tosses play one after the other (coin-plan.ts), then a summary. Everything runs on the duel
// FX clock, so the speed setting applies. Reduced motion: no spin, a short fade to the face.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { chainBeatAt, holdChainAfter } from "./chain-beats";
import { holdEffectSequenceUntil } from "./effect-sequence";
import { reportDuelClientError } from "./client-error";
import {
  COIN_FACES,
  COIN_TIMING,
  EMPTY_VIEW,
  coinLight,
  coinPose,
  coinResults,
  coinSpec,
  coinView,
  frameAt,
  planCoinToss,
  queueStart,
  summaryText,
  type CoinEventPlan,
  type CoinFace,
  type CoinFrame,
  type CoinPose,
  type CoinSegment,
  type CoinStep,
  type CoinView,
} from "./coin-plan";
import { acquireCoinLock, acquireCoinPlaying, holdTossLog } from "./coin-toss-lock";
import { collectFreshEvents, maxEventId } from "./event-queue";
import { duelFxClock } from "./fx-clock";
import { duelFontClasses } from "./fonts";
import { holdPromptReveal } from "./prompt-reveal";
import styles from "./coin-toss-fx.module.css";

export type CoinTossFxProps = {
  events: readonly DuelEvent[];
  duelKey: string;
  reducedMotion: boolean;
  /** An explicit replay starts the cursor here (like MoveFx). */
  replayFrom?: number | null;
  /** Events up to this id are history: no toss plays for them (a reconnect or a late join). */
  skipThrough?: number | null;
  /** The replay viewer: the coin shows, nothing is locked and the cover takes no pointer. */
  passive?: boolean;
};

/* ---------- the coin ---------- */

const N_RIM = 48;
const RIM = Array.from({ length: N_RIM }, (_, index) => {
  const angle = (360 / N_RIM) * index;
  // A fixed light from the upper left, with a milled alternation.
  const l = 0.5 + 0.5 * Math.cos(((angle - 235) * Math.PI) / 180);
  const k = (index % 2 ? 0.86 : 1) * (0.55 + 0.45 * l);
  return { angle, color: `rgb(${Math.round(120 + 135 * k)} ${Math.round(86 + 126 * k)} ${Math.round(24 + 70 * k)})` };
});

type Parts = {
  root: HTMLDivElement | null;
  lift: HTMLDivElement | null;
  coin: HTMLDivElement | null;
  shadow: HTMLDivElement | null;
  burst: HTMLDivElement | null;
  frontShade: HTMLDivElement | null;
  frontGlint: HTMLDivElement | null;
  backShade: HTMLDivElement | null;
  backGlint: HTMLDivElement | null;
};

function RingText({ face }: { face: CoinFace }): ReactElement {
  const info = COIN_FACES[face];
  return (
    <svg className={styles.ringtext} viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <path id={`coin-t-${face}`} d="M100,178 A78,78 0 1,1 100,22 A78,78 0 1,1 100,178" />
        <path id={`coin-b-${face}`} d="M14,100 A86,86 0 0,0 186,100" />
      </defs>
      <text textAnchor="middle"><textPath href={`#coin-t-${face}`} startOffset="50%">{info.ring}</textPath></text>
      <text textAnchor="middle"><textPath href={`#coin-b-${face}`} startOffset="50%">{`★ ${info.word} ★`}</textPath></text>
    </svg>
  );
}

function Face({ face, side, shadeRef, glintRef }: {
  face: CoinFace;
  side: "front" | "back";
  shadeRef: RefObject<HTMLDivElement | null>;
  glintRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const { src } = COIN_FACES[face];
  return (
    <div className={`${styles.face} ${styles[side]}`}>
      <div className={styles.medal}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} />
        <div className={styles.tint} />
        <div className={styles.emb}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" draggable={false} />
        </div>
        <div className={styles.hi} />
      </div>
      <div className={styles.groove} />
      <div className={styles.mill} />
      <RingText face={face} />
      <div ref={glintRef} className={styles.glint} />
      <div className={styles.sweep} />
      <div ref={shadeRef} className={styles.shade} />
    </div>
  );
}

function Chip({ face, label }: { face: CoinFace; label: string }): ReactElement {
  return (
    <span className={`${styles.chip} ${styles.chipDone}`} title={COIN_FACES[face].label}>
      <span className={styles.m}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={COIN_FACES[face].src} alt="" />
      </span>
      <span className={styles.l}>{label}</span>
    </span>
  );
}

const chipLabel = (face: CoinFace) => (face === "heads" ? "H" : "T");

/* ---------- drawing a moment (one write per frame, no React state) ---------- */

function resetCoin(parts: Parts, face: CoinFace): void {
  parts.coin?.classList.remove(styles.landed);
  parts.burst?.classList.remove(styles.burstOn);
  if (parts.coin) parts.coin.style.transform = `rotateX(${face === "tails" ? 180 : 0}deg)`;
  if (parts.lift) parts.lift.style.transform = "translate3d(0,0,0) scale(1)";
  if (parts.shadow) parts.shadow.style.transform = "scale(1,1)";
  for (const shade of [parts.frontShade, parts.backShade, parts.frontGlint, parts.backGlint]) if (shade) shade.style.opacity = "0";
}

function applyPose(parts: Parts, pose: CoinPose, lift: number): void {
  const { lift: liftEl, coin, shadow, frontShade, frontGlint, backShade, backGlint } = parts;
  if (!liftEl || !coin) return;
  liftEl.style.opacity = "1";
  liftEl.style.transform = `translate3d(0, ${(-pose.h * lift).toFixed(2)}px, 0) scale(${(1 + 0.26 * pose.h).toFixed(4)})`;
  coin.style.transform = `rotateX(${pose.ang.toFixed(2)}deg) rotateY(${pose.ry.toFixed(2)}deg) rotateZ(${pose.rz.toFixed(2)}deg)`;
  if (shadow) {
    // On the floor: smaller and lighter the higher the coin is.
    shadow.style.opacity = (0.95 * (1 - 0.75 * pose.h)).toFixed(3);
    shadow.style.transform = `scale(${(1 - 0.5 * pose.h + pose.contact * 0.08).toFixed(3)}, ${(1 - 0.5 * pose.h).toFixed(3)})`;
  }
  const light = coinLight(pose.ang);
  if (frontShade) frontShade.style.opacity = light.frontShade.toFixed(3);
  if (backShade) backShade.style.opacity = light.backShade.toFixed(3);
  if (frontGlint) frontGlint.style.opacity = light.frontGlint.toFixed(3);
  if (backGlint) backGlint.style.opacity = light.backGlint.toFixed(3);
  const shift = `translateX(${light.shift.toFixed(1)}%)`;
  if (frontGlint) frontGlint.style.transform = shift;
  if (backGlint) backGlint.style.transform = shift;
}

function hideCoin(parts: Parts): void {
  if (parts.lift) parts.lift.style.opacity = "0";
  if (parts.shadow) parts.shadow.style.opacity = "0";
}

/** The coin is sized from the screen: a diameter, and how high a toss rises. */
function sizeStage(parts: Parts, size: { lift: number }): void {
  const root = parts.root;
  if (!root) return;
  const { clientWidth: width, clientHeight: height } = root;
  if (width <= 0 || height <= 0) return;
  const d = Math.round(Math.max(150, Math.min(height * 0.34, width * 0.34, 300)));
  root.style.setProperty("--d", `${d}px`);
  size.lift = Math.round(height * 0.28);
}

function stepKey(step: CoinStep): string {
  return `${step.eventId}:${step.index}`;
}

/* ---------- the layer ---------- */

const EMPTY_PARTS: Parts = {
  root: null, lift: null, coin: null, shadow: null, burst: null, frontShade: null, frontGlint: null, backShade: null, backGlint: null,
};

export function CoinTossFx({ events, duelKey, reducedMotion, replayFrom = null, skipThrough = null, passive = false }: CoinTossFxProps): ReactElement {
  const [shown, setShown] = useState(false);
  const [out, setOut] = useState(false);
  const [view, setView] = useState<CoinView>(EMPTY_VIEW);
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const liftRef = useRef<HTMLDivElement>(null);
  const coinRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const burstRef = useRef<HTMLDivElement>(null);
  const frontShadeRef = useRef<HTMLDivElement>(null);
  const frontGlintRef = useRef<HTMLDivElement>(null);
  const backShadeRef = useRef<HTMLDivElement>(null);
  const backGlintRef = useRef<HTMLDivElement>(null);

  const cursorRef = useRef<number | null>(null);
  const keyRef = useRef(duelKey);
  const replayRef = useRef(replayFrom);
  replayRef.current = replayFrom;
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  const passiveRef = useRef(passive);
  passiveRef.current = passive;

  const plansRef = useRef<CoinEventPlan[]>([]);
  const segmentsRef = useRef<CoinSegment[]>([]);
  const logReleasesRef = useRef(new Map<number, () => void>());
  const lockReleaseRef = useRef<(() => void) | null>(null);
  const playingReleaseRef = useRef<(() => void) | null>(null);
  const rateReleasesRef = useRef<Array<() => void>>([]);
  const frameRef = useRef<number | null>(null);
  const safetyRef = useRef<number | null>(null);
  const shownRef = useRef(false);
  const outRef = useRef(false);
  const viewKeyRef = useRef("");
  const drawnRef = useRef<string | null>(null);
  const landedRef = useRef<string | null>(null);
  const sizeRef = useRef({ lift: 200 });

  const parts = (): Parts => ({
    root: rootRef.current,
    lift: liftRef.current,
    coin: coinRef.current,
    shadow: shadowRef.current,
    burst: burstRef.current,
    frontShade: frontShadeRef.current,
    frontGlint: frontGlintRef.current,
    backShade: backShadeRef.current,
    backGlint: backGlintRef.current,
  });

  useEffect(() => {
    setMounted(true);
    // The two faces are fixed art: load them now, so the first flip never shows an empty medal.
    if (typeof Image !== "undefined") {
      for (const face of ["heads", "tails"] as const) {
        const image = new Image();
        image.src = COIN_FACES[face].src;
      }
    }
  }, []);

  /** Gives back everything the layer holds: the lock, the log lines, the rate lease and the timers. */
  const finishAll = () => {
    if (frameRef.current != null) duelFxClock.cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (safetyRef.current != null) window.clearTimeout(safetyRef.current);
    safetyRef.current = null;
    for (const release of logReleasesRef.current.values()) release();
    logReleasesRef.current.clear();
    for (const release of rateReleasesRef.current) release();
    rateReleasesRef.current = [];
    plansRef.current = [];
    segmentsRef.current = [];
    drawnRef.current = null;
    landedRef.current = null;
    viewKeyRef.current = "";
    shownRef.current = false;
    outRef.current = false;
    // The lock goes last: by now the cover is leaving and every held line shows.
    lockReleaseRef.current?.();
    lockReleaseRef.current = null;
    playingReleaseRef.current?.();
    playingReleaseRef.current = null;
    setShown(false);
    setOut(false);
    setView(EMPTY_VIEW);
  };
  const finishRef = useRef(finishAll);
  finishRef.current = finishAll;

  const tick = () => {
    frameRef.current = null;
    try {
      const segments = segmentsRef.current;
      if (segments.length === 0) return;
      const now = duelFxClock.now();
      const end = segments[segments.length - 1].end;
      if (now >= end) {
        finishRef.current();
        return;
      }
      // A result may show in the log once its last coin has landed (also when frames were missed).
      for (const plan of plansRef.current) {
        if (now >= plan.finalLandAt) {
          const release = logReleasesRef.current.get(plan.eventId);
          if (release) {
            logReleasesRef.current.delete(plan.eventId);
            release();
          }
        }
      }
      const frame = frameAt(segments, now);
      const visible = now >= segments[0].start;
      if (visible && !shownRef.current) {
        shownRef.current = true;
        setShown(true);
      }
      const leaving = now >= end - COIN_TIMING.outroMs;
      if (leaving !== outRef.current) {
        outRef.current = leaving;
        setOut(leaving);
      }
      if (visible) {
        draw(frame, now);
        const key = viewKeyOf(frame);
        if (key !== viewKeyRef.current) {
          viewKeyRef.current = key;
          setView(coinView(frame, plansRef.current));
        }
      }
    } catch (error) {
      // A picture that cannot run must never keep the duel locked.
      reportDuelClientError(error);
      finishRef.current();
      return;
    }
    frameRef.current = duelFxClock.requestAnimationFrame(tick);
  };

  const viewKeyOf = (frame: CoinFrame): string => {
    // The view changes when the coin lands (label on), and when its label leaves; the spin changes nothing in it.
    if (frame.phase === "step") return `s:${stepKey(frame.step)}:${frame.stage === "hold" ? "hold" : frame.stage === "outro" ? "outro" : "pre"}`;
    if (frame.phase === "summary") return `u:${frame.summary.eventId}:${frame.stage === "out" ? "out" : "on"}`;
    return frame.phase;
  };

  const draw = (frame: CoinFrame, now: number) => {
    const els = parts();
    if (!els.lift || !els.coin) return;
    if (frame.phase !== "step") {
      hideCoin(els);
      drawnRef.current = null;
      return;
    }
    const { step } = frame;
    const key = stepKey(step);
    if (drawnRef.current !== key) {
      // A new coin: reset to the heads face, invisible, and size the stage.
      drawnRef.current = key;
      landedRef.current = null;
      sizeStage(els, sizeRef.current);
      resetCoin(els, step.reduced ? step.face : "heads");
      els.lift.style.opacity = "0";
      if (els.shadow) els.shadow.style.opacity = "0";
    }
    const spec = coinSpec(step.face, step.index);
    if (frame.stage === "fade") {
      const s = Math.min(1, Math.max(0, frame.at / step.fadeInMs));
      els.lift.style.opacity = String(s);
      if (els.shadow && !step.reduced) els.shadow.style.opacity = String(0.95 * s);
      return;
    }
    if (step.reduced) {
      els.lift.style.opacity = "1";
    } else if (frame.stage === "flip") {
      applyPose(els, coinPose(now - step.flipAt, spec, step.airMs), sizeRef.current.lift);
    } else {
      // The coin has stopped: the last pose, once, then the glow of the landing.
      if (landedRef.current !== key) {
        applyPose(els, coinPose(step.airMs + COIN_TIMING.hop1Ms + COIN_TIMING.hop2Ms, spec, step.airMs), sizeRef.current.lift);
        els.coin.classList.add(styles.landed);
        if (els.burst) {
          els.burst.classList.remove(styles.burstOn);
          void els.burst.offsetWidth;
          els.burst.classList.add(styles.burstOn);
        }
      }
    }
    if (frame.stage === "hold" || frame.stage === "outro") landedRef.current = key;
  };

  /** A new toss event: lock, hold the log line, the next prompt and the chain, and queue its steps. */
  const enqueue = (tosses: readonly DuelEvent[], all: readonly DuelEvent[]) => {
    const now = duelFxClock.now();
    let added = false;
    for (const event of tosses) {
      let requested = now;
      // The coin starts after the chain beat of the link that tosses, so its badge is read first.
      let resolving: DuelEvent | undefined;
      for (const candidate of all) {
        if (candidate.kind === "chain-resolving" && candidate.id < event.id && (!resolving || candidate.id > resolving.id)) resolving = candidate;
      }
      const beat = resolving ? chainBeatAt(resolving.id) : 0;
      if (beat > 0) requested = Math.max(requested, beat + COIN_TIMING.chainLeadMs);
      const last = segmentsRef.current[segmentsRef.current.length - 1];
      const startAt = queueStart(requested, last && last.end > now ? last.end : null);
      const plan = planCoinToss(event, startAt, reducedRef.current);
      if (!plan) continue;
      plansRef.current.push(plan);
      segmentsRef.current.push(...plan.segments);
      logReleasesRef.current.set(event.id, holdTossLog(event.id));
      rateReleasesRef.current.push(duelFxClock.retain(plan.end - now));
      if (!passiveRef.current) {
        // The next prompt and the next chain beat wait for the last result.
        holdPromptReveal(plan.end - now);
        holdChainAfter(event.id, plan.end);
        // Moves and markers laid out after this layer (bot moves too) start once the last result is gone.
        holdEffectSequenceUntil(plan.end);
      }
      added = true;
    }
    if (!added) return;
    // The playing flag is set in the replay too: its autoplay waits for the coin.
    if (!playingReleaseRef.current) playingReleaseRef.current = acquireCoinPlaying();
    if (!passiveRef.current && !lockReleaseRef.current) lockReleaseRef.current = acquireCoinLock();
    // Safety: if the picture cannot run (a hidden tab, an error), nothing stays locked past the plan.
    if (safetyRef.current != null) window.clearTimeout(safetyRef.current);
    const total = segmentsRef.current[segmentsRef.current.length - 1].end - now;
    safetyRef.current = window.setTimeout(() => finishRef.current(), duelFxClock.realMs(total) + COIN_TIMING.safetyMarginMs);
    if (frameRef.current == null) frameRef.current = duelFxClock.requestAnimationFrame(tick);
  };

  useLayoutEffect(() => {
    if (keyRef.current !== duelKey) {
      keyRef.current = duelKey;
      cursorRef.current = null;
      finishRef.current();
    }
    if (skipThrough != null) cursorRef.current = Math.max(cursorRef.current ?? skipThrough, skipThrough);
    if (cursorRef.current == null) {
      cursorRef.current = replayRef.current ?? maxEventId(events) ?? 0;
      if (replayRef.current == null) return;
    }
    const { nextCursor, fresh } = collectFreshEvents(events, cursorRef.current);
    cursorRef.current = nextCursor;
    if (fresh.length === 0) return;
    // A hidden tab plays no picture; the toss is history when it returns.
    if (typeof document !== "undefined" && document.hidden) return;
    const tosses = fresh.filter((event) => coinResults(event) != null);
    if (tosses.length > 0) enqueue(tosses, events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duelKey, events, skipThrough]);

  // Unmounting gives everything back. A remount (React strict mode) reads the events again from the end.
  useEffect(
    () => () => {
      finishRef.current();
      cursorRef.current = null;
    },
    [],
  );

  const sizeNow = () => {
    sizeStage(parts(), sizeRef.current);
  };
  useLayoutEffect(() => {
    if (!shown) return undefined;
    sizeNow();
    window.addEventListener("resize", sizeNow);
    return () => window.removeEventListener("resize", sizeNow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const tray = view.tray;
  const verdict = view.verdict;
  const summary = view.summary;
  const cover = shown && mounted && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={rootRef}
        className={`${styles.root} ${duelFontClasses}`}
        data-testid="coin-toss"
        data-state={out ? "out" : "in"}
        data-rm={reducedMotion ? "true" : "false"}
        data-passive={passive ? "true" : "false"}
        aria-hidden="true"
      >
        <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
          <filter id="duel-coin-emboss" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feConvolveMatrix order="3" kernelMatrix="-2 -1 0 -1 1 1 0 1 2" divisor="1" bias="0.5" preserveAlpha="true" />
          </filter>
        </svg>
        {tray ? (
          <div className={styles.tray}>
            <span className={styles.trayName}>{tray.name}</span>
            <span className={styles.chips}>
              {tray.faces.map((face, index) => face
                ? <Chip key={index} face={face} label={chipLabel(face)} />
                : <span key={index} className={styles.chip}>{index + 1}</span>)}
            </span>
          </div>
        ) : null}
        <div className={styles.stage}>
          <div className={styles.pad} />
          <div ref={shadowRef} className={styles.shadow} />
          <div className={styles.scene}>
            <div ref={liftRef} className={styles.lift}>
              <div ref={burstRef} className={styles.burst} />
              <div ref={coinRef} className={styles.coin}>
                {RIM.map((piece) => (
                  <i key={piece.angle} className={styles.rimpiece} style={{ "--a": `${piece.angle}deg`, "--c": piece.color } as CSSProperties} />
                ))}
                <Face face="heads" side="front" shadeRef={frontShadeRef} glintRef={frontGlintRef} />
                <Face face="tails" side="back" shadeRef={backShadeRef} glintRef={backGlintRef} />
              </div>
            </div>
          </div>
        </div>
        <div className={`${styles.verdict} ${verdict?.on ? styles.verdictOn : ""}`} data-face={verdict?.face ?? "heads"}>
          <small>{verdict?.kick ?? ""}</small>
          <b>{verdict ? COIN_FACES[verdict.face].word : ""}</b>
          <span>{verdict ? COIN_FACES[verdict.face].name : ""}</span>
        </div>
        <div className={`${styles.summary} ${summary?.on ? styles.summaryOn : ""}`}>
          <small>{summary?.kick ?? ""}</small>
          <div className={styles.sChips}>{summary?.results.map((face, index) => <Chip key={index} face={face} label={chipLabel(face)} />)}</div>
          <b>{summary ? summaryText(summary.results) : ""}</b>
          <span>{summary?.counts ?? ""}</span>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      {/* The result is read out when the coin has landed, never before. */}
      <div className={styles.sr} role="status" aria-live="polite" data-testid="coin-toss-live">{view.live}</div>
      {cover}
    </>
  );
}
