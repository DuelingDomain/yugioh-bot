"use client";

import { useState, type DragEvent, type ReactNode } from "react";
import { Plus } from "lucide-react";
import type { DeckCardInfo, SandboxCardEntry, SandboxStance } from "@yugidraft/shared/duels";
import { cardArtUrl } from "@/components/duel/constants";
import { hasCardDrag, readCardDrag, writeCardDrag } from "@/components/decks/drag";
import { cn } from "@/lib/utils";
import { cardOf, defaultPos, type CardLoc, type SlotZone } from "./board-model";
import styles from "./builder.module.css";

export type CardInfoMap = ReadonlyMap<number, DeckCardInfo>;

// ---------------------------------------------------------------------------------------------
// Drag and drop. A card on the board carries its place. A card from a list carries its passcode.

const LOC_DRAG = "application/x-sandbox-loc";

export type SandboxDrag = { kind: "loc"; loc: CardLoc } | { kind: "card"; code: number };

export function writeLocDrag(event: DragEvent, loc: CardLoc): void {
  event.dataTransfer.setData(LOC_DRAG, JSON.stringify(loc));
  event.dataTransfer.effectAllowed = "move";
}

export function writeListDrag(event: DragEvent, code: number): void {
  writeCardDrag(event, { code, from: "list" });
}

export function hasSandboxDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(LOC_DRAG) || hasCardDrag(event);
}

export function readSandboxDrag(event: DragEvent): SandboxDrag | null {
  try {
    const raw = event.dataTransfer.getData(LOC_DRAG);
    if (raw) {
      const loc = JSON.parse(raw) as CardLoc;
      if (loc && typeof loc.seat === "string" && typeof loc.zone === "string" && Number.isInteger(loc.index)) return { kind: "loc", loc };
    }
  } catch {
    // fall through to a card drag
  }
  const card = readCardDrag(event);
  return card ? { kind: "card", code: card.code } : null;
}

/** Drop target props shared by slots and piles. */
export function useDropTarget(onDrop: (drag: SandboxDrag) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!hasSandboxDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        setOver(false);
        // A card inside a slot or pile handles its own drop first.
        if (event.defaultPrevented) return;
        const drag = readSandboxDrag(event);
        if (!drag) return;
        event.preventDefault();
        onDrop(drag);
      },
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Card art

/** Small card art. A card without an image shows its name. */
export function CardThumb({ code, name, className }: { code: number; name?: string; className?: string }) {
  const [failed, setFailed] = useState<number | null>(null);
  if (failed === code) return <span className={cn(styles.thumbFallback, className)}>{name ?? code}</span>;
  return <img className={className} src={cardArtUrl(code, "small")} alt="" loading="lazy" draggable={false} onError={() => setFailed(code)} />;
}

export function specOf(entry: SandboxCardEntry) {
  return typeof entry === "number" ? { card: entry } : entry;
}

const STANCE_LABEL: Record<SandboxStance, string> = { atk: "ATK", def: "DEF", set: "Set", up: "Face-up" };
export function stanceLabel(pos: SandboxStance): string {
  return STANCE_LABEL[pos];
}

// ---------------------------------------------------------------------------------------------
// Slot

export function ZoneSlot({
  label,
  zone,
  entry,
  info,
  armed,
  active,
  onActivate,
  onDropDrag,
  loc,
  popover,
  disabled,
}: {
  /** Short name for the empty slot, e.g. "Monster 2". */
  label: string;
  zone: SlotZone;
  entry: SandboxCardEntry | null;
  info: DeckCardInfo | undefined;
  /** A card is selected: an empty slot shows that a click places it. */
  armed: boolean;
  /** The popover of this slot is open. */
  active: boolean;
  onActivate: () => void;
  onDropDrag: (drag: SandboxDrag) => void;
  loc: CardLoc;
  popover?: ReactNode;
  disabled?: boolean;
}) {
  const drop = useDropTarget(onDropDrag);
  const spec = entry === null ? null : specOf(entry);
  const pos = spec ? (spec.pos ?? defaultPos(zone)) : undefined;
  const code = entry === null ? 0 : cardOf(entry);
  const name = info?.name ?? (code ? `Card ${code}` : "");
  const materials = spec?.materials?.length ?? 0;
  const turned = zone === "monster" && (pos === "def" || pos === "set");
  const faceDown = pos === "set";

  return (
    <div className={styles.slotWrap} data-sbx-slot>
      {entry === null ? (
        <button
          type="button"
          className={styles.slot}
          data-empty="true"
          data-armed={armed ? "true" : undefined}
          data-over={drop.over ? "true" : undefined}
          disabled={disabled}
          aria-label={`${label}, empty${armed ? ". Place the selected card here" : ""}`}
          onClick={onActivate}
          {...drop.props}
        >
          <span className={styles.slotLabel}>{label}</span>
          <Plus className={styles.slotPlus} size={16} strokeWidth={1.6} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          className={styles.slot}
          data-filled="true"
          data-active={active ? "true" : undefined}
          data-over={drop.over ? "true" : undefined}
          aria-expanded={active}
          aria-haspopup="dialog"
          aria-label={`${label}, ${name}${pos ? `, ${stanceLabel(pos)}` : ""}${materials ? `, ${materials} materials` : ""}. Open card options`}
          title={name}
          draggable
          onClick={onActivate}
          onDragStart={(event) => writeLocDrag(event, loc)}
          {...drop.props}
        >
          <span className={styles.slotArt} data-turned={turned ? "true" : undefined} data-facedown={faceDown ? "true" : undefined}>
            <CardThumb code={code} name={name} />
          </span>
          {pos && pos !== "atk" && pos !== "up" ? <span className={styles.stanceChip}>{stanceLabel(pos)}</span> : null}
          {materials > 0 ? <span className={cn("num", styles.matChip)} title="Xyz materials">{materials} mat</span> : null}
          {spec?.summoned === false ? <span className={styles.stanceChip} data-low>Not summoned</span> : null}
        </button>
      )}
      {popover}
    </div>
  );
}
