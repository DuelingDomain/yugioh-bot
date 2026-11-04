"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { DUEL_BANLIST_OPTIONS } from "@yugidraft/shared/duels";
import { REMOTE_FORMATS, normalizeRemoteFormat, type RemoteRoom, type RemoteTable } from "@yugidraft/shared/remote";
import { duelFontClasses } from "@/components/duel/fonts";
import { AlertTriangle, Bot, Check, CheckCircle2, CircleDashed, Link2, Swords, UserPlus } from "lucide-react";
import { cx, SheetButton, SheetSelect, sheetButtonClass, sheetPage } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import room_ from "@/components/duel/room-lobby.module.css";
import { COLORS } from "./model";
import { remoteApi } from "./api";
import type { RoomController } from "./use-remote-room";
import { deckFailedKey, remoteFormatName, remoteTableHref, useSavedDecks } from "./create";
import { LobbyDeckList } from "./lobby-deck-list";
import LobbyCameraPreview, { type CameraMode } from "./lobby-camera-preview";
import { useVideoHub } from "./video-hub";
import l from "./remote-lobby.module.css";
import r from "./lobby-room.module.css";

const go = remoteTableHref;
const formatName = remoteFormatName;

function TableLinks({ title, tables, error }: { title: string; tables?: RemoteTable[]; error?: string }) {
  return <section className={l.card} aria-label={title}>
    <h2>{title}</h2>
    {error ? <p className={l.err} role="alert">{error}</p> : !tables ? <p className={l.note}>Loading tables…</p> : tables.length === 0 ? <p className={l.note}>No tables yet.</p> :
      <ul className={l.tables}>{tables.map(table => <li key={table.slug}>
        <a href={go(table.slug)} data-testid={`table-link-${table.slug}`}>
          <span>{table.slug}</span>
          <span className={l.tag}>{formatName(table.format?.id)}</span>
          {table.solo ? <span className={l.tag}>Solo test</span> : null}
          <span className={l.note}>{table.seats.length}/{table.seatCount} seats</span>
          <span className={`${l.tag} ${table.status === "active" ? l.tagLive : ""}`}>{table.status}</span>
        </a></li>)}</ul>}
  </section>;
}

/** /duels/remote: the open and your own tables. Creating a table happens on the normal create screen. */
export function RemoteLobby() {
  const mine = useSWR("remote:mine", () => remoteApi<{ tables: RemoteTable[] }>("?scope=mine"), { refreshInterval: 5000 });
  const open = useSWR("remote:open", () => remoteApi<{ tables: RemoteTable[] }>("?scope=open"), { refreshInterval: 5000 });
  return <div className={`${duelFontClasses} ${l.lobby}`} data-testid="remote-lobby">
    <div className={l.head}><h1>Remote Duels</h1><p className={l.sub}>Play with real cards on your webcam. The table keeps score.</p></div>
    <div className={l.actions}>
      <a className={`${l.btn} ${l.go}`} href="/duels/new?type=remote" data-testid="new-remote-duel">New Remote Duel</a>
      <a className={l.back} href="/duels">Back to duels</a>
    </div>
    <div className={l.lists}>
      <TableLinks title="Your tables" tables={mine.data?.tables} error={mine.error?.message} />
      <TableLinks title="Open tables" tables={open.data?.tables} error={open.error?.message} />
    </div>
  </div>;
}

/** Copies the link of this table. Same control as the online lobby's Copy invite. */
function CopyInvite({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return <div className={r.invite}>
    <SheetButton size="sm" data-testid="copy-invite" onClick={async () => {
      const href = new URL(remoteTableHref(slug), window.location.origin).href;
      try { await navigator.clipboard.writeText(href); setCopied(true); setManual(null); window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setCopied(false), 2000); }
      catch { setCopied(false); setManual(href); }
    }}>
      {copied ? <Check size={15} strokeWidth={1.7} aria-hidden /> : <Link2 size={15} strokeWidth={1.7} aria-hidden />}
      {copied ? "Invite copied" : "Copy invite"}
    </SheetButton>
    {manual ? <label className={r.manual}>Clipboard unavailable. Copy this invite:
      <input className={ui.input} readOnly value={manual} onFocus={event => event.currentTarget.select()} /></label> : null}
  </div>;
}

