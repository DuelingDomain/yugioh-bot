"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { DuelAction, FloorList, FloorRow, LiveDot, Mono, Seat, ringColour } from "@/components/sheet";
import type { LeaderboardScope, PlayerPosition, Standing } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

interface LedgerProps {
  standings: Standing[];
  scope: LeaderboardScope;
  position: PlayerPosition | null;
  loading: boolean;
  /** Player id to the slug of the duel they are playing right now. */
  liveDuels?: Record<number, string>;
}

const SEASON_COLS = "36px minmax(0, 1fr) 96px 68px 60px 56px";
const ALL_COLS = "36px minmax(0, 1fr) 140px";

export function LeaderboardLedger({ standings, scope, position, loading, liveDuels = {} }: LedgerProps) {
  const myRow = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const currentPlayerId = position?.row.playerId;
  const hasLive = standings.some(({ row }) => liveDuels[row.playerId]);
  const season = scope === "season";
  const cols = `${season ? SEASON_COLS : ALL_COLS}${hasLive ? " 92px" : ""}`;
  const phoneCols = "28px minmax(0, 1fr) auto";

  useEffect(() => {
    setPinned(false);
    const target = myRow.current;
    if (!target || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setPinned(!entry.isIntersecting);
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [standings, currentPlayerId]);

  if (standings.length === 0) {
    return (
      <section className={styles.empty} aria-label="Leaderboard standings" aria-busy={loading}>
        <h2>No one is on the board yet</h2>
        <p>Finish a ranked match to appear here.</p>
      </section>
    );
  }

  return (
    <section className={`${styles.busy} ${styles.ledger}`} aria-label="Leaderboard standings" aria-busy={loading} data-scope={scope}>
      <div className={styles.head} style={{ "--cols": cols } as CSSProperties} aria-hidden="true">
        <span>#</span>
        <span>Player</span>
        <span className={styles.r}>{season ? "Winnings" : "Career winnings"}</span>
        {season && (
          <>
            <span className={styles.r}>W–L</span>
            <span className={styles.r}>Win %</span>
            <span className={styles.r}>Streak</span>
          </>
        )}
        {hasLive && <span />}
      </div>
      <FloorList as="ol" aria-label={season ? "Season leaderboard, ranked by winnings" : "All-time leaderboard, ranked by career winnings"}>
        {standings.map(({ row, place }) => {
          const me = row.playerId === currentPlayerId;
          const slug = liveDuels[row.playerId];
          return (
            <FloorRow
              key={row.playerId}
              you={me}
              cols={cols}
              phoneCols={phoneCols}
              phoneAreas={'"rk seat win" "rk rec act"'}
              className={styles.row}
            >
              <span className={`sv-cell-rank ${styles.rk}`} data-first={place === 1 ? "true" : undefined}>
                <span className="sv-sr">Place </span>
                {place}
              </span>
              <Seat
                name={row.displayName}
                href={`/player/${row.playerId}`}
                tier={row.rank}
                elo={row.rating}
                you={me}
                ring={me ? undefined : ringColour(row.playerId)}
                className={styles.seat}
              />
              <span className={`${styles.win} ${styles.r}`}>
                {row.winnings.toLocaleString()}
                <span className="sv-sr"> winnings</span>
              </span>
              {season && (
                <>
                  <span className={`${styles.rec} ${styles.r}`}>
                    {row.wins}–{row.losses}
                    <span className="sv-sr"> record</span>
                  </span>
                  <span className={`${styles.pct} ${styles.r}`}>
                    {row.winRate}%<span className="sv-sr"> win rate</span>
                  </span>
                  <span className={`${styles.stk} ${styles.r}`}>
                    {row.currentStreak > 0 ? (
                      <>
                        <Flame className={styles.flame} aria-hidden="true" />
                        {row.currentStreak}
                        <span className="sv-sr"> win streak</span>
                      </>
                    ) : (
                      <span className={styles.none}>–<span className="sv-sr">no streak</span></span>
                    )}
                  </span>
                </>
              )}
              {slug && (
                <span className={styles.act}>
                  <LiveDot you={me} />
                  <DuelAction kind={me ? "open" : "watch"} href={`/duels/${slug}`} />
                </span>
              )}
              {me && <span ref={myRow} className={styles.anchor} aria-hidden="true" />}
            </FloorRow>
          );
        })}
      </FloorList>

      {pinned && position && (
        <div className={styles.pin} role="region" aria-label="Your position, pinned">
          <span className={styles.pinPlace}>{position.place}</span>
          <Mono name={position.row.displayName} you size="sm" />
          <Link href={`/player/${position.row.playerId}`}>{position.row.displayName}</Link>
          {position.gapLabel && <span className={styles.gap}>{position.gapLabel}</span>}
          <b className={styles.pinWin}>{position.row.winnings.toLocaleString()}</b>
        </div>
      )}
    </section>
  );
}
