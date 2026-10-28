"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { BridgeCard, type CardPropsFor } from "./bridge-card";
import { BridgeDetails } from "./bridge-details";
import { BridgeSearch } from "./bridge-search";
import { DeepProgress, DeepSearchButton } from "./deep-search";
import { BridgeRequestError, type BridgeScope, type ShownBridge } from "./bridges-api";
import { BRIDGES_SHOWN } from "./bridges-model";
import { useBridgeCards, useBridgeList, useDeepSearch } from "./use-bridges";
import styles from "./bridges.module.css";

type Props = {
  /** The archetype of the deck. Null: the deck has none yet, so only the two-archetype search works. */
  archetype: string | null;
  /** The deck has no Main Deck cards. */
  empty: boolean;
  mode: DuelMode;
  genesys: boolean;
  genesysRemaining?: number;
  cardProps: CardPropsFor;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** The server has no bridges (or Suggestions are off). */
  onDisabled?: () => void;
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
 * The Bridges row of Suggestions: where the deck's archetype can go next, the best few bridges first. A bridge
 * opens its details in place; Deep search looks wider with a progress bar; "Search two archetypes" is a free
 * lookup. Only bridges that passed the checks reach this row, so there is nothing to filter here.
 */
export function BridgesRow({ archetype, empty, mode, genesys, genesysRemaining, cardProps, deckCount, limit, onCatalog, onDisabled }: Props) {
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;
  const rootRef = useRef<HTMLElement>(null);
  const hintId = useId();
  const [open, setOpen] = useState<ShownBridge | null>(null);
  const [searching, setSearching] = useState(false);
  // The bridge a details view was opened from, so Back can give the focus to it again.
  const cameFrom = useRef<string | null>(null);

  const format = genesys ? "genesys" : "advanced";
  const scope: BridgeScope | null = archetype && !empty ? { source: archetype, format, ...(genesys && genesysRemaining != null ? { genesysRemaining } : {}) } : null;
  const { list, loading, error, retry } = useBridgeList(scope, true);
  const { deep, start, cooldown, blocked } = useDeepSearch(scope);

  // The server says bridges are off: this row goes away, like the other rows do for Suggestions.
  useEffect(() => { if (error?.status === 404) onDisabledRef.current?.(); }, [error]);
  // A new archetype or format closes the details of the old one.
  const scopeId = scope ? `${scope.source}|${scope.format}` : "";
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

  if (error?.status === 404) return null;

  const common = { mode, genesys, cardProps, onCatalog, onOpen: openBridge };
  const top = list?.results.slice(0, BRIDGES_SHOWN) ?? [];
  const noData = error instanceof BridgeRequestError && error.status === 400;
  const skeleton = scope != null && list == null && error == null;
  const inReview = deep.phase === "done" && deep.inReview != null ? deep.inReview : list?.inReview ?? 0;
  const running = deep.phase === "starting" || deep.phase === "running";

  const hint = !archetype || empty
    ? (empty ? "Add a few Main Deck cards. Bridges for your deck show here." : "Add cards from one archetype to see where your deck can bridge.")
    : noData ? `No bridges are mapped for ${archetype} yet.`
    : "No bridge that passed our checks yet. Try a deep search.";

  return (
    <section ref={rootRef} className={styles.row} aria-labelledby={`${hintId}-title`} data-testid="bridges-row">
      <h3 id={`${hintId}-title`} className={styles.rowTitle}>Bridges</h3>
      {open ? (
        <BridgeDetails bridge={open} mode={mode} onCatalog={onCatalog} cardProps={cardProps} deckCount={deckCount} limit={limit} genesys={genesys} onBack={() => setOpen(null)} />
      ) : (
        <div className={styles.body}>
          <p className={styles.lead}>Your deck can bridge into{archetype && !empty ? <> from <strong>{archetype}</strong></> : null}</p>
          {/* One reserved height for loading, results and the empty state, so the list below does not jump. */}
          <div className={styles.results}>
            {top.length > 0 ? (
              <div aria-busy={loading || undefined}><BridgeList {...common} bridges={top} label="Your deck can bridge into" /></div>
            ) : skeleton ? (
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
              {cooldown > 0 ? "You searched a moment ago. The button comes back when the time is up." : "Deep search checks every archetype, not only the top few."}
            </span>
          </div>
          {inReview > 0 ? <p className={styles.note} data-testid="bridges-in-review">{inReview} {inReview === 1 ? "bridge is" : "bridges are"} still in review.</p>
            : skeleton ? <p className={styles.note} aria-hidden style={{ visibility: "hidden" }}>&nbsp;</p> : null}

          {running || deep.phase === "failed" ? <DeepProgress deep={deep} /> : null}
          {deep.phase === "failed" && deep.error ? <p className={styles.errorLine} role="alert" data-testid="deep-error">{deep.error}</p> : null}
          {deep.phase === "done" ? (
            <div className={styles.deepResults} data-testid="deep-results">
              <h4 className={styles.subTitle}>Deep search results</h4>
              {deep.results.length > 0
                ? <BridgeList {...common} bridges={deep.results} label="Deep search results" />
                : <p className={styles.hint} data-testid="deep-none">The deep search found no more bridges that passed our checks.</p>}
            </div>
          ) : null}

          {searching ? (
            <BridgeSearch start={archetype} genesys={genesys} genesysRemaining={genesysRemaining}
              renderList={(bridges, title) => <BridgeList {...common} bridges={bridges} showSource label={title} />} />
          ) : null}
        </div>
      )}
    </section>
  );
}
