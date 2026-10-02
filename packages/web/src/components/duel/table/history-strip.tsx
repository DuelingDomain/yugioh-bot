"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { DuelCard, DuelCardInfo, DuelEngineView } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import { buildHistoryView, historyWho, type HistoryEntry } from "../history-entries";
import { emptyHistory, ingestHistory, shouldResetHistory, type HistoryState } from "../history-model";
import { contextFor, ICONS } from "../history-rail";
import styles from "./history-strip.module.css";

const MAX_TILES = 8;

export interface HistoryStripProps {
  engine: DuelEngineView;
  mySeat: number | null;
  playerName: (seat: number) => string;
  seatTones: ReadonlyMap<number, { main: string; ink: string }>;
  onInspectCard: (card: DuelCard | DuelCardInfo) => void;
  /** The "Log" tab opens the whole list. */
  onOpenLog?: () => void;
}

/**
 * A short row of the last moves at the top of the left column: one tile per move, newest on the left, edged in the colour
 * of the seat that made it. It folds events into its own list the way the Log tab does, so a rolled event window loses
 * nothing. Tiles with a card open it in the Card tab.
 */
export function HistoryStrip({ engine, mySeat, playerName, seatTones, onInspectCard, onOpenLog }: HistoryStripProps) {
  const [stored, setStored] = useState<HistoryState>(() => ingestHistory(emptyHistory(), engine.events, contextFor(engine)));
  const base = shouldResetHistory(stored, engine.events, engine.revision) ? emptyHistory() : stored;
  const history = ingestHistory(base, engine.events, contextFor(engine));
  if (history !== stored) setStored(history);

  const seatCount = engine.seats.length;
  const names = Array.from({ length: seatCount }, (_, seat) => historyWho(seat, mySeat, playerName, seatCount)).join("\u0000");
  const handlerRef = useRef(playerName);
  handlerRef.current = playerName;
  const view = useMemo(
    () => buildHistoryView(history.items, { mySeat, who: (seat) => historyWho(seat, mySeat, handlerRef.current, seatCount), seatCount }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history.items, mySeat, names, seatCount],
  );
  const tiles: HistoryEntry[] = [];
  for (const group of view.groups) {
    for (const row of group.rows) if (row.type === "entry" && tiles.length < MAX_TILES) tiles.push(row);
    if (tiles.length >= MAX_TILES) break;
  }

  return (
    <section className={styles.strip} aria-label="Recent moves" data-testid="history-strip">
      <div className={styles.cap}>
        <b>History</b>
        <i aria-hidden="true" />
        {onOpenLog ? <button type="button" onClick={onOpenLog}>newest first · Log</button> : <span>newest first</span>}
      </div>
      <ol className={styles.rail}>
        {tiles.length === 0 ? <li className={styles.none}>No moves yet</li> : null}
        {tiles.map((entry) => {
          const thumb = entry.thumbs[0];
          const tone = entry.seat != null ? seatTones.get(entry.seat) : undefined;
          const { Icon, tone: kind, label } = ICONS[entry.icon];
          const art = thumb?.code != null ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardArtUrl(thumb.code, "small")} alt="" loading="lazy" decoding="async" draggable={false} />
          ) : null;
          const body = (
            <>
              {art}
              <span className={styles.k} data-tone={kind} aria-hidden="true"><Icon size={9} strokeWidth={2.25} aria-hidden /></span>
            </>
          );
          const style = tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
          return (
            <li key={entry.key} className={styles.item} style={style} data-seat={entry.seat ?? undefined} title={`${entry.actor} · ${label}: ${entry.title}`}>
              {thumb?.card ? (
                <button type="button" className={styles.tile} aria-label={`${entry.sentence} Inspect ${thumb.name ?? "card"}`} onClick={() => onInspectCard(thumb.card as DuelCard)}>{body}</button>
              ) : (
                <span className={styles.tile} role="img" aria-label={entry.sentence}>{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
