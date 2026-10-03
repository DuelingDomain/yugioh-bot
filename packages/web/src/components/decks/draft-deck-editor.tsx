"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SheetRoot } from "@/components/sheet";
import { getDraftDeckPool } from "./api";
import { SavedDeckEditor } from "./editor";
import { useEditorViewport } from "./editor-viewport";
import type { DraftDeckPool } from "./pool-model";
import styles from "./editor.module.css";

/**
 * Loads the player's pool for a finished draft, then opens the editor on their
 * draft deck (the saved one, or a new empty one).
 */
export function DraftDeckEditor({ slug }: { slug: string }) {
  const [pool, setPool] = useState<DraftDeckPool | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { editorRef } = useEditorViewport(true);

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
      <SheetRoot className={cn(styles.host, styles.center)} data-pool>
        <p ref={editorRef} role="alert" className="banner banner-bad">{error}</p>
        <Link href={`/draft/${slug}`} className="btn btn-secondary">Back to the draft</Link>
      </SheetRoot>
    );
  }
  if (!pool) {
    return (
      <SheetRoot className={cn(styles.host, styles.center)} data-pool>
        <p ref={editorRef} className="small">Loading your draft pool…</p>
      </SheetRoot>
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
