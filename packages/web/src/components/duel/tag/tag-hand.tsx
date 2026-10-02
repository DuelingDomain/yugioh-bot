"use client";

import type { CSSProperties } from "react";
import type { DuelCard } from "@yugidraft/shared/duels";
import { LOCATION_HAND, zoneKey } from "../constants";
import { CardFace } from "../card-face";
import { UsableGlow } from "../usable-glow";
import type { DuelActivateHandler, DuelHoverHandler, InspectTarget } from "../table/types";
import styles from "./tag-stage.module.css";

/**
 * Hand strips of the Rooftop. SeatField draws no hand in tag (hand = "none"), so the viewer's own hand and the
 * partner's hand live here, in the HUD at the bottom edge. Cards keep the FX hooks of a field hand:
 * `data-zones="<seat>:2:<sequence>"`, `data-hand-seat`, and `data-card-art` from CardFace.
 */

export interface HandProps {
  seat: number;
  cards: readonly DuelCard[];
  legalKeys: ReadonlySet<string>;
  selectedKeys: ReadonlySet<string>;
  onActivate: DuelActivateHandler;
  onInspect: (target: InspectTarget) => void;
  onHoverCard?: DuelHoverHandler;
  reducedMotion: boolean;
  label: string;
}

function keyOf(seat: number, card: DuelCard, index: number): string {
  return zoneKey(seat, LOCATION_HAND, card.sequence ?? index);
}

/** The viewer's own hand: usable cards lift a little and carry the soft glow with the small Use chip. */
export function OwnHand({ seat, cards, legalKeys, selectedKeys, onActivate, onInspect, onHoverCard, reducedMotion, label }: HandProps) {
  return (
    <div className={`${styles.hud} ${styles.handDock}`} data-hand-dock role="group" aria-label={label}>
      <div className={styles.handRow} data-hand-seat={seat} data-side="you">
        {cards.map((card, index) => {
          const key = keyOf(seat, card, index);
          const usable = legalKeys.has(key);
          const selected = selectedKeys.has(key);
          const name = card.name ?? (card.code != null ? `Card ${card.code}` : `Card ${index + 1}`);
          return (
            <button
              key={`${seat}-h-${card.sequence ?? index}`}
              type="button"
              className={styles.hcard}
              data-zones={key}
              data-usable={usable ? "true" : "false"}
              data-sel={selected ? "true" : undefined}
              aria-label={usable ? `${name}, can be used` : name}
              style={{ ["--ug-r" as string]: "4px" } as CSSProperties}
              onClick={(event) => onActivate([key], card, event.currentTarget)}
              onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
              onMouseLeave={() => onHoverCard?.(null, null)}
              onFocus={(event) => onHoverCard?.(card, event.currentTarget)}
              onBlur={() => onHoverCard?.(null, null)}
              onContextMenu={(event) => {
                event.preventDefault();
                onInspect({ type: "card", card });
              }}
            >
              <CardFace card={card} location={LOCATION_HAND} />
              {usable ? <UsableGlow tone="extra" label="Use" still={reducedMotion} /> : null}
              {selected ? <span className={styles.ringSel} aria-hidden="true" /> : null}
            </button>
          );
        })}
        <div className={styles.handcount} aria-hidden="true">
          {cards.length}
          <small>hand</small>
        </div>
      </div>
    </div>
  );
}

/**
 * The partner's hand, face up, only for the viewer's team. Cards are never usable from here: the partner acts on their
 * own turn, so there is no glow, only the caption and the Ice accent.
 */
export function PartnerHand({ seat, cards, legalKeys, onInspect, onHoverCard, label, partnerName }: Omit<HandProps, "deckCount" | "selectedKeys" | "onActivate" | "reducedMotion"> & { partnerName: string }) {
  return (
    <div className={`${styles.hud} ${styles.phand}`} data-partner-hand data-hand-seat={seat} data-side="you" role="group" aria-label={label}>
      <div className={styles.pl}>
        <svg className={styles.ico} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span data-partner-caption>
          <b>{partnerName}</b>&rsquo;s hand &middot; only your team sees it
        </span>
      </div>
      <div className={styles.prow}>
        {cards.map((card, index) => {
          const key = keyOf(seat, card, index);
          const name = card.name ?? (card.code != null ? `Card ${card.code}` : `Card ${index + 1}`);
          return (
            <button
              key={`${seat}-p-${card.sequence ?? index}`}
              type="button"
              className={styles.pcd}
              data-zones={key}
              data-usable="false"
              data-legal={legalKeys.has(key) ? "true" : undefined}
              aria-label={name}
              onClick={() => onInspect({ type: "card", card })}
              onMouseEnter={(event) => onHoverCard?.(card, event.currentTarget)}
              onMouseLeave={() => onHoverCard?.(null, null)}
            >
              <CardFace card={card} location={LOCATION_HAND} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
