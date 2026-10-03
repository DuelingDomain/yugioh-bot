import type { ReactNode } from "react";
import styles from "./rail.module.css";

/** One quiet section of the rail: a display heading, an optional line under it, then the content. */
export function RailSection({ title, aside, id, children, label }: { title: string; aside?: ReactNode; id?: string; children: ReactNode; label?: string }) {
  return (
    <section className={styles.sec} id={id} aria-label={label ?? title}>
      <h2 className={styles.h}>{title}</h2>
      {aside != null && aside !== false && <p className={styles.aside}>{aside}</p>}
      {children}
    </section>
  );
}

