import type { CSSProperties } from "react";
import Link from "next/link";
import { Flame } from "lucide-react";
import { TierMeter, TierName } from "@/components/sheet";
import { tierProgress, winRatePercent } from "./dashboard-model";

export type StandingProfile = {
  rating: number;
  rank: { name: string; min: number; nextAt: number | null };
  winnings: number;
  currentStreak: number;
};

const TIER_VAR: Record<string, string> = { Platinum: "plat", Diamond: "dia" };

export function YourStanding({
  profile,
  record,
}: {
  profile: StandingProfile | null;
  record: { wins: number; losses: number };
}) {
  const progress = profile ? tierProgress(profile.rating, profile.rank) : null;
  const streak = profile?.currentStreak ?? 0;
  const count = (profile ? 1 : 0) + 3;

  return (
    <section className="db-stand msheet" aria-labelledby="db-standing">
      <header className="sheet-cap">
        <h2 id="db-standing">Your standing</h2>
        <small>
          <Link className="link" href="/leaderboard">Leaderboard</Link>
        </small>
      </header>
      <div className="lps db-lps" style={{ "--n": count } as CSSProperties}>
        {profile && progress && (
          <div
            className="lp db-elo"
            data-tone="tier"
            style={{ "--tier": `var(--t-${TIER_VAR[profile.rank.name] ?? profile.rank.name.toLowerCase()})` } as CSSProperties}
          >
            <p className="lp-k">
              <TierName tier={profile.rank.name} />
              <small>{progress.nextTier ? `${progress.toNext} to ${progress.nextTier}` : "Top tier"}</small>
            </p>
            <p className="lp-v"><b>{profile.rating}</b></p>
            <TierMeter
              tier={profile.rank.name}
              value={progress.fraction}
              label={
                progress.span != null
                  ? `${progress.into} of ${progress.span} Elo through ${progress.tier}`
                  : `${progress.tier}, the top tier`
              }
            />
          </div>
        )}
        <div className="lp">
          <p className="lp-k">Winnings</p>
          <p className="lp-v"><b>{profile ? profile.winnings : "—"}</b></p>
          <p className="lp-s">this season</p>
        </div>
        <div className="lp">
          <p className="lp-k">Record</p>
          <p className="lp-v">
            <b>{record.wins}<small>–{record.losses}</small></b>
          </p>
          <p className="lp-s">{winRatePercent(record.wins, record.losses)}% won, all matches</p>
        </div>
        <div className="lp" data-tone={streak > 0 ? "streak" : undefined}>
          <p className="lp-k">Streak</p>
          <p className="lp-v">
            <b>
              {streak > 0 && <Flame className="ic" aria-hidden="true" />}
              {streak > 0 ? streak : "—"}
            </b>
          </p>
          <p className="lp-s">this season</p>
        </div>
      </div>
    </section>
  );
}
