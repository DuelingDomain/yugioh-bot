"use client";

import * as React from "react";
import { X } from "lucide-react";
import { StatusLine, SvButton } from "@/components/sheet";
import type { CardSummary } from "@/lib/card-types";
import { CardInspector } from "../setup/card-inspector";
import { PoolBrowser } from "../setup/pool-browser";
import type { PoolCard, PoolCopies } from "../setup/pool-browser-model";
import { useCardInspector } from "../setup/use-card-inspector";
import { LobbyDialog } from "./lobby-actions";
import styles from "./seats-first.module.css";

export interface PoolDrawerProps {
  /** The Main pool cards. `qty` is the copies, one when missing. */
  cards: CardSummary[] | null;
  /** The Extra pool cards. */
  extraCards?: CardSummary[] | null;
  loading?: boolean;
  error?: string | null;
  title?: string;
  /** A line under the title, for example "From Goat cube". */
  detail?: string;
  onClose: () => void;
  /** The host's edit path. When given, an "Edit pool" button shows; the caller opens its editor. The browser itself stays read-only. */
  onEdit?: () => void;
  /** Where focus goes on close when the button that opened the drawer is gone. */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  emptyMessage?: string;
}

function copiesOf(cards: CardSummary[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const card of cards) map.set(card.id, (map.get(card.id) ?? 0) + (card.qty ?? 1));
  return map;
}

/**
 * The pool as a drawer: a full screen sheet on a phone and a wide panel on a desktop. It holds the read-only pool
 * browser and card inspector for everyone, whoever you are. The host also gets "Edit pool", which calls `onEdit`.
 */
export function PoolDrawer({ cards, extraCards, loading = false, error = null, title = "Card pool", detail, onClose, onEdit, returnFocusRef, emptyMessage = "This draft's pool hasn't been resolved yet." }: PoolDrawerProps) {
  const titleId = React.useId();
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const main = React.useMemo<PoolCopies>(() => copiesOf(cards ?? []), [cards]);
  const extra = React.useMemo<PoolCopies>(() => copiesOf(extraCards ?? []), [extraCards]);
  const byId = React.useMemo(() => {
    const map = new Map<number, PoolCard>();
    for (const card of [...(extraCards ?? []), ...(cards ?? [])]) map.set(card.id, card);
    return map;
  }, [cards, extraCards]);
  const getCard = React.useCallback((id: number) => byId.get(id), [byId]);
  // No edit callbacks: the browser and the inspector are read-only for everyone.
  const inspector = useCardInspector({ main, extra, getCard });
  const ready = cards !== null && !loading && !error;

  return (
    <LobbyDialog labelledBy={titleId} variant="full" onClose={onClose} dismissOnBackdrop initialFocusRef={closeRef} returnFocusRef={returnFocusRef} className={styles.drawer}>
      <div className={styles.drawerHead}>
        <div className={styles.drawerTitle}>
          <h2 className={styles.dialogT} id={titleId}>{title}</h2>
          {detail && <span className={styles.drawerDetail}>{detail}</span>}
        </div>
        <div className={styles.drawerActs}>
          {onEdit && <SvButton variant="ghost" onClick={onEdit}>Edit pool</SvButton>}
          <button ref={closeRef} type="button" className={styles.dialogX} aria-label="Close pool" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className={styles.drawerBody}>
        {error ? (
          <div role="alert"><StatusLine tone="block">{error}</StatusLine></div>
        ) : !ready ? (
          <p className={styles.drawerWait} role="status">Loading the pool…</p>
        ) : (
          <>
            <PoolBrowser
              main={main}
              extra={extra}
              getCard={getCard}
              inspector={inspector}
              height="100%"
              className={styles.drawerBrowser}
              emptyState={<p className={styles.drawerWait}>{emptyMessage}</p>}
            />
            <CardInspector controller={inspector} />
          </>
        )}
      </div>
    </LobbyDialog>
  );
}
