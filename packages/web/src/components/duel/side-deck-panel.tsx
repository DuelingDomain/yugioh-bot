"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DuelDeck, DuelSeriesSideState, DuelSeriesSummary } from "@yugidraft/shared/duels";
import { getDuelCards, readySeries, saveSeriesSideDeck, unreadySeries } from "./api";
import { cardArtUrl } from "./constants";
import { cx, sheetRoot, SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./series.module.css";
import { formatCountdown } from "./series-model";
import { OpponentSideChip, useSecondsUntil } from "./series-next";
import {
  deckCodes,
  deckCounts,
  isValidSideChange,
  sameDeck,
  swapCount,
  swapProblem,
  swapWithSide,
  type SwapSection,
  type SwapSource,
} from "./side-deck-model";

type CardMeta = { name: string; type: number };

function Tile({ code, meta, selected, changed, disabled, onClick }: {
  code: number;
  meta: CardMeta | undefined;
  selected: boolean;
  changed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const name = meta?.name ?? String(code);
  return (
    <li>
      <button type="button" className={styles.tile} aria-pressed={selected} data-changed={changed ? "true" : undefined}
        aria-label={changed ? `${name}, swapped in` : name} title={name} disabled={disabled} onClick={onClick}>
        <img src={cardArtUrl(code, "small")} alt="" loading="lazy" draggable={false}
          onError={(event) => { event.currentTarget.style.visibility = "hidden"; }} />
      </button>
    </li>
  );
}

function Group({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className={styles.group} aria-label={`${title} deck`}>
      <h3 className={styles.groupHead}>{title}<span>{count}</span></h3>
      {count === 0 ? <p className={styles.hintLine}>Empty</p> : <ul className={styles.tiles}>{children}</ul>}
    </section>
  );
}

/**
 * Side deck window between games of a Best of 3. Pick one card from the Main or Extra Deck and one
 * from the Side Deck to swap them; the Side Deck size never changes. Save stores the deck for the
 * next game, Ready saves first when needed. A ready player who starts editing is un-readied on the
 * server at once (before anything is saved), so the opponent's Ready cannot start the next game while
 * they are still swapping; they click Ready again when done. Saving a changed deck also clears Ready.
 * The cards are locked while a save or Ready is in flight, so no edit can slip past the deck it sends.
 */
export function SideDeckPanel({ slug, series, myIndex, side, onClose, onChanged, onNavigate }: {
  slug: string;
  series: DuelSeriesSummary;
  myIndex: 0 | 1;
  side: DuelSeriesSideState;
  onClose: () => void;
  /** Refreshes the room; a returned promise settles once the room has the new state. */
  onChanged: () => void | Promise<unknown>;
  onNavigate: (slug: string) => void;
}) {
  const [draft, setDraft] = useState<DuelDeck>(side.currentDeck);
  const serverKey = JSON.stringify(side.currentDeck);
  const [seenKey, setSeenKey] = useState(serverKey);
  const [out, setOut] = useState<SwapSource | null>(null);
  const [inIndex, setInIndex] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Ready: the server's flag is the truth. This panel's own requests know newer answers than the
  // room's last refresh, so `known` holds what they said until the server's flag next changes.
  const serverReady = series.sideReady[myIndex];
  const [seenReady, setSeenReady] = useState(serverReady);
  const [known, setKnown] = useState<boolean | null>(null);
  /** A Ready (or un-ready) whose answer was lost: the server may say ready, so the next edit un-readies. */
  const [maybeReady, setMaybeReady] = useState(false);
  /** This player's Ready was taken back (by editing or a save); shown until they are ready again. */
  const [unreadied, setUnreadied] = useState(false);
  /** The un-ready request in flight; Ready waits for it so the two cannot land out of order. */
  const unreadying = useRef<Promise<void> | null>(null);
  const [meta, setMeta] = useState<ReadonlyMap<number, CardMeta>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);
  const seconds = useSecondsUntil(series.nextGameAt);

  // The server deck changed (a save, or a new game): start from it again.
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    setDraft(side.currentDeck);
    setOut(null);
    setInIndex(null);
  }
  if (serverReady !== seenReady) {
    setSeenReady(serverReady);
    setKnown(null);
    setMaybeReady(false);
    if (serverReady) setUnreadied(false);
  }

  const { base } = { base: side.baseDeck };
  const codesKey = deckCodes(base).sort((a, b) => a - b).join(",");
  useEffect(() => {
    let cancelled = false;
    const codes = codesKey ? codesKey.split(",").map(Number) : [];
    if (codes.length === 0) return undefined;
    void getDuelCards(codes).then(
      ({ cards }) => { if (!cancelled) setMeta(new Map(cards.map((card) => [card.code, { name: card.name, type: card.type }]))); },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [codesKey]);

  // The room passes a new onClose on every live update. Keep the latest one in a ref so the focus
  // move below runs once on mount and never pulls focus away from a player who is picking cards.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onCloseRef.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const types = useMemo(() => new Map([...meta].map(([code, info]) => [code, info.type] as const)), [meta]);
  const counts = deckCounts(draft);
  const dirty = !sameDeck(draft, side.currentDeck);
  const atBase = sameDeck(draft, base);
  const swaps = swapCount(base, draft);
  const imReady = known ?? serverReady;

  /**
   * Any edit takes Ready back on the server straight away whenever the server might have this player
   * ready: its latest flag says so, this panel's own requests said so, or a Ready's answer was lost.
   * Un-ready is harmless when already not ready, so a spare request costs nothing.
   */
  function leaveReady() {
    if (!(serverReady || imReady || maybeReady) || unreadying.current) return;
    const before = known;
    setKnown(false);
    setMaybeReady(false);
    setUnreadied(true);
    unreadying.current = unreadySeries(slug).then(
      (result) => {
        if (result.nextSlug) onNavigate(result.nextSlug);
        else void onChanged();
      },
      (cause: unknown) => {
        // Still ready as far as anyone knows: the next edit tries again, and a save also clears Ready.
        setKnown(before);
        setMaybeReady(true);
        setUnreadied(false);
        setError(cause instanceof Error ? cause.message : "Could not take back your Ready. Try again.");
      },
    ).finally(() => { unreadying.current = null; });
  }

  function tryApply(source: SwapSource, sideIndex: number) {
    const why = swapProblem(draft, source, sideIndex, types);
    if (why) {
      setProblem(why);
      setInIndex(null);
      return;
    }
    const next = swapWithSide(draft, source, sideIndex);
    if (!isValidSideChange(draft, next)) {
      setProblem("That swap would change the deck size.");
      return;
    }
    setDraft(next);
    setOut(null);
    setInIndex(null);
    setProblem(null);
  }

  function pickDeckCard(section: SwapSection, index: number) {
    if (busy) return;
    leaveReady();
    setProblem(null);
    if (out?.section === section && out.index === index) {
      setOut(null);
      return;
    }
    const source = { section, index };
    if (inIndex != null) tryApply(source, inIndex);
    else setOut(source);
  }

  function pickSideCard(index: number) {
    if (busy) return;
    leaveReady();
    setProblem(null);
    if (inIndex === index) {
      setInIndex(null);
      return;
    }
    if (out) tryApply(out, index);
    else setInIndex(index);
  }

  async function work(job: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const save = () => work(async () => {
    const result = await saveSeriesSideDeck(slug, draft);
    const nowReady = result.series.sideReady[myIndex];
    if (imReady && !nowReady) setUnreadied(true);
    setKnown(nowReady);
    void onChanged();
  });
  // `dirty` and `draft` are read at the click: the cards stay locked until this finishes.
  const ready = () => work(async () => {
    await unreadying.current;
    if (dirty) await saveSeriesSideDeck(slug, draft);
    setMaybeReady(true);
    const result = await readySeries(slug);
    setMaybeReady(false);
    setKnown(result.series.sideReady[myIndex]);
    setUnreadied(false);
    if (result.nextSlug) onNavigate(result.nextSlug);
    else {
      // Close once the room has the new Ready, so reopening the panel never starts from stale state.
      await Promise.resolve(onChanged()).catch(() => undefined);
      onClose();
    }
  });

  const tiles = (section: SwapSection) => draft[section].map((code, index) => (
    <Tile key={`${section}-${index}`} code={code} meta={meta.get(code)}
      selected={out?.section === section && out.index === index}
      changed={base[section][index] !== code} disabled={busy}
      onClick={() => pickDeckCard(section, index)} />
  ));

  return (
    <div ref={rootRef} className={cx(sheetRoot, styles.sideSheet)} role="dialog" aria-modal="true" aria-labelledby="side-deck-title" tabIndex={-1}>
      <div className={styles.sideInner}>
        <header className={styles.sideHead}>
          <div className={styles.sideTitle}>
            <h2 id="side-deck-title" className={ui.title}>Side deck</h2>
            <p className={ui.hint}>
              Pick a card from your Main or Extra Deck, then one from your Side Deck, to swap them.
              Your Side Deck keeps its size. Extra Deck cards swap only with Extra Deck monsters.
            </p>
            {series.nextGameAt != null ? (
              <p className={ui.hint}>When the timer runs out, the next game starts with your last saved deck, ready or not.</p>
            ) : null}
            <OpponentSideChip series={series} index={myIndex} />
          </div>
          <div className={styles.badges}>
            <span className={styles.badge} data-tone="accent">Game {series.gameNumber + 1} of {series.bestOf}</span>
            {seconds != null ? <span className={styles.badge} data-tone="gold" role="timer">Starts in {formatCountdown(seconds)}</span> : null}
            {imReady || unreadied
              ? <span className={styles.badge} data-tone={imReady ? "accent" : undefined}>{imReady ? "You are ready" : "Not ready"}</span>
              : null}
            <span className={styles.badge}>Main {counts.main}</span>
            <span className={styles.badge}>Extra {counts.extra}</span>
            <span className={styles.badge}>Side {counts.side}</span>
          </div>
        </header>

        <div className={styles.sideCols}>
          <div className={styles.sideCol}>
            <Group title="Main" count={draft.main.length}>{tiles("main")}</Group>
            <Group title="Extra" count={draft.extra.length}>{tiles("extra")}</Group>
          </div>
          <div className={styles.sideCol}>
            <Group title="Side" count={draft.side.length}>
              {draft.side.map((code, index) => (
                <Tile key={`side-${index}`} code={code} meta={meta.get(code)} selected={inIndex === index}
                  changed={base.side[index] !== code} disabled={busy} onClick={() => pickSideCard(index)} />
              ))}
            </Group>
          </div>
        </div>

        {problem ? <p className={styles.problem} role="alert">{problem}</p> : null}
        {error ? <p className={styles.problem} role="alert">{error}</p> : null}
        {imReady && dirty ? (
          <p className={styles.hintLine} role="status">Saving these swaps clears your Ready. Click Ready again when you are done.</p>
        ) : unreadied ? (
          <p className={styles.hintLine} role="status">You are no longer ready. Finish your swaps, then click Ready for next game.</p>
        ) : null}
        <footer className={styles.sideFoot}>
          <SheetButton kind="secondary" disabled={busy || atBase} onClick={() => { leaveReady(); setDraft(base); setOut(null); setInIndex(null); setProblem(null); }}>
            Reset to registered deck
          </SheetButton>
          <SheetButton kind="secondary" loading={busy} disabled={busy || !dirty} onClick={() => void save()}>Save</SheetButton>
          {swaps > 0 ? <span className={styles.changed}>{swaps} {swaps === 1 ? "card" : "cards"} swapped from your registered deck</span> : null}
          <span className={styles.spacer} />
          <SheetButton kind="quiet" disabled={busy} onClick={onClose}>Close</SheetButton>
          <SheetButton kind="primary" loading={busy} disabled={busy || (imReady && !dirty)} onClick={() => void ready()}>
            {imReady && !dirty ? "Ready" : "Ready for next game"}
          </SheetButton>
        </footer>
      </div>
    </div>
  );
}
