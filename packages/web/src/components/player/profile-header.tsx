"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { RankGem, TierMeter, TierName } from "@/components/sheet";
import { didRankUp } from "@/components/rank/rank-up";
import { getTierProgress } from "@/components/leaderboard/leaderboard-model";
import { rankSeenKey, type ProfileScope } from "./profile-model";
import styles from "./profile.module.css";

const GEM_GLOW: Record<string, string> = {
  Bronze: "rgb(214 160 106 / 0.18)",
  Silver: "rgb(203 213 225 / 0.16)",
  Platinum: "rgb(125 211 252 / 0.18)",
  Diamond: "rgb(167 139 250 / 0.18)",
};

interface ProfileHeaderProps {
  playerId: number;
  displayName: string;
  isMe: boolean;
  rating: number;
  /** Place text such as "#5 this season"; null when the player is not placed. */
  placeLabel: string;
  scope: ProfileScope;
  onScopeChange: (scope: ProfileScope) => void;
  /** False when no season is running; then there is only the all-time view. */
  hasSeason: boolean;
  loading: boolean;
}

export function ProfileHeader({
  playerId, displayName, isMe, rating, placeLabel, scope, onScopeChange, hasSeason, loading,
}: ProfileHeaderProps) {
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

  const glow = GEM_GLOW[tier];
  const gemStyle: CSSProperties | undefined = glow ? { background: `radial-gradient(closest-side, ${glow}, transparent)` } : undefined;

  return (
    <>
      <Link className={`crumb ${styles.crumbRow}`} href="/leaderboard">
        <ChevronLeft className="ic sm" aria-hidden="true" />Leaderboard
      </Link>
      <header className={`pf-head sheet-head ${styles.header}`} style={hasSeason ? undefined : { gridTemplateColumns: "auto minmax(0, 1fr)" }}>
        <span
          className={popping ? "pf-gem rank-pop" : "pf-gem"}
          style={gemStyle}
          data-testid="profile-gem"
          onAnimationEnd={(e) => {
            if (e.animationName === "rank-pop") setPopping(false);
          }}
        >
          <RankGem tier={tier} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="pf-name">
            <h1 className="t-title">{displayName}</h1>
            {isMe && <span className="youtag">you</span>}
            {promoted && <span className="chip-new">Up to {tier}</span>}
          </div>
          <p className="pf-tier">
            <TierName tier={tier} gem={false} />
            <span><span className="elo">{rating}</span> Elo</span>
            <span>{placeLabel}</span>
          </p>
          {progress.nextTier ? (
            <div className="pf-next">
              <div className="top">
                <span>{tier}</span>
                <span>
                  <b>{progress.remaining.toLocaleString()}</b> Elo to <TierName tier={progress.nextTier} gem={false} /> ·{" "}
                  <Link className="link" href="/leaderboard#tiers">all tiers</Link>
                </span>
              </div>
              <TierMeter
                tier={tier}
                value={progress.percent / 100}
                label={`${progress.points} of ${progress.span} Elo through ${tier}`}
              />
            </div>
          ) : (
            <p className={`small ${styles.topTier}`}>
              Top tier. {progress.points.toLocaleString()} Elo above the {tier} line.{" "}
              <Link className="link" href="/leaderboard#tiers">all tiers</Link>
            </p>
          )}
        </div>
        {hasSeason && (
          <div className="seg" role="group" aria-label="Profile scope">
            <button type="button" aria-pressed={scope === "season"} disabled={loading} onClick={() => onScopeChange("season")}>This season</button>
            <button type="button" aria-pressed={scope === "all"} disabled={loading} onClick={() => onScopeChange("all")}>All-time</button>
          </div>
        )}
      </header>
    </>
  );
}
