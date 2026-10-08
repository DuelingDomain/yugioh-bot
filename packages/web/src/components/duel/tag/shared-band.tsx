import type { CSSProperties } from "react";
import type { DuelSeatView } from "@yugidraft/shared/duels";
import { duelFontClasses } from "../fonts";
import { emzZoneProps, ZoneSlot, type DuelActivateHandler, type DuelHoverHandler } from "../field";
import { extraMonster, extraMonsterKeys, withExact } from "../field-keys";
import { disabledZones } from "../multi-seat";
import fieldStyles from "../field.module.css";
import { ROOF_FIELD, ROOF_FIELD_Z } from "./roof-camera";
import styles from "./tag-stage.module.css";

/** Height of the band box in world units: one zone row (112 at the default zone size) with the field pad above and below. */
export const BAND_HEIGHT = 140;

export interface SharedBandProps {
  /** The facing pair: `near` stands on the viewer's strip, `far` across from it. */
  near: DuelSeatView;
  far: DuelSeatView;
  /** World x of the pair (both fields of a pair share a column). */
  x: number;
  /** The camera turns far cards upright (they read straight instead of facing the far side). */
  upright: boolean;
  nameOf: (seat: number) => string;
  /** How a seat relates to the viewer: "self", "partner", "opponent" or "other" (a spectator). */
  relationOf: (seat: number) => string;
  /** The seat's team is out of the duel: its cell greys out like its field. */
  outOf: (seat: number) => boolean;
  legalKeys: Set<string>;
  selectedKeys: Set<string>;
  onActivate: DuelActivateHandler;
  onHoverCard?: DuelHoverHandler;
}

/**
 * The two Extra Monster Zones one facing pair shares (1A and 2A, 1B and 2B). They are drawn once, between the two fields, in
 * the columns of each field's own Extra Monster Zones. The band is laid out for the near seat, like the 1v1 board: its left
 * cell is the near seat's zone 5 and the far seat's zone 6, its right cell the near seat's zone 6 and the far seat's zone 5.
 * A cell shows the card of whoever controls it; its zone keys name both seats, the exact key of the card first.
 */
export function SharedExtraBand({ near, far, x, upright, nameOf, relationOf, outOf, legalKeys, selectedKeys, onActivate, onHoverCard }: SharedBandProps) {
  const nearOff = disabledZones(near);
  const farOff = disabledZones(far);
  const nearName = nameOf(near.seat);
  const farName = nameOf(far.seat);
  const cell = (column: "left" | "right") => {
    const nearSeq = column === "left" ? 5 : 6;
    const farSeq = 11 - nearSeq;
    const card = extraMonster(near, far, column);
    const offId = nearOff.monsters[nearSeq] ? `${near.seat}-m-${nearSeq}` : farOff.monsters[farSeq] ? `${far.seat}-m-${farSeq}` : undefined;
    const holder = card ? (card.controller === far.seat ? farName : nearName) : null;
    const props = emzZoneProps(column, {
      card,
      keys: withExact(card, extraMonsterKeys(near.seat, far.seat, column)),
      offId,
      // A far card faces the far side, as it does on its own field; `upright` turns it to read straight.
      flip: card != null && card.controller === far.seat && !upright,
      callbacks: { legalKeys, selectedKeys, onActivate, onHoverCard },
    });
    // The cell looks like the field of whoever it belongs to: the controller of its card, or for an empty cell the seat of
    // the legal address that picks it. `display: contents` keeps it a grid cell of the band while it carries the field's
    // data-usable / data-relation / data-out, which the field and stage styles key on.
    const owner = card ? card.controller : props.keys.find((key) => legalKeys.has(key))?.split(":")[0];
    const ownerSeat = owner == null ? null : Number(owner);
    const relation = ownerSeat == null ? "other" : relationOf(ownerSeat);
    return (
      <div
        key={column}
        style={{ display: "contents" }}
        data-band-cell={column}
        data-usable={relation === "self" ? "true" : "false"}
        data-relation={relation}
        data-out={ownerSeat != null && outOf(ownerSeat) ? "true" : undefined}
      >
        <ZoneSlot
          {...props}
          label={`${nearName} / ${farName} shared extra monster zone, column ${column === "left" ? 2 : 4}${holder ? `, controlled by ${holder}` : ""}`}
        />
      </div>
    );
  };
  return (
    <div
      className={styles.fieldHold}
      data-shared-band={`${near.seat}-${far.seat}`}
      style={{ width: ROOF_FIELD.width, height: BAND_HEIGHT, transform: `translate3d(${x - ROOF_FIELD.width / 2}px, ${-BAND_HEIGHT / 2}px, ${ROOF_FIELD_Z}px)` }}
    >
      <div
        className={`${duelFontClasses} ${fieldStyles.seatField} ${styles.band}`}
        data-testid={`shared-emz-pair-${Math.min(near.seat, far.seat)}-${Math.max(near.seat, far.seat)}`}
        data-seats={`${near.seat} ${far.seat}`}
        role="group"
        aria-label={`${nearName} / ${farName} shared extra monster zones`}
        style={{ height: BAND_HEIGHT } as CSSProperties}
      >
        <div className={`${fieldStyles.sfGrid} ${styles.bandGrid}`}>
          <div className={fieldStyles.sfEmz}>
            <div className={fieldStyles.emzRow}>
              <div />
              {cell("left")}
              <div />
              {cell("right")}
              <div />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
