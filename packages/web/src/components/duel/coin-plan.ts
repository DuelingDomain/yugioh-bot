// The coin toss, as pure data: faces, timings, the pose of the coin at a moment, and the plan of one
// toss event. The picture (coin-toss-fx.tsx) only draws what this file says; times are in ms at 1x on
// the duel FX clock (duelFxClock), which already carries the speed setting.
// Ported from the approved demo (.fx-demo/coin-flip/demo.js). Keep the numbers in step with it.
import type { DuelEvent } from "@yugidraft/shared/duels";

export type CoinFace = "heads" | "tails";

/** Both faces are fixed art: Blue-Eyes White Dragon is heads, Dark Magician is tails. */
export const COIN_FACES: Record<CoinFace, { word: string; label: string; code: number; name: string; ring: string; src: string }> = {
  heads: { word: "HEADS", label: "Heads", code: 89631139, name: "Blue-Eyes White Dragon", ring: "BLUE-EYES WHITE DRAGON", src: "/duel/coin/89631139.jpg" },
  tails: { word: "TAILS", label: "Tails", code: 46986414, name: "Dark Magician", ring: "DARK MAGICIAN", src: "/duel/coin/46986414.jpg" },
};

export const COIN_TIMING = {
  /** The coin appears on the floor. */
  fadeInMs: 220,
  /** Launch, flip, fall. */
  airMs: 1050,
  /** First bounce. */
  hop1Ms: 260,
  /** Second, small bounce, then still. */
  hop2Ms: 190,
  /** The landed face stays and the label shows. */
  holdMs: 1200,
  /** The label goes out. */
  outroMs: 260,
  /** Reduced motion: the coin fades to its face. */
  reducedFadeMs: 260,
  /** The summary after more than one toss: in, hold, out. */
  summaryInMs: 260,
  summaryHoldMs: 1000,
  summaryOutMs: 260,
  /** The coin waits this long after the chain beat of its link, so the link badge is read first. */
  chainLeadMs: 450,
  /** A second toss event queues behind the first by this gap. */
  gapMs: 500,
  /** Safety: the input block is released this long after the plan should have ended, if the picture did not report. */
  safetyMarginMs: 1500,
} as const;

/** From the fifth coin on, the fade, the hand-off and the air time shrink after the second coin (the hold stays). */
export const COMPACT_FROM_COUNT = 5;
export const COMPACT_AFTER_INDEX = 2;
const COMPACT = { fadeInMs: 110, airMs: 750, outroMs: 140 } as const;

export const COIN_FLIP_MS = COIN_TIMING.airMs + COIN_TIMING.hop1Ms + COIN_TIMING.hop2Ms;

export type CoinStep = {
  kind: "toss";
  eventId: number;
  index: number;
  count: number;
  face: CoinFace;
  fadeInMs: number;
  airMs: number;
  /** Absolute start (the FX clock). */
  start: number;
  /** The flip starts (after the fade; the fade is the whole step in reduced motion). */
  flipAt: number;
  /** The coin has stopped: the label and the result show. */
  landAt: number;
  /** The label goes out. */
  holdEnd: number;
  /** The step is over (the coin stays up until the next step resets it). */
  end: number;
  reduced: boolean;
};

export type CoinSummary = {
  kind: "summary";
  eventId: number;
  results: CoinFace[];
  /** Absolute start. */
  start: number;
  /** The summary starts to leave. */
  holdEnd: number;
  end: number;
};

export type CoinSegment = CoinStep | CoinSummary;

export type CoinEventPlan = {
  eventId: number;
  results: CoinFace[];
  /** The card that tossed, when the event names one. */
  source: { code: number; name: string } | null;
  segments: CoinSegment[];
  start: number;
  end: number;
  /** The last result has landed: the log line may show. */
  finalLandAt: number;
};

/** The results of a toss event as faces; null when the event is not a coin toss with results. */
export function coinResults(event: Pick<DuelEvent, "kind" | "toss">): CoinFace[] | null {
  if (event.kind !== "toss" || event.toss?.type !== "coin") return null;
  const results = event.toss.results.filter((face): face is CoinFace => face === "heads" || face === "tails");
  return results.length > 0 ? results : null;
}

/** The name the summary shows for the card that tossed. */
export function coinSource(event: Pick<DuelEvent, "card" | "sourceCode">): CoinEventPlan["source"] {
  const code = event.card?.code ?? event.sourceCode;
  const name = event.card?.name;
  return code != null && code > 0 && name ? { code, name } : null;
}

