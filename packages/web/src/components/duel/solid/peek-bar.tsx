import type { InspectTarget } from "../inspector";
import panels from "./panels.module.css";
import { SvIcon } from "./icons";

/**
 * The mobile bar under the field: the card being inspected and two buttons that open the Card and Log sheets.
 * Stub from the foundation: the panels worker styles it and fills in the thumb and meta.
 */
export function PeekBar({ target, onCard, onLog }: { target: InspectTarget | null; onCard: () => void; onLog: () => void }) {
  const name = target?.type === "card" ? (target.card.name ?? "Card") : null;
  return (
    <div className={panels.peek} data-sv-peek="">
      <span className={panels.peekName}>{name ?? "Tap a card to read it"}</span>
      <button type="button" onClick={onCard}><SvIcon name="card" /> Card</button>
      <button type="button" onClick={onLog}><SvIcon name="log" /> Log</button>
    </div>
  );
}
