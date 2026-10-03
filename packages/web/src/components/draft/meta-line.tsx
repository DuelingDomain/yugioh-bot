import type { ReactNode } from "react";
import styles from "./meta-line.module.css";

interface MetaLineItem {
  content: ReactNode;
  className?: string;
}

/** Keep each separator with its item and clip the first separator on every line. */
export function MetaLine({ className, items }: { className: string; items: MetaLineItem[] }) {
  return (
    <p className={`${className} ${styles.line}`}>
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
