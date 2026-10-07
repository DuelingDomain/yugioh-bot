"use client";

import * as React from "react";
import { Check, TriangleAlert } from "lucide-react";
import { extraCheck, railPool, seatCheck } from "./pool-model";
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

/** A gentle line under the rail rows: enough cards for 8 players, or how many more it takes. */
export function SeatNote({ total, perPlayer }: { total: number; perPlayer: number }) {
  if (total === 0) return null;
  const check = seatCheck(total, perPlayer);
  return (
    <p className={`${styles.seats} ${check.enough ? styles.seatsOk : styles.seatsWarn}`} role="status">
      {check.enough ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
      <span>{check.text}</span>
    </p>
  );
}

/**
 * The Extra Deck round needs one pack for every player. Says whether the Extra pool is big enough for 8 seats (the most
 * a draft holds), or how many Extra Deck cards are missing. Nothing shows when the round is off or its size is 0.
 */
export function ExtraNote({ size, total, players = 8, className }: { size: number; total: number; players?: number; className?: string }) {
  const check = extraCheck({ on: true, size, total, players });
  if (!check) return null;
  return (
    <p className={`${styles.seats} ${check.enough ? styles.seatsOk : styles.seatsWarn}${className ? ` ${className}` : ""}`} role="status">
      {check.enough ? <Check size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
      <span>{check.text}</span>
    </p>
  );
}
