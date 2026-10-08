"use client";

import { RotateCw } from "lucide-react";
import { SvButton } from "@/components/sheet";
import { DraftFrame } from "./draft-frame";
import styles from "./draft-state.module.css";

/**
 * What a draft address shows when there is no draft to show: loading, not found or a failed load. Not found is the same
 * for a missing draft and a private one the viewer has no access to (the server answers 404 for both; a stray 403 reads
 * the same, so nothing tells the two apart).
 * It sits in the same frame as the other drafts pages, so the phone keeps its menu button.
 */
export function DraftState({ error, onRetry }: { /** The address's draft. The states do not show it: a 404 must read the same for every draft. */ slug?: string; error: { status: number | null } | null; onRetry: () => void }) {
  const missing = error?.status === 404 || error?.status === 403;
  return (
    <DraftFrame title="Draft">
      {error ? (
        <div className={styles.state}>
          <p className={styles.code}>{missing ? "404" : "Error"}</p>
          <h2 className={styles.title}>
            {missing ? "Draft not found" : "This draft didn't load"}
          </h2>
          {missing ? (
            <p className={styles.text}>There is no draft you can open at this address. It may have been deleted, or it may be private. If a host invited you, open the invite link they sent.</p>
          ) : (
            <p className={styles.text}>Nothing was changed. Try again, or open your drafts list.</p>
          )}
          <div className={styles.acts}>
            {missing ? (
              <SvButton as="a" href="/drafts" variant="primary">All drafts</SvButton>
            ) : (
              <SvButton variant="primary" onClick={onRetry}>
                <RotateCw size={16} aria-hidden="true" />Try again
              </SvButton>
            )}
            {missing ? (
              <SvButton as="a" href="/dashboard" variant="ghost">Dashboard</SvButton>
            ) : (
              <SvButton as="a" href="/drafts" variant="ghost">Drafts</SvButton>
            )}
          </div>
        </div>
      ) : (
        <p className={styles.loading} role="status" aria-label="Loading draft">Loading draft…</p>
      )}
    </DraftFrame>
  );
}
