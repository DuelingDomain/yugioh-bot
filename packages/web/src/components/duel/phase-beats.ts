/**
 * The phase beats of a turn start. The server announces Draw Phase, Standby Phase and Main Phase 1 as
 * events (the opening of the duel too: first the cards of both hands are dealt, then the three phases).
 * They reach the browser in one batch with the first prompt, so this module spreads them over time:
 *
 *   - each phase is "presented" for one beat (PHASE_TIMING.beatMs), in order, and lights the phase bar;
 *   - a phase starts after the card flights that come before it have landed (the opening deal, the draw
 *     of a turn), so the draw happens in the Draw Phase and the Standby Phase follows the landed card;
 *   - the player is held (no actions, no prompt panel) until the Main Phase 1 beat begins, or, when the
 *     batch ends in a Draw or Standby Phase (a response window is open there), until that beat is over.
 *
 * A turn start can arrive in pieces: a response window in the Draw Phase stops the engine there, and the
 * Standby Phase and Main Phase 1 come later, after the answer. The phase before the batch (found in the
 * events that are older than the cursor) tells a lone Standby Phase or Main Phase 1 that it belongs to a
 * turn start. Battle, Main Phase 2 and End Phase are not beats: they show at once, as before.
 *
 * The plan is a pure function of the events, the clock and the landing times of the card flights, and it
 * is memoised per event id, so whichever layer sees a batch first plans it and the others read it.
 * Timestamps are performance.now() values, the same clock as move-plan.ts.
 */
import type { DuelEvent } from "@yugidraft/shared/duels";
import { PHASE_TIMING } from "./duel-timing";
import { getMovePlan } from "./move-plan";

export type PhaseKey = "draw" | "standby" | "main1" | "battle" | "main2" | "end";

/** The phase an announced phase event stands for ("Main Phase 1" -> "main1"), or null for unknown text. */
export function phaseKeyOfText(text: string): PhaseKey | null {
  const t = text.trim().toLowerCase();
  if (/^draw\b/.test(t)) return "draw";
  if (/^standby\b/.test(t)) return "standby";
  if (/^main\s*(phase\s*)?1\b/.test(t)) return "main1";
  if (/^main\s*(phase\s*)?2\b/.test(t)) return "main2";
  if (/^battle\b/.test(t)) return "battle";
  if (/^end\b/.test(t)) return "end";
  return null;
}

export type PhaseBeat = {
  /** The phase event this beat presents. */
  id: number;
  phase: PhaseKey;
  /** When the phase lights on the bar and its ribbon starts. */
  startAt: number;
  endAt: number;
};

export type PhaseBeatPlan = {
  beats: PhaseBeat[];
  /** What the bar keeps showing until the first beat starts (null: nothing is lit yet, the opening deal). */
  holdPhase: PhaseKey | null;
  /** The player may act from here. */
  releaseAt: number;
};

export type PlanPhaseOptions = {
  now: number;
  reduced: boolean;
  duelKey: string;
  /**
   * When the card flight of a move event has landed (and its hold is over), or null when the move is not
   * drawn. Defaults to the move plan (move-plan.ts).
   */
  landAtOf?: (event: DuelEvent) => number | null;
};

const plans = new Map<number, PhaseBeatPlan>();
const beats = new Map<number, PhaseBeat>();
const state = { key: "", busyUntil: 0 };

export function resetPhaseBeats(key = ""): void {
  plans.clear();
  beats.clear();
  state.key = key;
  state.busyUntil = 0;
}

/** The beat of this phase event, if it was planned. */
export function getPhaseBeat(id: number): PhaseBeat | null {
  return beats.get(id) ?? null;
}

function defaultLandAt(event: DuelEvent): number | null {
  const plan = getMovePlan(event.id);
  return plan ? plan.landAt + plan.holdMs : null;
}

/**
 * True when the first view of a duel is its very start: nothing has been answered yet and the events
 * hold the deal and the phases of turn 1. The layers then replay those events instead of dropping them
 * as history, so the player sees the hands dealt and the phases pass.
 */
export function isOpeningView(view: { revision: number; turn: number; events: readonly DuelEvent[] }): boolean {
  if (view.revision !== 0 || view.turn > 1) return false;
  return view.events.some((event) => event.kind === "phase" || (event.kind === "move" && event.reason === "draw"));
}

/**
 * Plans the beats of the turn-start phases in the events newer than `cursor`. Returns null when the
 * batch has none. Safe to call again with the same batch (the first plan is returned).
 */
export function planPhaseBeats(events: readonly DuelEvent[], cursor: number, options: PlanPhaseOptions): PhaseBeatPlan | null {
  const { now, reduced, duelKey } = options;
  const landAtOf = options.landAtOf ?? defaultLandAt;
  if (state.key !== duelKey) resetPhaseBeats(duelKey);

  const seen = new Set<number>();
  const sorted: DuelEvent[] = [];
  for (const event of events) {
    if (typeof event.id !== "number" || seen.has(event.id)) continue;
    seen.add(event.id);
    sorted.push(event);
  }
  sorted.sort((a, b) => a.id - b.id);
  let previous: PhaseKey | null = null;
  const fresh: DuelEvent[] = [];
  for (const event of sorted) {
    if (event.id <= cursor) {
      if (event.kind === "phase") previous = phaseKeyOfText(event.text) ?? previous;
    } else {
      fresh.push(event);
    }
  }

  // The phases that belong to a turn start: Draw and Standby, and the Main Phase 1 that ends the run.
  let inRun = previous === "draw" || previous === "standby";
  const run: Array<{ event: DuelEvent; phase: PhaseKey }> = [];
  for (const event of fresh) {
    if (event.kind !== "phase") continue;
    const phase = phaseKeyOfText(event.text);
    if (phase === "draw" || phase === "standby") {
      run.push({ event, phase });
      inRun = true;
    } else if (phase === "main1" && inRun) {
      run.push({ event, phase });
      inRun = false;
    } else {
      inRun = false;
    }
  }
  if (run.length === 0) return null;
  const known = plans.get(run[0].event.id);
  if (known) return known;

  let holdPhase: PhaseKey | null = previous;
  for (const event of fresh) {
    if (event.id >= run[0].event.id) break;
    if (event.kind === "phase") holdPhase = phaseKeyOfText(event.text) ?? holdPhase;
  }

  const length = reduced ? PHASE_TIMING.reducedBeatMs : PHASE_TIMING.beatMs;
  const planned: PhaseBeat[] = [];
  run.forEach((item, index) => {
    const after = index === 0 ? -Infinity : run[index - 1].event.id;
    // Every card that moves between the last phase and this one has landed before this one starts.
    let ready = 0;
    for (const event of fresh) {
      if (event.kind !== "move" || event.id <= after || event.id >= item.event.id) continue;
      const landAt = landAtOf(event);
      if (landAt != null) ready = Math.max(ready, landAt + PHASE_TIMING.afterMovesMs);
    }
    const startAt = Math.max(now, index === 0 ? state.busyUntil : planned[index - 1].endAt, ready);
    planned.push({ id: item.event.id, phase: item.phase, startAt, endAt: startAt + length });
  });

  const last = planned[planned.length - 1];
  const releaseAt = Math.min(
    last.phase === "main1" ? last.startAt + PHASE_TIMING.releaseLeadMs : last.endAt,
    now + PHASE_TIMING.capMs,
  );
  const plan: PhaseBeatPlan = { beats: planned, holdPhase, releaseAt };
  for (const beat of planned) {
    beats.set(beat.id, beat);
    plans.set(beat.id, plan);
  }
  state.busyUntil = last.endAt;
  return plan;
}
