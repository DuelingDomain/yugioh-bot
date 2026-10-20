import type { CardReleaseInfo } from "@yugidraft/shared/cards/effects";
import styles from "./card-browser.module.css";

export function ReleaseMarks({ release, tile = false }: { release?: CardReleaseInfo; tile?: boolean }) {
  const ocg = !!release?.ocgDate && !release.tcgDate;
  if (!release?.upcoming && !ocg) return null;
  return <span className={styles.releaseMarks} data-tile={tile || undefined} title={release?.date ?? "Release month unknown"}>
    {release?.upcoming ? <span>Upcoming</span> : null}
    {ocg ? <span>OCG</span> : null}
  </span>;
}
