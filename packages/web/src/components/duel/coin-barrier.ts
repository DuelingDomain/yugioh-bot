// The coin barrier: what happens AFTER a coin toss waits until its last result is gone.
//
// A snapshot brings the toss and what follows it (an attack, a halved LP, a destroy) in one batch. The
// picture of the coin (coin-toss-fx.tsx) plays at once, so a layer that has no hold of its own would
// start behind the dim cover and the board would jump ahead. Moves, markers, chain beats and prompts
// already wait (effect-sequence.ts, chain-beats.ts, prompt-reveal.ts). The battle play and the LP roll
// ask this file: "when may an event that follows toss N start?" An LP change has no event of its own
// (an engine LP update, like the halving of Jirai Gumo, comes as a new value only), so the LP counter asks
// "is a coin on?" and waits for it, whatever seat changed and whatever batch it came in.
//
// The plan of a toss is made here, once, and the coin picture plays that same plan, so the barrier and
// the picture cannot drift. Planning is lazy: the first layer that asks after the render pass makes it,
// because the chain beats (the coin starts after the badge of its link) are planned during that pass.
// A toss whose chain beat is not planned yet is not planned either while only the render pass asks: it
// answers "no barrier" and is tried again at the next question. Layout effects, timers and the picture
// ask with `force`: by then every chain beat is planned, so a missing beat means there is none.
//
// Every barrier ends at its plan end, so a picture that fails or a hidden tab cannot hold the duel for
// longer than the plan; the picture also lets go early (releaseCoinBarriers) when it ends or errors.
import type { DuelEvent } from "@yugidraft/shared/duels";
import { chainBeatAt } from "./chain-beats";
import { COIN_TIMING, coinResults, planCoinToss, queueStart, type CoinEventPlan } from "./coin-plan";
import { duelFxClock } from "./fx-clock";

type Entry = { event: DuelEvent; all: readonly DuelEvent[]; reduced: boolean; plan: CoinEventPlan | null };

const entries = new Map<number, Entry>();
let queueEnd = 0;
const listeners = new Set<() => void>();
const KEEP_MS = 60_000;

/** The resolving beat of the link that tosses: the coin starts after it. */
function resolvingBefore(event: DuelEvent, all: readonly DuelEvent[]): DuelEvent | undefined {
  let resolving: DuelEvent | undefined;
  for (const candidate of all) {
    if (candidate.kind === "chain-resolving" && candidate.id < event.id && (!resolving || candidate.id > resolving.id)) resolving = candidate;
  }
  return resolving;
}

/** The earliest start of a toss on its own: now, or after the chain beat of its link. */
export function coinRequestedStart(event: DuelEvent, all: readonly DuelEvent[], now: number): number {
  const resolving = resolvingBefore(event, all);
  const beat = resolving ? chainBeatAt(resolving.id) : 0;
  return beat > 0 ? Math.max(now, beat + COIN_TIMING.chainLeadMs) : now;
}

/** Make the plans of the tosses that have none, in engine order. */
function resolve(force = false): void {
  const now = duelFxClock.now();
  for (const [id, entry] of entries) {
    if (entry.plan && entry.plan.end < now - KEEP_MS) entries.delete(id);
  }
  const waiting = [...entries.values()].filter((entry) => entry.plan == null).sort((a, b) => a.event.id - b.event.id);
  for (const entry of waiting) {
    const resolving = resolvingBefore(entry.event, entry.all);
    // The chain beats of this batch are planned in the render pass: until then the start is not known.
    // Stop here: a later toss is never planned before an earlier one.
    if (!force && resolving && chainBeatAt(resolving.id) === 0) break;
    const requested = coinRequestedStart(entry.event, entry.all, now);
    const plan = planCoinToss(entry.event, queueStart(requested, queueEnd > now ? queueEnd : null), entry.reduced);
    if (!plan) {
      entries.delete(entry.event.id);
      continue;
    }
    entry.plan = plan;
    queueEnd = Math.max(queueEnd, plan.end);
  }
}

/** A live coin toss was seen (render phase is fine: noting is idempotent). */
export function noteCoinToss(event: DuelEvent, all: readonly DuelEvent[], reduced: boolean): void {
  if (coinResults(event) == null || entries.has(event.id)) return;
  entries.set(event.id, { event, all, reduced, plan: null });
}

/**
 * The plan of this toss (the picture plays it). `force` plans a toss whose chain beat is not planned
 * (no chain layer on this screen): the picture must never be lost. Without it, null means "not yet".
 */
export function coinPlanOf(eventId: number, force = false): CoinEventPlan | null {
  resolve(force);
  return entries.get(eventId)?.plan ?? null;
}

/** True when a toss that comes before this event is known, planned or not. */
export function coinTossBefore(eventId: number): boolean {
  for (const [id, entry] of entries) if (id < eventId && (entry.plan == null || entry.plan.end > duelFxClock.now())) return true;
  return false;
}

/**
 * The time (duelFxClock.now() stamp) before which the event with this id may not start: the end of the
 * last toss before it that is still on. 0 when nothing holds it. `force`: see the header.
 */
export function coinBarrierFor(eventId: number, force = false): number {
  resolve(force);
  const now = duelFxClock.now();
  let until = 0;
  for (const [id, entry] of entries) {
    if (id < eventId && entry.plan && entry.plan.end > now) until = Math.max(until, entry.plan.end);
  }
  return until;
}

/**
 * How long an LP change that lands now waits for the coins: the time to the end of the last toss that is
 * still on, 0 when none is. Asked from a layout effect, so every toss of the commit is known.
 */
export function coinLpWaitMs(): number {
  resolve(true);
  const now = duelFxClock.now();
  let until = 0;
  for (const entry of entries.values()) if (entry.plan && entry.plan.end > now) until = Math.max(until, entry.plan.end);
  return Math.max(0, until - now);
}

/**
 * Runs `fn` once no toss holds the event with this id. The question is asked again when the timer fires
 * and when the barriers are released, so a barrier that ends early (the picture failed) lets go at once.
 * Returns a function that cancels the wait.
 */
export function whenCoinBarrierClears(eventId: number, fn: () => void): () => void {
  let timer: number | undefined;
  let done = false;
  const release = () => {
    done = true;
    if (timer != null) duelFxClock.clearTimeout(timer);
    timer = undefined;
    listeners.delete(check);
  };
  const check = () => {
    if (done) return;
    if (timer != null) { duelFxClock.clearTimeout(timer); timer = undefined; }
    const wait = coinBarrierFor(eventId, true) - duelFxClock.now();
    if (wait > 8) {
      timer = duelFxClock.setTimeout(check, wait);
      return;
    }
    release();
    fn();
  };
  listeners.add(check);
  check();
  return release;
}

/**
 * The picture ended (or failed): nothing waits for its plan any more. One waiter that throws must not
 * keep the others (or the caller) from going on.
 */
export function releaseCoinBarriers(): void {
  entries.clear();
  queueEnd = 0;
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error("coin barrier waiter failed", error);
    }
  }
}

/** Test helper: forget everything. */
export function resetCoinBarriers(): void {
  entries.clear();
  queueEnd = 0;
  listeners.clear();
}
