"use client";

import { Icon } from "./icons";
import s from "./remote-ui.module.css";

/** One line above a seat's field: two public cards of one seat look like the same card. Merge fixes it in one click. */
export function DupBanner({ seat, name, count, more, busy, canAct, onMerge, onTwo }: {
  seat: number; name: string; count: number; more: number; busy: boolean;
  /** Only the owner of the field can merge. Others see the badge and the line, with no buttons. */
  canAct: boolean; onMerge: () => void; onTwo: () => void;
}) {
  return <div className={s.dupbar} role="group" aria-label={`${name} appears ${count === 2 ? "twice" : `${count} times`}`} data-testid={`dup-banner-${seat}`}>
    <Icon name="warn" />
    <span className={s.duptx}><b>{name}</b> appears {count === 2 ? "twice" : `${count} times`}{canAct ? " — Same card?" : ""}{more ? ` (+${more} more)` : ""}</span>
    {canAct ? <>
      <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={busy} onClick={onMerge} data-testid={`dup-merge-${seat}`}>Merge</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onTwo} data-testid={`dup-two-${seat}`}>Two copies</button>
    </> : null}
  </div>;
}
