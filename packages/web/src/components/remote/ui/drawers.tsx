"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import type { LogKind } from "./describe";
import type { Health } from "./video-hub";
import s from "./remote-ui.module.css";

export type LogEntry = { id: string; time: string; kind: LogKind; text: string; fresh: boolean };
export type TableSeat = { seat: number; name: string; color: string; turn: boolean; lp: number; note: string };

const KIND_CLASS: Record<LogKind, string> = { LP: "kLp", PH: "kPh", CD: "kCd", AT: "kAt", VX: "kVx" };
const KINDS: { id: LogKind | "all"; label: string }[] = [
  { id: "all", label: "All" }, { id: "LP", label: "LP" }, { id: "PH", label: "Phases" }, { id: "CD", label: "Cards" }, { id: "AT", label: "Attacks" }, { id: "VX", label: "Voice" },
];

/** Right overlay drawer. Closed by default. It never reads out loud (aria-live off). */
export function LogDrawer({ voiceFilter = true, open, entries, seats, rules, onClose, extra, onConcede, declare }: { voiceFilter?: boolean; open: boolean; entries: LogEntry[]; seats: TableSeat[]; rules: string[]; onClose: () => void;
  /** Extra table settings (for example the training-set switch). */ extra?: ReactNode; onConcede?: () => void;
  /** "Declare result": the other players must agree. `choices` are the possible results; `waiting` is set while a result waits for them. */
  declare?: { choices: { seat: number | null; label: string }[]; waiting: string | null; onDeclare: (winnerSeat: number | null) => void } }) {
  const [confirm, setConfirm] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [tab, setTab] = useState<"log" | "table">("log");
  const [filter, setFilter] = useState<LogKind | "all">("all");
  const shown = entries.filter(entry => filter === "all" || entry.kind === filter);
  return <aside className={`${s.drawer} ${s.logd} ${open ? s.open : ""}`} data-layer="log" role="dialog" aria-label="Duel log" aria-modal="false" aria-hidden={!open} data-testid="log-drawer" inert={!open}>
    <div className={s.dh}><h2>Duel log</h2><span className={s.sp} /><button type="button" className={s.ibtn} aria-label="Close log" onClick={onClose}><Icon name="x" /></button></div>
    <div className={s.tabs} role="tablist">
      <button type="button" role="tab" aria-selected={tab === "log"} onClick={() => setTab("log")}>Log</button>
      <button type="button" role="tab" aria-selected={tab === "table"} onClick={() => setTab("table")}>Table</button>
    </div>
    {tab === "log" ? <div className={s.db} role="tabpanel" style={{ paddingTop: 0 }}>
      <div className={s.flt} role="group" aria-label="Filter log">
        {KINDS.filter(kind => voiceFilter || kind.id !== "VX").map(kind => <button type="button" key={kind.id} aria-pressed={filter === kind.id} onClick={() => setFilter(kind.id)}>{kind.label}</button>)}
      </div>
      <ol className={s.logl} aria-live="off" data-testid="log-list">
        {shown.length ? shown.map(entry => <li key={entry.id} className={entry.fresh ? s.new : ""}>
          <time>{entry.time}</time><span className={`${s.k} ${s[KIND_CLASS[entry.kind]] ?? ""}`}>{entry.kind}</span><span>{entry.text}</span>
        </li>) : <li><span /><span /><span>Nothing here yet.</span></li>}
      </ol>
    </div> : <div className={s.db} role="tabpanel">
      <p className={s.cap} style={{ marginBottom: 8 }}>Turn order</p>
      <div className={s.tabOrder}>
        {seats.map(seat => <div key={seat.seat} className={`${s.oseat} ${seat.turn ? s.on : ""}`} style={{ "--c": seat.color } as CSSProperties}>
          <span className={s.pip} /><b>{seat.name}</b><small>{seat.note}</small><span className={s.num}>{seat.lp}</span></div>)}
      </div>
      <p className={s.ordnote}>Pass turn moves the highlight to the next seat in this order. The log is quiet by default: it never reads out loud. A short peek shows the newest line when the phase changes.</p>
      <div className={s.rules}>{rules.map(rule => <div key={rule}><Icon name="check" />{rule}</div>)}</div>
      {extra}
      {onConcede || declare ? <div className={s.concede}>
        {confirm ? <>
          <p>{seats.length > 2 ? "Give up this game? You are out of it right away. The others play on." : "Give up this game? You lose it right away."}</p>
          <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} onClick={() => { setConfirm(false); onConcede?.(); }} data-testid="concede-yes">{seats.length > 2 ? "Yes, I am out" : "Yes, I lose"}</button>
          <button type="button" className={`${s.btn} ${s.sm}`} onClick={() => setConfirm(false)}>Keep playing</button>
        </> : choosing && declare ? <>
          <p>Who won? The other players must agree before the game ends.</p>
          {declare.choices.map(choice => <button key={String(choice.seat)} type="button" className={`${s.btn} ${s.sm}`} data-testid={`declare-${choice.seat === null ? "draw" : choice.seat}`}
            onClick={() => { setChoosing(false); declare.onDeclare(choice.seat); }}>{choice.label}</button>)}
          <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setChoosing(false)}>Cancel</button>
        </> : <>
          {onConcede ? <button type="button" className={`${s.btn} ${s.sm} ${s.danger}`} onClick={() => setConfirm(true)} data-testid="concede">I lose</button> : null}
          {declare ? <button type="button" className={`${s.btn} ${s.sm}`} disabled={declare.waiting !== null} onClick={() => setChoosing(true)} data-testid="declare-result">Declare result</button> : null}
          {declare?.waiting ? <p data-testid="declare-waiting">{declare.waiting}</p> : null}
        </>}
      </div> : null}
    </div>}
    <div className={s.dfoot}>Newest line at the top.</div>
  </aside>;
}

