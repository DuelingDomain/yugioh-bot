"use client";

/**
 * The small, always-on mark of an equip link on a board card: "Equipped" on the equip card and a
 * count ("1 equip") on the monster that carries it. The tooltip says what it is linked to
 * ("Equipped to Blue-Eyes White Dragon"). The line between the two cards is drawn by EquipFx on
 * hover or focus. The chip is decoration for the eye; the same sentence is in the zone's accessible
 * name (see equipSentence), so screen readers do not read it twice.
 */
import { createContext, useContext } from "react";
import {
  EMPTY_EQUIP_LINKS,
  equipSentence,
  roleOfCard,
  type EquipLinks,
  type EquipRole,
} from "./equip-links";
import styles from "./equip-chip.module.css";

/** The links of the board that is on screen. DuelField provides it; outside a field there are none. */
export const EquipLinksContext = createContext<EquipLinks>(EMPTY_EQUIP_LINKS);

/** Two links of a chain, joined. */
export function LinkGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g transform="rotate(-40 12 12)" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
        <rect x="1.5" y="8" width="12" height="8" rx="4" />
        <rect x="10.5" y="8" width="12" height="8" rx="4" />
      </g>
    </svg>
  );
}

export function EquipChip({ role, flip }: { role: EquipRole | null; flip?: boolean }) {
  if (!role) return null;
  const isEquip = role.role === "equip";
  return (
    <span
      className={styles.chip}
      data-equip-chip={role.role}
      data-side={flip ? "opp" : "you"}
      title={equipSentence(role) ?? undefined}
      aria-hidden="true"
    >
      <LinkGlyph className={styles.glyph} />
      {isEquip ? (
        <span className={styles.text}>Equipped</span>
      ) : (
        <>
          <b className={styles.count}>{role.links.length}</b>
          <span className={styles.text}>{role.links.length === 1 ? "equip" : "equips"}</span>
        </>
      )}
    </span>
  );
}

/** For a zone: the role of its card, from the board's links. */
export function useEquipRole(card: { controller: number; location: number; sequence: number } | null): EquipRole | null {
  const links = useContext(EquipLinksContext);
  return card ? roleOfCard(links, card) : null;
}
