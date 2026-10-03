import type { ReactNode } from "react";
import { RankGem, SectionHead, TierName } from "@/components/sheet";
import { TierLine } from "@/components/rank/tier-line";
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
    <div className={styles.tierProgress}>
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
      <TierLine tier={progress.tier} value={progress.percent / 100} label={tierMeterLabel(progress)} />
    </div>
  );
}

/** Three plain numbers: place, winnings, Elo. Also used alone above the list on a phone. */
export function PositionNumbers({ position }: { position: PlayerPosition }) {
  const { row, place } = position;
  const tier = getTierProgress(row.rating).tier;
  return (
    <dl className={styles.nums} aria-label="Your position">
      <div>
        <dt>Place</dt>
        <dd>#{place}</dd>
        {position.gapLabel && <span className={styles.numSub}>{position.gapLabel}</span>}
      </div>
      <div>
        <dt>Winnings</dt>
        <dd>{row.winnings.toLocaleString()}</dd>
      </div>
      <div>
        <dt>Elo</dt>
        <dd>{row.rating}</dd>
        <span className={styles.numSub}>{tier}</span>
      </div>
    </dl>
  );
}

function RailSection({ title, note, id, children }: { title: string; note?: ReactNode; id?: string; children: ReactNode }) {
  const headingId = `${id ?? title.toLowerCase().replace(/\W+/g, "-")}-h`;
  return (
    <section id={id} className={styles.railSection} aria-labelledby={headingId}>
      <SectionHead title={title} note={note} id={headingId} className={styles.railHead} />
      {children}
    </section>
  );
}

export function YourSeasonPanel({ position, scope }: { position: PlayerPosition | null; scope: LeaderboardScope }) {
  const title = scope === "season" ? "Your season" : "All-time";
  if (!position) {
    return (
      <RailSection title={title}>
        <p className={styles.plain}>You&apos;re not on the board yet.</p>
        <p className={styles.plainSmall}>Finish a ranked match to appear here.</p>
      </RailSection>
    );
  }
  const { row, above, gap } = position;
  return (
    <RailSection title={title} note={row.displayName}>
      <div className={styles.seasonBody}>
        <PositionNumbers position={position} />
        {(above || scope === "season") && (
          <dl className="rows">
            {above && <div><dt>Gap to {above.displayName}</dt><dd>{gap!.toLocaleString()} winnings</dd></div>}
            {scope === "season" && (
              <>
                <div><dt>Record</dt><dd>{row.wins}–{row.losses}, {row.winRate}%</dd></div>
                <div><dt>Streak</dt><dd>{row.currentStreak}</dd></div>
              </>
            )}
          </dl>
        )}
        <TierProgress rating={row.rating} />
      </div>
    </RailSection>
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
    <aside className={styles.rail} aria-label="Leaderboard details">
      {/* The phone shows the numbers above the list instead. */}
      <div className={styles.deskOnly}><YourSeasonPanel position={position} scope={scope} /></div>

      <RailSection id="tiers" title="Tiers" note="By current Elo">
        <ul className="ladder">
          {tiers.map(({ name, min, count }) => (
            <li key={name} className={currentTier === name ? "here" : undefined}>
              <RankGem tier={name} size="lg" />
              <TierName tier={name} gem={false} />
              <span className="rng">{min === 0 ? "below" : `${min}+`}, {count} {count === 1 ? "player" : "players"}</span>
            </li>
          ))}
        </ul>
      </RailSection>

      <RailSection title="How winnings work">
        <div className={styles.guide}>
          <p className={styles.plainSmall}>
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
      </RailSection>
    </aside>
  );
}
