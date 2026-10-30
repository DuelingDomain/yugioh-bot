"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { getDeckCards } from "@/components/decks/api";
import { BridgeRequestError, fetchBridges, pollDeepSearch, startDeepSearch, type BridgeList, type BridgeScope, type DeepStep, type EngineSuggestion, type ShownBridge } from "./bridges-api";
import { DEEP_POLL_FAILURES, DEEP_POLL_MS, deepContextKey, deepWorkKey, readStore, scopeKey, secondsLeft, writeStore } from "./bridges-model";

/** Wait this long after the last deck change before asking again, like the other Suggestions rows. */
const LIST_DEBOUNCE_MS = 600;

export function errorText(error: unknown): string {
  if (error instanceof BridgeRequestError) return error.message;
  return "Could not reach the server. Check your connection and try again.";
}

type ListAnswer = { key: string; retry: number; list: BridgeList } | { key: string; retry: number; error: BridgeRequestError };

/**
 * The shown bridges for a scope. The last answer stays while a new one loads, so the list does not flicker.
 * `debounce` waits for a deck to settle; a typed search asks at once. `enabled` false (a hidden tab) asks for nothing
 * and keeps the last answer; a scope that changed meanwhile is asked for when it is enabled again.
 */
export function useBridgeList(scope: BridgeScope | null, debounce: boolean, enabled = true) {
  const key = scope ? scopeKey(scope) : null;
  const [answer, setAnswer] = useState<ListAnswer | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef(scope);
  latest.current = scope;
  const answered = useRef(answer);
  answered.current = answer;

  useEffect(() => {
    if (!key) { setAnswer(null); return; }
    if (!enabled) return;
    // Shown again with nothing new to ask: the last answer is still the answer.
    if (answered.current?.key === key && answered.current.retry === retry) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const now = latest.current;
      if (!now) return;
      void fetchBridges(now, controller.signal).then(
        (list) => { if (!controller.signal.aborted) setAnswer({ key, retry, list }); },
        (reason: unknown) => {
          if (controller.signal.aborted) return;
          setAnswer({ key, retry, error: reason instanceof BridgeRequestError ? reason : new BridgeRequestError(0, errorText(reason)) });
        },
      );
    }, debounce ? LIST_DEBOUNCE_MS : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, retry, debounce, enabled]);

  const current = answer?.key === key && answer.retry === retry;
  return {
    list: answer && "list" in answer ? answer.list : null,
    error: answer && "error" in answer && answer.key === key ? answer.error : null,
    loading: key != null && !current,
    retry: () => setRetry((value) => value + 1),
  };
}

export type DeepPhase = "idle" | "starting" | "running" | "done" | "failed";
export type Deep = { phase: DeepPhase; step: DeepStep; progress: number; results: ShownBridge[]; next: EngineSuggestion[]; inReview: number | null; error: string | null };
const IDLE: Deep = { phase: "idle", step: "candidates", progress: 0, results: [], next: [], inReview: null, error: null };

const COOLDOWN_STORE = "bridges:hourly-limit";
/** The one search of this player that runs now, whatever the tab shows. */
const ACTIVE_STORE = "bridges:active";
/** The last job of a search, so a reload or a way back to the same engines finds its results. */
const jobStore = (work: string) => `bridges:job:${work}`;
/**
 * The host keeps a finished search at least this long, so asking for it again (to measure it against an edited deck)
 * joins the kept job and starts no new one.
 */
const REFRESH_MS = 9 * 60_000;
/** Wait this long after the last deck change before the host hears of it. */
const CONTEXT_WAIT_MS = 800;

type JobRecord = { id: string; context: string; doneAt?: number };
/** The job in flight. `quiet`: only a refresh of a finished search for a new deck, so no progress bar shows. */
type Running = { id: string; work: string; names: string; context: string; quiet?: boolean; doneAt?: number; step: DeepStep; progress: number; inReview: number | null };
type Finished = { work: string; context: string; doneAt?: number; deep: Deep };
/** The searches kept per set of engines, so one that ends never takes the place of another set's results. */
type PerWork<T> = Readonly<Record<string, T>>;
const KEEP_WORKS = 12;
function keepFor<T>(map: PerWork<T>, work: string, value: T | null): PerWork<T> {
  if (value == null && !(work in map)) return map;
  const next: Record<string, T> = { ...map };
  delete next[work];
  if (value != null) next[work] = value;
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_WORKS))) delete next[old];
  return next;
}
/** How long to wait before asking again: the host's own wait (a busy host says one), or twice the poll time. */
const waitAfter = (reason: unknown) => (reason instanceof BridgeRequestError && reason.retryAfter != null && reason.retryAfter > 0 ? Math.ceil(reason.retryAfter) * 1000 : DEEP_POLL_MS * 2);
/** A wait the host asked for (it is busy for a moment). It is not a failure of the search. */
const isBusy = (reason: unknown) => reason instanceof BridgeRequestError && (reason.status === 503 || reason.status === 429);
/** Asks that only wait out a busy host, before the search shows an error. */
const BUSY_TRIES = 10;

