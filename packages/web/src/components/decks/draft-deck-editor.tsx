"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cx, sheetButtonClass, sheetRoot } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { getDraftDeckPool } from "./api";
import { SavedDeckEditor } from "./editor";
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

  if (error) {
    return (
      <div className={cx(sheetRoot, styles.editor, styles.center)}>
        <p role="alert" className={ui.alert}>{error}</p>
        <Link href={`/draft/${slug}`} className={sheetButtonClass("secondary")}>Back to the draft</Link>
      </div>
    );
  }
  if (!pool) {
    return (
      <div className={cx(sheetRoot, styles.editor, styles.center)}>
        <p className={ui.hint}>Loading your draft pool…</p>
      </div>
    );
  }
  return (
    <SavedDeckEditor
      key={`${pool.draftId}-${pool.savedDeckId ?? "new"}`}
      pool={pool}
      deckId={pool.savedDeckId == null ? undefined : String(pool.savedDeckId)}
    />
  );
}
