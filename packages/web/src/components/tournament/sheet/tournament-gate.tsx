"use client";

import { FieldOutline, LightRule, PageBar, SheetRoot, SvButton } from "@/components/sheet";
import { OwnsPageBar, ShellMenuButton } from "@/components/layout/shell-bar";
import styles from "./tournament-gate.module.css";

/**
 * What the tournament page shows instead of a tournament: loading, "not found", a load error with a retry, and the
 * three states of an invite link that is being opened. All sit on a field outline so a missing page still looks
 * like this site.
 *
 * "missing" is one screen for a tournament that does not exist and one the viewer may not see. It says nothing
 * about the address, the name, the status or the bracket.
 */
export function TournamentGate({ kind, busy = false, onRetry, wait }: {
  kind: "loading" | "opening" | "missing" | "error" | "invite-limited" | "invite-error";
  busy?: boolean;
  onRetry?: () => void;
  /** invite-limited: the line about how long to wait. */
  wait?: string;
}) {
  const loading = kind === "loading" || kind === "opening";
  return (
    <SheetRoot>
      <PageBar back={{ href: "/tournaments", label: "Back to tournaments" }} title="Tournament" actions={<><ShellMenuButton /><OwnsPageBar /></>} />
      <div className={styles.wrap}>
        <FieldOutline lit={kind !== "error" && kind !== "invite-error"}>
          <div className={styles.body}>
            {loading && (
              <div role="status" aria-label={kind === "opening" ? "Opening your invite" : "Loading tournament"} aria-busy="true" className={styles.loading}>
                <span className="sk" style={{ width: "min(220px, 60%)", height: 22 }} aria-hidden="true" />
                <span className="sk" style={{ width: "min(340px, 90%)" }} aria-hidden="true" />
                <span className="sk" style={{ width: "min(280px, 75%)" }} aria-hidden="true" />
                {kind === "opening" && <span className={styles.opening}>Opening your invite…</span>}
              </div>
            )}
            {kind === "missing" && (
              <>
                <p className={styles.code}>404</p>
                <h1 className={styles.title}>Tournament not found</h1>
                <LightRule />
                <p className={styles.text}>There is no tournament here that you can open. The link may have a typo, or the tournament may have been deleted. A private tournament needs its invite link.</p>
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
                <p className={styles.text}>Nothing was changed. Try again, and if it keeps happening, email support@duelingdomain.com.</p>
                <div className={styles.acts}>
                  <SvButton variant="primary" big disabled={busy} aria-busy={busy} onClick={onRetry}>Try again</SvButton>
                  <SvButton as="a" href="/dashboard" variant="quiet" big>Dashboard</SvButton>
                </div>
              </>
            )}
            {kind === "invite-limited" && (
              <>
                <p className={styles.code}>Slow down</p>
                <h1 className={styles.title}>Try again in a moment</h1>
                <LightRule />
                <p className={styles.text}>{wait}</p>
                <div className={styles.acts}>
                  <SvButton variant="primary" big onClick={onRetry}>Try again</SvButton>
                  <SvButton as="a" href="/tournaments" variant="quiet" big>All tournaments</SvButton>
                </div>
              </>
            )}
            {kind === "invite-error" && (
              <>
                <p className={`${styles.code} ${styles.bad}`}>Error</p>
                <h1 className={styles.title}>This invite didn&apos;t open</h1>
                <LightRule />
                <p className={styles.text}>Nothing was changed. Check your connection and try again.</p>
                <div className={styles.acts}>
                  <SvButton variant="primary" big onClick={onRetry}>Try again</SvButton>
                  <SvButton as="a" href="/tournaments" variant="quiet" big>All tournaments</SvButton>
                </div>
              </>
            )}
          </div>
        </FieldOutline>
      </div>
    </SheetRoot>
  );
}
