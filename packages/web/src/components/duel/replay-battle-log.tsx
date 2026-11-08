"use client";

// The replay's battle log (Log tab): the live Hearthstone-style history over the replay. Rows run oldest first and end
// at the playhead: what happens next stays hidden (it can spoil a Set card or the result) unless "Full log" is on, which
// shows the rest dimmed. A press on a row seeks to it, a hover on a card shows it in the card preview. The raw engine
// lines sit behind the Details toggle. The list follows the playhead until the viewer scrolls away from it.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { CardHoverInfo } from "./card-interactions";
import { duelFontClasses } from "./fonts";
import { historyWho } from "./history-entries";
import type { HistoryCard } from "./history-model";
import { EntryRow, PhaseRow, type ThumbHandlers } from "./history-rail";
import { buildReplayBattleLog, playheadKey, visibleRowCount, type ReplayBattleLog, type ReplayLogGroup } from "./replay-history";
import type { ReplayTimeline } from "./replay-timeline";
import { useForkLabels } from "./table/fork-labels";
import baseStyles from "./history-rail.module.css";
import styles from "./replay-battle-log.module.css";
import { useSkinStyles } from "./skin";

const Group = memo(function Group({ group, shown, futureAfter, playhead, handlers, onSeek }: {
  group: ReplayLogGroup;
  /** How many rows of the group are drawn (the rows are in frame order). */
  shown: number;
  /** Rows after this frame are dimmed. Infinity when nothing ahead is drawn. */
  futureAfter: number;
  playhead: number | null;
  handlers: ThumbHandlers;
  onSeek: (frame: number) => void;
}) {
  const history = useSkinStyles(baseStyles, "history");
  return (
    <li className={history.group} data-future={group.frame > futureAfter || undefined}>
      <h4 className={history.turn} data-turn>{group.label}</h4>
      <ol className={history.rows} role="list">
        {group.rows.slice(0, shown).map((row) => row.type === "phase" ? (
          <PhaseRow key={`p${row.phase.key}`} row={row.phase} />
        ) : (
          <EntryRow key={`e${row.entry.key}`} entry={row.entry} latest={false} animate={false} handlers={handlers}
            playhead={row.entry.key === playhead} future={row.frame > futureAfter} seekFrame={row.frame} onSeekFrame={onSeek} />
        ))}
      </ol>
    </li>
  );
});

