"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { BridgeCard, type CardPropsFor } from "./bridge-card";
import { BridgeDetails } from "./bridge-details";
import { BridgeSearch } from "./bridge-search";
import { DeepProgress, DeepSearchButton } from "./deep-search";
import { EngineChips } from "./engine-chips";
import { EngineList } from "./engine-card";
import { BridgeRequestError, type BridgeScope, type ShownBridge } from "./bridges-api";
import { BRIDGES_SHOWN, DEEP_BRIDGES_SHOWN } from "./bridges-model";
import { NO_EDITS, bridgeDeck, bridgeFormat, hasEdits, lightEngines, sameNames, toggleEngine, type EngineEdits } from "./engines-model";
import { useBridgeCards, useBridgeList, useDeepSearch } from "./use-bridges";
import { useDeckEngines } from "./use-engines";
import styles from "./bridges.module.css";

/** An engine the Suggest tab asked to show. `count` grows with every ask, so asking again for the same engine works. */
export type FocusEngine = { name: string; count: number };

type Props = {
  /** The archetype the editor found in the deck. Only a start for the two-archetype search; the engines come from the host. */
  archetype: string | null;
  /** The open deck. The host finds its engines from the card lists. */
  deck: { main: readonly number[]; extra: readonly number[] };
  deckMaster?: number | null;
  mode: DuelMode;
  genesys: boolean;
  genesysRemaining?: number;
  cardProps: CardPropsFor;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** The server has no bridges (or Suggestions are off). */
  onDisabled?: () => void;
  /** The tab of the row is on screen. A hidden row asks for no new list, but a running deep search goes on. */
  active?: boolean;
  /** A deep search just finished. */
  onDeepFinished?: () => void;
  /** Show this engine: its bridge opens (one engine) or its card is brought into view (several). */
  focus?: FocusEngine | null;
};

type ListProps = Pick<Props, "mode" | "genesys" | "cardProps" | "onCatalog"> & { bridges: readonly ShownBridge[]; showSource?: boolean; onOpen: (bridge: ShownBridge) => void; label: string };

/** A list of bridges. The cards of the bridges load together, so the thumbnails fill in at once. */
function BridgeList({ bridges, mode, genesys, cardProps, onCatalog, showSource, onOpen, label }: ListProps) {
  const cards = useBridgeCards([...new Set(bridges.flatMap((bridge) => bridge.cards.slice(0, 4)))], mode, onCatalog);
  return (
    <ul className={styles.list} aria-label={label}>
      {bridges.map((bridge) => <BridgeCard key={`${bridge.source}>${bridge.target}:${bridge.evidence_hash}`} bridge={bridge} cards={cards} cardProps={cardProps} genesys={genesys} showSource={showSource} onOpen={onOpen} />)}
    </ul>
  );
}

/**
 * The Bridges tab of the deck editor: where the deck's archetype can go next, the best few bridges first. A bridge
 * opens its details in place; Deep search looks wider with a progress bar; "Search two archetypes" is a free
 * lookup. Only bridges that passed the checks reach this row, so there is nothing to filter here.
 */
