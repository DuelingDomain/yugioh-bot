"use client";

import type { ReactNode } from "react";
import { StatusLine, SvButton } from "@/components/sheet";
import { SECTION_BY_ID } from "@/lib/admin-console/sections";
import type { SectionDataMap, SectionId } from "@/lib/admin-console/types";
import { useAdminSection } from "./use-admin-section";
import { UpdatedLine } from "./updated-line";
import styles from "./admin-console.module.css";

/**
 * The frame every section uses: anchor id, heading, "updated" line, and the loading, not-configured and
 * error states. A section's panel file only renders `children(data)` for the "ok" case.
 *
 *   export function WaitlistPanel() {
 *     return <SectionPanel id="waitlist">{(data) => <FloorList>...</FloorList>}</SectionPanel>;
 *   }
 */
export function SectionPanel<K extends SectionId>({ id, children }: { id: K; children: (data: SectionDataMap[K]) => ReactNode }) {
  const def = SECTION_BY_ID[id];
  const { result, fetchedAt, failure, reload } = useAdminSection(id);
  const stale = failure !== null && result !== null;
  return (
    <section id={id} className={styles.panel} data-panel={id} data-span={def.span} aria-labelledby={`${id}-title`} aria-busy={result === null && failure === null}>
      <header className={styles.panelHead}>
        <div>
          <h2 id={`${id}-title`} className={styles.panelTitle}>{def.title}</h2>
          <p className={styles.muted}>{def.blurb}</p>
        </div>
        <p className={styles.updated}><UpdatedLine fetchedAt={fetchedAt} stale={stale} /></p>
      </header>
      <div className={styles.panelBody}>
        {result === null && failure === null ? <p className={styles.muted}>Loading</p> : null}
        {result === null && failure !== null ? (
          <div className={styles.stack}>
            <StatusLine tone="warn">
              {failure === "forbidden" ? "Only admins can see this." : failure === "unauthorized" ? "Sign in again to see this." : "Could not load this section. Trying again."}
            </StatusLine>
            <SvButton variant="quiet" onClick={reload}>Try again</SvButton>
          </div>
        ) : null}
        {result?.state === "not-configured" ? (
          <StatusLine tone="neutral">{result.message} Setup steps: docs/deployment/admin-console.md.</StatusLine>
        ) : null}
        {result?.state === "error" ? <StatusLine tone="warn">{result.message}</StatusLine> : null}
        {result?.state === "ok" ? <div className={styles.stack}>{children(result.data)}</div> : null}
      </div>
    </section>
  );
}

/** One short sentence for a section with nothing to show, for example "Nobody is online." */
export function EmptyNote({ children }: { children: ReactNode }) {
  return <p className={styles.muted}>{children}</p>;
}
