"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StatusLine, SvButton } from "@/components/sheet";
import { getDraftDeckPool } from "./api";
import { SavedDeckEditor } from "./editor";
import { PageFrame } from "./page-frame";
import type { DraftDeckPool } from "./pool-model";
import styles from "./editor.module.css";

/**
 * Loads the player's pool for a finished draft, then opens the editor on their
 * draft deck (the saved one, or a new empty one).
 */
export function DraftDeckEditor({ slug }: { slug: string }) {
  const [pool, setPool] = useState<DraftDeckPool | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPool(null);
    setError(null);
    void getDraftDeckPool(slug).then(
      (result) => { if (!cancelled) setPool({ ...result, slug }); },
      (reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Could not load your draft pool.");
      },
    );
    return () => { cancelled = true; };
  }, [slug]);

  const frame = (children: ReactNode) => (
    <PageFrame title="Draft deck" back={{ href: `/draft/${slug}`, label: "Back to the draft" }}>{children}</PageFrame>
  );
  if (error) {
    return frame(
      <>
        <div role="alert" className={styles["de-fail"]}><StatusLine tone="block">{error}</StatusLine></div>
        <div><SvButton as="a" href={`/draft/${slug}`} variant="ghost">Back to the draft</SvButton></div>
      </>,
    );
  }
  if (!pool) {
    return frame(<p className={styles["de-wait"]} role="status">Loading your draft pool…</p>);
  }
  return (
    <SavedDeckEditor
      key={`${pool.draftId}-${pool.savedDeckId ?? "new"}`}
      pool={pool}
      deckId={pool.savedDeckId == null ? undefined : String(pool.savedDeckId)}
    />
  );
}
