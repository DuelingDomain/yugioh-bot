import { useId, type ReactNode } from "react";
import type { Release, ReleaseSection } from "@/lib/updates/types";
import { SECTION_META, orderedSections, splitTitle } from "@/lib/updates/model";
import styles from "./updates-board.module.css";

/** Text with **bold** marks. Nothing else is read as markup, so a release can not put HTML on the page. */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, i) => (i % 2 === 1 ? <b key={i}>{part}</b> : part))}</>;
}

/** "Dueling Domain" with the version in gold. */
export function ReleaseTitle({ release }: { release: Pick<Release, "title" | "version"> }): ReactNode {
  const [lead, tag] = splitTitle(release);
  return <>{lead}{tag ? <span className={styles.accent}>{tag}</span> : null}</>;
}

function Section({ section }: { section: ReleaseSection }) {
  const headingId = useId();
  const meta = SECTION_META[section.kind];
  const items = section.items.map((item, i) => <li key={i}><Rich text={item} /></li>);
  return (
    <div className={styles.sec} data-kind={section.kind}>
      <h3 id={headingId}><span className={styles.em} aria-hidden="true">{meta.emoji}</span>{meta.label}</h3>
      {section.kind === "howto" ? <ol className={styles.steps} aria-labelledby={headingId}>{items}</ol> : <ul aria-labelledby={headingId}>{items}</ul>}
    </div>
  );
}

/** The sections of one release: New, Improvements, Card data, Fixes, How to use. Shared by the board and the admin preview. */
export function ReleaseSections({ release }: { release: Pick<Release, "sections"> }) {
  return <>{orderedSections(release.sections).map((section) => <Section key={section.kind} section={section} />)}</>;
}
