"use client";

import type { DuelSeatView } from "@yugidraft/shared/duels";
import { cardArtUrl } from "../constants";
import { masterInUse, masterNextCost, useMasterSeats } from "../master-place";
import styles from "./master-chip.module.css";

/**
 * Your Deck Master, as a chip under your LP plate on the wide table: small art, the name, how often it has returned and
 * what the next return costs. It replaces the Deck Master column; a click opens the Master tab of the drawer.
 */
export function MasterChip({ view, label, onOpen }: { view: DuelSeatView; label: string; onOpen: () => void }) {
  const master = view.deckMaster;
  const seats = useMasterSeats();
  if (!master) return null;
  // Out of its zone the master is "in use": the chip keeps its place and shows an empty slot instead of the art.
  const inUse = masterInUse(view, seats);
  return (
    <button
      type="button"
      className={styles.chip}
      data-testid="master-chip"
      data-in-use={inUse ? "true" : undefined}
      aria-label={`${label}: ${master.card.name}${inUse ? " (in use)" : ""}. Returns ${master.returns}, next ${masterNextCost(master)} LP. Open the Master tab`}
      onClick={onOpen}
    >
      {inUse ? (
        <span className={styles.art} data-in-use="true" aria-hidden="true" />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={styles.art} src={cardArtUrl(master.card.code, "small")} alt="" draggable={false} />
      )}
      <span className={styles.text}>
        <b>{master.card.name}</b>
        <small>{inUse ? "In use · " : ""}Master · Returns {master.returns} · Next <em>{masterNextCost(master).toLocaleString("en-US")} LP</em></small>
      </span>
    </button>
  );
}