function stepOf(eventId: number, index: number, count: number, face: CoinFace, start: number, reduced: boolean): CoinStep {
  const compact = !reduced && count >= COMPACT_FROM_COUNT && index >= COMPACT_AFTER_INDEX;
  const fadeInMs = reduced ? COIN_TIMING.reducedFadeMs : compact ? COMPACT.fadeInMs : COIN_TIMING.fadeInMs;
  const airMs = compact ? COMPACT.airMs : COIN_TIMING.airMs;
  const outroMs = compact ? COMPACT.outroMs : COIN_TIMING.outroMs;
  const flipAt = start + fadeInMs;
  const landAt = reduced ? flipAt : flipAt + airMs + COIN_TIMING.hop1Ms + COIN_TIMING.hop2Ms;
  const holdEnd = landAt + COIN_TIMING.holdMs;
  return { kind: "toss", eventId, index, count, face, fadeInMs, airMs, start, flipAt, landAt, holdEnd, end: holdEnd + outroMs, reduced };
}

/**
 * The whole presentation of one toss event, one step per result in engine order, then (for more
 * than one result) the summary. A step starts when the one before has ended, so two coins never show
 * at the same time and a result shows only after its coin has stopped.
 */
export function planCoinToss(
  event: Pick<DuelEvent, "id" | "kind" | "toss" | "card" | "sourceCode">,
  startAt: number,
  reduced: boolean,
): CoinEventPlan | null {
  const results = coinResults(event);
  if (!results) return null;
  const segments: CoinSegment[] = [];
  let at = startAt;
  results.forEach((face, index) => {
    const step = stepOf(event.id, index, results.length, face, at, reduced);
    segments.push(step);
    at = step.end;
  });
  const finalLandAt = (segments[segments.length - 1] as CoinStep).landAt;
  if (results.length > 1) {
    const holdEnd = at + COIN_TIMING.summaryInMs + COIN_TIMING.summaryHoldMs;
    segments.push({ kind: "summary", eventId: event.id, results, start: at, holdEnd, end: holdEnd + COIN_TIMING.summaryOutMs });
    at = holdEnd + COIN_TIMING.summaryOutMs;
  }
  return { eventId: event.id, results, source: coinSource(event), segments, start: startAt, end: at, finalLandAt };
}

/** A plan that begins after another one: the same toss, `gapMs` later than the end of the plan before. */
export function queueStart(requested: number, previousEnd: number | null): number {
  return previousEnd == null ? requested : Math.max(requested, previousEnd + COIN_TIMING.gapMs);
}

/* ---------- the pose: one pure function of time ---------- */

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (s: number) => s * s * (3 - 2 * s);
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

export type CoinSpec = {
  /** Degrees: whole turns, plus 180 for tails. */
  final: number;
  /** Signed degrees of the first lean. */
  lean: number;
  /** +1 or -1: the side the coin wobbles to. */
  side: 1 | -1;
};

export type CoinPose = { h: number; ang: number; ry: number; rz: number; contact: number };

/** 3 or 4 full turns, so tosses differ; the side alternates. */
export function coinSpec(face: CoinFace, index: number): CoinSpec {
  const turns = 3 + ((index + (face === "tails" ? 1 : 0)) % 2);
  return { final: turns * 360 + (face === "tails" ? 180 : 0), lean: 15, side: index % 2 ? -1 : 1 };
}

/** The coin at `t` ms into its flip (0 to COIN_FLIP_MS). `airMs` is the air time of this step. */
export function coinPose(t: number, spec: CoinSpec, airMs: number = COIN_TIMING.airMs): CoinPose {
  const { hop1Ms, hop2Ms } = COIN_TIMING;
  const F = spec.final;
  let h = 0;
  let ang = 0;
  let ry = 0;
  let rz = 0;
  let contact = 0;
  if (t < airMs) {
    const s = t / airMs;
    h = 4 * s * (1 - s);
    const e = 0.8 * s + 0.2 * (1 - (1 - s) * (1 - s));
    ang = (F + spec.lean) * e;
    const env = Math.sin(Math.PI * s);
    ry = spec.side * 13 * Math.sin(s * Math.PI * 3) * env;
    rz = spec.side * 7 * Math.sin(s * Math.PI * 2) * env;
  } else if (t < airMs + hop1Ms) {
    const s = (t - airMs) / hop1Ms;
    h = 0.1 * 4 * s * (1 - s);
    ang = F + lerp(spec.lean, -spec.lean * 0.38, smooth(s));
    rz = spec.side * 2 * (1 - s);
    contact = 1 - clamp01(s * 5);
  } else {
    const s = clamp01((t - airMs - hop1Ms) / hop2Ms);
    h = 0.032 * 4 * s * (1 - s);
    ang = F + lerp(-spec.lean * 0.38, 0, smooth(s));
    contact = 0.5 * (1 - clamp01(s * 5));
  }
  return { h, ang, ry, rz, contact };
}

