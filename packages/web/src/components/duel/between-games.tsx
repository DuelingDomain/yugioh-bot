"use client";

import { Children, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DuelDeck, DuelRoom, DuelSeriesSummary } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import deckStyles from "@/components/decks/editor.module.css";
import { cancelSeries, chooseSeriesFirst, DuelRequestError, getDuelCards, readySeries, saveSeriesSideDeck, unreadySeries } from "./api";
import { DeckCardPreview } from "./deck-card-preview";
import { cx, sheetRoot, SheetButton } from "./sheet-ui";
import ui from "./sheet-ui.module.css";
import styles from "./between-games.module.css";
import { betweenGamesInfo, canCancelInterrupted, formatCountdown, seriesCompactScore, seriesKindLabel, seriesPlayerIndex, viewerChoosesFirst } from "./series-model";
import { FirstChoiceGroup, OpponentFirstChip, OpponentSideChip, useSecondsUntil } from "./series-next";
import {
  deckCodes,
  hasMarks,
  isExtraDeckType,
  isMarkedIn,
  isMarkedOut,
  NO_MARKS,
  planSideDeck,
  sameDeck,
  SIDE_EXTRA_MAX,
  SIDE_MAIN_MAX,
  SIDE_MAIN_MIN,
  toggleIn,
  toggleOut,
  type SideMarks,
  type SwapSection,
} from "./side-deck-model";

export type CardMeta = { name: string; type: number };

const EMPTY_DECK: DuelDeck = { main: [], extra: [], side: [] };

type Tag = "out" | "in";

/** One card of the deck view: a deck editor tile that can carry an OUT or IN mark. */
function Tile({ code, name, label, tag, extra, locked, onClick, onHover }: {
  code: number;
  name: string;
  label: string;
  tag?: Tag;
  /** A Side card that goes to the Extra Deck when it comes in. */
  extra?: boolean;
  locked: boolean;
  onClick: () => void;
  onHover: (code: number | null) => void;
}) {
  return (
    <li>
      <button type="button" className={cx(deckStyles.card, styles.tile)} data-tag={tag} data-locked={locked ? "true" : undefined}
        aria-pressed={tag != null} aria-disabled={locked || undefined} aria-label={label} title={name}
        onClick={() => { if (!locked) onClick(); }}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") onHover(code); }}
        onPointerLeave={() => onHover(null)}
        onFocus={() => onHover(code)}
        onBlur={() => onHover(null)}>
        <CardArt code={code} name={name} />
        {tag ? <span className={styles.tag} data-tag={tag}>{tag === "out" ? "Out" : "In"}</span> : null}
        {extra && !tag ? <span className={styles.exTag}>Extra</span> : null}
      </button>
    </li>
  );
}

function Section({ title, count, target, tone, hint, children, empty }: {
  title: string;
  count: number;
  target: string;
  tone?: "ok" | "bad";
  hint?: string;
  children: ReactNode;
  empty: string;
}) {
  return (
    <section className={deckStyles.section} aria-label={`${title} Deck`} data-testid={`section-${title.toLowerCase()}`}>
      <header className={deckStyles.sectionHead}>
        <h2 className={deckStyles.sectionTitle}>
          {title}
          <span className={cx(ui.num, deckStyles.sectionCount)} data-tone={tone} data-testid={`count-${title.toLowerCase()}`}>{count}</span>
          <span className={deckStyles.sectionTarget}>{target}</span>
        </h2>
        {hint ? <p className={styles.sectionHint}>{hint}</p> : null}
      </header>
      {Children.toArray(children).length === 0 ? <p className={deckStyles.empty}>{empty}</p> : <ul className={deckStyles.cards}>{children}</ul>}
    </section>
  );
}

/**
 * The screen between two games of a Best of 3, for a player. It replaces the table lobby: a deck view
 * like the deck editor (Main, Extra and Side) where cards come out of the Main or Extra Deck and go
 * in from the Side Deck. The count out must equal the count in, so the Side Deck never changes size.
 * Ready saves the deck for the next game (the saved deck is never touched) and marks the player ready;
 * the first subsequent deck edit takes Ready back immediately, before saving. Editing stays locked
 * while Ready is in flight, and Ready waits for un-ready so the requests cannot land out of order.
 * When both players are ready the room follows the series to the next game.
 */