/** The camera step. It mounts only after the room's saved camera choice has loaded, so no camera starts by mistake. */
function CameraStep({ room }: { room: RemoteRoom }) {
  const hub = useVideoHub();
  if (!hub.rosterReady) return <p className={ui.hint} role="status" data-testid="lobby-camera-loading">Loading camera choice…</p>;
  return <ReadyCameraStep room={room} />;
}

function ReadyCameraStep({ room }: { room: RemoteRoom }) {
  const hub = useVideoHub();
  const [mode, setMode] = useState<CameraMode>(() => hub.manual(room.mySeat) ? "manual" : hub.phones.some(item => item.seat === room.mySeat) ? "phone" : "webcam");
  return <LobbyCameraPreview room={room} mode={mode} onModeChange={setMode} />;
}

/** The setup room of a table that has not started: seats, decks, rules, camera, ready, start. */
export function RemoteLobbyRoom({ ctl, room }: { ctl: RoomController; room: RemoteRoom }) {
  const { operation, busy, error } = ctl;
  const saved = useSavedDecks();
  // The create screen leaves a note here when it made the room but could not seat the chosen deck.
  const [deckNote, setDeckNote] = useState("");
  useEffect(() => {
    try {
      const key = deckFailedKey(room.slug); const note = sessionStorage.getItem(key);
      if (note) { setDeckNote(note); sessionStorage.removeItem(key); }
    } catch { /* storage may be blocked */ }
  }, [room.slug]);
  const current = room.format ?? normalizeRemoteFormat();
  const [format, setFormat] = useState<string>(current.id);
  const [bestOf, setBestOf] = useState<string>(String(room.bestOf ?? room.state.match?.bestOf ?? 1));
  const [banlist, setBanlist] = useState(current.settings.banlist);
  const [points, setPoints] = useState(current.settings.genesys?.pointCap ?? 100);
  const [lp, setLp] = useState(current.settings.startingLP);
  const [publicityDraft,setPublicityDraft]=useState<boolean|null>(null);
  const showCardsSetFromDeck=publicityDraft ?? room.showCardsSetFromDeck ?? true;
  const me = room.seats.find(seat => seat.seat === room.mySeat);
  const host = me?.userId === room.createdBy;
  const decks = saved.data?.decks ?? [];
  const blocked = !me?.ready && ((!room.solo && !me?.deck) || !!me?.deck?.validation.issues.length);
  const alert = error ?? (deckNote ? `Your deck was not seated: ${deckNote} Pick a deck below.` : saved.error?.message ?? null);
  const canStart = host && room.seats.length === room.seatCount && room.seats.every(seat => seat.ready);
  const open = room.seatCount - room.seats.length;
  const seatNames = ["Seat 1", "Seat 2", "Seat 3", "Seat 4"];
  return <div className={sheetPage} data-testid="remote-lobby-room">
    <div className={room_.wrap}>
      <header className={room_.head}>
        <div className={room_.titleBlock}>
          <h1 className={ui.title}>{room.solo ? "Solo test" : "Remote table"}</h1>
          <p className={room_.chips}>
            <span className={cx(ui.chip, ui.chipAccent)}>{formatName(current.id)}</span>
            <span className={ui.chip}>{room.seatCount === 2 ? "1v1" : `${room.seatCount}-way`}</span>
            <span className={ui.chip}>Code <b className={r.code}>{room.slug}</b></span>
            <span className={room_.presence} data-present={ctl.realtime === "Connected"} role="status"><i aria-hidden />{ctl.realtime}</span>
          </p>
        </div>
        <div className={room_.headActions}>
          {room.solo ? null : <CopyInvite slug={room.slug} />}
          <a href="/duels/remote" className={sheetButtonClass("quiet", "sm")}>All tables</a>
        </div>
      </header>

      {alert ? <div className={cx(ui.banner, ui.bannerBad, r.alert)} role="alert"><AlertTriangle size={16} strokeWidth={1.7} aria-hidden /><div className={ui.bannerBody}>{alert}</div></div> : null}

      <div className={r.layout}>
        <section className={cx(room_.panel, r.seatsPanel)} aria-label="Seats and decks">
          <h2 className={ui.sectionTitle}>Seats and decks</h2>
          <ul className={room_.seats}>{Array.from({ length: room.seatCount }, (_, index) => {
            const seat = room.seats.find(item => item.seat === index);
            if (!seat) return <li key={index} className={cx(room_.seat, room_.seatOpen)}>
              <span className={room_.avatar} aria-hidden><UserPlus size={17} strokeWidth={1.5} /></span>
              <span className={room_.seatText}><span className={room_.seatName}>Open seat</span><span className={room_.seatMeta}>{seatNames[index]}</span></span>
              <span className={room_.seatActions}><span className={room_.status}><CircleDashed size={15} strokeWidth={1.6} aria-hidden />Waiting for a player</span></span>
            </li>;
            const mine = seat.seat === room.mySeat;
            const editable = room.solo || mine;
            const choices = decks.some(deck => deck.id === seat.deck?.savedDeckId) || !seat.deck ? decks : [...decks, { id: seat.deck.savedDeckId, name: seat.deck.name }];
            const Icon = seat.ready ? CheckCircle2 : CircleDashed;
            return <li key={index} className={room_.seat} data-testid={`lobby-seat-${seat.seat}`} data-ready={seat.ready ? "true" : "false"} data-mine={mine ? "true" : undefined}>
              <span className={room_.avatar} aria-hidden>{seat.bot ? <Bot size={18} strokeWidth={1.5} /> : (seat.displayName.trim()[0] ?? "?").toUpperCase()}</span>
              <span className={room_.seatText}>
                <span className={room_.seatName}>{seat.displayName}</span>
                <span className={room_.seatMeta}><i className={r.dot} style={{ background: `rgb(${COLORS[seat.seat]})` }} aria-hidden />{seatNames[index]}{mine ? " · You" : seat.bot ? " · Test opponent" : ""}</span>
              </span>
              <span className={room_.seatActions}><span className={cx(room_.status, seat.ready && room_.statusReady)}><Icon size={15} strokeWidth={1.7} aria-hidden />{seat.ready ? "Ready" : "Not ready"}</span></span>
              <div className={r.deck}>
                <SheetSelect label="Deck" ariaLabel={`Deck for ${seat.displayName}`} value={seat.deck?.savedDeckId ?? ""} disabled={busy || !editable} testId={`deck-${seat.seat}`}
                  choices={[{ value: "", label: !editable ? seat.deckRegistered ? "Deck registered (private)" : "No deck selected" : room.solo ? "No deck (optional)" : "Choose a saved deck" },
                    ...choices.map(deck => ({ value: deck.id, label: deck.name }))]}
                  onChange={value => void operation("deck", { savedDeckId: value === "" ? null : Number(value), seat: seat.seat })} />
                {mine && editable ? <LobbyDeckList disabled={busy} onSeat={async id => { await saved.mutate(); return operation("deck", { savedDeckId: id, seat: seat.seat }); }} /> : null}
                {seat.deck ? <p className={r.listOn} data-testid={`deck-list-on-${seat.seat}`}>Deck list: on · {seat.deck.deck.main.length + seat.deck.deck.extra.length} cards</p> : null}
                {seat.deck?.validation.issues.length ? <ul className={r.issues} role="alert">{seat.deck.validation.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul>
                  : seat.deck ? <p className={r.valid}><CheckCircle2 size={14} strokeWidth={1.7} aria-hidden />Valid for this table.</p> : null}
              </div>
            </li>;
          })}</ul>
          <p className={ui.hint}>{open > 0 ? `${open} open seat${open === 1 ? "" : "s"}. Share the invite link. ` : ""}The table keeps a copy of the deck you pick. Live additions are shared with the table. Your saved deck stays unchanged.</p>
        </section>

        <section className={cx(room_.panel, r.cameraPanel)} aria-label="Camera setup">
          <div className={r.camHead}><h2 className={ui.sectionTitle}>Field camera</h2><p className={ui.hint}>Check your field camera before you get ready.</p></div>
          <CameraStep room={room} />
        </section>


        <div className={r.side}>
          <div className={r.actions}>
            <div className={r.primary}>
              <SheetButton kind={me?.ready ? "secondary" : "primary"} size="lg" disabled={busy || blocked} data-testid="ready" onClick={() => void operation("ready", { ready: !me?.ready })}>
                {me?.ready ? "Not ready" : <>Ready<CheckCircle2 size={17} strokeWidth={1.6} aria-hidden /></>}
              </SheetButton>
              {host ? <SheetButton kind={canStart ? "primary" : "secondary"} size="lg" disabled={busy || !canStart} data-testid="start" onClick={() => void operation("start")}>
                Start table<Swords size={17} strokeWidth={1.6} aria-hidden />
              </SheetButton> : null}
            </div>
            <SheetButton kind="quiet" disabled={busy} onClick={() => void operation("leave")}>Leave table</SheetButton>
            {blocked ? <p className={r.startHint}>{me?.deck?.validation.issues.length ? "Fix the deck problems to get ready." : "Choose a saved deck to get ready."}</p>
              : !host ? <p className={r.startHint}>Waiting for the host to start the table.</p>
              : !canStart ? <p className={r.startHint}>{room.seats.length < room.seatCount ? "Start unlocks when every seat is filled and ready." : "Start unlocks when every seat is ready."}</p> : null}
          </div>
          <form className={cx(room_.panel, r.rulesPanel)} aria-label="Rules" onSubmit={e => { e.preventDefault();
            void operation("format", { format, bestOf: Number(bestOf), showCardsSetFromDeck, rules: { banlist, startingLP: lp, ...(format.includes("genesys") ? { genesys: { pointCap: points } } : {}) } }).then(()=>setPublicityDraft(null)); }}>
            <h2 className={ui.sectionTitle}>Rules</h2>
            <fieldset disabled={busy || !host} className={r.fieldset}>
              <SheetSelect label="Match length" value={bestOf} testId="room-best-of"
                choices={[{ value: "1", label: "Best of 1 (one game)" }, { value: "3", label: "Best of 3 (side decking between games)" }]}
                onChange={setBestOf} />
              <SheetSelect label="Duel format" value={format} testId="room-format"
                choices={REMOTE_FORMATS.map(item => ({ value: item.value as string, label: remoteFormatName(item.value) }))}
                onChange={value => { setFormat(value); setBanlist(normalizeRemoteFormat(value).settings.banlist); }} />
              {format.includes("genesys")
                ? <label><span className={ui.label}>Genesys point cap</span><input className={ui.input} type="number" min={0} max={1000} value={points} onChange={e => setPoints(Number(e.target.value))} /></label>
                : <SheetSelect label="Banlist" value={banlist} choices={DUEL_BANLIST_OPTIONS.map(item => ({ value: item.id as string, label: item.label }))} onChange={setBanlist} />}
              <label><span className={ui.label}>Starting LP</span><input className={ui.input} type="number" min={1} max={100000} value={lp} onChange={e => setLp(Number(e.target.value))} /></label>
              <div className={r.toggleRow}>
                <label className={r.toggle}><input type="checkbox" checked={showCardsSetFromDeck} onChange={e => setPublicityDraft(e.target.checked)} /><span>Cards Set from Deck are shown to all</span></label>
                <p className={ui.hint}>Also applies to cards searched from Deck to hand. Candidate lists are visible only to the controller.</p>
              </div>
              {host ? <SheetButton type="submit" kind="secondary" block data-testid="apply-rules">Apply rules</SheetButton> : null}
            </fieldset>
            <p className={ui.hint}>{host ? "Changing the rules clears every ready mark." : "Only the host changes the rules."}</p>
          </form>
        </div>
      </div>
    </div>
  </div>;
}
