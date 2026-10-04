"use client";

import * as React from "react";
import { Check, TriangleAlert } from "lucide-react";
import { railPool, seatCheck } from "./pool-model";
import type { PoolEditor } from "./use-pool-editor";
import styles from "./pool.module.css";

/** The rail's Pool row: the cube (", edited" once it differs) or "Built for this draft", with the card count under it. */
export function PoolRailText({ baseName, edited, total, empty }: { baseName: string | null; edited: boolean; total: number; empty: boolean }) {
  const row = railPool({ baseName, edited, total, empty });
  return (
    <span className={styles.railPool}>
      <b>{row.name}</b>
      {row.count && (
        <small>
          <span className="num">{total}</span> {total === 1 ? "card" : "cards"}
        </small>
      )}
    </span>
  );
}

export function PoolRailValue({ ctl }: { ctl: Pick<PoolEditor, "meta" | "edited" | "total" | "pool" | "loading"> }) {
  if (ctl.loading) return <span className={styles.railPool}><b>Loading…</b></span>;
  return <PoolRailText baseName={ctl.meta?.name ?? null} edited={ctl.edited} total={ctl.total} empty={ctl.pool.size === 0} />;
}

/** A gentle line under the rail rows: enough different cards for 8 players, or how many more it takes. */
export function SeatNote({ distinct, packSize }: { distinct: number; packSize: number }) {
  if (distinct === 0) return null;
  const check = seatCheck(distinct, packSize);
  return (
    <p className={`${styles.seats} ${check.enough ? styles.seatsOk : styles.seatsWarn}`} role="status">
      {check.enough ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
      <span>{check.text}</span>
    </p>
  );
}
