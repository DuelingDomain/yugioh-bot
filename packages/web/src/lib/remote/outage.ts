/**
 * A server restart or a dropped connection is not a refusal. This module tells the two apart, keeps ONE shared "reconnecting"
 * state for the table page, and retries a write through the outage with the same idempotency key (the server returns the saved
 * result for a key it has seen, so a lost reply never applies a move twice).
 */
const listeners = new Set<() => void>(), recovered = new Set<() => void>(), wakers = new Set<() => void>();
let down = false, waiting = 0, lost = 0, shown = false;

const refresh = () => { const next = down || waiting > 0; if (next !== shown) { shown = next; for (const l of [...listeners]) l(); } };

/** A network failure, a timeout, or a gateway answer (502/503/504) while the server restarts. */
export function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { transient?: boolean; status?: number; name?: string };
  return e.transient === true || e.name === "AbortError" || e.name === "TimeoutError"
    || error instanceof TypeError && /fetch|network|load failed|connection/i.test(error.message)
    || e.status === 502 || e.status === 503 || e.status === 504;
}
export const isGatewayStatus = (status: number) => status === 502 || status === 503 || status === 504;

/** A request could not reach the server (or was answered by the gateway). Raw detail goes to the console only. */
export function noteOutage(error?: unknown) {
  if (!down) console.warn("[remote] server not reachable, retrying", error instanceof Error ? error.message : error);
  down = true; refresh();
}
/** A request got a real answer from the server. Wakes every write that is waiting to retry. */
export function noteReachable() {
  if (!down) return;
  down = false; refresh();
  for (const w of [...wakers]) w();
  for (const r of [...recovered]) r();
}
/** A write (not a read) died on the connection and resolved to null. `retryThroughOutage` compares this count before and after one try. */
export const noteWriteLost = () => { lost++; };
export const outageDown = () => down;
export const reconnecting = () => shown;
export function subscribeReconnecting(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** Runs once each time the server is reachable again after an outage. */
export function onOutageEnd(listener: () => void) { recovered.add(listener); return () => { recovered.delete(listener); }; }
/** The socket came back: retry the waiting writes now instead of at the next backoff step. */
export function wakeOutage() { for (const w of [...wakers]) w(); }

/** The retry window ran out (or the caller does not wait). The write was not saved. */
export class OutageGaveUpError extends Error {
  readonly transient = true;
  constructor(message = "No connection to the table") { super(message); this.name = "OutageGaveUpError"; }
}
/** Returned instead of a result when `valid()` turned false while waiting: the work no longer applies. */
export const SKIPPED = Symbol("skipped");

export const OUTAGE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000];
export const OUTAGE_CAP_MS = 180_000;
const backoff = (i: number) => OUTAGE_BACKOFF_MS[Math.min(i, OUTAGE_BACKOFF_MS.length - 1)];

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); wakers.delete(done); resolve(); };
    const timer = setTimeout(done, ms); wakers.add(done);
  });
}

/**
 * Runs `attempt` (a write that resolves to null for a refusal AND for a transient failure, the second marked by `noteWriteLost`).
 * A result or a refusal returns at once. A transient failure waits and tries again with backoff (0.5, 1, 2, 4, 8 s, then every 8 s)
 * for about 3 minutes, so the caller must pass the same idempotency key on every try. `patient: false` gives up at the first
 * transient failure (background work is tried again by its own cycle). While waiting, the shared reconnecting state stays on.
 */
export async function retryThroughOutage<T>(attempt: () => Promise<T | null>, options: { valid?: () => boolean; patient?: boolean; capMs?: number } = {}): Promise<T | null | typeof SKIPPED> {
  const { valid, patient = true, capMs = OUTAGE_CAP_MS } = options;
  const once = async (): Promise<{ transient: boolean; value: T | null }> => {
    const before = lost;
    try { const value = await attempt(); return { transient: !value && lost !== before, value }; }
    catch (error) { if (!isTransientError(error)) throw error; noteOutage(error); noteWriteLost(); return { transient: true, value: null }; }
  };
  const first = await once();
  if (!first.transient) return first.value;
  if (!patient) throw new OutageGaveUpError();
  const started = Date.now();
  waiting++; refresh();
  try {
    for (let i = 0; ; i++) {
      if (Date.now() - started > capMs) throw new OutageGaveUpError();
      await sleep(backoff(i));
      if (valid && !valid()) return SKIPPED;
      const next = await once();
      if (!next.transient) return next.value;
    }
  } finally { waiting--; refresh(); }
}