/** Left drawer with the big card view. Hover on a card shows it; a click pins it. */
export function InspectorDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return <aside className={`${s.drawer} ${s.insp} ${open ? s.open : ""}`} data-layer="insp" role="dialog" aria-label="Card inspector" aria-modal="false" aria-hidden={!open} data-testid="inspector" inert={!open}>
    <div className={s.dh}><h2>Card</h2><span className={s.sp} /><button type="button" className={s.ibtn} aria-label="Close card inspector" onClick={onClose}><Icon name="x" /></button></div>
    <div className={s.db}>{children}</div>
  </aside>;
}

export type HealthRow = { seat: number; name: string; color: string; health: Health };
/** A problem that is not one seat's feed: table video, the card watcher, the card reader. */
export type HealthExtra = { key: string; name: string; health: Health; /** Status word at the right; defaults to Failed or Weak. */ tag?: string };
export function HealthPopover({ open, rows, extras = [], onClose }: { open: boolean; rows: HealthRow[]; extras?: HealthExtra[]; onClose: () => void }) {
  return <div className={`${s.pop} ${s.hpop} ${open ? s.show : ""}`} data-layer="health" role="dialog" aria-label="Feed health" data-testid="health-popover" inert={!open}>
    <h2 className={s.cap} style={{ margin: "0 0 6px" }}>Feed health</h2>
    {rows.map(row => <div className={s.hrow} key={row.seat}>
      <span className={s.pip} style={{ "--c": row.color } as CSSProperties} />
      <span><b>{row.name}</b><br /><small>{row.health.label}{row.health.detail ? ` · ${row.health.detail}` : ""}</small></span>
      <span className={`${s.hl} ${s[row.health.q] ?? ""}`}><span className={s.sig}><i /><i /><i /><i /></span> {row.health.q === "good" ? "Good" : row.health.q === "off" ? "Off" : "Weak"}</span>
    </div>)}
    {extras.map(item => <div className={s.hrow} key={item.key} data-testid="health-extra">
      <span className={s.pip} style={{ "--c": "currentColor" } as CSSProperties} />
      <span><b>{item.name}</b><br /><small>{item.health.label}{item.health.detail ? ` · ${item.health.detail}` : ""}</small></span>
      <span className={`${s.hl} ${s[item.health.q] ?? ""}`}><span className={s.sig}><i /><i /><i /><i /></span> {item.tag ?? (item.health.q === "bad" ? "Failed" : "Weak")}</span>
    </div>)}
    <p>Weak feeds lower card-reading accuracy. Cards are read again when a feed recovers.</p>
    <div style={{ marginTop: 10 }}><button type="button" className={`${s.btn} ${s.sm}`} onClick={onClose}>Close</button></div>
  </div>;
}

