import { useId } from "react";
import { RankGem, TierName } from "@/components/rank/rank-gem";
import sheet from "@/components/sheet/sheet.module.css";
import { getTierProgress, getWinningsGuide, type getTierCounts, type LeaderboardScope, type PlayerPosition } from "./leaderboard-model";
import styles from "./leaderboard.module.css";

function YourPositionCard({ position, scope }: { position: PlayerPosition | null; scope: LeaderboardScope }) {
  const kicker = scope === "season" ? "Your season" : "All-time";
  if (!position) return <section className={sheet.card} aria-label={kicker}>
    <p className={sheet["card-kind"]}>{kicker}</p>
    <p>You're not on the board yet.</p>
    <p className={sheet.small}>Finish a ranked match to appear here.</p>
  </section>;

  const { row, place, above, gap } = position;
  const progress = getTierProgress(row.rating);
  return <section className={sheet.card} aria-label={kicker}>
    <div><p className={sheet["card-kind"]}>{kicker}</p><p className={styles["card-name"]}>{row.displayName}</p></div>
    <dl className={sheet.tally}>
      <div><dd>#{place}</dd><dt>Place</dt></div>
      {/* The "All-time" kicker already says these are career totals; a longer label wraps the tally. */}
      <div><dd>{row.winnings.toLocaleString()}</dd><dt>Winnings</dt></div>
      <div><dd>{row.rating}</dd><dt>Elo</dt></div>
    </dl>
    {(above || scope === "season") && <dl className={sheet.rows}>
      {above && <div><dt>Behind {above.displayName}</dt><dd>{gap!.toLocaleString()} winnings</dd></div>}
      {scope === "season" && <>
        <div><dt>Record</dt><dd>{row.wins}–{row.losses} · {row.winRate}%</dd></div>
        <div><dt>Streak</dt><dd>{row.currentStreak}</dd></div>
      </>}
    </dl>}
    <div className={styles["tier-progress"]}>
      <div className={styles["progress-top"]}>
        <TierName tier={progress.tier} />
        <span className={styles["progress-label"]}>{progress.nextTier ? <>
          {progress.remaining.toLocaleString()} Elo to <TierName tier={progress.nextTier} gem={false} />
        </> : progress.label}</span>
      </div>
      <div className={styles.meter} role="img" aria-label={progress.span === null ? `${progress.tier} tier, Top tier` : `${progress.tier} tier, ${progress.points} of ${progress.span} points through`}>
        <i data-t={progress.tier} style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  </section>;
}

export function LeaderboardRail({ position, scope, tiers }: {
  position: PlayerPosition | null; scope: LeaderboardScope; tiers: ReturnType<typeof getTierCounts>;
}) {
  const tiersId = useId();
  const howtoId = useId();
  const guide = getWinningsGuide();
  const currentTier = position ? getTierProgress(position.row.rating).tier : null;
  return <aside className={styles["t-rail"]} aria-label="Leaderboard details">
    <YourPositionCard position={position} scope={scope} />
    <section className={`${sheet.panel} ${sheet["panel-pad"]}`} aria-labelledby={tiersId}>
      <h2 id={tiersId} className={`${sheet["panel-t"]} ${styles["ladder-title"]}`}>Tiers<small>by Elo, {scope === "season" ? "this season" : "all-time"}</small></h2>
      <ul className={styles.ladder}>{tiers.map(({ name, min, count }) => {
        const here = currentTier === name;
        return <li key={name} className={here ? styles.here : undefined}>
          <RankGem tier={name} size="lg" />
          <TierName tier={name} gem={false}>{name}{here && <span className={styles["tier-marker"]}>YOU</span>}</TierName>
          <span className={styles.rng}>{min === 0 ? "below" : `${min}+`} · {count}</span>
        </li>;
      })}</ul>
    </section>
    <section className={`${sheet.panel} ${sheet["panel-pad"]} ${styles["winnings-panel"]}`} aria-labelledby={howtoId}>
      <h2 id={howtoId} className={sheet["panel-t"]}>How winnings work</h2>
      <p className={sheet.small}>A win earns {guide.min} to {guide.max}: {guide.equal} against an equal rating, more against stronger players. Losses never take winnings away.</p>
      <table className={styles.howto} aria-label="Tournament placement winnings">
        <thead><tr><th scope="col">Tournament size</th><th scope="col">1st</th><th scope="col">2nd</th><th scope="col">Top 4</th></tr></thead>
        <tbody>{guide.brackets.map(({ label, awards }) => <tr key={label}>
          <td>{label}</td>{awards.map((award, index) => <td key={index}>{award.toLocaleString()}</td>)}
        </tr>)}</tbody>
      </table>
    </section>
  </aside>;
}
