"use client";

import { SECTIONS } from "@/lib/admin-console/sections";
import { PANELS } from "./panels";
import { SectionNav } from "./section-nav";
import { SummaryStrip } from "./summary-strip";
import styles from "./admin-console.module.css";

/** The page body: key numbers, sticky section tabs, then the panels in reading order. */
export function AdminConsole() {
  return (
    <div className={styles.page}>
      <SummaryStrip />
      <SectionNav />
      <div className={styles.grid}>
        {SECTIONS.map((s) => { const Panel = PANELS[s.id]; return <Panel key={s.id} />; })}
      </div>
    </div>
  );
}
