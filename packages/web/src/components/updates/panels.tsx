import { forwardRef, type RefObject } from "react";
import { ChevronDown, Maximize2, Minimize2, Minus, ScrollText } from "lucide-react";
import type { Release } from "@/lib/updates/types";
import { SECTION_META, changeCount, kindOfHighlight, longDate, shortDate } from "@/lib/updates/model";
import { ReleaseSections, ReleaseTitle, Rich } from "./release-notes";
import styles from "./updates-board.module.css";

const NewTag = () => <span className={styles.newtag}>New</span>;

interface CompactPanelProps {
  release: Release;
  older: Release[];
  isNew: boolean;
  closing: boolean;
  lift: number;
  readRef: RefObject<HTMLButtonElement | null>;
  onExpand: () => void;
  onMinimize: () => void;
  onGoto: (version: string) => void;
}

/** The small panel above the chip: the newest release as a short list, with links to older ones. */
export const CompactPanel = forwardRef<HTMLElement, CompactPanelProps>(function CompactPanel({ release, older, isNew, closing, lift, readRef, onExpand, onMinimize, onGoto }, ref) {
  const changes = changeCount(release);
  return (
    <section
      ref={ref}
      className={`${styles.float} ${styles.compact} ${closing ? styles.closing : styles.opening}`}
      style={{ "--upd-lift": `${lift}px` } as React.CSSProperties}
      role="dialog"
      aria-modal="false"
      aria-labelledby="upd-c-title"
    >
      <div className={styles.fhead}>
        <h2 className={styles.t1} id="upd-c-title"><ScrollText aria-hidden="true" />Updates</h2>
        <button type="button" className={styles.iconbtn} onClick={onExpand} aria-label="Expand to all notes" title="Expand"><Maximize2 aria-hidden="true" /></button>
        <button type="button" className={styles.iconbtn} onClick={onMinimize} aria-label="Minimize" title="Minimize"><Minus aria-hidden="true" /></button>
      </div>
      <div className={styles.cbody}>
        <div className={styles.vhead}>
          <h3 className={styles.vtitle}><ReleaseTitle release={release} /></h3>
          {isNew ? <NewTag /> : null}
        </div>
        <p className={styles.vdate}>{longDate(release.publishedAt)}{changes > 0 ? ` · ${changes} ${changes === 1 ? "change" : "changes"}` : ""}</p>
        <ul className={styles.hl}>
          {release.highlights.map((highlight, i) => {
            const kind = kindOfHighlight(release, highlight);
            return (
              <li key={i}>
                {kind ? <span className={styles.em} aria-hidden="true">{SECTION_META[kind].emoji}</span> : <span className={styles.dot} aria-hidden="true" />}
                <span><Rich text={highlight} /></span>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={styles.cfoot}>
        <span className={styles.older}>
          {older.length > 0 ? (
            <>Older: {older.slice(0, 3).map((r, i) => (
              <span key={r.version}>{i > 0 ? " · " : ""}<button type="button" onClick={() => onGoto(r.version)}>v{r.version}</button></span>
            ))}</>
          ) : null}
        </span>
        <button type="button" ref={readRef} className={`${styles.btnPen} ${styles.btnSm}`} onClick={onExpand}>All notes</button>
      </div>
    </section>
  );
});

interface ExpandedPanelProps {
  releases: Release[];
  newVersion: string | null;
  activeVersion: string;
  closing: boolean;
  lift: number;
  shrinkRef: RefObject<HTMLButtonElement | null>;
  bodyRef: RefObject<HTMLDivElement | null>;
  onShrink: () => void;
  onMinimize: () => void;
  onGoto: (version: string) => void;
  onScroll: () => void;
}

/** The full notes: version tabs on top, the newest release open, older ones folded. */
export const ExpandedPanel = forwardRef<HTMLElement, ExpandedPanelProps>(function ExpandedPanel({ releases, newVersion, activeVersion, closing, lift, shrinkRef, bodyRef, onShrink, onMinimize, onGoto, onScroll }, ref) {
  const [latest, ...older] = releases;
  if (!latest) return null;
  const oldest = releases[releases.length - 1]!;
  return (
    <section
      ref={ref}
      className={`${styles.float} ${styles.expanded} ${closing ? styles.closing : styles.opening}`}
      style={{ "--upd-lift": `${lift}px` } as React.CSSProperties}
      role="dialog"
      aria-modal="false"
      aria-labelledby="upd-e-title"
    >
      <div className={styles.fhead}>
        <h2 className={styles.t1} id="upd-e-title"><ScrollText aria-hidden="true" />Updates</h2>
        <button type="button" ref={shrinkRef} className={styles.iconbtn} onClick={onShrink} aria-label="Shrink to summary" title="Shrink"><Minimize2 aria-hidden="true" /></button>
        <button type="button" className={styles.iconbtn} onClick={onMinimize} aria-label="Minimize" title="Minimize"><Minus aria-hidden="true" /></button>
      </div>
      <div className={styles.ebody} ref={bodyRef} onScroll={onScroll}>
        {releases.length > 1 ? (
          <nav className={styles.vtabs} aria-label="Versions" data-vtabs>
            {releases.map((r, i) => (
              <button key={r.version} type="button" className={styles.vtab} aria-current={r.version === activeVersion} onClick={() => onGoto(r.version)}>
                v{r.version}{i === 0 ? " · Latest" : ""}
              </button>
            ))}
          </nav>
        ) : null}

        <article className={styles.release} data-rel={latest.version} aria-labelledby="upd-rel-latest">
          <h2 id="upd-rel-latest"><span><ReleaseTitle release={latest} /></span>{latest.version === newVersion ? <NewTag /> : null}</h2>
          <p className={styles.vdate}>{longDate(latest.publishedAt)}</p>
          <ReleaseSections release={latest} />
        </article>

        {older.map((r) => (
          <details key={r.version} className={styles.olderRel} data-rel={r.version}>
            <summary>
              <span className={styles.vt}>{r.title}</span>
              {r.version === newVersion ? <NewTag /> : null}
              <span className={styles.vd}>{shortDate(r.publishedAt)}</span>
              <ChevronDown aria-hidden="true" />
            </summary>
            <article className={styles.release} aria-label={r.title}>
              <ReleaseSections release={r} />
            </article>
          </details>
        ))}
        <p className={styles.eend}>{releases.length > 1 ? `That is all the updates since v${oldest.version}.` : "That is every update so far."}</p>
      </div>
    </section>
  );
});
