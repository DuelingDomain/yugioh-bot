"use client";

import { FieldOutline, LightRule, PageBar, SheetRoot, SvButton } from "@/components/sheet";
import { OwnsPageBar, ShellMenuButton } from "@/components/layout/shell-bar";
import styles from "./tournament-gate.module.css";

/**
 * What the tournament page shows instead of a tournament: loading, "no tournament at this address", or a
 * load error with a retry. All three sit on a field outline so a missing page still looks like this site.
 */
export function TournamentGate({ kind, slug, busy = false, onRetry }: {
  kind: "loading" | "missing" | "error";
  slug: string;
  busy?: boolean;
  onRetry?: () => void;
}) {
  return (
    <SheetRoot>
      <PageBar back={{ href: "/tournaments", label: "Back to tournaments" }} title="Tournament" actions={<><ShellMenuButton /><OwnsPageBar /></>} />
      <div className={styles.wrap}>
        <FieldOutline lit={kind !== "error"} centreLine>
          <div className={styles.body}>
            {kind === "loading" && (
              <div role="status" aria-label="Loading tournament" aria-busy="true" className={styles.loading}>
                <span className="sk" style={{ width: "min(220px, 60%)", height: 22 }} aria-hidden="true" />
                <span className="sk" style={{ width: "min(340px, 90%)" }} aria-hidden="true" />
                <span className="sk" style={{ width: "min(280px, 75%)" }} aria-hidden="true" />
              </div>
            )}
            {kind === "missing" && (
              <>
                <p className={styles.code}>404</p>
                <h1 className={styles.title}>No tournament at this address</h1>
                <LightRule />
                <p className={styles.text}>Nothing on this server matches <code>/tournament/{slug}</code>. It may have been deleted, or the link has a typo.</p>
                <div className={styles.acts}>
                  <SvButton as="a" href="/tournaments" variant="primary" big>All tournaments</SvButton>
                  <SvButton as="a" href="/dashboard" variant="quiet" big>Dashboard</SvButton>
                </div>
              </>
            )}
            {kind === "error" && (
              <>
                <p className={`${styles.code} ${styles.bad}`}>Error</p>
                <h1 className={styles.title}>This tournament didn&apos;t load</h1>
                <LightRule />
                <p className={styles.text}>Nothing was changed. Try again, and if it keeps happening, tell whoever runs the bot.</p>
                <div className={styles.acts}>
                  <SvButton variant="primary" big disabled={busy} aria-busy={busy} onClick={onRetry}>Try again</SvButton>
                  <SvButton as="a" href="/dashboard" variant="quiet" big>Dashboard</SvButton>
                </div>
              </>
            )}
          </div>
        </FieldOutline>
      </div>
    </SheetRoot>
  );
}
