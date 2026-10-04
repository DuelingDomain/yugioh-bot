"use client";

import type { DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import styles from "./master-chip.module.css";

/**
 * Your Deck Master, as a chip under your LP plate on the wide table: small art, the name, how often it has returned and
 * what the next return costs. It replaces the Deck Master column; a click opens the Master tab of the drawer.
 */
export function MasterChip({ view, label, onOpen }: { view: DuelSeatView; label: string; onOpen: () => void }) {
  const master = view.deckMaster;
  if (!master) return null;
  return (
    <button
      type="button"
      className={styles.chip}
      data-testid="master-chip"
      aria-label={`${label}: ${master.card.name}. Returns ${master.returns}, next ${master.nextCost} LP. Open the Master tab`}
      onClick={onOpen}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.art} src={cardArtUrl(master.card.code, "small")} alt="" draggable={false} />
      <span className={styles.text}>
        <b>{master.card.name}</b>
        <small>Master · Returns {master.returns} · Next <em>{master.nextCost.toLocaleString("en-US")} LP</em></small>
      </span>
    </button>
  );
}