function readJson(key: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readStore("session", key) ?? "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}
function readRecord(work: string): JobRecord | null {
  const kept = readJson(jobStore(work));
  if (!kept || typeof kept.id !== "string" || typeof kept.context !== "string") return null;
  return { id: kept.id, context: kept.context, ...(typeof kept.doneAt === "number" ? { doneAt: kept.doneAt } : {}) };
}
const writeRecord = (work: string, record: JobRecord | null) => writeStore("session", jobStore(work), record ? JSON.stringify(record) : null);
function readActive(): Running | null {
  const kept = readJson(ACTIVE_STORE);
  if (!kept || typeof kept.id !== "string" || typeof kept.work !== "string" || typeof kept.context !== "string") return null;
  return { id: kept.id, work: kept.work, names: typeof kept.names === "string" ? kept.names : "", context: kept.context, step: "candidates", progress: 0, inReview: null };
}
const writeActive = (job: Running | null) => writeStore("session", ACTIVE_STORE, job ? JSON.stringify({ id: job.id, work: job.work, names: job.names, context: job.context }) : null);

const doneDeep = (status: { results: ShownBridge[]; next?: EngineSuggestion[]; inReview: number }): Deep =>
  ({ phase: "done", step: "done", progress: 100, results: status.results, next: status.next ?? [], inReview: status.inReview, error: null });
const failedDeep = (error: string, step: DeepStep = "candidates", progress = 0, inReview: number | null = null): Deep =>
  ({ ...IDLE, phase: "failed", step, progress, inReview, error });

export type DeepSearchOptions = {
  /** The engines in words ("Blue-Eyes + Dragunity"), to name a search that runs while the tab shows another set. */
  names: string;
  /** The tab is on screen. A deck edit reaches the host only then. */
  active: boolean;
  /** A search the player started has finished, whatever the tab shows now. `work` names its set. */
  onFinished?: (work: string) => void;
};

/**
 * The deep search of a scope. The host runs one search per player; this hook follows that one job wherever the tab
 * goes (other chips, Pick mode, another deck set), so a running search is never lost and a finish always reports. At
 * most one request is in flight (a double click sends one), the button waits out the hourly limit, and the jobs are
 * kept for this browser tab, so a reload picks them up again.
 *
 * Results are measured against the deck that asked: a deck edit (or a Pick of the same engines) tells the host the new
 * deck, which joins the same job for free while the host keeps it. A result too old for that says it is for another deck.
 */
export function useDeepSearch(scope: BridgeScope | null, { names, active, onFinished }: DeepSearchOptions) {
  const work = scope ? deepWorkKey(scope) : null;
  const context = scope ? deepContextKey(scope) : "";
  const [running, setRunning] = useState<Running | null>(null);
  const [finishedAll, setFinishedAll] = useState<PerWork<Finished>>({});
  const [failedAll, setFailedAll] = useState<PerWork<Deep>>({});
  const finished = work ? finishedAll[work] ?? null : null;
  const failure = work ? failedAll[work] ?? null : null;
  const setFinished = useCallback((entry: Finished) => setFinishedAll((before) => keepFor(before, entry.work, entry)), []);
  const setFailure = useCallback((on: string, deep: Deep | null) => setFailedAll((before) => keepFor(before, on, deep)), []);
  const [notice, setNotice] = useState<{ work: string; text: string } | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  // A refresh that did not work is not tried again for the same deck.
  const [syncTried, setSyncTried] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  const latest = useRef({ scope, work, context, names });
  latest.current = { scope, work, context, names };
  const runningRef = useRef(running);
  runningRef.current = running;
  const finishedRef = useRef(finishedAll);
  finishedRef.current = finishedAll;
  const onFinishedRef = useRef(onFinished);
  onFinishedRef.current = onFinished;

  const cool = useCallback((seconds: number) => {
    const time = Date.now(), until = time + seconds * 1000;
    setNow(time);
    setCooldownUntil(until);
    writeStore("session", COOLDOWN_STORE, String(until));
  }, []);

  // A reload: the hourly limit and the search in flight come back.
  useEffect(() => {
    const kept = Number(readStore("session", COOLDOWN_STORE));
    if (Number.isFinite(kept) && kept > Date.now()) setCooldownUntil(kept);
    const job = readActive();
    if (job) setRunning((before) => before ?? job);
  }, []);

  useEffect(() => {
    if (cooldownUntil == null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      const time = Date.now();
      setNow(time);
      if (time >= cooldownUntil) setCooldownUntil(null);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);

  // The job in flight is asked for its progress until it ends, whatever scope is on screen.
  const runningId = running?.id ?? null;
  useEffect(() => {
    if (!runningId) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let failures = 0;
    let busyTries = 0;
    const settle = () => { writeActive(null); setRunning((now) => (now?.id === runningId ? null : now)); };
    const tick = async () => {
      try {
        const status = await pollDeepSearch(runningId, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        busyTries = 0;
        const job = runningRef.current;
        if (!job || job.id !== runningId) return;
        if (status.state === "done") {
          const doneAt = job.doneAt ?? Date.now();
          writeRecord(job.work, { id: job.id, context: job.context, doneAt });
          settle();
          setFinished({ work: job.work, context: job.context, doneAt, deep: doneDeep(status) });
          setFailure(job.work, null);
          if (!job.quiet) onFinishedRef.current?.(job.work);
          return;
        }
        if (status.state === "failed") {
          writeRecord(job.work, null);
          settle();
          if (!job.quiet) setFailure(job.work, failedDeep(status.error || "The deep search could not finish.", status.step, status.progress || job.progress, status.inReview));
          return;
        }
        setRunning((now) => (now?.id === runningId ? { ...now, step: status.step, progress: status.progress, inReview: status.inReview } : now));
        timer = window.setTimeout(() => void tick(), DEEP_POLL_MS);
      } catch (reason) {
        if (controller.signal.aborted) return;
        const job = runningRef.current;
        if (reason instanceof BridgeRequestError && reason.status === 404) {
          // The host no longer knows this job. Forget it, so the next click starts a new search.
          if (job) writeRecord(job.work, null);
          settle();
          if (job && !job.quiet) setFailure(job.work, failedDeep("This search is no longer available. Start it again."));
          return;
        }
        // A busy host asks for a short wait: that is no failure, up to a point.
        if (isBusy(reason) && busyTries < BUSY_TRIES) busyTries += 1;
        else failures += 1;
        if (failures >= DEEP_POLL_FAILURES) {
          settle();
          if (job && !job.quiet) setFailure(job.work, failedDeep(errorText(reason), job.step, job.progress, job.inReview));
          return;
        }
        timer = window.setTimeout(() => void tick(), waitAfter(reason));
      }
    };
    void tick();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [runningId, setFinished, setFailure]);

  // Engines shown again: the kept job of that search brings its results back (or its progress, if it still runs).
  // A busy host (or a lost answer) is asked again a few times, after the wait it asks for.
  useEffect(() => {
    if (!work || runningRef.current?.work === work || finishedRef.current[work]) return;
    const record = readRecord(work);
    if (!record) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let tries = 0;
    const ask = () => void pollDeepSearch(record.id, controller.signal).then((status) => {
      if (controller.signal.aborted) return;
      if (status.state === "done") { setFinished({ work, context: record.context, doneAt: record.doneAt, deep: doneDeep(status) }); return; }
      if (status.state === "failed") { writeRecord(work, null); return; }
      const job: Running = { id: record.id, work, names: latest.current.names, context: record.context, step: status.step, progress: status.progress, inReview: status.inReview };
      setRunning((before) => { if (before) return before; writeActive(job); return job; });
    }, (reason: unknown) => {
      if (controller.signal.aborted) return;
      if (reason instanceof BridgeRequestError && reason.status === 404) { writeRecord(work, null); return; }
      const again = !(reason instanceof BridgeRequestError) || isBusy(reason) || reason.status >= 500;
      tries += 1;
      if (again && tries < BUSY_TRIES) timer = window.setTimeout(ask, waitAfter(reason));
    });
    ask();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [work, setFinished]);

  const refreshable = (job: { doneAt?: number }) => job.doneAt != null && Date.now() - job.doneAt < REFRESH_MS;
  const syncKey = work ? `${work}#${context}` : null;
  const mine = running != null && running.work === work;
  // The deck changed under a search of these engines: the host hears of the new deck, so held cards and points match.
  const needsSync = !!work && active && syncTried !== syncKey && (
    mine ? running!.context !== context
      : running == null && finished != null && finished.context !== context && refreshable(finished));
  useEffect(() => {
    if (!needsSync) return;
    const timer = window.setTimeout(() => {
      const { scope: wanted, work: w, context: c, names: n } = latest.current;
      if (!wanted || !w || sending.current) return;
      sending.current = true;
      setSyncing(true);
      void startDeepSearch(wanted).then((started) => {
        const job = runningRef.current;
        if (job && job.work === w) {
          const next = { ...job, id: started.jobId, context: c };
          if (!job.quiet) writeActive(next);
          writeRecord(w, { id: started.jobId, context: c });
          setRunning(next);
          return;
        }
        const done = started.state === "done";
        const next: Running = { id: started.jobId, work: w, names: n, context: c, step: "candidates", progress: 0, inReview: null, ...(done ? { quiet: true, doneAt: finishedRef.current[w]?.doneAt } : {}) };
        if (!done) { writeActive(next); writeRecord(w, { id: started.jobId, context: c }); }
        setRunning(next);
      }, () => { setSyncTried(`${w}#${c}`); }).finally(() => { sending.current = false; setSyncing(false); });
    }, CONTEXT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [needsSync, syncKey]);

  const left = secondsLeft(cooldownUntil, now);
  // A search for other engines still runs: it has to end first (the host runs one per player).
  const elsewhere = running && !mine && !running.quiet ? { names: running.names, step: running.step, progress: running.progress } : null;
  const busy = starting != null || (running != null && !running.quiet);

  let deep: Deep = IDLE;
  let stale = false;
  let updating = false;
  if (work && starting === work) deep = { ...IDLE, phase: "starting" };
  else if (mine && !running!.quiet) deep = { ...IDLE, phase: "running", step: running!.step, progress: running!.progress, inReview: running!.inReview };
  else if (failure) deep = failure;
  else if (finished) {
    if (finished.context === context) deep = finished.deep;
    else if (mine || needsSync || syncing) { deep = finished.deep; updating = true; }
    else stale = true;
  }

  const start = useCallback(async () => {
    const { scope: wanted, work: w, context: c, names: n } = latest.current;
    if (!wanted || !w || sending.current) return;
    const other = runningRef.current;
    if (other && !other.quiet) return;
    sending.current = true;
    setStarting(w);
    setNotice(null);
    setFailure(w, null);
    try {
      const started = await startDeepSearch(wanted);
      const job: Running = { id: started.jobId, work: w, names: n, context: c, step: "candidates", progress: 0, inReview: null };
      writeActive(job);
      writeRecord(w, { id: started.jobId, context: c });
      setRunning(job);
    } catch (reason) {
      if (reason instanceof BridgeRequestError && reason.status === 429 && Number.isFinite(reason.retryAfter) && reason.retryAfter! > 0) {
        cool(Math.ceil(reason.retryAfter!));
        return;
      }
      // Another search of this player runs (from another browser tab): that is a wait, not a failure.
      if (reason instanceof BridgeRequestError && reason.status === 409) {
        setNotice({ work: w, text: `${reason.message.replace(/\.$/, "")}. You can start this one when it ends.` });
        return;
      }
      setFailure(w, failedDeep(errorText(reason)));
    } finally {
      sending.current = false;
      setStarting(null);
    }
  }, [cool, setFailure]);

  return {
    deep,
    start,
    cooldown: left,
    busy,
    /** A deck edit is being sent to the host: the button waits that moment out, so a click is never lost. */
    blocked: busy || syncing || left > 0,
    /** A search for other engines that still runs. */
    elsewhere,
    /** Results of these engines exist, but for another deck (or none): they are not shown. */
    stale,
    /** The results are being measured against the edited deck. */
    updating,
    notice: notice && notice.work === work ? notice.text : null,
  };
}

const known = new Map<string, DeckCardInfo>();

/**
 * Card details for bridge cards, so a thumbnail can open the card inspector like any other tile. The editor's
 * catalog learns them too. A card that could not be loaded still shows its art, without the inspector.
 */
export function useBridgeCards(codes: readonly number[], mode: DuelMode, onCatalog: (cards: DeckCardInfo[]) => void): ReadonlyMap<number, DeckCardInfo> {
  const [, bump] = useState(0);
  const catalog = useRef(onCatalog);
  catalog.current = onCatalog;
  const list = codes.join(",");
  useEffect(() => {
    const wanted = list ? list.split(",").map(Number) : [];
    const have = wanted.flatMap((code) => { const card = known.get(`${mode}:${code}`); return card ? [card] : []; });
    if (have.length) catalog.current(have);
    const missing = wanted.filter((code) => !known.has(`${mode}:${code}`));
    if (!missing.length) return;
    const controller = new AbortController();
    void getDeckCards(missing, { mode }, controller.signal).then(({ cards }) => {
      if (controller.signal.aborted) return;
      for (const card of cards) known.set(`${mode}:${card.code}`, card);
      catalog.current(cards);
      bump((value) => value + 1);
    }, () => { /* The thumbnails stay plain art. */ });
    return () => controller.abort();
  }, [list, mode]);
  return new Map(codes.flatMap((code) => { const card = known.get(`${mode}:${code}`); return card ? [[code, card] as const] : []; }));
}
