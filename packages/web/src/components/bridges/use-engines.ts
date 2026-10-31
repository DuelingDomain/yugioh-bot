"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BridgeRequestError, fetchBridgeArchetypes, fetchBridgeEngines, type BridgeEnginesRequest, type BridgeEnginesResponse } from "@/lib/bridges-api";
import { applyEdits, bridgeDeck, bridgeFormat, enginesKey, sameNames, type EngineEdits } from "./engines-model";
import { errorText } from "./use-bridges";

/** Wait this long after the last deck change before asking again, like the other Suggestions rows. */
const DEBOUNCE_MS = 600;
/** The Suggest tab and the Bridges tab ask the same question for the same deck. An answer is shared for this long. */
const SHARE_MS = 30_000;
const SHARE_MAX = 24;

const NONE: readonly string[] = [];

const shared = new Map<string, { at: number; data: BridgeEnginesResponse }>();

function remember(key: string, data: BridgeEnginesResponse) {
  shared.delete(key);
  shared.set(key, { at: Date.now(), data });
  for (const old of shared.keys()) { if (shared.size <= SHARE_MAX) break; shared.delete(old); }
}

function fresh(key: string): BridgeEnginesResponse | null {
  const hit = shared.get(key);
  return hit && Date.now() - hit.at < SHARE_MS ? hit.data : null;
}

// A finished deep search can add rows that passed the checks, so every engine answer asks again once it is shown.
let generation = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const currentGeneration = () => generation;
const serverGeneration = () => 0;

/** Forget the shared answers: the next engine answer on screen (Suggest or Bridges) is asked again. */
export function refreshEngines(): void {
  generation += 1;
  shared.clear();
  for (const listener of listeners) listener();
}

type Answer = { key: string; deck: string; retry: number; generation: number } & ({ data: BridgeEnginesResponse } | { error: BridgeRequestError });

/**
 * The fast engine answer for a request: the engines of a deck or of a pick, the bridges between them and the engines
 * that fit next. It reads stored rows only and never starts a paid search. A deck change waits for the deck to settle;
 * a change of the engines alone (a chip) asks at once. The last answer stays while a new one loads. `enabled` false (a
 * hidden tab) asks for nothing. No query (an empty deck) is no answer at all, so nothing of the old deck stays.
 */
export function useEnginesAnswer(query: BridgeEnginesRequest | null, enabled: boolean) {
  const keys = query ? enginesKey(query) : null;
  const key = keys ? `${keys.deck}#${keys.rest}` : null;
  const deckKey = keys?.deck ?? null;
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [retry, setRetry] = useState(0);
  const gen = useSyncExternalStore(subscribe, currentGeneration, serverGeneration);
  const latest = useRef(query);
  latest.current = query;
  const answered = useRef(answer);
  answered.current = answer;

  useEffect(() => {
    if (!key || deckKey == null) { setAnswer(null); return; }
    if (!enabled) return;
    const before = answered.current;
    if (before?.key === key && before.retry === retry && before.generation === gen) return;
    const hit = retry === 0 ? fresh(key) : null;
    if (hit) { setAnswer({ key, deck: deckKey, retry, generation: gen, data: hit }); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const now = latest.current;
      if (!now) return;
      void fetchBridgeEngines(now, controller.signal).then(
        (data) => { if (controller.signal.aborted) return; remember(key, data); setAnswer({ key, deck: deckKey, retry, generation: gen, data }); },
        (reason: unknown) => {
          if (controller.signal.aborted) return;
          const status = typeof (reason as { status?: unknown })?.status === "number" ? (reason as { status: number }).status : 0;
          setAnswer({ key, deck: deckKey, retry, generation: gen, error: new BridgeRequestError(status, reason instanceof Error && status ? reason.message : errorText(reason)) });
        },
      );
    }, before && before.deck !== deckKey ? DEBOUNCE_MS : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key, deckKey, retry, enabled, gen]);

  const current = answer?.key === key && answer.retry === retry && answer.generation === gen;
  return {
    data: key != null && answer && "data" in answer ? answer.data : null,
    error: answer && "error" in answer && answer.key === key ? answer.error : null,
    loading: key != null && !current,
    retry: () => setRetry((value) => value + 1),
  };
}

export type DeckEnginesInput = {
  deck: { main: readonly number[]; extra: readonly number[] };
  deckMaster: number | null | undefined;
  genesys: boolean;
  /** The deck has no Main Deck cards: nothing to ask. */
  empty: boolean;
  enabled: boolean;
  /** Genesys points left, as the editor counts them (Side Deck and the player's cap included). */
  genesysRemaining?: number;
};

/** The engines of the open deck as the host sees them, before any chip edit: the Suggest tab uses this alone. */
export function useDetectedEngines({ deck, deckMaster, genesys, empty, enabled, genesysRemaining }: DeckEnginesInput) {
  const format = bridgeFormat(genesys);
  const points = genesys && genesysRemaining != null ? Math.max(0, Math.min(1000, Math.floor(genesysRemaining))) : null;
  const query = useMemo<BridgeEnginesRequest | null>(
    () => (empty ? null : { format, deck: bridgeDeck(deck, deckMaster), ...(points != null ? { genesysRemaining: points } : {}) }),
    // The card lists and the master decide the request; the key below drops a repeat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empty, format, deck.main, deck.extra, deckMaster, points],
  );
  return { ...useEnginesAnswer(query, enabled), query };
}

/**
 * The engine set of the Bridges tab: the engines the host found, with the player's chip edits on top. With no edit the
 * first answer is the answer; with edits the set is asked again (with the deck, so cards already held count).
 */
export function useDeckEngines(input: DeckEnginesInput, edits: EngineEdits) {
  const detect = useDetectedEngines(input);
  const found = detect.data?.engines ?? NONE;
  const set = useMemo(() => applyEdits(found, edits), [found, edits]);
  const unchanged = detect.data != null && sameNames(set, detect.data.engines);
  const format = bridgeFormat(input.genesys);
  const fixed = useMemo<BridgeEnginesRequest | null>(
    () => (detect.data && !unchanged && set.length > 0 && detect.query?.deck ? { ...detect.query, format, engines: set } : null),
    [detect.data, unchanged, set, detect.query, format],
  );
  const corrected = useEnginesAnswer(fixed, input.enabled);
  const result = unchanged ? detect.data : set.length > 0 ? corrected.data : null;
  return {
    /** What the host found in the deck, with the groups that are only in part in the deck. */
    detected: detect.data?.detected,
    found,
    set,
    result,
    /** The first answer is not in yet. */
    waiting: detect.data == null && detect.error == null && !input.empty,
    /** The answer for the set is on its way. */
    loading: detect.loading || (fixed != null && corrected.loading),
    error: detect.error ?? (fixed ? corrected.error : null),
    retry: () => { detect.retry(); corrected.retry(); },
  };
}

/** The archetype names that have bridge data, for the boxes that take a name. `load` false waits. */
export function useArchetypeNames(load = true) {
  const [names, setNames] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!load) return;
    let live = true;
    setError(null);
    fetchBridgeArchetypes().then((found) => { if (live) setNames(found); }, (reason: unknown) => { if (live) setError(errorText(reason)); });
    return () => { live = false; };
  }, [load, retry]);
  return { names, error, retry: () => setRetry((value) => value + 1) };
}
