import type { CardDataUpdateHistoryEntry } from "@yugidraft/shared/types";
import { FloorList, FloorRow, StatusLine } from "@/components/sheet";
import { absoluteDate, newestUpdates } from "@/lib/card-data-status-model";
import styles from "./card-data.module.css";

const COUNTS = [
  ["newCards", "New cards"], ["changedCards", "Changed cards"], ["removedCards", "Removed cards"],
  ["changedScripts", "Changed scripts"], ["newSetCodes", "New set codes"],
] as const;

export function UpdateHistorySection({ entries = [] }: { entries?: CardDataUpdateHistoryEntry[] }) {
  return (
    <section className="set-sec" aria-labelledby="cd-history">
      <div className="set-intro">
        <h2 id="cd-history">Update history</h2>
        <p>Past engine data updates, newest first. Open an update&apos;s card list or pull request for details.</p>
      </div>
      <div className={styles.block}>
        {entries.length ? (
          <FloorList aria-label="Card data updates">
            {newestUpdates(entries).map((entry) => (
              <FloorRow key={entry.pullRequest.url} className={styles.historyRow}>
                <article className={styles.historyEntry} aria-label={entry.label}>
                  <div className={styles.historyHeading}>
                    <div>
                      <p className={styles.rowNote}><time dateTime={entry.date}>{absoluteDate(entry.date)}</time></p>
                      <h3 className={styles.rowTitle}>{entry.label}</h3>
                    </div>
                    <a className={styles.historyLink} href={entry.pullRequest.url} target="_blank" rel="noreferrer">
                      View PR #{entry.pullRequest.number}<span className="sv-sr"> (opens in a new tab)</span>
                    </a>
                  </div>
                  <dl className={styles.historyCounts}>
                    {COUNTS.map(([key, label]) => (
                      <div key={key}><dt>{label}</dt><dd>{entry.counts[key]?.toLocaleString("en-US") ?? "Unknown"}</dd></div>
                    ))}
                  </dl>
                  {entry.setCodes.length ? <p className={styles.rowNote}>Set codes: {entry.setCodes.join(", ")}</p> : null}
                  <details className={styles.historyDetails}>
                    <summary>New cards{entry.cardListAvailable ? ` (${entry.newCards.length.toLocaleString("en-US")})` : " — list unavailable"}</summary>
                    <div className={styles.historyCards}>
                      {!entry.cardListAvailable ? (
                        <StatusLine tone="neutral">The original update has no card list. See the pull request for its report.</StatusLine>
                      ) : entry.newCards.length ? (
                        <FloorList aria-label={`New cards in ${entry.label}`}>
                          {entry.newCards.map((card) => (
                            <FloorRow key={card.passcode} className={styles.historyCardRow}>
                              <div className={styles.historyCardName}>
                                <p className={styles.rowTitle}>{card.name}</p>
                                <p className={styles.rowNote}>{card.setName}{card.setCode ? ` (${card.setCode})` : ""}</p>
                              </div>
                              <span className={styles.mono}>{card.passcode}</span>
                              <span className={styles.rowNote}>{card.prerelease ? "Pre-release" : "Released"}</span>
                            </FloorRow>
                          ))}
                        </FloorList>
                      ) : <p className={styles.rowNote}>No new cards in this update.</p>}
                      <p className={styles.note}>{entry.note}</p>
                    </div>
                  </details>
                </article>
              </FloorRow>
            ))}
          </FloorList>
        ) : <StatusLine tone="neutral">No update history is recorded yet.</StatusLine>}
      </div>
    </section>
  );
}
