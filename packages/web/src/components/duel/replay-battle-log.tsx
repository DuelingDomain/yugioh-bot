"use client";

// The replay's battle log (Log tab): the live Hearthstone-style history over the whole replay. Rows run oldest first
// and follow the playhead; a row that has not happened yet is dimmed. A press on a row seeks to it, a hover on a card
// shows it in the card preview. The raw engine lines sit behind the Details toggle.
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DuelCard, DuelCardInfo } from "@yugidraft/shared/duels";
import { CardHoverInfo } from "./card-interactions";
import { duelFontClasses } from "./fonts";
import { historyWho } from "./history-entries";
import type { HistoryCard } from "./history-model";
import { EntryRow, PhaseRow, type ThumbHandlers } from "./history-rail";
import { buildReplayBattleLog, playheadKey, type ReplayBattleLog, type ReplayLogGroup } from "./replay-history";
import type { ReplayTimeline } from "./replay-timeline";
import { useForkLabels } from "./table/fork-labels";
import baseStyles from "./history-rail.module.css";
import styles from "./replay-battle-log.module.css";
import { useSkinStyles } from "./skin";

const Group = memo(function Group({ group, index, playhead, handlers, onSeek }: {
  group: ReplayLogGroup;
  index: number;
  playhead: number | null;
  handlers: ThumbHandlers;
  onSeek: (frame: number) => void;
}) {
  const history = useSkinStyles(baseStyles, "history");
  return (
    <li className={history.group} data-future={group.frame > index || undefined}>
      <h4 className={history.turn} data-turn>{group.label}</h4>
      <ol className={history.rows} role="list">
        {group.rows.map((row) => row.type === "phase" ? (
          <PhaseRow key={`p${row.phase.key}`} row={row.phase} />
        ) : (
          <EntryRow key={`e${row.entry.key}`} entry={row.entry} latest={false} animate={false} handlers={handlers}
            playhead={row.entry.key === playhead} future={row.frame > index} onSeek={() => onSeek(row.frame)} />
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
  const [hover, setHover] = useState<{ card: HistoryCard; anchor: HTMLElement } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const who = (seat: number | null) => historyWho(seat, mySeat, playerName, seatCount, fork);
  // Names change the rows; `who` itself changes on every render.
  const names = Array.from({ length: seatCount }, (_, seat) => who(seat)).join("\u0000");
  const log = useMemo<ReplayBattleLog>(
    () => buildReplayBattleLog(timeline, { mySeat, who, seatCount }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [timeline, mySeat, names, seatCount],
  );
  const playhead = playheadKey(log, index);

  const onInspectRef = useRef(onInspectCard);
  onInspectRef.current = onInspectCard;
  const handlers = useMemo<ThumbHandlers>(() => ({
    onEnter: (card, element) => setHover({ card, anchor: element }),
    onLeave: () => setHover(null),
    onOpen: (card) => onInspectRef.current(card),
  }), []);

  // Follow the playhead inside the list. Only the list scrolls, never the page.
  useEffect(() => {
    const box = scroller.current;
    if (!box || showDetails) return;
    const row = box.querySelector<HTMLElement>("[data-playhead]");
    if (!row) {
      box.scrollTo?.({ top: 0 });
      return;
    }
    const boxRect = box.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    // Leave room for the sticky turn header at the top.
    const margin = 36;
    if (rowRect.top >= boxRect.top + margin && rowRect.bottom <= boxRect.bottom) return;
    const top = rowRect.top - boxRect.top + box.scrollTop - box.clientHeight / 2 + rowRect.height / 2;
    box.scrollTo?.({ top: Math.max(0, top), behavior: reducedMotion ? "auto" : "smooth" });
  }, [playhead, showDetails, reducedMotion]);

  return (
    <section className={`${history.rail} ${styles.log} ${duelFontClasses}`} data-motion={reducedMotion ? "off" : "on"}
      aria-label="Battle log" data-replay-battle-log>
      <div className={styles.head}>
        <h3 className={history.cap}><span>{showDetails ? "Engine details" : "Battle log"}</span></h3>
        <button type="button" className={styles.toggle} aria-pressed={showDetails} onClick={() => setShowDetails((value) => !value)}>
          Details
        </button>
      </div>
      <div className={styles.body}>
        {showDetails ? <div className={styles.details}>{details}</div> : (
          <div ref={scroller} className={history.list} tabIndex={0} role="region" aria-label="Battle log events">
            {log.entries.length === 0 ? <p className={styles.empty}>No events yet.</p> : (
              <ol className={history.groups} role="list">
                {log.groups.map((group) => (
                  <Group key={group.key} group={group} index={index} playhead={playhead} handlers={handlers} onSeek={onSeek} />
                ))}
              </ol>
            )}
          </div>
        )}
      </div>
      {hover ? <CardHoverInfo card={hover.card} anchor={hover.anchor} /> : null}
    </section>
  );
}
