"use client";

import type { DuelEngineView } from "@yugidraft/shared/duels";
import { engineFormat, isEliminated, nextSeatAfter, opponentPickLabel, seatRelation, seatTeam, type SeatPick } from "./multi-seat";
import styles from "./seat-strip.module.css";

/**
 * Turn order for 3 and 4 seat tables: who plays now, who plays next, who answers the open prompt,
 * and which seats are out. State is always words as well as colour.
 */
export function SeatStrip({
  engine,
  mySeat,
  nameOf,
  promptSeat,
  focusSeat,
  onFocusSeat,
  pick,
}: {
  engine: Pick<DuelEngineView, "format" | "seats" | "turnSeat">;
  mySeat: number | null;
  nameOf: (seat: number) => string;
  promptSeat: number | null;
  focusSeat?: number | null;
  onFocusSeat?: (seat: number) => void;
  /** An opponent pick is open: the seats it offers answer it when tapped. */
  pick?: SeatPick | null;
}) {
  const format = engineFormat(engine);
  const ordered = [...engine.seats].sort((a, b) => a.seat - b.seat);
  const next = nextSeatAfter(engine.seats, engine.turnSeat);
  return (
    <ol className={styles.strip} aria-label="Turn order" data-format={format} data-testid="seat-strip">
      {ordered.map((view) => {
        const out = isEliminated(view);
        const relation = seatRelation(format, mySeat, view.seat);
        const leaving = !out && view.pendingElimination === true;
        const turn = view.seat === engine.turnSeat && !out;
        const isNext = view.seat === next && view.seat !== engine.turnSeat;
        const answering = view.seat === promptSeat && !out;
        const pickable = pick?.options.has(view.seat) === true && !out;
        const focusable = !pickable && onFocusSeat != null && relation === "opponent" && !out;
        const status = out ? "Eliminated" : turn ? "To play" : isNext ? "Next" : null;
        const content = (
          <>
            <span className={styles.order} aria-hidden="true">{view.seat + 1}</span>
            <span className={styles.name}>{nameOf(view.seat)}</span>
            {relation === "self" ? <span className={styles.rel}>You</span> : relation === "partner" ? <span className={styles.rel}>Partner</span> : null}
            {status ? <span className={styles.status} data-kind={out ? "out" : turn ? "turn" : "next"}>{status}</span> : null}
            {answering ? <span className={styles.status} data-kind="answer">Choosing</span> : null}
            {leaving ? <span className={styles.status} data-kind="leaving" data-testid={`seat-strip-leaving-${view.seat}`}>Leaving</span> : null}
          </>
        );
        return (
          <li key={view.seat} className={styles.item} data-seat={view.seat} data-testid={`seat-strip-${view.seat}`} data-team={format === "tag" ? seatTeam(format, view) : undefined}
            data-relation={relation} data-turn={turn ? "true" : "false"} data-next={isNext ? "true" : "false"}
            data-answering={answering ? "true" : "false"} data-eliminated={out ? "true" : "false"} data-leaving={leaving ? "true" : "false"}
            data-focus={focusSeat === view.seat ? "true" : "false"} data-pickable={pickable ? "true" : undefined}
            aria-current={turn ? "step" : undefined}>
            {pickable ? (
              <button type="button" className={styles.hit} data-testid={`seat-strip-pick-${view.seat}`}
                onClick={() => pick?.onPick(view.seat)} aria-label={opponentPickLabel(nameOf(view.seat))}>{content}</button>
            ) : focusable ? (
              <button type="button" className={styles.hit} onClick={() => onFocusSeat?.(view.seat)}
                aria-label={`Show ${nameOf(view.seat)} on the main field`}>{content}</button>
            ) : <div className={styles.hit}>{content}</div>}
          </li>
        );
      })}
    </ol>
  );
}
