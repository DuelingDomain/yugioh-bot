"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import type { CardAdder } from "@/components/decks/card-adder";
import { BridgeCard, GradeBadge, OwnedTag, directionText, type CardPropsFor } from "./bridge-card";
import { BridgeDetails } from "./bridge-details";
import { BridgeSearch } from "./bridge-search";
import { DeepProgress, DeepSearchButton } from "./deep-search";
import { EngineChips } from "./engine-chips";
import { EngineList } from "./engine-card";
import { BridgeRequestError, type BridgeScope, type ShownBridge } from "@/lib/bridges-api";
import { BRIDGES_SHOWN, DEEP_BRIDGES_SHOWN, actionableFirst, bridgeCodes, capActionable, deepWorkKey } from "./bridges-model";
import { MAX_ENGINES, NO_EDITS, bridgeDeck, bridgeFormat, hasEdits, lightEngines, readEdits, toggleEngine, writeEdits, type EngineEdits } from "./engines-model";
import { useBridgeCards, useBridgeList, useDeepSearch } from "./use-bridges";
import { refreshEngines, useDeckEngines, useEnginesAnswer } from "./use-engines";
import styles from "./bridges.module.css";

/**
 * What the Suggest tab asks of this tab. `engine`: show that engine (one engine: the details of its link; several:
 * its card in the list). `deep`: bring the Deep search button to the player. `pick`: open Pick archetypes. `count`
 * grows with every ask, so asking again for the same thing works.
 */
export type BridgesAsk = ({ kind: "engine"; name: string } | { kind: "deep" } | { kind: "pick" }) & { count: number };

type Props = {
  /** The archetype the editor found in the deck. Only a start for the two-archetype search; the engines come from the host. */
  archetype: string | null;
  /** The saved deck, to keep the player's chip edits for it in this browser. Null: not saved yet. */
  deckId?: number | null;
  /** The open deck. The host finds its engines from the card lists. */
  deck: { main: readonly number[]; extra: readonly number[] };
  deckMaster?: number | null;
  mode: DuelMode;
  genesys: boolean;
  genesysRemaining?: number;
  cardProps: CardPropsFor;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  /** Adds the cards a bridge's line needs. Not given: the details have no Add button. */
  adder?: CardAdder;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** The server has no bridges (or Suggestions are off). */
  onDisabled?: () => void;
  /** The tab of the row is on screen. A hidden row asks for no new list, but a running deep search goes on. */
  active?: boolean;
  /** A deep search just finished. */
  onDeepFinished?: () => void;
  ask?: BridgesAsk | null;
};

type ListProps = Pick<Props, "mode" | "genesys" | "cardProps" | "onCatalog"> & { bridges: readonly ShownBridge[]; showSource?: boolean; onOpen: (bridge: ShownBridge) => void; label: string };

/** A list of bridges. The cards of the bridges load together, so the thumbnails fill in at once. */
function BridgeList({ bridges, mode, genesys, cardProps, onCatalog, showSource, onOpen, label }: ListProps) {
  const cards = useBridgeCards(bridgeCodes(bridges), mode, onCatalog);
  return (
    <ul className={styles.list} aria-label={label}>
      {actionableFirst(bridges).map((bridge) => <BridgeCard key={`${bridge.source}>${bridge.target}:${bridge.evidence_hash}`} bridge={bridge} mode={mode} cards={cards} cardProps={cardProps} genesys={genesys} showSource={showSource} onOpen={onOpen} />)}
    </ul>
  );
}

/** The between rows that show before "Show all". */
const BETWEEN_SHOWN = 3;

/**
 * The bridges between the engines of the set, one short line each (ends, grade, way), so the next engine stays near
 * the top. A line opens the details of its bridge.
 */
