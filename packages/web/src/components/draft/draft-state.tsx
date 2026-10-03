"use client";

import { RotateCw } from "lucide-react";
import { SvButton } from "@/components/sheet";
import { DraftFrame } from "./draft-frame";
import styles from "./draft-state.module.css";

/**
 * What a draft address shows when there is no draft to show: loading, private (403), missing (404) or a failed load.
 * It sits in the same frame as the other drafts pages, so the phone keeps its menu button.
 */
export function DraftState({ slug, error, onRetry }: { slug: string; error: { status: number | null } | null; onRetry: () => void }) {
  const forbidden = error?.status === 403;
  const missing = error?.status === 404;
  return (
    <DraftFrame title="Draft">
      {error ? (
        <div className={styles.state}>
          <p className={styles.code}>{forbidden ? "403" : missing ? "404" : "Error"}</p>
          <h2 className={styles.title}>
            {forbidden ? "This draft is only open to its players" : missing ? "No draft at this address" : "This draft didn't load"}
          </h2>
          {forbidden ? (
            <p className={styles.text}>Once a draft starts, only its host and the people drafting can open it.</p>
          ) : missing ? (
            <p className={styles.text}>Nothing on this server matches{" "}<code>/draft/{slug}</code>.{" "}It may have been deleted, or the link has a typo.</p>
          ) : (
            <p className={styles.text}>Nothing was changed. Try again, or open your drafts list.</p>
          )}
          <div className={styles.acts}>
            {forbidden || missing ? (
              <SvButton as="a" href="/drafts" variant="primary">All drafts</SvButton>
            ) : (
              <SvButton variant="primary" onClick={onRetry}>
                <RotateCw size={16} aria-hidden="true" />Try again
              </SvButton>
            )}
            {forbidden || missing ? (
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
