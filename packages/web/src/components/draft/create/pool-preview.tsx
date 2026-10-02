"use client";

import * as React from "react";
import { Eye } from "lucide-react";
import { SheetPortal } from "@/components/sheet";
import { Sheet } from "@/components/ui/sheet";
import { CardPoolPanel } from "@/components/cards/card-pool-panel";
import type { CardSummary } from "@/lib/card-types";
import { tallyPool } from "./format";
import styles from "./create.module.css";

interface PoolPreviewProps {
  cards: CardSummary[];
  unknownIds: number[];
  loading: boolean;
}

/** Summary-rail preview of the resolved pool: counts by kind, six cards, and the full pool in a side sheet. */
export function PoolPreview({ cards, unknownIds, loading }: PoolPreviewProps) {
  const [open, setOpen] = React.useState(false);
  const tally = React.useMemo(() => tallyPool(cards), [cards]);
  const thumbs = React.useMemo(() => cards.filter((c) => c.imageUrlSmall).slice(0, 6), [cards]);

  return (
    <div className={styles.pv}>
      <p className={styles.pvh}>
        <span>Pool preview</span>
        <small aria-live="polite">{loading ? "Resolving" : cards.length > 0 ? `${tally.total} cards` : ""}</small>
      </p>
      {cards.length === 0 ? (
        <p className={styles.pvEmpty}>{loading ? "Looking up the cards." : "Add sets or card IDs to preview the pool."}</p>
      ) : (
        <>
          <p className={styles.tally}>
            <span data-k="monster">
              <b>{tally.monsters}</b>Monsters
            </span>
            <span data-k="spell">
              <b>{tally.spells}</b>Spells
            </span>
            <span data-k="trap">
              <b>{tally.traps}</b>Traps
            </span>
          </p>
          <ul className={styles.thumbs} aria-hidden="true">
            {thumbs.map((c) => (
              <li key={c.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrlSmall} alt="" loading="lazy" />
              </li>
            ))}
          </ul>
          <button className="btn btn-quiet btn-sm btn-block" type="button" onClick={() => setOpen(true)}>
            <Eye className="ic sm" aria-hidden="true" />
            See all {tally.total} cards
          </button>
        </>
      )}
      <SheetPortal>
        <Sheet open={open} onClose={() => setOpen(false)} title="Pool preview" className="md:w-[560px] md:max-w-full">
          <div className={styles.poolSheet}>
            <CardPoolPanel
              variant="sheet"
              title="Pool preview"
              cards={cards}
              unknownIds={unknownIds}
              loading={loading}
              emptyMessage="Add sets or card IDs to preview the pool."
              countMode="copies"
              heightClassName="h-[calc(100vh-9rem)]"
            />
          </div>
        </Sheet>
      </SheetPortal>
    </div>
  );
}
