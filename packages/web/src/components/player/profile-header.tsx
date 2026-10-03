"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DuelAction, LiveDot, Mono, RankGem, TierName, YouPill, ringColour } from "@/components/sheet";
import { TierLine } from "@/components/rank/tier-line";
import { didRankUp } from "@/components/rank/rank-up";
import { getTierProgress } from "@/components/leaderboard/leaderboard-model";
import { rankSeenKey } from "./profile-model";
import styles from "./profile.module.css";

interface ProfileHeaderProps {
  playerId: number;
  displayName: string;
  isMe: boolean;
  rating: number;
  /** Place text such as "#5 this season"; says "not placed" when the player is not on the board. */
  placeLabel: string;
  /** Slug of the duel this player is in right now, if any. */
  liveDuel?: string | null;
}

/** Who this is: a ring, the tier gem and Elo, a thin line to the next tier, and a live-duel link. The name is the page bar's title. */
export function ProfileHeader({ playerId, displayName, isMe, rating, placeLabel, liveDuel = null }: ProfileHeaderProps) {
  const progress = getTierProgress(rating);
  const tier = progress.tier;
  const [popping, setPopping] = useState(false);
  const [promoted, setPromoted] = useState(false);

  // Rank-up pop: compare against the tier this device saw last, once per change.
  useEffect(() => {
    const key = rankSeenKey(playerId);
    let prev: string | null = null;
    try {
      prev = window.localStorage.getItem(key);
    } catch {
      return; // storage unavailable (private mode etc.)
    }
    if (didRankUp(prev, tier)) {
      setPromoted(true);
      const still = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!still) setPopping(true);
    }
    try {
      window.localStorage.setItem(key, tier);
    } catch {
      // ignore write failures
    }
  }, [playerId, tier]);

  return (
    <section className={styles.who} aria-label="Player">
      <Mono name={displayName} size="big" you={isMe} ring={isMe ? undefined : ringColour(playerId)} />
      <div className={styles.whoText}>
        <p className={styles.tierRow}>
          <span
            className={popping ? `${styles.gem} rank-pop` : styles.gem}
            data-testid="profile-gem"
            onAnimationEnd={(e) => {
              if (e.animationName === "rank-pop") setPopping(false);
            }}
          >
            <RankGem tier={tier} size="lg" />
          </span>
          <TierName tier={tier} gem={false} />
          <span className={styles.eloNum}>{rating}</span>
          <span className={styles.quiet}>Elo</span>
          <span className={styles.quiet}>{placeLabel}</span>
          {isMe && <YouPill />}
          {promoted && <span className="chip-new">Up to {tier}</span>}
        </p>
        {progress.nextTier ? (
          <div className={styles.next}>
            <TierLine
              tier={tier}
              value={progress.percent / 100}
              label={`${progress.points} of ${progress.span} Elo through ${tier}`}
            />
            <p className={styles.nextText}>
              <b>{progress.remaining.toLocaleString()}</b> Elo to <TierName tier={progress.nextTier} gem={false} />,{" "}
              <Link className={styles.link} href="/leaderboard#tiers">all tiers</Link>
            </p>
          </div>
        ) : (
          <p className={styles.nextText}>
            Top tier. {progress.points.toLocaleString()} Elo above the {tier} line.{" "}
            <Link className={styles.link} href="/leaderboard#tiers">all tiers</Link>
          </p>
        )}
      </div>
      {liveDuel && (
        <div className={styles.liveAct}>
          <LiveDot you={isMe} />
          <DuelAction kind={isMe ? "open" : "watch"} href={`/duels/${liveDuel}`} />
        </div>
      )}
    </section>
  );
}