export function BridgesRow({ archetype, deck, deckMaster, mode, genesys, genesysRemaining, cardProps, deckCount, limit, onCatalog, onDisabled, active = true, onDeepFinished, focus = null }: Props) {
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;
  const onDeepFinishedRef = useRef(onDeepFinished);
  onDeepFinishedRef.current = onDeepFinished;
  const rootRef = useRef<HTMLElement>(null);
  const hintId = useId();
  const [open, setOpen] = useState<ShownBridge | null>(null);
  const [searching, setSearching] = useState(false);
  // The bridge a details view was opened from, so Back can give the focus to it again.
  const cameFrom = useRef<string | null>(null);

  const empty = deck.main.length === 0;
  const format = bridgeFormat(genesys);
  // The player's chip edits sit on top of the engines the host finds. They change this tab only.
  const [edits, setEdits] = useState<EngineEdits>(NO_EDITS);
  const engines = useDeckEngines({ deck, deckMaster, genesys, empty, enabled: active }, edits);
  const set = engines.set;
  const single = set.length === 1 ? set[0]! : null;
  // One engine: its own bridges, as before. The deep search looks from the first engine of a set.
  const first = set[0] ?? null;
  const genesysPart = genesys && genesysRemaining != null ? { genesysRemaining } : {};
  const listScope: BridgeScope | null = single && !empty ? { source: single, format, ...genesysPart } : null;
  // The deep search runs on the whole set. The open deck stands for the set when it is the one the host finds in it
  // (the host then also knows the deck's cards and points); a corrected set is sent by name.
  const multiScope = set.length > 1 ? { engines: set, ...(sameNames(set, engines.found) && engines.detected ? { deck: bridgeDeck(deck, deckMaster) } : {}) } : {};
  const scope: BridgeScope | null = first && !empty ? { source: first, format, ...genesysPart, ...multiScope } : null;
  const { list, loading, error: listError, retry: retryList } = useBridgeList(listScope, true, active);
  const { deep, start, cooldown, blocked } = useDeepSearch(scope);
  const error = listError ?? (single ? null : engines.error);
  const retry = () => { retryList(); engines.retry(); };

  // A search that ends tells the tab bar, so a hidden tab can show a dot.
  const phase = deep.phase;
  const lastPhase = useRef(phase);
  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (before !== phase && phase === "done") onDeepFinishedRef.current?.();
  }, [phase]);

  // The server says bridges are off: this row goes away, like the other rows do for Suggestions.
  const disabled = (listError ?? engines.error)?.status === 404;
  useEffect(() => { if (disabled) onDisabledRef.current?.(); }, [disabled]);
  // A new set of engines or a new format closes the details of the old one.
  const scopeId = `${set.join("|")}|${format}`;
  useEffect(() => { setOpen(null); }, [scopeId]);

  useLayoutEffect(() => {
    if (open || !cameFrom.current) return;
    const button = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-bridge]") ?? [])].find((node) => node.dataset.bridge === cameFrom.current);
    cameFrom.current = null;
    button?.focus({ preventScroll: true });
  }, [open]);

  function openBridge(bridge: ShownBridge) {
    cameFrom.current = bridge.evidence_hash;
    setOpen(bridge);
  }

  // A tap on an engine in Suggest: wait for the answer it needs, then open or show it, once.
  const handled = useRef(0);
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    if (!lit) return;
    const node = [...(rootRef.current?.querySelectorAll<HTMLElement>("[data-engine]") ?? [])].find((entry) => entry.dataset.engine === lit);
    node?.scrollIntoView({ block: "nearest" });
  }, [lit, engines.result]);
  useEffect(() => {
    if (!focus || handled.current === focus.count || !active || open) return;
    if (single) {
      if (list == null) { if (error) handled.current = focus.count; return; }
      const bridge = list.results.find((entry) => entry.target === focus.name);
      handled.current = focus.count;
      if (bridge) openBridge(bridge);
      return;
    }
    if (!engines.result) { if (error) handled.current = focus.count; return; }
    handled.current = focus.count;
    setLit(focus.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, active, open, single, list, error, engines.result]);

  if (disabled) return null;

  const common = { mode, genesys, cardProps, onCatalog, onOpen: openBridge };
  const top = list?.results.slice(0, BRIDGES_SHOWN) ?? [];
  const noData = error instanceof BridgeRequestError && error.status === 400;
  const result = engines.result;
  const between = result?.between ?? [];
  const next = result?.next ?? [];
  const skeleton = single != null ? list == null && error == null : set.length > 1 && result == null && error == null;
  const inReview = deep.phase === "done" && deep.inReview != null ? deep.inReview : (single ? list?.inReview : result?.inReview) ?? 0;
  const running = deep.phase === "starting" || deep.phase === "running";

  const hint = empty ? "Add a few Main Deck cards. Bridges for your deck show here."
    : set.length === 0 ? "Add cards from one archetype to see where your deck can bridge."
    : noData ? `No bridges are mapped for ${single ?? set.join(", ")} yet.`
    : "No bridge that passed our checks yet. Try a deep search.";
  const names = set.join(" + ");

  return (
    <section ref={rootRef} className={styles.row} aria-labelledby={`${hintId}-title`} data-testid="bridges-row">
      <h3 id={`${hintId}-title`} className={styles.rowTitle}>Bridges</h3>
      {open ? (
        <BridgeDetails bridge={open} mode={mode} onCatalog={onCatalog} cardProps={cardProps} deckCount={deckCount} limit={limit} genesys={genesys} onBack={() => setOpen(null)} />
      ) : (
        <div className={styles.body}>
          {!empty ? (
            <EngineChips title="Engines in this deck" set={set} light={lightEngines(engines.detected, set)} edited={hasEdits(edits)} busy={engines.loading}
              onRemove={(name) => setEdits((now) => toggleEngine(now, engines.found, name, false))}
              onAdd={(name) => setEdits((now) => toggleEngine(now, engines.found, name, true))}
              onReset={() => setEdits(NO_EDITS)} />
          ) : null}
          {single ? <p className={styles.lead}>Your <strong>{single}</strong> deck can bridge into</p> : null}
          {/* One reserved height for loading, results and the empty state, so the list below does not jump. */}
          <div className={styles.results}>
            {single && top.length > 0 ? (
              <div aria-busy={loading || undefined}><BridgeList {...common} bridges={top} label="Your deck can bridge into" /></div>
            ) : set.length > 1 && (between.length > 0 || next.length > 0) ? (
              <div className={styles.betweenList} aria-busy={engines.loading || undefined}>
                {between.length > 0 ? (
                  <section aria-label="Bridges between your engines" data-testid="engines-between">
                    <h4 className={styles.subTitle}>Bridges between your engines</h4>
                    <BridgeList {...common} bridges={between} showSource label="Bridges between your engines" />
                  </section>
                ) : null}
                {next.length > 0 ? (
                  <section aria-label={`Next engine for ${names}`} data-testid="engines-next">
                    <h4 className={styles.subTitle}>Next engine for {names}</h4>
                    <EngineList engines={next} mode={mode} genesys={genesys} cardProps={cardProps} onCatalog={onCatalog} label={`Next engine for ${names}`} lit={lit} />
                  </section>
                ) : null}
              </div>
            ) : skeleton || engines.waiting ? (
              <div className={styles.skeletons} role="status" aria-label="Looking for bridges">{Array.from({ length: 4 }, (_, index) => <span key={index} className={styles.skeleton} aria-hidden />)}</div>
            ) : error && !noData ? (
              <p className={styles.hint} role="alert">{error.status === 403 ? "Bridges need a player in this community." : "Bridges are not available right now."}{error.status === 403 ? null : <> <button type="button" className={styles.link} onClick={retry}>Try again</button></>}</p>
            ) : (
              <p className={styles.hint} data-testid="bridges-empty">{hint}</p>
            )}
          </div>

          <div className={styles.actions}>
            <DeepSearchButton deep={deep} cooldown={cooldown} blocked={blocked} disabled={!scope} describedBy={hintId} onStart={() => void start()} />
            <button type="button" className={styles.link} aria-expanded={searching} data-testid="bridge-search-toggle" onClick={() => setSearching((now) => !now)}>{searching ? "Hide two-archetype search" : "Search two archetypes"}</button>
            <span id={hintId} className={styles.actionHint}>
              {cooldown > 0 ? "You can run 15 deep searches per hour. The button comes back when the time is up." : "Deep search checks every archetype, not only the top few."}
            </span>
          </div>
          {inReview > 0 ? <p className={styles.note} data-testid="bridges-in-review">{inReview} {inReview === 1 ? "bridge is" : "bridges are"} still in review.</p>
            : skeleton ? <p className={styles.note} aria-hidden style={{ visibility: "hidden" }}>&nbsp;</p> : null}

          {running || deep.phase === "failed" ? <DeepProgress deep={deep} /> : null}
          {deep.phase === "failed" && deep.error ? <p className={styles.errorLine} role="alert" data-testid="deep-error">{deep.error}</p> : null}
          {deep.phase === "done" ? (
            <div className={styles.deepResults} data-testid="deep-results">
              <h4 className={styles.subTitle}>Deep search results</h4>
              {set.length > 1 ? (
                deep.next.length > 0
                  ? <EngineList engines={deep.next} mode={mode} genesys={genesys} cardProps={cardProps} onCatalog={onCatalog} label="Deep search results" />
                  : <p className={styles.hint} data-testid="deep-none">The deep search found no engine for {names} that passed our checks.</p>
              ) : deep.results.length > 0
                ? <BridgeList {...common} bridges={deep.results.slice(0, DEEP_BRIDGES_SHOWN)} label="Deep search results" />
                : <p className={styles.hint} data-testid="deep-none">The deep search found no more bridges that passed our checks.</p>}
            </div>
          ) : null}

          {searching ? (
            <BridgeSearch start={first ?? archetype} genesys={genesys} genesysRemaining={genesysRemaining}
              renderList={(bridges, title) => <BridgeList {...common} bridges={bridges} showSource label={title} />} />
          ) : null}
        </div>
      )}
    </section>
  );
}
