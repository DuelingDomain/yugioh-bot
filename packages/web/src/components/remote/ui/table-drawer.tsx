"use client";

import { Fragment, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { cardArt } from "./catalog";
import { Icon } from "./icons";
import type { LogCat, LogFilter, LogRow, LogTurn } from "./log-model";
import type { Health } from "./video-hub";
import s from "./remote-ui.module.css";
import d from "./table-drawer.module.css";

export type DrawerTab = "log" | "settings" | "info" | "admin";
const TABS: { id: DrawerTab; label: string }[] = [{ id: "log", label: "Log" }, { id: "settings", label: "Settings" }, { id: "info", label: "Info" }];

const FILTERS: { id: LogFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "chain", label: "Chains" }, { id: "move", label: "Moves" }, { id: "lp", label: "LP" }, { id: "phase", label: "Phases" }, { id: "voice", label: "Voice" },
];
const keeps = (filter: LogFilter, cat: LogCat) => filter === "all" || filter === cat;

export type DrawerFeed = { seat: number; name: string; color: string; health: Health };
export type DrawerExtra = { key: string; name: string; health: Health; tag?: string };

export type TableDrawerProps = {
  open: boolean; tab: DrawerTab; onTab: (tab: DrawerTab) => void; onClose: () => void;
  /** Show the Admin tab. */ admin: boolean;
  log: {
    turns: LogTurn[]; voiceFilter: boolean; color: (seat: number) => string;
    /** Open the card inspector on a card (hover shows it, a click pins it). */
    onCard: (row: LogRow, mode: "hover" | "pin" | "leave") => void;
    onAddToDeck: (seat: number, cardId: number) => void; adding: boolean;
    undo: { label: string; enabled: boolean; reason?: string; onUndo: () => void };
  };
  info: {
    format: string; game: string; time: ReactNode; startingLp: number; feeds: DrawerFeed[]; extras: DrawerExtra[];
    onSurrender?: (el: HTMLElement) => void; onQuit?: (el: HTMLElement) => void;
    declare?: { choices: { seat: number | null; label: string }[]; waiting: string | null; onDeclare: (winnerSeat: number | null) => void };
    /** The feedback prompt that asks players once about the training set. */ extra?: ReactNode;
  };
  settings: ReactNode; adminPanel: ReactNode;
};

/** A picture of the card, or a short label in the same box for a phase or an LP change. */
function Thumb({ row, onCard }: { row: LogRow; onCard: TableDrawerProps["log"]["onCard"] }) {
  const [broken, setBroken] = useState(false);
  if (row.cardId && !broken) return <button type="button" className={`${d.th} ${d.thBtn}`} aria-label={`Show ${row.cardName ?? "card"}`} data-testid="log-card"
    onMouseEnter={() => onCard(row, "hover")} onMouseLeave={() => onCard(row, "leave")} onFocus={() => onCard(row, "hover")} onBlur={() => onCard(row, "leave")} onClick={() => onCard(row, "pin")}>
    <img src={cardArt(row.cardId, "small")} alt="" loading="lazy" onError={() => setBroken(true)} /></button>;
  return <span className={`${d.th} ${d.thLabel}`} aria-hidden="true">{row.badge ?? "·"}</span>;
}

/** The action text with the card name in bold. */
function Text({ row }: { row: LogRow }) {
  if (row.lp) return <>LP <span className={`${d.num} ${row.lp.to > row.lp.from ? d.up : ""}`}>{row.lp.from} → {row.lp.to}</span></>;
  const at = row.cardName ? row.rest.indexOf(row.cardName) : -1;
  if (at < 0 || !row.cardName) return <>{row.rest}</>;
  return <>{row.rest.slice(0, at)}<b>{row.cardName}</b>{row.rest.slice(at + row.cardName.length)}</>;
}

function Entry({ row, p }: { row: LogRow; p: TableDrawerProps["log"] }) {
  const warn = !!row.notInDeck;
  const cls = [d.ev, row.cat === "lp" ? d.lp : "", row.cat === "phase" ? d.ph : "", warn ? d.warn : "", row.fresh ? d.fresh : ""].join(" ");
  return <li className={cls} data-testid="log-entry" data-kind={row.kind}>
    <time>{row.time}</time>
    <Thumb row={row} onCard={p.onCard} />
    <p>
      {row.actor && row.actorSeat !== null ? <><span className={d.who} style={{ "--c": p.color(row.actorSeat) } as CSSProperties}>{row.actor}</span>{" "}</> : null}
      {warn ? <>· Not in decklist: <b>{row.cardName ?? `Card ${row.notInDeck!.cardId}`}</b></> : <Text row={row} />}
      {row.chain ? <span className={d.chain} data-testid="log-chain">Chain {row.chain}</span> : null}
      {warn ? <button type="button" className={`${s.btn} ${s.sm} ${d.add}`} disabled={p.adding} data-testid="log-add-deck" onClick={() => p.onAddToDeck(row.notInDeck!.seat, row.notInDeck!.cardId)}>Add to decklist</button> : null}
    </p>
  </li>;
}

