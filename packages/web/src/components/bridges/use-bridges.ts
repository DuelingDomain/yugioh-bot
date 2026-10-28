"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { getDeckCards } from "@/components/decks/api";
import { BridgeRequestError, fetchBridges, pollDeepSearch, startDeepSearch, type BridgeList, type BridgeScope, type DeepStep, type ShownBridge } from "./bridges-api";
import { DEEP_POLL_FAILURES, DEEP_POLL_MS, DEEP_SEARCH_COOLDOWN_SECONDS, readStore, scopeKey, secondsLeft, writeStore } from "./bridges-model";

/** Wait this long after the last deck change before asking again, like the other Suggestions rows. */
const LIST_DEBOUNCE_MS = 600;

export function errorText(error: unknown): string {
  if (error instanceof BridgeRequestError) return error.message;
  return "Could not reach the server. Check your connection and try again.";
}

type ListAnswer = { key: string; retry: number; list: BridgeList } | { key: string; retry: number; error: BridgeRequestError };

/**
 * The shown bridges for a scope. The last answer stays while a new one loads, so the list does not flicker.
 * `debounce` waits for a deck to settle; a typed search asks at once.
 */
export function useBridgeList(scope: BridgeScope | null, debounce: boolean) {
  const key = scope ? scopeKey(scope) : null;
  const [answer, setAnswer] = useState<ListAnswer | null>(null);
  const [retry, setRetry] = useState(0);
  const latest = useRef(scope);
  latest.current = scope;

  useEffect(() => {
    if (!key) { setAnswer(null); return; }
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
  }, [key, retry, debounce]);

  const current = answer?.key === key && answer.retry === retry;
  return {
    list: answer && "list" in answer ? answer.list : null,
    error: answer && "error" in answer && answer.key === key ? answer.error : null,
    loading: key != null && !current,
    retry: () => setRetry((value) => value + 1),
  };
}

export type DeepPhase = "idle" | "starting" | "running" | "done" | "failed";
export type Deep = { phase: DeepPhase; step: DeepStep; progress: number; results: ShownBridge[]; inReview: number | null; error: string | null };
const IDLE: Deep = { phase: "idle", step: "candidates", progress: 0, results: [], inReview: null, error: null };

const COOLDOWN_STORE = "bridges:cooldown";
const jobStore = (key: string) => `bridges:job:${key}`;

/**
 * The deep search of one scope. At most one request is in flight (a double click sends one), the button waits out
 * the host's cooldown, and the job id is kept for this tab, so leaving and coming back picks the running job up again.
 */
export function useDeepSearch(scope: BridgeScope | null) {
  const key = scope ? scopeKey(scope) : null;
  const [deep, setDeep] = useState<Deep>(IDLE);
  // The job belongs to the scope it was found for, so a new scope never polls the old job.
  const [job, setJob] = useState<{ key: string | null; id: string | null }>({ key: null, id: null });
  const jobId = job.key === key ? job.id : null;
  const [runs, setRuns] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  const latest = useRef({ scope, key });
  latest.current = { scope, key };
  // The job this tab started and whether it was answered from the host's cache. Only a new job starts the host's cooldown.
  const own = useRef<{ jobId: string; cached: boolean } | null>(null);

  const cool = useCallback((until: number) => {
    setCooldownUntil(until);
    writeStore("session", COOLDOWN_STORE, String(until));
  }, []);

  useEffect(() => {
    const kept = Number(readStore("session", COOLDOWN_STORE));
    if (Number.isFinite(kept) && kept > Date.now()) setCooldownUntil(kept);
  }, []);

  // A new scope forgets the old search and picks up the job this tab kept for it.
  useEffect(() => {
    sending.current = false;
    own.current = null;
    setDeep(IDLE);
    setJob({ key, id: key ? readStore("session", jobStore(key)) : null });
    setRuns((value) => value + 1);
  }, [key]);

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

  useEffect(() => {
    if (!jobId || !key) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let failures = 0;
    const settle = () => {
      if (own.current?.jobId === jobId && !own.current.cached) cool(Date.now() + DEEP_SEARCH_COOLDOWN_SECONDS * 1000);
    };
    const tick = async () => {
      try {
        const status = await pollDeepSearch(jobId, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        if (status.state === "done") {
          setDeep({ phase: "done", step: "done", progress: 100, results: status.results, inReview: status.inReview, error: null });
          settle();
          return;
        }
        if (status.state === "failed") {
          setDeep((before) => ({ phase: "failed", step: status.step, progress: status.progress || before.progress, results: [], inReview: status.inReview, error: status.error || "The deep search could not finish." }));
          settle();
          return;
        }
        setDeep({ phase: "running", step: status.step, progress: status.progress, results: [], inReview: status.inReview, error: null });
        timer = window.setTimeout(() => void tick(), DEEP_POLL_MS);
      } catch (reason) {
        if (controller.signal.aborted) return;
        if (reason instanceof BridgeRequestError && reason.status === 404) {
          // The host no longer knows this job. Forget it, so the next click starts a new search.
          writeStore("session", jobStore(key), null);
          setJob({ key, id: null });
          setDeep({ ...IDLE, phase: "failed", error: "This search is no longer available. Start it again." });
          return;
        }
        failures += 1;
        if (failures >= DEEP_POLL_FAILURES) {
          setDeep((before) => ({ ...before, phase: "failed", error: errorText(reason) }));
          return;
        }
        timer = window.setTimeout(() => void tick(), DEEP_POLL_MS * 2);
      }
    };
    void tick();
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [jobId, key, runs, cool]);

  const left = secondsLeft(cooldownUntil, now);
  const busy = deep.phase === "starting" || deep.phase === "running";

  const start = useCallback(async () => {
    const { scope: wanted, key: startedFor } = latest.current;
    if (!wanted || !startedFor || sending.current) return;
    sending.current = true;
    setDeep((before) => ({ ...IDLE, phase: "starting", inReview: before.inReview }));
    try {
      const started = await startDeepSearch(wanted);
      if (latest.current.key !== startedFor) return;
      writeStore("session", jobStore(startedFor), started.jobId);
      own.current = { jobId: started.jobId, cached: started.cached };
      setJob({ key: startedFor, id: started.jobId });
      setRuns((value) => value + 1);
      setDeep({ ...IDLE, phase: "running" });
    } catch (reason) {
      if (latest.current.key !== startedFor) return;
      if (reason instanceof BridgeRequestError && reason.status === 429) {
        cool(Date.now() + Math.max(1, reason.retryAfter ?? DEEP_SEARCH_COOLDOWN_SECONDS) * 1000);
        setDeep(IDLE);
        return;
      }
      setDeep({ ...IDLE, phase: "failed", error: errorText(reason) });
    } finally {
      sending.current = false;
    }
  }, [cool]);

  return { deep, start, cooldown: left, busy, blocked: busy || left > 0 };
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
