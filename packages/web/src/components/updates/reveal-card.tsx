import { forwardRef } from "react";
import { ScrollText, Star, X } from "lucide-react";
import type { Release } from "@/lib/updates/types";
import { cardDate, cardStats, setCode } from "@/lib/updates/model";
import { Rich, ReleaseTitle } from "./release-notes";
import styles from "./updates-board.module.css";

const CARD_HIGHLIGHTS = 3;

interface RevealCardProps {
  release: Release;
  leaving: boolean;
  onRead: () => void;
  onLater: () => void;
  barRef: React.RefObject<HTMLElement | null>;
  cardRef: React.RefObject<HTMLElement | null>;
}

/** The one-time card that flies in above the chip when a new update is out. Gold frame, like a card from the game. */
export const RevealCard = forwardRef<HTMLDivElement, RevealCardProps>(function RevealCard({ release, leaving, onRead, onLater, barRef, cardRef }, ref) {
  const stars = Math.min(Math.max(release.highlights.length, 1), 6);
  const stats = cardStats(release);
  // The card text is short: the first three highlights, then a count. The panels list them all.
  const shown = release.highlights.slice(0, CARD_HIGHLIGHTS);
  const more = release.highlights.length - shown.length;
  return (
    <div
      ref={ref}
      className={`${styles.reveal} ${leaving ? styles.leaving : ""}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby="upd-rv-name"
      aria-describedby="upd-rv-effect"
    >
      <div className={styles.rwrap}>
        <span className={`${styles.rlabel} ${styles.show}`}>New update</span>
        <button type="button" className={styles.rclose} onClick={onLater} aria-label="Close and keep in Updates"><X aria-hidden="true" /></button>
        <article ref={cardRef as React.RefObject<HTMLElement>} className={`${styles.ycard} ${styles.show}`}>
          <div className={styles.namebar}>
            <h2 className={styles.nm} id="upd-rv-name"><ReleaseTitle release={release} /></h2>
            <span className={styles.attr} aria-hidden="true"><ScrollText /></span>
          </div>
          <div className={styles.stars} role="img" aria-label={`${stars} highlights`}>
            {Array.from({ length: stars }, (_, i) => <Star key={i} aria-hidden="true" />)}
          </div>
          <div className={styles.art} aria-hidden="true">
            <div className={styles.rays} />
            <div className={styles.emblem}>
              <svg viewBox="0 0 32 32"><path fill="currentColor" fillRule="evenodd" d="M6 4H18.5L26 11.5V20.5L18.5 28H6Z M12 9H19.5A1.5 1.5 0 0 1 21 10.5V21.5A1.5 1.5 0 0 1 19.5 23H12A1.5 1.5 0 0 1 10.5 21.5V10.5A1.5 1.5 0 0 1 12 9Z" /><path fill="currentColor" d="M15.75 12.6L19.15 16L15.75 19.4L12.35 16Z" /></svg>
            </div>
            <span className={styles.watermark}>PATCH · {release.version}</span>
            <div className={styles.foil} />
          </div>
          <div className={styles.setline}><span>{setCode(release.version)}</span><span>{cardDate(release.publishedAt)}</span></div>
          <div className={styles.effect} id="upd-rv-effect">
            <div className={styles.type}>[ Update / Effect ]</div>
            <p>
              When this update is revealed: {shown.map((h, i) => <span key={i}>{i > 0 ? " " : ""}<Rich text={h} /></span>)}
              {more > 0 ? ` And ${more} more.` : ""}
            </p>
            {stats.length > 0 ? <div className={styles.stat}>{stats.map((s) => <span key={s}>{s}</span>)}</div> : null}
          </div>
          <div className={styles.rtimer} aria-hidden="true"><i ref={barRef as React.RefObject<HTMLElement>} /></div>
        </article>
        <div className={`${styles.ractions} ${styles.show}`}>
          <button type="button" className={styles.btnGhost} onClick={onLater}>Later</button>
          <button type="button" className={styles.btnPen} onClick={onRead} data-reveal-read><ScrollText aria-hidden="true" />Read the notes</button>
        </div>
      </div>
    </div>
  );
});
