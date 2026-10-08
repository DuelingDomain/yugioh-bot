"use client";

import * as React from "react";
import { LoaderCircle } from "lucide-react";
import { svButtonClass } from "@/components/sheet";
import type { PagedList } from "@/lib/hooks/use-paged-list";
import styles from "./load-more.module.css";

export interface LoadMoreProps {
  list: Pick<PagedList<unknown>, "nextCursor" | "status" | "appended" | "lastLoad" | "loadMore"> & { items: readonly unknown[] };
  /** Plural, lower case: "drafts". */
  noun: string;
}

/**
 * The footer of a paged list: a quiet secondary "Load more" button, a retry line when a load fails,
 * and nothing once the last page is in (apart from a one-line note after rows were added).
 *
 * The button stays mounted and keeps focus while it loads: it is `aria-disabled`, not `disabled`, so
 * a keyboard user is not dropped to the top of the page. When the last page arrives and the button
 * goes away, focus moves to the end note instead of being lost.
 */
export function LoadMore({ list, noun }: LoadMoreProps) {
  const { nextCursor, status, appended, lastLoad, loadMore } = list;
  const loading = status === "loading";
  const failed = status === "error";
  const endRef = React.useRef<HTMLParagraphElement>(null);
  const clicked = React.useRef(false);

  const done = nextCursor === null;
  React.useEffect(() => {
    if (done && clicked.current) {
      clicked.current = false;
      endRef.current?.focus();
    }
  }, [done]);

  return (
    <div className={styles.foot}>
      <p className={styles.sr} role="status">
        {loading ? `Loading more ${noun}` : lastLoad ? `Loaded ${lastLoad.count} more ${noun}` : ""}
      </p>
      {!done && (
        <div className={styles.row}>
          <button
            type="button"
            className={`${svButtonClass("ghost")} ${styles.btn}`}
            aria-disabled={loading || undefined}
            aria-busy={loading || undefined}
            onClick={() => {
              if (loading) return;
              clicked.current = true;
              loadMore();
            }}
          >
            {loading && <LoaderCircle className="spin" size={16} strokeWidth={2.2} aria-hidden="true" />}
            {failed ? "Try again" : "Load more"}
          </button>
          {failed && (
            <p className={styles.err} role="alert">
              Couldn&rsquo;t load more {noun}.
            </p>
          )}
        </div>
      )}
      {done && appended && (
        <p ref={endRef} tabIndex={-1} className={styles.end}>
          All {list.items.length} {noun} shown
        </p>
      )}
    </div>
  );
}
