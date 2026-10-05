import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import type { DuelChainLink } from "@yugidraft/shared/duels";
import styles from "./priority-chips.module.css";

export type PrioritySlot = { seat: number; choosing: boolean };

type SeatLike = { seat: number; eliminated?: boolean; pendingElimination?: boolean };

/**
 * Who may answer the open chain, in order. With no chain link the turn player answers first and the others follow
 * clockwise. After a link, the first living seat after the seat that added the last link answers first, the others
 * follow clockwise, and that activator answers last. Seats that left the duel or are leaving are skipped.
 * `choosingSeat` is the seat with the open chain prompt, or null when nobody is being asked.
 */
export function priorityOrder(
  seats: readonly SeatLike[],
  turnSeat: number,
  chain: readonly Pick<DuelChainLink, "seat">[],
  choosingSeat: number | null,
): PrioritySlot[] {
  const alive = [...seats].filter((view) => view.eliminated !== true && view.pendingElimination !== true).map((view) => view.seat).sort((a, b) => a - b);
  if (alive.length === 0) return [];
  const last = chain[chain.length - 1];
  let start: number;
  if (last != null) {
    // The last activator may have left; the next living seat after theirs still opens, and they are left out.
    start = alive.findIndex((seat) => seat > last.seat);
  } else {
    // The turn player may have left; the next living seat after theirs then opens.
    const turnAt = alive.indexOf(turnSeat);
    start = turnAt >= 0 ? turnAt : alive.findIndex((seat) => seat > turnSeat);
  }
  if (start < 0) start = 0;
  return alive.map((_, k) => alive[(start + k) % alive.length]).map((seat) => ({ seat, choosing: seat === choosingSeat }));
}

/**
 * "Priority: Ren > Mika > Ryo" with the seat that is choosing lit. Each chip wears its seat's tone. The panel that
 * shows it is a table of 3 or 4 seats only, so the order always reads by name.
 */
export function PriorityChips({
  order,
  mySeat,
  nameOf,
  seatTones,
  compact = false,
}: {
  order: readonly PrioritySlot[];
  mySeat: number | null;
  nameOf: (seat: number) => string;
  seatTones?: ReadonlyMap<number, { main: string; ink: string }>;
  compact?: boolean;
}) {
  if (order.length === 0) return null;
  return (
    <div className={styles.prio} data-testid="priority-chips" data-compact={compact ? "true" : undefined} aria-label="Who may respond, in order">
      {compact ? null : <span className={styles.cap}>Priority</span>}
      {order.map((slot, at) => {
        const tone = seatTones?.get(slot.seat);
        const style = tone ? ({ "--seat-main": tone.main, "--seat-ink": tone.ink } as CSSProperties) : undefined;
        return (
          <span key={slot.seat} className={styles.slot}>
            {at > 0 ? <ArrowRight size={11} strokeWidth={1.75} aria-hidden /> : null}
            <span className={styles.chip} data-now={slot.choosing ? "true" : undefined} data-seat={slot.seat} style={style} title={slot.choosing ? `${nameOf(slot.seat)} is choosing` : undefined}>
              <i aria-hidden="true" />
              {slot.seat === mySeat ? "You" : nameOf(slot.seat)}
              {slot.choosing && !compact ? <em> · choosing</em> : null}
            </span>
          </span>
        );
      })}
    </div>
  );
}
