"use client";

import type { ReactNode } from "react";
import { Eraser, Plus } from "lucide-react";
import type { SandboxCardEntry, SandboxDuelistId } from "@yugidraft/shared/duels";
import { cn } from "@/lib/utils";
import { cardOf, pileCapacity, type CardLoc, type PileZone } from "./board-model";
import { zoneName } from "./placement";
import { CardThumb, useDropTarget, writeLocDrag, type CardInfoMap, type SandboxDrag } from "./zone-slot";
import styles from "./builder.module.css";

/**
 * One pile of a seat: Hand, Deck top, Extra Deck, Graveyard or Banished. The header picks the pile as the
 * quick add target. A card thumb opens the popover of that card.
 */
export function PileRow({
  seat,
  zone,
  cards,
  infos,
  isTarget,
  armedCode,
  note,
  openIndex,
  renderPopover,
  onSelectTarget,
  onToggleCard,
  onAddArmed,
  onClear,
  onDropDrag,
}: {
  seat: SandboxDuelistId;
  zone: PileZone;
  cards: readonly SandboxCardEntry[];
  infos: CardInfoMap;
  isTarget: boolean;
  armedCode: number | null;
  /** Extra text in the header, e.g. the Deck size. */
  note?: ReactNode;
  openIndex: number | null;
  renderPopover: (index: number) => ReactNode;
  onSelectTarget: () => void;
  onToggleCard: (index: number) => void;
  onAddArmed: () => void;
  onClear: () => void;
  /** Drop on the pile (index = end) or on one card (index = that card). */
  onDropDrag: (drag: SandboxDrag, index: number) => void;
}) {
  const capacity = pileCapacity(zone);
  const drop = useDropTarget((drag) => onDropDrag(drag, cards.length));
  const title = zoneName(zone);
  return (
    <section className={styles.pile} data-target={isTarget ? "true" : undefined} data-over={drop.over ? "true" : undefined} aria-label={`${title} of ${seat.toUpperCase()}`} {...drop.props}>
      <header className={styles.pileHead}>
        <button
          type="button"
          className={styles.pileName}
          aria-pressed={isTarget}
          title={isTarget ? `Quick add goes to ${title}` : `Send quick add to ${title}`}
          onClick={onSelectTarget}
        >
          {title}
          <span className={cn("num", styles.pileCount)}>{cards.length}<span>/{capacity}</span></span>
        </button>
        {note ? <span className={styles.pileNote}>{note}</span> : null}
        <span className={styles.pileTools}>
          {armedCode !== null ? (
            <button type="button" className={styles.pileAdd} onClick={onAddArmed} aria-label={`Add the selected card to ${title}`} disabled={cards.length >= capacity}>
              <Plus size={13} aria-hidden /> Selected
            </button>
          ) : null}
          {cards.length > 0 ? (
            <button type="button" className={styles.iconBtn} aria-label={`Clear ${title}`} title={`Clear ${title}`} onClick={onClear}>
              <Eraser size={14} aria-hidden />
            </button>
          ) : null}
        </span>
      </header>
      {cards.length === 0 ? (
        <p className={styles.pileEmpty}>{isTarget ? "Type a card name and press Enter." : "Empty"}</p>
      ) : (
        <ul className={styles.pileCards}>
          {cards.map((entry, index) => {
            const code = cardOf(entry);
            const name = infos.get(code)?.name ?? `Card ${code}`;
            return (
              <li key={`${index}-${code}`} className={styles.pileCard} data-sbx-slot>
                <PileCard
                  code={code}
                  name={name}
                  active={openIndex === index}
                  onClick={() => onToggleCard(index)}
                  onDropDrag={(drag) => onDropDrag(drag, index)}
                  dragLoc={{ seat, zone, index }}
                />
                {openIndex === index ? renderPopover(index) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function PileCard({ code, name, active, onClick, onDropDrag, dragLoc }: {
  code: number;
  name: string;
  active: boolean;
  onClick: () => void;
  onDropDrag: (drag: SandboxDrag) => void;
  dragLoc: CardLoc;
}) {
  const drop = useDropTarget(onDropDrag);
  return (
    <button
      type="button"
      className={styles.pileThumb}
      data-active={active ? "true" : undefined}
      data-over={drop.over ? "true" : undefined}
      aria-expanded={active}
      aria-haspopup="dialog"
      aria-label={`${name}. Open card options`}
      title={name}
      draggable
      onClick={onClick}
      onDragStart={(event) => writeLocDrag(event, dragLoc)}
      {...drop.props}
    >
      <CardThumb code={code} name={name} />
    </button>
  );
}
