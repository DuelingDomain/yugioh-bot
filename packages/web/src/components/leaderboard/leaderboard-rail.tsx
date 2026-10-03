import { LpTally, RankGem, SheetPanel, TierMeter, TierName, type LpTallyItem } from "@/components/sheet";
import {
  getTierProgress,
  getWinningsGuide,
  type getTierCounts,
  type LeaderboardScope,
  type PlayerPosition,
} from "./leaderboard-model";
import styles from "./leaderboard.module.css";

export function tierMeterLabel(progress: ReturnType<typeof getTierProgress>) {
  return progress.span === null
    ? `${progress.tier} tier, Top tier`
    : `${progress.tier} tier, ${progress.points} of ${progress.span} points through`;
}

function TierProgress({ rating }: { rating: number }) {
  const progress = getTierProgress(rating);
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div className={styles.tierRow}>
        <TierName tier={progress.tier} />
        <span>
          {progress.nextTier ? (
            <>{progress.remaining.toLocaleString()} Elo to <TierName tier={progress.nextTier} gem={false} /></>
          ) : (
            progress.label
          )}
        </span>
      </div>
      <TierMeter tier={progress.tier} value={progress.percent / 100} label={tierMeterLabel(progress)} />
    </div>
  );
}

export function YourSeasonPanel({ position, scope }: { position: PlayerPosition | null; scope: LeaderboardScope }) {
  const title = scope === "season" ? "Your season" : "All-time";
  if (!position) {
    return (
      <SheetPanel title={title}>
        <p>You&apos;re not on the board yet.</p>
        <p className="small">Finish a ranked match to appear here.</p>
      </SheetPanel>
    );
  }
  const { row, place, above, gap } = position;
  const tier = getTierProgress(row.rating).tier;
  const items: LpTallyItem[] = [
    { key: "place", label: "Place", value: `#${place}` },
    { key: "winnings", label: "Winnings", value: row.winnings.toLocaleString() },
    { key: "elo", label: "Elo", value: row.rating, sub: tier, tone: "tier", tier },
  ];
  return (
    <SheetPanel title={title} aside={row.displayName}>
      <div style={{ display: "grid", gap: 14 }}>
        <LpTally items={items} />
        {(above || scope === "season") && (
          <dl className="rows">
            {above && <div><dt>Gap to {above.displayName}</dt><dd>{gap!.toLocaleString()} winnings</dd></div>}
            {scope === "season" && (
              <>
                <div><dt>Record</dt><dd>{row.wins}–{row.losses} · {row.winRate}%</dd></div>
                <div><dt>Streak</dt><dd>{row.currentStreak}</dd></div>
              </>
            )}
          </dl>
        )}
        <TierProgress rating={row.rating} />
      </div>
    </SheetPanel>
  );
}

export function LeaderboardRail({ position, scope, tiers }: {
  position: PlayerPosition | null;
  scope: LeaderboardScope;
  tiers: ReturnType<typeof getTierCounts>;
}) {
  const guide = getWinningsGuide();
  const currentTier = position ? getTierProgress(position.row.rating).tier : null;
  return (
    <aside className="t-rail" aria-label="Leaderboard details">
      {/* The phone shows two readouts above the list instead. */}
      <div className={styles.deskOnly}><YourSeasonPanel position={position} scope={scope} /></div>

      <SheetPanel id="tiers" title="Tiers" aside="by current Elo">
        <ul className="ladder">
          {tiers.map(({ name, min, count }) => (
            <li key={name} className={currentTier === name ? "here" : undefined}>
              <RankGem tier={name} size="lg" />
              <TierName tier={name} gem={false} />
              <span className="rng">{min === 0 ? "below" : `${min}+`} · {count}</span>
            </li>
          ))}
        </ul>
      </SheetPanel>

      <SheetPanel title="How winnings work">
        <div className={styles.guide}>
          <p className="small">
            A win earns {guide.min} to {guide.max}: {guide.equal} against an equal rating, more against stronger players. Losses never take winnings away.
          </p>
          <table className="howto" aria-label="Tournament placement winnings">
            <thead>
              <tr><th scope="col">Tournament size</th><th scope="col">1st</th><th scope="col">2nd</th><th scope="col">Top 4</th></tr>
            </thead>
            <tbody>
              {guide.brackets.map(({ label, awards }) => (
                <tr key={label}>
                  <td>{label}</td>
                  {awards.map((award, i) => <td key={i}>{award.toLocaleString()}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SheetPanel>
    </aside>
  );
}