export function ReplayBattleLog({ timeline, index, mySeat, seatCount, playerName, onSeek, onInspectCard, reducedMotion, details }: {
  timeline: ReplayTimeline;
  index: number;
  mySeat: number | null;
  seatCount: number;
  playerName: (seat: number) => string;
  onSeek: (frame: number) => void;
  onInspectCard: (card: DuelCard | DuelCardInfo) => void;
  reducedMotion: boolean;
  /** The raw engine log, shown instead of the battle log while Details is on. */
  details: ReactNode;
}) {
  const history = useSkinStyles(baseStyles, "history");
  const fork = useForkLabels();
  const [showDetails, setShowDetails] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [away, setAway] = useState(false);
  const [hover, setHover] = useState<{ card: HistoryCard; anchor: HTMLElement } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const awayRef = useRef(false);
  // A scroll we started ourselves is not the viewer leaving the playhead.
  const ownScrollUntil = useRef(0);

  const who = (seat: number | null) => historyWho(seat, mySeat, playerName, seatCount, fork);
  // Names change the rows; `who` itself changes on every render.
  const names = Array.from({ length: seatCount }, (_, seat) => who(seat)).join("\u0000");
  const log = useMemo<ReplayBattleLog>(
    () => buildReplayBattleLog(timeline, { mySeat, who, seatCount }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, mySeat, names, seatCount],
  );
  const playhead = playheadKey(log, index);
  // Only the group that holds the playhead row gets it, so a step re-renders one group, not all of them.
  const groupOfEntry = useMemo(() => {
    const map = new Map<number, number>();
    log.groups.forEach((group, at) => group.rows.forEach((row) => { if (row.type === "entry") map.set(row.entry.key, at); }));
    return map;
  }, [log]);
  const playheadGroup = playhead == null ? -1 : (groupOfEntry.get(playhead) ?? -1);
  const visible = useMemo(() => log.groups.map((group) => (showAll ? group.rows.length : visibleRowCount(group, index))),
    [log, index, showAll]);
  const shownRows = visible.reduce((sum, count) => sum + count, 0);

  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const seek = useCallback((frame: number) => {
    awayRef.current = false;
    setAway(false);
    onSeekRef.current(frame);
  }, []);
  const onInspectRef = useRef(onInspectCard);
  onInspectRef.current = onInspectCard;
  const handlers = useMemo<ThumbHandlers>(() => ({
    onEnter: (card, element) => setHover({ card, anchor: element }),
    onLeave: () => setHover(null),
    onOpen: (card) => onInspectRef.current(card),
  }), []);

  /** Scrolls the list (never the page) so the playhead row is in view, below the sticky turn header. */
  const reveal = useCallback((smooth: boolean) => {
    const box = scroller.current;
    if (!box) return;
    const row = box.querySelector<HTMLElement>("[data-playhead]");
    if (!row) {
      box.scrollTo?.({ top: 0 });
      return;
    }
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const margin = 36;
    if (rowRect.top >= boxRect.top + margin && rowRect.bottom <= boxRect.bottom) return;
    const top = rowRect.top - boxRect.top + box.scrollTop - box.clientHeight * 0.6 + rowRect.height / 2;
    ownScrollUntil.current = performance.now() + (smooth ? 700 : 100);
    box.scrollTo?.({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Follow the playhead, unless the viewer scrolled away from it.
  useEffect(() => {
    if (showDetails || awayRef.current) return;
    reveal(!reducedMotion);
  }, [playhead, shownRows, showDetails, reducedMotion, reveal]);

  const onScroll = () => {
    const box = scroller.current;
    if (!box || performance.now() < ownScrollUntil.current) return;
    const row = box.querySelector<HTMLElement>("[data-playhead]");
    let gone = false;
    if (row) {
      const boxRect = box.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      gone = rowRect.bottom < boxRect.top || rowRect.top > boxRect.bottom;
    }
    if (gone !== awayRef.current) {
      awayRef.current = gone;
      setAway(gone);
    }
  };
  const backToNow = () => {
    awayRef.current = false;
    setAway(false);
    reveal(!reducedMotion);
  };

  return (
    <section className={`${history.rail} ${styles.log} ${duelFontClasses}`} data-motion={reducedMotion ? "off" : "on"}
      aria-label="Battle log" data-replay-battle-log>
      <div className={styles.head}>
        <h3 className={history.cap}><span>{showDetails ? "Engine details" : "Battle log"}</span></h3>
        {showDetails ? null : (
          <button type="button" className={styles.toggle} aria-pressed={showAll} onClick={() => setShowAll((value) => !value)}
            title="Show what happens after this move (it can give away hidden cards)">
            Full log
          </button>
        )}
        <button type="button" className={styles.toggle} aria-pressed={showDetails} onClick={() => setShowDetails((value) => !value)}>
          Details
        </button>
      </div>
      <div className={styles.body}>
        {showDetails ? <div className={styles.details}>{details}</div> : (
          <div ref={scroller} className={history.list} tabIndex={0} role="region" aria-label="Battle log events" onScroll={onScroll}>
            {shownRows === 0 ? <p className={styles.empty}>No events yet.</p> : (
              <ol className={history.groups} role="list">
                {log.groups.map((group, at) => visible[at] > 0 ? (
                  <Group key={group.key} group={group} shown={visible[at]} futureAfter={showAll ? index : Infinity}
                    playhead={at === playheadGroup ? playhead : null} handlers={handlers} onSeek={seek} />
                ) : null)}
              </ol>
            )}
          </div>
        )}
        {away && !showDetails ? (
          <button type="button" className={styles.now} onMouseDown={(event) => event.preventDefault()} onClick={backToNow}>Back to now</button>
        ) : null}
      </div>
      {hover ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
    </section>
  );
}