function BetweenList({ bridges, title, onOpen }: { bridges: readonly ShownBridge[]; title: string; onOpen: (bridge: ShownBridge) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? bridges : bridges.slice(0, BETWEEN_SHOWN);
  return (
    <section className={styles.between} aria-label={title} data-testid="engines-between">
      <h4 className={styles.subTitle}>{title}</h4>
      <ul className={styles.betweenRows} aria-label={title}>
        {shown.map((bridge) => (
          <li key={`${bridge.source}>${bridge.target}:${bridge.evidence_hash}`} data-testid="bridge-item" data-grade={bridge.review.grade} data-owned={bridge.alreadyInDeck ? "" : undefined}>
            <button type="button" className={styles.betweenRow} data-bridge={bridge.evidence_hash}
              aria-label={`${bridge.source} to ${bridge.target}. ${bridge.tier === "niche" ? "Niche" : bridge.grade}, ${directionText(bridge).toLowerCase()}. Open details`} onClick={() => onOpen(bridge)}>
              <strong className={styles.betweenEnds}>{bridge.source}<span className={styles.arrow} aria-hidden> → </span>{bridge.target}</strong>
              <span className={styles.betweenTags}>
                <GradeBadge bridge={bridge} />
                <span className={styles.way} data-way={bridge.two_way ? "two" : "one"}>{directionText(bridge)}</span>
                {bridge.alreadyInDeck ? <OwnedTag /> : null}
                <ChevronRight size={15} strokeWidth={1.8} aria-hidden className={styles.chevron} />
              </span>
            </button>
          </li>
        ))}
      </ul>
      {bridges.length > BETWEEN_SHOWN ? (
        <button type="button" className={styles.link} aria-expanded={all} data-testid="between-more" onClick={() => setAll((now) => !now)}>{all ? "Show fewer" : `Show all ${bridges.length}`}</button>
      ) : null}
    </section>
  );
}

/** The box that scrolls the tab, so Back can put the list where it was. */
function scrollBox(node: HTMLElement | null): HTMLElement | null {
  for (let at = node?.parentElement ?? null; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
}

/** A line about an ask that could not be shown. `resetFor`: the engine that a Reset to deck would bring back. */
type Notice = { text: string; resetFor?: string };
type FocusTarget = "deep" | "add" | "lit" | "notice";

/**
 * The Bridges tab of the deck editor: the engines of the deck (or picked archetypes), the bridges between them and the
 * engine to add next. Deep search sits right under the chips, so it is never far down. A bridge opens its details in
 * place, and Back returns to the same place in the list. Only bridges that passed the checks reach this tab.
 */
export function BridgesRow({ archetype, deckId = null, deck, deckMaster, mode, genesys, genesysRemaining, cardProps, deckCount, limit, adder, onCatalog, onDisabled, active = true, onDeepFinished, ask = null }: Props) {
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;
  const onDeepFinishedRef = useRef(onDeepFinished);
  onDeepFinishedRef.current = onDeepFinished;
  const rootRef = useRef<HTMLElement>(null);
  const hintId = useId();
  const [open, setOpen] = useState<ShownBridge | null>(null);
  const [searching, setSearching] = useState(false);
  // The link a details view was opened from (its place among the links, and the scroll), so Back returns to it.
  const cameFrom = useRef<{ hash: string; index: number; scroll: number } | null>(null);
  const clicked = useRef<HTMLElement | null>(null);

  const empty = deck.main.length === 0;
  const format = bridgeFormat(genesys);
  // The player's chip edits sit on top of the engines the host finds. They change this tab only.
  // They are kept for a saved deck. A deck that is saved for the first time keeps the edits it already has.
  const [saved, setSaved] = useState<{ id: number | null; edits: EngineEdits }>(() => ({ id: deckId, edits: readEdits(deckId) }));
  if (saved.id !== deckId) {
    const keep = saved.id == null && deckId != null;
    const edits = keep ? saved.edits : readEdits(deckId);
    if (keep) writeEdits(deckId, edits);
    setSaved({ id: deckId, edits });
  }
  const edits = saved.edits;
  const setEdits = (change: (now: EngineEdits) => EngineEdits) => {
    const next = change(edits);
    writeEdits(saved.id, next);
    setSaved({ id: saved.id, edits: next });
  };
  // Two ways to choose the engines: the deck's own, or one to four archetypes picked by name.
  const [pickMode, setPickMode] = useState(false);
  const [picks, setPicks] = useState<readonly string[]>([]);
  const points = genesys && genesysRemaining != null ? { genesysRemaining } : {};
  const engines = useDeckEngines({ deck, deckMaster, genesys, empty, enabled: active && !pickMode, genesysRemaining }, edits);
  // The open deck goes with every set as context only: the host counts the cards it already holds.
  const openDeck = useMemo(() => (empty ? undefined : bridgeDeck(deck, deckMaster)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [empty, deck.main, deck.extra, deckMaster]);
  const pickQuery = useMemo(() => (pickMode && picks.length > 1 ? { format, engines: [...picks], ...(openDeck ? { deck: openDeck } : {}), ...points } : null),
    // `points` follows the two values below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pickMode, picks, format, openDeck, genesys, genesysRemaining]);
  const picked = useEnginesAnswer(pickQuery, active);
  const set: readonly string[] = pickMode ? picks : engines.set;
  const setResult = pickMode ? picked.data : engines.result;
  const setError = pickMode ? picked.error : engines.error;
  const setLoading = pickMode ? picked.loading : engines.loading;
  // A pick needs no deck: only the deck's own way of choosing has no cards to ask with.
  const noCards = !pickMode && empty;
  const single = set.length === 1 ? set[0]! : null;
  const first = set[0] ?? null;
  const names = set.join(" + ");
  // The open deck goes with the list, so each row knows what the deck already holds. A deck edit changes the request
  // key: the list is asked again after the usual wait, and an answer for an older deck never replaces a newer one.
  const listScope: BridgeScope | null = single && !noCards ? { source: single, format, ...(openDeck ? { deck: openDeck } : {}), ...points } : null;
  // The deep search runs on the set on screen. The open deck says what the player already holds.
  const scope: BridgeScope | null = first && !noCards
    ? set.length > 1 ? { source: first, format, engines: set, ...(openDeck ? { deck: openDeck } : {}), ...points } : { source: first, format, ...points }
    : null;
  const workKey = scope ? deepWorkKey(scope) : null;
  // The sets whose deep search ended while this page was open: only for those can "New" be told.
  const [liveDone, setLiveDone] = useState<readonly string[]>([]);
  const { list, loading, error: listError, retry: retryList } = useBridgeList(listScope, true, active);
  const { deep, start, cooldown, blocked, elsewhere, stale, updating, notice: deepNotice } = useDeepSearch(scope, {
    names,
    active,
    // A search that ends tells the tab bar (a hidden tab shows a dot), and the fast answers are asked again.
    onFinished: (work) => { onDeepFinishedRef.current?.(); refreshEngines(); setLiveDone((before) => (before.includes(work) ? before : [...before, work])); },
  });
  const error = listError ?? (single ? null : setError);
  const retry = () => { retryList(); if (pickMode) picked.retry(); else engines.retry(); };

  // The server says bridges are off: this row goes away, like the other rows do for Suggestions.
  const disabled = (listError ?? setError)?.status === 404;
  useEffect(() => { if (disabled) onDisabledRef.current?.(); }, [disabled]);
  // A new set of engines or a new format closes the details of the old one.
  const scopeId = `${set.join("|")}|${format}|${pickMode}`;
  const [lit, setLit] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => { setOpen(null); setLit(null); setNotice(null); }, [scopeId]);

  useLayoutEffect(() => {
    if (open || !cameFrom.current) return;
    const back = cameFrom.current;
    cameFrom.current = null;
    const box = scrollBox(rootRef.current);
    if (box) box.scrollTop = back.scroll;
    const nodes = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-bridge]") ?? [])];
    const atIndex = back.index >= 0 && nodes[back.index]?.dataset.bridge === back.hash ? nodes[back.index] : undefined;
    // A bridge opened from Suggest can be one the list does not show: the tab title takes the focus then.
    const button = atIndex ?? nodes.find((node) => node.dataset.bridge === back.hash) ?? rootRef.current?.querySelector<HTMLElement>("h3");
    button?.focus({ preventScroll: true });
    if (button?.dataset.bridge) button.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  function openBridge(bridge: ShownBridge) {
    const nodes = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-bridge]") ?? [])];
    const from = clicked.current && clicked.current.dataset.bridge === bridge.evidence_hash ? nodes.indexOf(clicked.current) : -1;
    clicked.current = null;
    cameFrom.current = { hash: bridge.evidence_hash, index: from, scroll: scrollBox(rootRef.current)?.scrollTop ?? 0 };
    setOpen(bridge);
  }

  // Focus that waits for the next paint: the node it goes to is only there once the tab has rendered.
  const [focusTo, setFocusTo] = useState<{ target: FocusTarget; tick: number } | null>(null);
  const focusOn = (target: FocusTarget) => setFocusTo((before) => ({ target, tick: (before?.tick ?? 0) + 1 }));
  useEffect(() => {
    if (!focusTo || !active || open) return;
    const root = rootRef.current;
    const selector = { deep: '[data-testid="deep-search-button"]', add: '[data-testid="engine-add"]', lit: '[data-testid="engine-item"][data-lit]', notice: '[data-testid="bridges-notice"]' }[focusTo.target];
    const node = root?.querySelector<HTMLElement>(selector);
    // A button that is off cannot take the focus: the tab title does, so the player still lands in the tab.
    const target = node && !(node instanceof HTMLButtonElement && node.disabled) ? node : root?.querySelector<HTMLElement>("h3");
    target?.focus({ preventScroll: true });
    (node ?? target)?.scrollIntoView?.({ block: "nearest" });
    setFocusTo(null);
  }, [focusTo, active, open]);

  // An ask from the Suggest tab: leave Pick mode (or go to it) and the details first, then answer it once the list is in.
  const handled = useRef(0);
  const [pending, setPending] = useState<BridgesAsk | null>(null);
  useEffect(() => {
    if (!ask || handled.current === ask.count || !active) return;
    handled.current = ask.count;
    setOpen(null);
    setNotice(null);
    setLit(null);
    setPickMode(ask.kind === "pick");
    setPending(ask);
  }, [ask, active]);

  const result = setResult;
  const between = actionableFirst(result?.between ?? []);
  const fastNext = actionableFirst(result?.next ?? []);
  // A finished deep search for this set takes the place of the fast list: one list, its new engines marked.
  const deepDone = set.length > 1 && deep.phase === "done";
  const deepNext = deepDone ? actionableFirst(deep.next) : [];
  const next = deepNext.length > 0 ? deepNext : fastNext;
  // "New" is measured against the fast list from before the deep search ended. The fast answer is asked again once it
  // ends and then holds the rows the deep search stored, so it alone would take the marks away a moment later.
  const [fastBefore, setFastBefore] = useState<Readonly<Record<string, string>>>({});
  const fastNames = result && !setLoading && set.length > 1 ? result.next.map((engine) => engine.engine).join("\n") : null;
  useEffect(() => {
    if (!workKey || deepDone || fastNames == null) return;
    setFastBefore((before) => (before[workKey] === fastNames ? before : { ...before, [workKey]: fastNames }));
  }, [workKey, deepDone, fastNames]);
  // Results that came back after a reload (or from the host's cache) were measured against a list this page never saw,
  // so nothing can be called new and the list shows no marks. The fast list as it is now holds the deep rows already.
  const fresh = useMemo(() => {
    const kept = workKey && liveDone.includes(workKey) ? fastBefore[workKey] : undefined;
    if (kept == null) return new Set<string>();
    const known = new Set(kept.split("\n"));
    return new Set(deepNext.filter((engine) => !known.has(engine.engine)).map((engine) => engine.engine));
  }, [deepNext, fastBefore, liveDone, workKey]);

  useEffect(() => {
    if (!pending || !active) return;
    if (pending.kind === "pick") { if (!pickMode) return; setPending(null); focusOn("add"); return; }
    if (pickMode) return;
    if (pending.kind === "deep") { setPending(null); focusOn("deep"); return; }
    if (engines.waiting || engines.loading) return;
    const name = pending.name;
    const answer = engines.result;
    setPending(null);
    const say = (text: string, resetFor?: string) => { setNotice({ text, ...(resetFor ? { resetFor } : {}) }); focusOn("notice"); };
    if (!answer) { say(engines.error ? `${name} cannot be shown: ${engines.error.message}` : `${name} cannot be shown right now.`); return; }
    if (set.includes(name)) { say(`${name} is already one of your engines.`); return; }
    // Only an engine on screen can be shown: deep results take the place of the fast list.
    const engine = next.find((entry) => entry.engine === name);
    if (!engine && deepNext.length > 0 && answer.next.some((entry) => entry.engine === name)) {
      say(`${name} is not among your deep search results for ${names}.`);
      return;
    }
    if (!engine) {
      const edited = hasEdits(edits);
      say(`${name} is not a next engine for ${names || "these engines"}.${edited ? " Suggest uses the engines the deck has without your chip changes." : ""}`, edited ? name : undefined);
      return;
    }
    // One engine: the details of the link that makes it fit. Several: its card in the list, marked.
    if (set.length === 1) { const link = engine.links[0]; if (link) openBridge(link.bridge); return; }
    setLit(name);
    focusOn("lit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, active, pickMode, engines.waiting, engines.loading, engines.result, engines.error, set, next, deepNext]);

  if (disabled) return null;

  const common = { mode, genesys, cardProps, onCatalog, onOpen: openBridge };
  const top = capActionable(list?.results ?? [], BRIDGES_SHOWN);
  const noData = error instanceof BridgeRequestError && error.status === 400;
  // The host could not read the deck (in Genesys, a card with no known points): its words say why.
  const deckRefused = !pickMode && !empty && engines.error?.status === 400 ? engines.error.message : null;
  const skeleton = !noCards && (single != null ? list == null && error == null : set.length > 1 && result == null && error == null);
  const inReview = deep.phase === "done" && deep.inReview != null ? deep.inReview : (single ? list?.inReview : result?.inReview) ?? 0;
  const running = deep.phase === "starting" || deep.phase === "running";
  const removedAll = !pickMode && !empty && set.length === 0 && engines.found.length > 0;
  // Two or more picks already compare archetypes, so the two-archetype search would only say the same thing again.
  const searchOffered = !(pickMode && set.length > 1);

  const hint = noCards ? "Add a few Main Deck cards. Bridges for your deck show here."
    : pickMode && set.length === 0 ? "Pick one to four archetypes to see the bridges between them."
    : deckRefused ? `${deckRefused.replace(/\.$/, "")}. You can still pick archetypes by name.`
    : removedAll ? "You took out every engine of this deck. Reset to deck, or add one."
    : set.length === 0 ? "Add cards from one archetype to see where your deck can bridge."
    : noData ? `No bridges are mapped for ${single ?? set.join(", ")} yet.`
    : "No bridge that passed our checks yet. Try a deep search.";
  const ownLabel = pickMode && single ? `${single} can bridge into` : "Your deck can bridge into";
  const betweenTitle = pickMode ? "Bridges between these archetypes" : "Bridges between your engines";
  const actionHint = cooldown > 0 ? "You can run 15 deep searches per hour. The button comes back when the time is up."
    : elsewhere ? "One deep search runs at a time. This one can start when it ends."
    : "Deep search checks every archetype, not only the top few.";

  return (
    <section ref={rootRef} className={styles.row} aria-labelledby={`${hintId}-title`} data-testid="bridges-row"
      onClickCapture={(event) => { clicked.current = (event.target as HTMLElement).closest<HTMLElement>("[data-bridge]"); }}>
      <h3 id={`${hintId}-title`} className={styles.rowTitle} tabIndex={-1}>Bridges</h3>
      {open ? (
        <BridgeDetails bridge={open} mode={mode} onCatalog={onCatalog} cardProps={cardProps} deckCount={deckCount} limit={limit} genesys={genesys} adder={adder} onBack={() => setOpen(null)} />
      ) : (
        <div className={styles.body}>
          <div className={styles.modes} role="group" aria-label="Choose the engines" data-testid="engine-modes">
            <button type="button" className={styles.mode} aria-pressed={!pickMode} onClick={() => setPickMode(false)}>Use my deck</button>
            <button type="button" className={styles.mode} aria-pressed={pickMode} onClick={() => setPickMode(true)}>Pick archetypes</button>
          </div>
          {pickMode ? (
            <EngineChips title="Archetypes to compare" set={set} busy={setLoading}
              onRemove={(name) => setPicks((now) => now.filter((item) => item !== name))}
              onAdd={(name) => setPicks((now) => (now.includes(name) || now.length >= MAX_ENGINES ? now : [...now, name]))} />
          ) : !empty && !deckRefused && engines.waiting ? (
            <div className={styles.chipSkeletons} data-testid="engine-chips-loading" role="status" aria-label="Looking for the engines of your deck">
              <span className={styles.chipSkeleton} aria-hidden /><span className={styles.chipSkeleton} aria-hidden />
            </div>
          ) : !empty && !deckRefused && !(engines.error && engines.found.length === 0) ? (
            <EngineChips title="Engines in this deck" set={set} light={lightEngines(engines.detected, set)} edited={hasEdits(edits)} busy={engines.loading} keepOne
              onRemove={(name) => setEdits((now) => toggleEngine(now, engines.found, name, false))}
              onAdd={(name) => setEdits((now) => toggleEngine(now, engines.found, name, true))}
              onReset={() => setEdits(() => NO_EDITS)} />
          ) : null}
          {notice ? (
            <p className={styles.notice} role="status" tabIndex={-1} data-testid="bridges-notice">
              {notice.text}
              {notice.resetFor ? <> <button type="button" className={styles.link} data-testid="bridges-notice-reset" onClick={() => { const name = notice.resetFor!; setNotice(null); setEdits(() => NO_EDITS); setPending({ kind: "engine", name, count: -1 }); }}>Reset to deck and show it</button></> : null}
            </p>
          ) : null}

          {/* Deep search sits under the chips: the second thing a player looks for, never a long scroll away. */}
          <div className={styles.actions}>
            <DeepSearchButton deep={deep} cooldown={cooldown} blocked={blocked} disabled={!scope} again={stale} describedBy={hintId} onStart={() => void start()} />
            {searchOffered ? <button type="button" className={styles.link} aria-expanded={searching} data-testid="bridge-search-toggle" onClick={() => setSearching((now) => !now)}>{searching ? "Hide two-archetype search" : "Search two archetypes"}</button> : null}
            <span id={hintId} className={styles.actionHint}>{actionHint}</span>
          </div>
          {elsewhere ? <DeepProgress deep={{ phase: "running", step: elsewhere.step, progress: elsewhere.progress }} title={`Your deep search for ${elsewhere.names || "other engines"} is still running...`} testId="deep-elsewhere" /> : null}
          {running || deep.phase === "failed" ? <DeepProgress deep={deep} /> : null}
          {deep.phase === "failed" && deep.error ? <p className={styles.errorLine} role="alert" data-testid="deep-error">{deep.error}</p> : null}
          {deepNotice ? <p className={styles.note} role="status" data-testid="deep-notice">{deepNotice}</p> : null}
          {stale ? <p className={styles.note} data-testid="deep-stale">Your cards changed since the deep search for {names}. Search again to update what it shows.</p> : null}
          {searching && searchOffered ? (
            <BridgeSearch start={first ?? archetype} genesys={genesys} genesysRemaining={genesysRemaining}
              renderList={(bridges, title) => <BridgeList {...common} bridges={bridges} showSource label={title} />} />
          ) : null}

          {single && !noCards ? <p className={styles.lead}>{pickMode ? <><strong>{single}</strong> can bridge into</> : <>Your <strong>{single}</strong> deck can bridge into</>}</p> : null}
          {/* One reserved height for loading, results and the empty state, so the list below does not jump. */}
          <div className={styles.results}>
            {single && !noCards && top.length > 0 ? (
              <div aria-busy={loading || undefined}><BridgeList {...common} bridges={top} label={ownLabel} /></div>
            ) : set.length > 1 && !noCards && (between.length > 0 || next.length > 0 || deepDone) ? (
              <div className={styles.betweenList} aria-busy={setLoading || updating || undefined}>
                {between.length > 0 ? <BetweenList bridges={between} title={betweenTitle} onOpen={openBridge} /> : null}
                {next.length > 0 ? (
                  <section aria-label={`Next engine for ${names}`} data-testid={deepNext.length > 0 ? "deep-results" : "engines-next"}>
                    <h4 className={styles.subTitle}>Next engine for {names}</h4>
                    {deepNext.length > 0 ? <p className={styles.note} data-testid="deep-from">From your deep search{fresh.size > 0 ? `: ${fresh.size} new` : ""}.</p> : null}
                    <EngineList engines={next} mode={mode} genesys={genesys} cardProps={cardProps} adder={adder} limit={limit} onCatalog={onCatalog} label={`Next engine for ${names}`} lit={lit} fresh={fresh} onOpenLink={openBridge} />
                  </section>
                ) : null}
                {deepDone && deepNext.length === 0 ? (
                  <div data-testid="deep-results"><p className={styles.hint} data-testid="deep-none">The deep search found no engine for {names} that passed our checks.</p></div>
                ) : null}
              </div>
            ) : skeleton || (!pickMode && !noCards && engines.waiting) ? (
              <div className={styles.skeletons} role="status" aria-label="Looking for bridges">{Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.skeleton} aria-hidden />)}</div>
            ) : error && !noData && !deckRefused ? (
              <p className={styles.hint} role="alert">{error.status === 403 ? "Bridges need a player in this community." : "Bridges are not available right now."}{error.status === 403 ? null : <> <button type="button" className={styles.link} onClick={retry}>Try again</button></>}</p>
            ) : (
              <p className={styles.hint} data-testid="bridges-empty">{hint}</p>
            )}
          </div>
          {inReview > 0 ? <p className={styles.note} data-testid="bridges-in-review">{inReview} {inReview === 1 ? "bridge is" : "bridges are"} still in review.</p>
            : skeleton ? <p className={styles.note} aria-hidden style={{ visibility: "hidden" }}>&nbsp;</p> : null}

          {single && deep.phase === "done" ? (
            <div className={styles.deepResults} data-testid="deep-results">
              <h4 className={styles.subTitle}>Deep search results</h4>
              {deep.results.length > 0
                ? <BridgeList {...common} bridges={capActionable(deep.results, DEEP_BRIDGES_SHOWN)} label="Deep search results" />
                : <p className={styles.hint} data-testid="deep-none">The deep search found no more bridges that passed our checks.</p>}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
