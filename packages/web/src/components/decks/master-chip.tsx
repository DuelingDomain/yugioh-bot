import type { MouseEvent, PointerEvent } from "react";
import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./art-chip.module.css";

/**
 * "Set as Deck Master" on a deck tile: a crown that shows while the tile is hovered or focused.
 * It is a mouse target only (a button cannot sit inside the tile's button); the keyboard uses the M key on the tile.
 */
export function MasterChip({ name, onSet, genesys }: { name: string; onSet: () => void; genesys?: boolean }) {
  return (
    <span
      className={cn("num", styles.chip, styles.master)}
      data-action=""
      data-gx={genesys ? "" : undefined}
      title={`Set ${name} as Deck Master (M)`}
      aria-hidden="true"
      // Stops the press so it does not arm a removal on the tile.
      onPointerDown={(event: PointerEvent<HTMLElement>) => event.stopPropagation()}
      onClick={(event: MouseEvent<HTMLElement>) => { event.stopPropagation(); onSet(); }}
    >
      <Crown strokeWidth={2.4} />
    </span>
  );
}