function LogTab({ p }: { p: TableDrawerProps["log"] }) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const [shut, setShut] = useState<Record<string, boolean>>({});
  // Without voice the Voice pill goes, and a stale choice falls back to All.
  const active = filter === "voice" && !p.voiceFilter ? "all" : filter;
  const turns = p.turns.map(turn => ({ ...turn, shown: turn.rows.filter(row => keeps(active, row.cat)) })).filter(turn => active === "all" || turn.shown.length);
  const first = p.turns[0]?.key;
  return <>
    <div className={s.flt} role="group" aria-label="Filter the log">
      {FILTERS.filter(item => p.voiceFilter || item.id !== "voice").map(item => <button type="button" key={item.id} aria-pressed={active === item.id} onClick={() => setFilter(item.id)}>{item.label}</button>)}
    </div>
    <div data-testid="log-list" aria-live="off">
      {turns.length ? turns.map(turn => {
        const closed = shut[turn.key] ?? turn.key !== first;
        return <details key={turn.key} className={d.turn} open={!closed} data-testid="log-turn" onToggle={event => { const open = (event.currentTarget as HTMLDetailsElement).open; setShut(old => old[turn.key] === !open ? old : { ...old, [turn.key]: !open }); }}>
          <summary><Icon name="chev" />Turn {turn.turn}{turn.seat !== null && turn.rows.length ? <> · <span className={d.who} style={{ "--c": p.color(turn.seat) } as CSSProperties}>{turn.rows.find(row => row.actorSeat === turn.seat)?.actor ?? ""}</span></> : null}<em>{turn.shown.length} {turn.shown.length === 1 ? "event" : "events"}</em></summary>
          {turn.shown.length ? <ul className={d.evs}>{turn.shown.map(row => <Entry key={row.id} row={row} p={p} />)}</ul> : null}
        </details>;
      }) : <p className={d.empty}>Nothing here yet.</p>}
    </div>
  </>;
}

function InfoTab({ p }: { p: TableDrawerProps["info"] }) {
  const [choosing, setChoosing] = useState(false);
  const worse = (q: Health["q"]) => q === "bad" ? s.bad : q === "warn" ? s.warn : "";
  return <>
    <div className={d.sec}><h3>Table</h3>
      <div className={d.kv}><span>Format</span><b>{p.format}</b></div>
      <div className={d.kv}><span>Game</span><b>{p.game}</b></div>
      <div className={d.kv}><span>Time</span><b className={d.num}>{p.time}</b></div>
      <div className={d.kv}><span>Starting LP</span><b className={d.num}>{p.startingLp}</b></div>
    </div>
    <div className={d.sec} data-testid="health-popover"><h3>Players</h3>
      {p.feeds.map(feed => <div className={d.pl} key={feed.seat}>
        <span className={s.pip} style={{ "--c": feed.color } as CSSProperties} /><b>{feed.name}</b>
        <small>{feed.health.label}{feed.health.detail ? ` · ${feed.health.detail}` : ""}</small>
        {feed.health.q === "off" ? null : <span className={`${s.hdot} ${worse(feed.health.q)}`} />}
      </div>)}
      {p.extras.map(item => <div className={d.pl} key={item.key} data-testid="health-extra">
        <span className={s.pip} style={{ "--c": "currentColor" } as CSSProperties} /><b>{item.name}</b>
        <small>{item.health.label}{item.health.detail ? ` · ${item.health.detail}` : ""}</small>
        <span className={`${s.hdot} ${worse(item.health.q)}`} title={item.tag ?? (item.health.q === "bad" ? "Failed" : "Weak")} />
      </div>)}
    </div>
    {p.extra}
    {p.declare ? <div className={d.sec}><h3>Result</h3>
      {choosing ? <>
        <p className={d.hint}>Who won? The other players must agree before the game ends.</p>
        <div className={d.btns}>
          {p.declare.choices.map(choice => <button key={String(choice.seat)} type="button" className={`${s.btn} ${s.sm}`} data-testid={`declare-${choice.seat === null ? "draw" : choice.seat}`}
            onClick={() => { setChoosing(false); p.declare?.onDeclare(choice.seat); }}>{choice.label}</button>)}
          <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={() => setChoosing(false)}>Cancel</button>
        </div></> : <div className={d.btns}>
        <button type="button" className={`${s.btn} ${s.sm}`} disabled={p.declare.waiting !== null} onClick={() => setChoosing(true)} data-testid="declare-result">Declare result</button>
        {p.declare.waiting ? <p className={d.hint} data-testid="declare-waiting">{p.declare.waiting}</p> : null}
      </div>}
    </div> : null}
    {p.onSurrender || p.onQuit ? <div className={d.leave} role="group" aria-label="Leave the game or the match" data-testid="leave-group">
      {p.onSurrender ? <button type="button" className={`${s.tb} ${s.leaveBtn}`} aria-haspopup="dialog" data-layer-opener data-testid="surrender-button" onClick={event => p.onSurrender?.(event.currentTarget)}><Icon name="flag" /><span>Surrender</span></button> : null}
      {p.onQuit ? <button type="button" className={`${s.tb} ${s.leaveBtn}`} aria-haspopup="dialog" data-layer-opener data-testid="quit-button" onClick={event => p.onQuit?.(event.currentTarget)}><Icon name="x" /><span>Quit match</span></button> : null}
    </div> : null}
  </>;
}

