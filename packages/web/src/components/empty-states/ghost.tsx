import type { CSSProperties, ReactNode } from "react";
import { Zone } from "@/components/sheet";
import styles from "./empty-states.module.css";

const bar = (width: string, small = false) => <i className={small ? styles.gbS : styles.gb} style={{ width }} />;
const index = (i: number) => ({ "--i": i }) as CSSProperties;

/** A faded, inert preview of the page once it has content. Drawn only: nothing in it is read or focusable. */
export function GhostPreview({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `${styles.ghost} ${className}` : styles.ghost} aria-hidden="true">{children}</div>;
}

/** The line that says the faded block is what the page will look like. */
export function GhostLabel({ children }: { children: ReactNode }) {
  return <p className={styles.pre} aria-hidden="true">{children}</p>;
}

/** Tournament rows: a ring, two lines, a strip of round slots, a button outline. */
export function GhostTournamentRows({ count, from = 0, strip = true }: { count: number; from?: number; strip?: boolean }) {
  return (
    <ul className={styles.glist}>
      {Array.from({ length: count }, (_, n) => {
        const i = from + n;
        return (
          <li key={i} className={styles.grow} style={index(n)}>
            <span className={styles.gring} />
            <span className={styles.gcol}>{bar(i % 2 ? "46%" : "58%")}{bar(i % 2 ? "30%" : "38%", true)}</span>
            {strip && (
              <span className={styles.gstrip}>
                <Zone state="lost" size="sm" /><Zone state="lost" size="sm" /><Zone state="dashed" size="sm" />
              </span>
            )}
            <i className={styles.gpill} style={{ width: 74 }} />
          </li>
        );
      })}
    </ul>
  );
}

/** Draft rows: a live row with a stage line, or a waiting row with a strip of seats. */
export function GhostDraftRows({ count, from = 0, kind }: { count: number; from?: number; kind: "live" | "wait" }) {
  return (
    <ul className={styles.glist}>
      {Array.from({ length: count }, (_, n) => {
        const i = from + n;
        return (
          <li key={i} className={styles.grow} style={index(n)}>
            <span className={styles.gcol}>
              {bar(i % 2 ? "50%" : "62%")}
              {kind === "live"
                ? <span className={styles.gseg}>{Array.from({ length: 14 }, (_, j) => <i key={j} data-on={j < 5 ? "" : undefined} />)}</span>
                : bar("34%", true)}
            </span>
            {kind === "wait" && (
              <span className={styles.gstrip}>
                {Array.from({ length: 8 }, (_, j) => <Zone key={j} state={j < 3 ? "lost" : "empty"} size="xs" />)}
              </span>
            )}
            <i className={styles.gpill} style={{ width: 74 }} />
          </li>
        );
      })}
    </ul>
  );
}

/** Saved deck rows: a fan of card backs, two lines, a button outline. */
export function GhostDeckRows({ count }: { count: number }) {
  return (
    <ul className={styles.glist}>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className={styles.grow} style={index(i)}>
          <span className={styles.gdeck}>{Array.from({ length: 7 }, (_, j) => <Zone key={j} state="lost" size="sm" />)}</span>
          <span className={styles.gcol}>{bar(i % 2 ? "44%" : "56%")}{bar("26%", true)}</span>
          <i className={styles.gpill} style={{ width: 58 }} />
        </li>
      ))}
    </ul>
  );
}

/** Leaderboard rows under the real column heads. */
export function GhostLedger({ count }: { count: number }) {
  return (
    <>
      <div className={styles.ghostHead}>
        <span>#</span><span>Player</span>
        <span className={styles.gr}>Winnings</span><span className={styles.gr}>W–L</span><span className={styles.gr}>Win %</span><span className={styles.gr}>Streak</span>
      </div>
      <ol className={styles.glist}>
        {Array.from({ length: count }, (_, i) => (
          <li key={i} className={styles.glrow} style={index(i)}>
            <span className={styles.glnum}>{i + 1}</span>
            <span className={styles.glwho}><span className={styles.gring} />{bar(`${46 - i * 3}%`)}</span>
            <span className={styles.gr}>{bar("48px")}</span>
            <span className={styles.gr}>{bar("36px")}</span>
            <span className={styles.gr}>{bar("32px")}</span>
            <span className={styles.gr}>{bar("28px")}</span>
          </li>
        ))}
      </ol>
    </>
  );
}
