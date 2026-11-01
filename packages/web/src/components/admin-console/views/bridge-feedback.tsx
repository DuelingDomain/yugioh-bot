"use client";

import { Notice, SectionHead, Tag } from "../parts";
import { useAdminSection } from "../use-admin-section";
import styles from "../admin-console.module.css";

export function BridgeFeedback() {
  const snapshot = useAdminSection("bridges");
  const result = snapshot.result;
  return (
    <section aria-label="Bridge feedback">
      <SectionHead title="Bridge feedback" n={result?.state === "ok" ? `${result.data.inReview} in review` : undefined} />
      {!result ? <p className={styles.muted}>Loading</p> : result.state !== "ok"
        ? <Notice tone="warn" title="Bridge feedback is unavailable">{result.message}</Notice>
        : result.data.feedback.length === 0 ? <div className={`${styles.empty} ${styles.emptySm}`}>No unresolved bridge feedback.</div>
        : result.data.feedback.map(row => (
          <div className={styles.errRow} key={`${row.evidenceHash}-${row.source}-${row.target}-${row.format}`}>
            <div className={styles.minw}>
              <div className={styles.p}>{row.source} → {row.target}</div>
              <div className={styles.errM}><Tag>{row.format === "genesys" ? "Genesys" : "Advanced"}</Tag>{row.hidden ? <Tag tone="warn">Hidden</Tag> : null}<span>{row.users} {row.users === 1 ? "report" : "reports"}</span></div>
              {row.reasons.filter(reason => reason.trim()).map((reason, index) => <p className={styles.muted} key={index}>{reason}</p>)}
              <small className={styles.muted}>{row.createdAt}</small>
            </div>
          </div>
        ))}
    </section>
  );
}
