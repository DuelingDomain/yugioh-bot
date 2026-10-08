import type { ReactNode } from "react";
import styles from "./empty-states.module.css";

/** The headline of an empty state, one plain sentence, and the actions (the first button is the page's one primary). */
export function EmptyHero({ id, title, lede, children }: { id: string; title: string; lede: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.hero}>
      <h2 className={styles.heroTitle} id={id}>{title}</h2>
      <p className={styles.heroLede}>{lede}</p>
      {children ? <div className={styles.heroActs}>{children}</div> : null}
    </div>
  );
}