/**
 * The right drawer of the table, from the Log button: Log, Settings, Info and (for admins) Admin.
 * From 1100 px it pushes the table (the `data-drawer` flag on the app), below that it covers it, and on a phone it is a full sheet.
 * Only the open tab is mounted, so a control never exists twice.
 */
export function TableDrawer({ open, tab, onTab, onClose, admin, log, info, settings, adminPanel }: TableDrawerProps) {
  const tabs = admin ? [...TABS, { id: "admin" as const, label: "Admin" }] : TABS;
  const shown = tab === "admin" && !admin ? "log" : tab;
  useEffect(() => { if (tab === "admin" && !admin) onTab("log"); }, [tab, admin, onTab]);
  const body = shown === "log" ? <LogTab p={log} /> : shown === "settings" ? settings : shown === "admin" ? adminPanel : <InfoTab p={info} />;
  return <aside className={`${s.drawer} ${s.logd} ${s.tdr} ${open ? s.open : ""}`} data-layer="log" data-sticky="true" role="dialog" aria-label="Table drawer" aria-modal="false" aria-hidden={!open} data-testid="log-drawer" data-tab={shown} inert={!open}>
    <div className={s.dh}><h2>Table</h2><span className={s.sp} /><button type="button" className={s.ibtn} aria-label="Close drawer" data-testid="drawer-close" onClick={onClose}><Icon name="x" /></button></div>
    <div className={s.tabs} role="tablist" aria-label="Table drawer">
      {tabs.map(item => <button type="button" key={item.id} role="tab" id={`drawer-tab-${item.id}`} aria-selected={shown === item.id} aria-controls="drawer-panel" data-testid={`drawer-tab-${item.id}`} onClick={() => onTab(item.id)}>{item.label}</button>)}
    </div>
    <div className={s.db} id="drawer-panel" role="tabpanel" aria-labelledby={`drawer-tab-${shown}`}>{open ? <Fragment key={shown}>{body}</Fragment> : null}</div>
    {shown === "log" ? <div className={d.foot}>
      <button type="button" className={`${s.btn} ${s.sm}`} disabled={!log.undo.enabled} title={log.undo.reason} data-testid="drawer-undo" onClick={log.undo.onUndo}><Icon name="undo" />Undo: {log.undo.label}</button>
      <span>Newest first. Cards show their art.</span>
    </div> : null}
  </aside>;
}

/** The card picture of a log line, shown beside the drawer. A hover shows it; a click pins it until the next click. */
export function LogCardPreview({ card, onClose }: { card: { row: LogRow; pinned: boolean } | null; onClose: () => void }) {
  const cardId = card?.row.cardId;
  if (!card || !cardId) return null;
  const { row, pinned } = card;
  return <div className={d.peek} data-testid="log-card-preview" data-pinned={pinned || undefined} role="img" aria-label={row.cardName ?? "Card"}>
    <img src={cardArt(cardId, "full")} alt="" />
    <div className={d.peekname}><b>{row.cardName ?? "Card"}</b>{pinned ? <button type="button" className={d.peekx} aria-label="Close card" onClick={onClose}><Icon name="x" /></button> : null}</div>
  </div>;
}