export type HistoryItem = { id: string; label: string; reason?: string };
/** My last actions, newest first. Click any entry to undo it. An entry the server would refuse shows why. */
export function HistoryPopover({ open, items, style, onUndo }: { open: boolean; items: HistoryItem[]; style: CSSProperties; onUndo: (id: string) => void }) {
  return <div className={`${s.pop} ${s.hist} ${open ? s.show : ""}`} data-layer="hist" role="dialog" aria-label="Recent actions" style={style} data-testid="history-popover" inert={!open}>
    <h2 className={s.cap}>Your last {items.length} {items.length === 1 ? "action" : "actions"}</h2>
    {items.length ? <ol>{items.map((item, index) => <li key={item.id}>
      <button type="button" className={`${s.hrow} ${item.reason ? s.cblocked : ""}`} aria-disabled={!!item.reason} onClick={() => onUndo(item.id)} data-testid="history-entry">
        <span><b>{item.label}</b><small>{item.reason ?? (index === 0 ? "Newest. Same as the Undo button" : "Click to undo this one")}</small></span>
        <em>Undo</em>
      </button>
    </li>)}</ol> : <p className={s.empty}>Nothing to undo yet.</p>}
  </div>;
}

/** The table closes after 10 idle minutes. This shows from minute 8 with a live countdown. */
export function IdleBanner({ closesAt, now, onStay }: { closesAt: number | null; now: number; onStay: () => void }) {
  if (closesAt === null) return null;
  const left = Math.max(0, Math.ceil((closesAt - now) / 1000));
  return <div className={s.idle} role="alert" data-testid="idle-banner">
    <span>This table closes in <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b> because nobody has played.</span>
    <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} onClick={onStay} data-testid="idle-stay">Still playing</button>
  </div>;
}

export type PeekState = { id: number; kind: LogKind; text: ReactNode } | null;
export function Peek({ peek }: { peek: PeekState }) {
  return <div className={`${s.peek} ${peek ? s.show : ""}`} aria-hidden="true" data-testid="peek" key={peek?.id ?? 0}>
    {peek ? <><span className={s.k}>{peek.kind}</span><span className={s.pk}>{peek.text}</span><i className={s.tbar} /></> : null}
  </div>;
}

export type ToastItem = { id: number; text: ReactNode };
export function Toasts({ items, dock, top = false }: { items: ToastItem[]; dock?: HTMLElement | null; /** Over an open dialog: only the newest toast, on the dialog's hint row, clicks pass through. */ top?: boolean }) {
  const list = <div className={dock ? s.toastsDocked : top ? s.toastsTop : s.toasts} role="status" aria-live="polite" data-testid="toasts">{(top ? items.slice(-1) : items).map(item => <div key={item.id} className={s.toast}>{item.text}</div>)}</div>;
  return dock ? createPortal(list, dock) : list;
}

export function Banner({ banner }: { banner: { id: number; small: string; big: string } | null }) {
  return <div className={`${s.banner} ${banner ? s.go : ""}`} key={banner?.id ?? 0} aria-hidden="true" data-testid="banner">
    {banner ? <div className={s.bn}><small>{banner.small}</small><b>{banner.big}</b></div> : null}
  </div>;
}