export function BetweenGamesScreen({ room, slug, onChanged, onNavigate, knownCards, initialMarks }: {
  room: DuelRoom;
  slug: string;
  onChanged: () => void | Promise<unknown>;
  onNavigate: (slug: string) => void;
  /** Card names and types known up front (the FX lab has no card database). */
  knownCards?: ReadonlyMap<number, CardMeta>;
  /** Marks to start with (the FX lab shows siding in progress). */
  initialMarks?: SideMarks;
}) {
  const series = room.series as DuelSeriesSummary;
  const index = seriesPlayerIndex(room, series);
  const info = betweenGamesInfo(room, slug);
  const seconds = useSecondsUntil(series.nextGameAt);
  const side = room.mySide ?? null;
  const serverDeck = side?.currentDeck ?? EMPTY_DECK;
  const base = side?.baseDeck ?? serverDeck;
  const [current, setCurrent] = useState(serverDeck);

  const [marks, setMarks] = useState<SideMarks>(initialMarks ?? NO_MARKS);
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ReadonlyMap<number, CardMeta>>(knownCards ?? new Map());
  const [hovered, setHovered] = useState<number | null>(null);
  const serverReady = index != null && series.sideReady[index];
  const [seenReady, setSeenReady] = useState(serverReady);
  // Local request results keep the UI accurate until the room catches up. Never use these flags
  // to decide whether an edit needs un-ready: a stale snapshot or lost Ready answer is unsafe.
  const [knownReady, setKnownReady] = useState<boolean | null>(null);
  const [unreadied, setUnreadied] = useState(false);
  const unreadySent = useRef(false);
  const unreadying = useRef<Promise<void> | null>(null);
  const working = useRef(false);
  const [moving, setMoving] = useState(false);
  const advancing = useRef(false);

  // The server deck changed (Ready saved it, or a new game began): the marks start again from it.
  const serverKey = JSON.stringify(serverDeck);
  const [seenKey, setSeenKey] = useState(serverKey);
  if (serverKey !== seenKey) {
    setSeenKey(serverKey);
    // A save's snapshot can arrive after the player has already begun their next edit. Keep those
    // new marks when this is merely the room catching up with our own successful save.
    if (!sameDeck(current, serverDeck)) {
      setCurrent(serverDeck);
      setMarks(NO_MARKS);
    }
  }
  if (serverReady !== seenReady) {
    setSeenReady(serverReady);
    setKnownReady(null);
    if (serverReady) setUnreadied(false);
  }
  // Re-arm even when a fresh snapshot is still true: another tab may have sent Ready again.
  useEffect(() => { if (serverReady) unreadySent.current = false; }, [series, serverReady]);

  const codesKey = [...deckCodes(current)].sort((a, b) => a - b).join(",");
  useEffect(() => {
    let cancelled = false;
    const codes = codesKey ? codesKey.split(",").map(Number) : [];
    if (codes.length === 0) return undefined;
    void getDuelCards(codes).then(
      ({ cards }) => {
        if (!cancelled) setMeta((known) => new Map([...known, ...cards.map((card) => [card.code, { name: card.name, type: card.type }] as const)]));
      },
      () => undefined,
    );
    return () => { cancelled = true; };
  }, [codesKey]);

  const types = useMemo(() => new Map([...meta].map(([code, info]) => [code, info.type] as const)), [meta]);
  const plan = useMemo(() => planSideDeck(current, marks, types, base), [current, marks, types, base]);

  if (index == null) return null;
  const imReady = knownReady ?? serverReady;
  const theirReady = series.sideReady[index === 0 ? 1 : 0];
  const hasSide = current.side.length > 0;
  const locked = busy || moving || !hasSide;
  const choosing = viewerChoosesFirst(series, index);
  const interrupted = series.nextGameAt == null;
  const nameOf = (code: number) => meta.get(code)?.name ?? String(code);
  const changed = hasMarks(marks);
  const sideShown = plan.counts.side;
  const minMain = Math.min(SIDE_MAIN_MIN, base.main.length);

  const flag = (code: number, section: string, tag?: Tag, extra?: boolean) =>
    `${nameOf(code)}, ${section} Deck${tag === "out" ? ", going out" : tag === "in" ? ", coming in" : ""}${extra ? ", goes to the Extra Deck" : ""}`;

  async function refresh() {
    try { await onChanged(); } catch { /* The next edit still sends un-ready after a failed refresh. */ }
  }

  function follow(nextSlug: string) {
    advancing.current = true;
    setMoving(true);
    onNavigate(nextSlug);
  }

  /** First edit since mount, Ready, or a snapshot showing Ready: always send the idempotent un-ready. */
  function leaveReady() {
    if (unreadySent.current || unreadying.current) return;
    unreadySent.current = true;
    const wasReady = imReady;
    const before = knownReady;
    if (wasReady) {
      setKnownReady(false);
      setUnreadied(true);
    }
    unreadying.current = unreadySeries(slug).then(
      (result) => {
        if (result.nextSlug) follow(result.nextSlug);
        else void refresh();
      },
      (cause: unknown) => {
        unreadySent.current = false;
        if (wasReady) {
          setKnownReady(before);
          setUnreadied(false);
        }
        setError(cause instanceof Error ? cause.message : "Could not take back your Ready. Try again.");
        // A closed series rejects editing; let the room recover its current state.
        if (cause instanceof DuelRequestError && cause.status === 409) void refresh();
      },
    ).finally(() => { unreadying.current = null; });
  }

  function edit(next: SideMarks) {
    if (working.current || advancing.current || !hasSide) return;
    leaveReady();
    setMarks(next);
  }

  async function run(work: () => Promise<void>) {
    if (working.current || advancing.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong. Try again.");
      await refresh();
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const ready = () => run(async () => {
    if (plan.reason) return;
    // Any Ready attempt may land on the server, even if its answer is lost.
    unreadySent.current = false;
    await unreadying.current;
    if (advancing.current) return;
    if (changed) {
      const saved = await saveSeriesSideDeck(slug, plan.deck);
      setKnownReady(saved.series.sideReady[index]);
      setCurrent(plan.deck);
      setMarks(NO_MARKS);
    }
    const result = await readySeries(slug);
    setKnownReady(result.series.sideReady[index]);
    setUnreadied(false);
    if (result.nextSlug) follow(result.nextSlug);
    else await refresh();
  });
  const choose = (choice: "first" | "second") => run(async () => {
    if (choice === series.firstChoice) return;
    await unreadying.current;
    if (advancing.current) return;
    // The server allows choice changes while ready and does not clear Ready for them.
    const result = await chooseSeriesFirst(slug, choice);
    if (result.nextSlug) follow(result.nextSlug);
    else await refresh();
  });
  const cancel = () => run(async () => {
    await cancelSeries(series.id);
    setConfirmCancel(false);
    await refresh();
  });

  const readyReason = imReady && !changed ? null : plan.reason;
  const counterState = !changed ? "none" : plan.balanced ? "even" : "uneven";
  const status = imReady && changed
    ? "Saving these swaps clears your Ready. Click Ready again when you are done."
    : imReady
      ? (theirReady ? "Both players are ready." : !hasSide ? "Your deck has no Side Deck, so you are ready. Waiting for your opponent." : "You are ready. Waiting for your opponent.")
    : unreadied ? "You are no longer ready. Finish your swaps, then click Ready again."
    : interrupted ? "The last game did not finish. Both players must click Ready to play on."
      : !hasSide ? "Your deck has no Side Deck, so there is nothing to change. Click Ready."
        : "Click Ready to save your changes and start sooner.";

  const mainCards = current.main.map((code, i) => {
    const tag: Tag | undefined = isMarkedOut(marks, "main", i) ? "out" : undefined;
    return (
      <Tile key={`main-${i}`} code={code} name={nameOf(code)} label={flag(code, "Main", tag)} tag={tag} locked={locked}
        onClick={() => edit(toggleOut(marks, "main", i))} onHover={setHovered} />
    );
  });
  const extraCards = current.extra.map((code, i) => {
    const tag: Tag | undefined = isMarkedOut(marks, "extra", i) ? "out" : undefined;
    return (
      <Tile key={`extra-${i}`} code={code} name={nameOf(code)} label={flag(code, "Extra", tag)} tag={tag} locked={locked}
        onClick={() => edit(toggleOut(marks, "extra", i))} onHover={setHovered} />
    );
  });
  // A Side card that is marked in shows in the section it will join, with an IN mark; click to take it back.
  const incoming = (section: SwapSection) => [...plan.destination]
    .filter(([, to]) => to === section)
    .map(([sideIndex]) => {
      const code = current.side[sideIndex];
      return (
        <Tile key={`in-${section}-${sideIndex}`} code={code} name={nameOf(code)} label={flag(code, section === "main" ? "Main" : "Extra", "in")}
          tag="in" locked={locked} onClick={() => edit(toggleIn(marks, sideIndex))} onHover={setHovered} />
      );
    });
  const sideCards = current.side.map((code, i) => {
    const tag: Tag | undefined = isMarkedIn(marks, i) ? "in" : undefined;
    const type = types.get(code);
    const extra = type != null && isExtraDeckType(type);
    return (
      <Tile key={`side-${i}`} code={code} name={nameOf(code)} label={flag(code, "Side", tag, extra)} tag={tag} extra={extra} locked={locked}
        onClick={() => edit(toggleIn(marks, i))} onHover={setHovered} />
    );
  });

  const mainOk = plan.counts.main >= minMain && plan.counts.main <= SIDE_MAIN_MAX;
  const extraOk = plan.counts.extra <= SIDE_EXTRA_MAX;
  const sideOk = plan.counts.side === current.side.length;
  const kind = seriesKindLabel(series);

  return (
    <div className={cx(sheetRoot, styles.screen)} data-testid="between-games" role="region" aria-label="Between games">
      <header className={styles.head}>
        <div className={styles.headMain}>
          <p className={styles.eyebrow}>Between games</p>
          <h1 className={styles.title}>{info?.next ?? `Game ${series.gameNumber + 1} of ${series.bestOf}`}</h1>
          <p className={styles.result} data-testid="between-result">{info?.result}</p>
        </div>
        <div className={styles.chips}>
          <span className={styles.chip} data-tone="score" title={`${series.displayNames[0]} ${series.wins[0]} – ${series.wins[1]} ${series.displayNames[1]}`}>
            Score <b>{seriesCompactScore(series, index)}</b>
          </span>
          <span className={styles.chip}>{kind}</span>
          <span className={styles.chip} data-tone={seconds != null ? "gold" : undefined} role="timer" data-testid="between-timer">
            {seconds != null ? <>Starts in <b>{formatCountdown(seconds)}</b></> : "Waiting for both players"}
          </span>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.deck}>
          <Section title="Main" count={plan.counts.main} target={plan.counts.main !== current.main.length ? `was ${current.main.length}` : `${minMain}–${SIDE_MAIN_MAX} cards`}
            tone={mainOk ? undefined : "bad"} empty="No Main Deck cards.">
            {[...mainCards, ...incoming("main")]}
          </Section>
          <Section title="Extra" count={plan.counts.extra} target={plan.counts.extra !== current.extra.length ? `was ${current.extra.length}` : `0–${SIDE_EXTRA_MAX} cards`}
            tone={extraOk ? undefined : "bad"} hint="Only Extra Deck monsters come into the Extra Deck." empty="No Extra Deck cards.">
            {[...extraCards, ...incoming("extra")]}
          </Section>
          <Section title="Side" count={sideShown} target={sideOk ? "stays the same" : `was ${current.side.length}`}
            tone={sideOk ? undefined : "bad"} empty="No Side Deck. You play the same deck again.">
            {sideCards}
          </Section>
        </div>

        <aside className={styles.panel} aria-label="Siding">
          <div className={styles.preview}><DeckCardPreview code={hovered} /></div>

          <div className={styles.counter} data-state={counterState} role="status" aria-live="polite" data-testid="swap-counter">
            <span className={ui.num}>{plan.out} out · {plan.inn} in</span>
            <span className={styles.counterNote}>{!changed ? "No changes" : plan.balanced ? "Even" : "Not even"}</span>
          </div>
          <p className={styles.help}>
            Click a card in the Main or Extra Deck to take it out, then the same number from the Side Deck to bring in.
          </p>

          <div className={styles.nextBlock}>
            {choosing ? <FirstChoiceGroup series={series} busy={busy || moving} onChoose={(choice) => void choose(choice)} />
              : info && !(series.firstChooser != null && series.firstChoice == null)
                ? <p className={styles.first} data-testid="between-first">{info.first}</p> : null}
            <OpponentFirstChip series={series} index={index} />
            <OpponentSideChip series={series} index={index} />
            {series.vsBot ? <p className={styles.botNote}>The practice bot is always ready.</p> : null}
          </div>

          <div className={styles.actions}>
            {readyReason ? <p className={styles.reason} role="status" data-testid="my-side-status">{status}</p> : null}
            {hasSide || !interrupted ? (
              <p className={styles.help}>
                {[hasSide ? "Changing your deck after Ready takes it back." : null,
                  !interrupted ? "When the timer ends, the next game starts with your last saved deck." : null].filter(Boolean).join(" ")}
              </p>
            ) : null}
            <p className={styles.reason} id="between-reason" data-testid="ready-reason">
              {readyReason ?? <span role="status" data-testid="my-side-status">{status}</span>}
            </p>
            <div className={styles.buttons}>
              <SheetButton kind="primary" size="lg" loading={busy && !confirmCancel} disabled={(imReady && !changed) || busy || moving || readyReason != null}
                aria-describedby="between-reason" onClick={() => void ready()}>
                Ready
              </SheetButton>
              <SheetButton kind="secondary" disabled={locked || !changed} onClick={() => edit(NO_MARKS)}>
                Reset to the deck from last game
              </SheetButton>
              {canCancelInterrupted(series) ? (
                confirmCancel ? (
                  <>
                    <SheetButton kind="secondary" loading={busy} disabled={busy} onClick={() => void cancel()}>Confirm cancel</SheetButton>
                    <SheetButton kind="quiet" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep series</SheetButton>
                  </>
                ) : (
                  <SheetButton kind="quiet" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel series</SheetButton>
                )
              ) : null}
            </div>
            {error ? <p className={styles.error} role="alert">{error}</p> : null}
          </div>
        </aside>
      </div>
    </div>
  );
}

/** True when this room is the next game of an open series that the server is about to start. */
export function isStartingNextGame(room: Pick<DuelRoom, "session" | "series">): boolean {
  const series = room.series;
  return series != null && (series.status === "active" || series.status === "between_games")
    && room.session.status === "lobby" && (room.session.gameNumber ?? 1) > 1;
}

/**
 * The moment between Ready and the first prompt of the next game. Both players are already seated and
 * ready, so the table lobby and its settings never show. If the server is slow, a link opens the table.
 */
export function NextGameStarting({ room, onShowTable }: { room: DuelRoom; onShowTable: () => void }) {
  const game = room.session.gameNumber ?? 2;
  const bestOf = room.series?.bestOf ?? 3;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12_000);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={cx(sheetRoot, styles.starting)} data-testid="next-game-starting" role="status">
      <h1 className={styles.startingTitle}>Game {game} of {bestOf}</h1>
      <p className={styles.startingNote}>Starting the next game…</p>
      {slow ? <SheetButton kind="quiet" onClick={onShowTable}>Open the table</SheetButton> : null}
    </div>
  );
}
