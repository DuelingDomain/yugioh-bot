import type { ReactNode } from "react";
import styles from "./meta-line.module.css";

export interface MetaLineItem {
  content: ReactNode;
  className?: string;
}

/**
 * Facts split by dots. Each dot travels with the item after it and the dot that starts a line
 * is clipped, so a wrapped line never starts or ends on a stray dot.
 */
export function MetaLine({ className, items }: { className?: string; items: MetaLineItem[] }) {
  return (
    <p className={[className, styles.line].filter(Boolean).join(" ")}>
      <span className={styles.run}>
        {items.map((item, index) => (
          <span key={index} className={[styles.item, item.className].filter(Boolean).join(" ")}>
            <span className="dot" aria-hidden="true" />
            {item.content}
          </span>
        ))}
      </span>
    </p>
  );
}