/** The light on a face and the glint, from the angle: the faces go dark when they turn away. */
export function coinLight(ang: number): { frontShade: number; backShade: number; frontGlint: number; backGlint: number; shift: number } {
  const c = Math.cos((ang * Math.PI) / 180);
  const glint = (a: number) => 0.95 * Math.exp(-(((a - 0.8) / 0.11) ** 2));
  return {
    frontShade: c > 0 ? 0.62 * (1 - c) : 0,
    backShade: c < 0 ? 0.62 * (1 + c) : 0,
    frontGlint: c > 0 ? glint(c) : 0,
    backGlint: c < 0 ? glint(-c) : 0,
    shift: Math.sin((ang * Math.PI) / 180) * 50,
  };
}

/* ---------- where the plan is at a time ---------- */

export type CoinFrame =
  | { phase: "step"; step: CoinStep; /** ms from the step start */ at: number; stage: "fade" | "flip" | "hold" | "outro" }
  | { phase: "summary"; summary: CoinSummary; at: number; stage: "in" | "hold" | "out" }
  | { phase: "gap" }
  | { phase: "done" };

/** The segment that is on at `now`, over the segments of every queued plan (in order). */
export function frameAt(segments: readonly CoinSegment[], now: number): CoinFrame {
  for (const segment of segments) {
    if (now < segment.start) return { phase: "gap" };
    if (now < segment.end) {
      const at = now - segment.start;
      if (segment.kind === "summary") {
        return { phase: "summary", summary: segment, at, stage: now >= segment.holdEnd ? "out" : at < COIN_TIMING.summaryInMs ? "in" : "hold" };
      }
      const stage = now < segment.flipAt ? "fade" : now < segment.landAt ? "flip" : now < segment.holdEnd ? "hold" : "outro";
      return { phase: "step", step: segment, at, stage };
    }
  }
  return { phase: "done" };
}

/** The total length of a plan at 1x, from its first step to its end. */
export function planMs(plan: Pick<CoinEventPlan, "start" | "end">): number {
  return plan.end - plan.start;
}

/* ---------- what the label, the tray and the summary say at a time ---------- */

export type CoinView = {
  /** The pill at the top: the card that tossed and one chip per result (null until its coin has landed). */
  tray: { name: string; faces: Array<CoinFace | null> } | null;
  verdict: { face: CoinFace; kick: string; on: boolean } | null;
  summary: { results: CoinFace[]; kick: string; counts: string | null; on: boolean } | null;
  /** The screen reader text for this moment; empty when nothing is to be said. */
  live: string;
};

export const EMPTY_VIEW: CoinView = { tray: null, verdict: null, summary: null, live: "" };

export function summaryText(results: readonly CoinFace[]): string {
  return results.map((face) => COIN_FACES[face].label).join(", ");
}

export function coinView(frame: CoinFrame, plans: readonly CoinEventPlan[]): CoinView {
  if (frame.phase !== "step" && frame.phase !== "summary") return EMPTY_VIEW;
  const segment = frame.phase === "step" ? frame.step : frame.summary;
  const plan = plans.find((candidate) => candidate.eventId === segment.eventId);
  if (!plan) return EMPTY_VIEW;
  const name = plan.source?.name ?? "Coin toss";
  if (frame.phase === "step") {
    const { step } = frame;
    const landed = frame.stage === "hold" || frame.stage === "outro";
    const faces = plan.results.map((face, index) => (index < step.index || (index === step.index && landed) ? face : null));
    const on = frame.stage === "hold";
    const label = COIN_FACES[step.face].label;
    return {
      tray: { name, faces },
      verdict: { face: step.face, kick: step.count > 1 ? `Toss ${step.index + 1} of ${step.count}` : "Coin toss", on },
      summary: null,
      live: on ? (step.count > 1 ? `Toss ${step.index + 1}: ${label}` : label) : "",
    };
  }
  const { summary } = frame;
  const heads = summary.results.filter((face) => face === "heads").length;
  const on = frame.stage !== "out";
  return {
    tray: { name, faces: plan.results },
    verdict: null,
    summary: {
      results: summary.results,
      kick: plan.source ? `${plan.source.name}: ${summary.results.length} coin tosses` : `${summary.results.length} coin tosses`,
      counts: `${heads} heads, ${summary.results.length - heads} tails`,
      on,
    },
    live: on ? `Result: ${summaryText(summary.results)}` : "",
  };
}
