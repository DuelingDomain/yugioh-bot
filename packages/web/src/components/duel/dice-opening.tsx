"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { DuelDiceOpeningView } from "@yugidraft/shared/duels";
import { DiceDie } from "./dice-die";
import {
  DICE_TIMELINE,
  DICE_TIMELINE_REDUCED,
  diceBeat,
  dicePlan,
  diceStatus,
  diceSub,
  facingSeat,
  landingOf,
  myLobbySeat,
  nameOfLobby,
  roundStartMs,
  seatCountOf,
  seatMoveText,
  seatsMoved,
  tileOf,
  currentRound,
} from "./dice-model";
import { useDiceSkin } from "./dice-skins";
import { duelFontClasses } from "./fonts";
import { sampleServerNow, useNow } from "./opening-clock";
import { cx } from "./sheet-ui";
import styles from "./dice-opening.module.css";
import rootStyles from "./opening.module.css";

export interface DiceOpeningScreenProps {
  opening: DuelDiceOpeningView;
  /** Monotonic client time when the room response arrived; retained with cached rooms. */
  receivedAt?: number;
  /** The viewer's seat as the room reports it: a lobby seat until the move, the new public seat after. `null` = spectator. */
  mySeat: number | null;
  /** Names by the seat the room reports now (see `mySeat`). */
  names: string[];
  error?: string | null;
  reducedMotion?: boolean;
}

/**
 * The opening of a 3-way or 4-way duel: every player rolls a die, tied players roll again, and the order decides
 * the seats. The server rolls and decides everything; this draws the view on the server clock.
 */
export function DiceOpeningScreen({ opening, receivedAt, mySeat, names, error = null, reducedMotion = false }: DiceOpeningScreenProps) {
  const skin = useDiceSkin();
  const now = useNow(opening, receivedAt, 100);
  const timeline = reducedMotion ? DICE_TIMELINE_REDUCED : DICE_TIMELINE;
  const startsAt = roundStartMs(opening);
  const elapsed = opening.phase === "start" ? Number.POSITIVE_INFINITY : (now ?? Date.now()) - startsAt;
  const seatCount = seatCountOf(opening);
  const me = myLobbySeat(opening, mySeat);
  const nameOf = (lobbySeat: number) => nameOfLobby(opening, names, lobbySeat);
  const beat = diceBeat(opening, elapsed, timeline);
  const moved = seatsMoved(opening, elapsed, timeline);
  const status = diceStatus(opening, me, nameOf, beat, moved);
  const round = currentRound(opening);
  const facing = moved && me != null ? facingSeat(opening, me) : null;
  const sampleElapsed = () => sampleServerNow(opening, receivedAt) - startsAt;

  // Seat move: the tiles glide from their lobby places to their new ones (a short fade with reduced motion).
  const rowRef = useRef<HTMLDivElement>(null);
  const placed = useRef<{ rects: DOMRect[]; moved: boolean }>({ rects: [], moved: false });
  useLayoutEffect(() => {
    const tiles = Array.from(rowRef.current?.children ?? []) as HTMLElement[];
    const rects = tiles.map((tile) => tile.getBoundingClientRect());
    const before = placed.current;
    placed.current = { rects, moved };
    if (!moved || before.moved || before.rects.length !== rects.length) return;
    tiles.forEach((tile, seat) => {
      if (typeof tile.animate !== "function") return;
      if (reducedMotion) { tile.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: timeline.moveMs }); return; }
      const dx = before.rects[seat]!.left - rects[seat]!.left;
      const dy = before.rects[seat]!.top - rects[seat]!.top;
      if (!dx && !dy) return;
      tile.style.zIndex = "4";
      const glide = tile.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: timeline.moveMs, easing: "cubic-bezier(0.55, 0, 0.2, 1)" });
      glide.onfinish = () => { tile.style.zIndex = ""; };
    });
  });

  return (
    <div className={cx(rootStyles.root, duelFontClasses)} role="dialog" aria-modal="true" aria-labelledby="opening-title" data-testid="opening-screen" data-stage={opening.phase} data-kind="dice" data-reduced={reducedMotion ? "true" : undefined}>
      <div className={styles.stage}>
        <header className={styles.head}>
          <h2 id="opening-title" className={styles.title}>Who goes first?</h2>
          <p className={styles.sub} data-testid="dice-sub">{diceSub(opening, me, moved)}</p>
        </header>
        <div className={styles.status} role="status" aria-live="polite" data-kind={status.kind} data-testid="dice-status">
          <span key={status.main} className={styles.main}>{status.main}</span>
          <span key={status.note} className={styles.note}>{status.note}</span>
        </div>
        <div ref={rowRef} className={styles.row} data-n={seatCount} data-testid="dice-row">
          {Array.from({ length: seatCount }, (_, seat) => {
            const tile = tileOf(opening, seat, elapsed, timeline);
            const isMe = seat === me;
            const rankText = tile.chip?.text;
            const moveText = moved ? seatMoveText(opening, seat) : null;
            const label = [`${nameOf(seat)}${isMe ? " (you)" : ""}`, tile.caption.main.toLowerCase(), rankText?.toLowerCase(), moveText?.toLowerCase()].filter(Boolean).join(", ");
            return (
              <div
                key={seat}
                className={cx(styles.tile, styles[`s${seat}` as "s0"])}
                style={moved && tile.rank != null ? ({ order: tile.rank } as CSSProperties) : undefined}
                role="group"
                aria-label={label}
                data-testid={`dice-tile-${seat}`}
                data-state={tile.state}
                data-me={isMe ? "true" : "false"}
                data-first={moved && tile.rank === 0 ? "true" : undefined}
                data-face={facing === seat ? "true" : undefined}
              >
                <div className={styles.rankrow}>
                  <span className={styles.chip} data-on={tile.chip ? "true" : "false"} data-kind={tile.chip?.kind} data-first={tile.chip?.first ? "true" : undefined}>{tile.chip?.text}</span>
                </div>
                <div className={styles.dieBox}>
                <DiceDie
                  value={tile.value}
                  skin={skin}
                  throwRound={tile.rolling ? opening.round : null}
                  plan={dicePlan(opening.round, seat, timeline)}
                  timeline={timeline}
                  landing={tile.rolling && round ? landingOf(round, seat) : null}
                  tied={tile.state === "tied"}
                  reduced={reducedMotion}
                  sampleElapsed={sampleElapsed}
                />
                </div>
                <div className={styles.who}>
                  <span className={styles.av} aria-hidden />
                  <span className={styles.nm}>{nameOf(seat)}</span>
                </div>
                <div className={styles.cap} aria-hidden>
                  <b key={tile.caption.main}>{tile.caption.main}</b>
                  {tile.caption.note ? <i>{tile.caption.note}</i> : null}
                </div>
                {isMe ? <span className={styles.you}>You</span> : null}
              </div>
            );
          })}
        </div>
        {seatCount === 4 ? (
          <div className={styles.pairs} data-on={moved ? "true" : "false"} aria-hidden data-testid="dice-pairs">
            <div className={styles.pairbar}><small>face each other</small></div>
            <div className={styles.pairbar}><small>face each other</small></div>
          </div>
        ) : null}
        {error ? <p className={rootStyles.error} role="alert">{error}</p> : null}
      </div>
    </div>
  );
}
