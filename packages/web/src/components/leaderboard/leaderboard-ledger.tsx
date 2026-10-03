"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { RankGem, TierName } from "@/components/sheet";
import type { LeaderboardScope, PlayerPosition, Standing } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

interface LedgerProps {
  standings: Standing[];
  scope: LeaderboardScope;
  position: PlayerPosition | null;
  loading: boolean;
}

export function LeaderboardLedger({ standings, scope, position, loading }: LedgerProps) {
  const tableRow = useRef<HTMLTableRowElement>(null);
  const phoneRow = useRef<HTMLLIElement>(null);
  const [pinned, setPinned] = useState(false);
  const currentPlayerId = position?.row.playerId;

  useEffect(() => {
    setPinned(false);
    const targets = [tableRow.current, phoneRow.current].filter((el): el is NonNullable<typeof el> => el !== null);
    if (!targets.length || typeof IntersectionObserver === "undefined") return;
    // The desktop table and the phone list both hold your row and one of them
    // is always hidden, so you are "in view" when either one is on screen.
    const seen = new Map<Element, boolean>(targets.map((el) => [el, false]));
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) seen.set(entry.target, entry.isIntersecting);
      setPinned(![...seen.values()].some(Boolean));
    });
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [standings, currentPlayerId]);

  if (standings.length === 0) {
    return (
      <div className="empty" role="region" aria-label="Leaderboard standings" aria-busy={loading}>
        <h2>No one is on the board yet</h2>
        <p>Finish a ranked match to appear here.</p>
      </div>
    );
  }

  return (
    <div className={`${styles.busy} ${styles.ledgerBox}`} role="region" aria-label="Leaderboard standings" aria-busy={loading}>
      <div className={styles.deskOnly}>
        <div className="ledger">
          <table aria-label={scope === "season" ? "Season leaderboard" : "All-time leaderboard"} data-scope={scope} style={scope === "all" ? { minWidth: 520 } : undefined}>
            <thead>
              <tr>
                <th scope="col" style={{ paddingLeft: 18 }}>#</th>
                <th scope="col">Player</th>
                <th scope="col">Tier</th>
                <th scope="col" className="r">Elo</th>
                <th scope="col" className="r sort" aria-sort="descending" style={scope === "all" ? { paddingRight: 18 } : undefined}>
                  {scope === "season" ? "Winnings" : "Career winnings"}
                </th>
                {scope === "season" && (
                  <>
                    <th scope="col" className="r">W–L</th>
                    <th scope="col" className="r">Win %</th>
                    <th scope="col" className="r" style={{ paddingRight: 18 }}>Streak</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {standings.map(({ row, place }) => {
                const me = row.playerId === currentPlayerId;
                return (
                  <tr key={row.playerId} className={me ? "me" : undefined} ref={me ? tableRow : undefined}>
                    <td className="p">{place}</td>
                    <td>
                      <span className="nm">
                        <Link className={styles.rowLink} href={`/player/${row.playerId}`}>{row.displayName}</Link>
                        {me && <span className="youtag">you</span>}
                      </span>
                    </td>
                    <td><TierName tier={row.rank} /></td>
                    <td className="r v">{row.rating}</td>
                    <td className="r wn" style={scope === "all" ? { paddingRight: 18 } : undefined}>{row.winnings.toLocaleString()}</td>
                    {scope === "season" && (
                      <>
                        <td className="r wl">{row.wins}<span>–</span>{row.losses}</td>
                        <td className="r v">{row.winRate}</td>
                        <td className="r" style={{ paddingRight: 18 }}>
                          {row.currentStreak > 0 ? (
                            <span className="stk"><Flame className="ic sm" aria-hidden="true" />{row.currentStreak}</span>
                          ) : (
                            <span className="stk z">–</span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles.phoneOnly}>
        <div className="sec-h">
          <h2 className="sec-t">{scope === "season" ? "Ranked by winnings" : "Ranked by career winnings"}</h2>
        </div>
        <ol className="mini-st lb-ph">
          {standings.map(({ row, place }) => {
            const me = row.playerId === currentPlayerId;
            return (
              <li key={row.playerId} className={me ? "me" : undefined} ref={me ? phoneRow : undefined}>
                <span className="pos">{place}</span>
                <span className="nm">
                  <RankGem tier={row.rank} />
                  <Link className={styles.rowLink} href={`/player/${row.playerId}`}>{row.displayName}</Link>
                  {me && <span className="youtag">you</span>}
                  {scope === "season" && <small>{row.wins}–{row.losses}</small>}
                </span>
                <span className="rec">{row.winnings.toLocaleString()}</span>
              </li>
            );
          })}
        </ol>
      </div>

      {pinned && position && (
        <div className={`pinbar ${styles.pin}`} role="region" aria-label="Your position, pinned">
          <span className="p">{position.place}</span>
          <span className="nm">
            <RankGem tier={position.row.rank} />
            <Link href={`/player/${position.row.playerId}`}>{position.row.displayName}</Link>
            <span className="youtag">you</span>
            {position.gapLabel && <span className="gap">{position.gapLabel}</span>}
          </span>
          <span className="wn">{position.row.winnings.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
