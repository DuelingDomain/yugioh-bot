import type { MouseEvent, PointerEvent } from "react";
import { Layers } from "lucide-react";
import { artCountLabel } from "@/components/artwork/artwork-picker";
import { cn } from "@/lib/utils";
import styles from "./art-chip.module.css";

/**
 * The mark for a card with other arts: a layers icon and how many arts the card has. The same chip sits on
 * the tiles of the card list and the deck. With `onOpen` it is a hit target that opens the art menu;
 * without, it only shows its title and clicks go to the tile.
 */
export function ArtChip({ otherArts, corner = false, open = false, onOpen }: {
  /** Other arts the card has besides its own (the `altArtCount` of the card data). */
  otherArts: number;
  corner?: boolean;
  open?: boolean;
  onOpen?: (anchor: HTMLElement) => void;
}) {
  if (otherArts <= 0) return null;
  const label = artCountLabel(otherArts);
  return (
    <span
      className={cn("num", styles.chip, corner && styles.corner)}
      data-open={open ? "true" : undefined}
      data-action={onOpen ? "" : undefined}
      title={onOpen ? `${label}. Click or right-click to change the art.` : `${label}. Select the card to choose one.`}
      aria-hidden="true"
      onPointerDown={onOpen ? (event: PointerEvent<HTMLElement>) => event.stopPropagation() : undefined}
      onClick={onOpen ? (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        const anchor = event.currentTarget.closest("button");
        if (anchor) onOpen(anchor);
      } : undefined}
    >
      <Layers strokeWidth={2.4} />{otherArts + 1}
    </span>
  );
}
