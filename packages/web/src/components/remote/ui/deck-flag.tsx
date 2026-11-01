"use client";

import { useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

type Flag = NonNullable<RemoteRoom["state"]["deckChecks"]>["flags"][number];
type Instance = NonNullable<RemoteRoom["state"]["deckChecks"]>["instances"][number];

const where = (instance: Instance) => `${instance.zone ?? "hand or deck"}${instance.slot ? ` ${instance.slot}` : ""}${instance.public ? "" : " (hidden)"}`;

/**
 * The deck warning is only advice. Any living player may dismiss it as wrong. The owner of the field may also say two
 * copies the system counted are one physical card (it tracks cards by place, so a card that moves can look like two).
 */
export function DeckFlagPopover({ open, flag, instances, canMerge, busy, onDismiss, onMerge, onClose }: {
  open: boolean; flag: Flag | undefined; instances: Instance[]; canMerge: boolean; busy: boolean;
  onDismiss: (flag: Flag) => void; onMerge: (flag: Flag, keep: string, remove: string) => void; onClose: () => void;
}) {
  const [keep, setKeep] = useState("");
  const pool = flag ? flag.instanceIds.map(id => instances.find(instance => instance.id === id)).filter((instance): instance is Instance => !!instance) : [];
  const kept = pool.find(instance => instance.id === keep) ?? pool[0];
  const others = pool.filter(instance => instance.id !== kept?.id && instance.copyKey === kept?.copyKey);
  return <div className={`${s.pop} ${s.hpop} ${s.fpop} ${open && flag ? s.show : ""}`} data-layer="flag" role="dialog" aria-label="Deck warning" data-testid="deck-flag" inert={!open}>
    {flag ? <>
      <h2 className={s.cap} style={{ margin: "0 0 6px" }}><Icon name="warn" /> Deck warning</h2>
      <p className={s.fmsg}>{flag.message}</p>
      {flag.proof.length ? <ul className={s.fproof}>{flag.proof.map((line, index) => <li key={index}>{line}</li>)}</ul> : null}
      <p className={s.fnote}>This is a check, not a ruling. The duel is not stopped.</p>
      <div className={s.fact}>
        <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy} onClick={() => onDismiss(flag)} data-testid="flag-dismiss">Dismiss as wrong</button>
        {canMerge && others.length ? <>
          <label>Keep <select value={kept?.id ?? ""} onChange={event => setKeep(event.target.value)} aria-label="Card to keep">
            {pool.map(instance => <option key={instance.id} value={instance.id}>{instance.name} · {where(instance)}</option>)}</select></label>
          <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={busy || !kept} onClick={() => kept && onMerge(flag, kept.id, others[0].id)} data-testid="flag-merge">Merge: same physical card</button>
        </> : null}
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onClose}>Close</button>
      </div>
    </> : null}
  </div>;
}
