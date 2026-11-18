'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
import { FIELD_LEAVE_DESTINATIONS, fieldLeaveLabel } from '@/lib/remote/field-proposals';
import { playerStamp } from '@/lib/remote/field-timing';
import { cardCode, cardName } from './model';
import { cardInfo } from './catalog';
import s from './remote-ui.module.css';

/** A card that just left the field shows as a small note for this long. The Departures chip keeps it reachable after that, as long as the event is kept. */
const NOTE_MS = 8000;
const NOTE_MAX = 3;
const PILES = ['hand', 'deck', 'extra', 'graveyard', 'banished'];
/** Width of a departure note: a card name, its destination and the Change tag. */
const NOTES_W = 230;
/** Free space left of the camera box (px) below which the notes stay at the box corner. */
const MIN_FREE = 24;
type Anchor = { l: number; b: number; w: number; h: number };

/**
 * Cards the camera just sent away from the field (the default destination, or a pile it saw). A floating overlay on the left: it never moves the board.
 * Each new card shows as a compact note ("Card → GY") that fades by itself; a click on it opens that card's destinations. The "Departures (N)" chip
 * stays and lists every kept card, so a destination can be fixed later. Nothing here takes focus.
 */
export function RecentDepartures({ room, seat, onAction }: { room: RemoteRoom; seat: number; onAction(action: RemoteActionProposal): void }) {
  const mine = room.solo || seat === room.mySeat;
  const events = mine ? [...room.events].reverse().filter(e => e.action.type === 'twin.move' && e.action.seat === seat && e.action.source === 'auto' && e.action.cam?.by !== 'player' && ['hand','extra','graveyard','banished'].includes(e.action.zone)) : [];
  const seen = new Set<string>();
  const items = events.flatMap(e => {
    if (e.action.type !== 'twin.move' || seen.has(e.action.cardRef)) return [];
    seen.add(e.action.cardRef);
    const ref=e.action.cardRef,card = room.state.seats[seat]?.twin.find(c => c.ref === ref);
    // A card that is back on the field (Undo) or moved on to another zone no longer counts as a departure.
    return card && PILES.includes(card.zone) ? [{ card, event: e }] : [];
  }).slice(0, 6);
  const [open, setOpen] = useState<string | null>(null);
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [, tick] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  // When each entry first showed here. Entries that were already there at mount (a reload, a late join) never pop up as notes.
  const firstSeen = useRef(new Map<string, number>());
  const mounted = useRef(false);
  for (const { event } of items) if (!firstSeen.current.has(event.id)) firstSeen.current.set(event.id, mounted.current ? Date.now() : 0);
  const now = Date.now();
  const fresh = items.filter(({ event }) => !gone.has(event.id) && (firstSeen.current.get(event.id) ?? 0) > 0 && now - firstSeen.current.get(event.id)! < NOTE_MS);
  const nextEnd = Math.min(...fresh.map(({ event }) => firstSeen.current.get(event.id)! + NOTE_MS));
  useEffect(() => { mounted.current = true; }, []);
  useEffect(() => {
    if (!Number.isFinite(nextEnd)) return;
    const timer = setTimeout(() => tick(n => n + 1), Math.max(50, nextEnd - Date.now() + 20));
    return () => clearTimeout(timer);
  }, [nextEnd]);
  // A panel for a card that dropped out of the list (Undo, or more than 6 newer cards) closes.
  const openGone = !!open && open !== 'all' && !items.some(({ event }) => event.id === open);
  useEffect(() => { if (openGone) setOpen(null); }, [openGone]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    // Escape closes this panel first: the capture phase and stopPropagation keep the table's own Escape handlers (drawers, prompts) from acting on the same key.
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(null); } };
    document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key, true); };
  }, [open]);
  // On a wide screen the overlay sits at the bottom left of this seat's camera box. It starts in the free space left of the box when there is some (no LP, zone or toolbar is covered), so it covers less of the picture.
  // It is fixed, so it moves nothing.
  // Without a camera box to measure (a layout that hides it) CSS puts it above the dock and the phase bar.
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const has = items.length > 0;
  useEffect(() => {
    if (!has) return;
    const boxSelector = `[data-testid="feed-box-${seat}"]`;
    const measure = () => {
      let next: Anchor | null = null;
      if (window.innerWidth > 900) {
        const box = document.querySelector<HTMLElement>(boxSelector), r = box?.getBoundingClientRect();
        if (box && r && r.width >= 160 && r.height >= 100) {
          // Rule: the notes start at the seat's left edge whenever the camera box leaves more than MIN_FREE px free there, so they cover only the picture part (note width minus free space) that the free space cannot hold.
          // Starting at the seat edge never clips and never covers more than starting at the box corner would. With no free space they sit at the box corner.
          const seatLeft = document.querySelector<HTMLElement>(`[data-testid="seat-${seat}"]`)?.getBoundingClientRect().left ?? r.left;
          const left = r.left - seatLeft > MIN_FREE ? Math.round(seatLeft) + 8 : Math.round(r.left) + 8;
          // Over the picture, the notes sit above the "revealed in hand" chip when that one is there.
          const chip = left + NOTES_W > r.left ? box.querySelector<HTMLElement>(`.${s.hover}`)?.getBoundingClientRect() : undefined;
          const bottom = chip && chip.height > 0 ? window.innerHeight - chip.top + 8 : window.innerHeight - r.bottom + 8;
          next = { l: left, b: Math.round(bottom), w: Math.round(r.right) - left - 8, h: Math.round(r.height) - 16 };
        }
      } else {
        // On a phone the turn and phase bar sits above the dock. The overlay goes above that bar, so it never covers it.
        const r = document.querySelector<HTMLElement>('[data-testid="rail"]')?.getBoundingClientRect();
        if (r && r.height > 0) next = { l: 0, b: Math.round(window.innerHeight - r.top) + 8, w: 0, h: 0 };
      }
      setAnchor(prev => prev?.l === next?.l && prev?.b === next?.b && prev?.w === next?.w && prev?.h === next?.h ? prev : next);
    };
    measure();
    // The camera box changes size with the window and with the layout. The chip appears and goes inside the box.
    // Both observers fire in bursts (the feed redraws often), so the measuring runs at most once per frame.
    let frame = 0;
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); };
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule), mutate = new MutationObserver(schedule);
    for (const element of [document.querySelector(boxSelector), document.querySelector(`[data-testid="seat-${seat}"]`)]) if (element) resize?.observe(element);
    const box = document.querySelector(boxSelector); if (box) mutate.observe(box, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => { resize?.disconnect(); mutate.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); };
  }, [has, seat]);
  if (!items.length) return null;
  const live = room.status === 'active' && !room.state.ended && !room.state.seats[seat]?.eliminated;
  const shown = open ? items.filter(({ event }) => open === 'all' || event.id === open) : [];
  const notes = open ? [] : fresh.slice(0, NOTE_MAX);
  return <div ref={root} className={s.depDock} data-testid="recent-departures"
    style={anchor ? { '--dep-b': `${anchor.b}px`, ...(anchor.w ? { '--dep-l': `${anchor.l}px`, '--dep-w': `${anchor.w}px`, '--dep-h': `${anchor.h}px` } : {}) } as CSSProperties : undefined}>
    {shown.length ? <div className={s.depPanel}>
      {shown.map(({ card, event }) => {
      const change = [...room.state.undoHistory??[]].sort((a,b)=>b.order-a.order).find(e => !e.undone && e.actorSeat === (room.solo ? seat : room.mySeat) && e.cards.includes(`${seat}:${card.ref}`));
      return <div key={event.id} role="group" aria-label={`Departure: ${cardName(card, cardInfo(cardCode(card)))}`}>
        <b>{cardName(card, cardInfo(cardCode(card)))}</b><span> → {fieldLeaveLabel(card.zone,card.faceUp)}</span>
        {FIELD_LEAVE_DESTINATIONS.map(d => <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} key={d.title} disabled={!live || !PILES.includes(card.zone) || card.zone === d.zone && (d.zone !== 'banished' || card.faceUp === !('down' in d))} onClick={() => onAction({type:'twin.move',actorSeat:room.solo?seat:room.mySeat,seat,cardRef:card.ref,zone:d.zone,confirmed:true,cam:playerStamp('recent-departure'),...(d.zone === 'banished' ? {faceUp:!('down' in d)} : d.zone === 'graveyard' ? {faceUp:true} : d.zone === 'extra'&&card.faceUp&&/pendulum/i.test(cardInfo(cardCode(card))?.type??'')?{faceUp:true,pendulum:true}:d.zone === 'deck' || d.zone === 'extra' ? {faceUp:false} : {})})}>{d.title}</button>)}
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} disabled={!live || !change || !!change.reason} title={change?.reason} onClick={() => { if (change) onAction({type:'undo',actorSeat:room.solo?seat:room.mySeat,targetActionId:change.actionId,cam:playerStamp('recent-departure-undo')}); }}>Undo</button>
      </div>;
      })}
    </div> : null}
    <div className={s.depNotes} role="status">
      {notes.map(({ card, event }) => <button type="button" key={event.id} className={s.depNote} aria-label={`${cardName(card, cardInfo(cardCode(card)))} went to ${fieldLeaveLabel(card.zone,card.faceUp)}. Change`} onClick={() => { setOpen(event.id); setGone(g => new Set(g).add(event.id)); }} title="Change where it went">
        <b>{cardName(card, cardInfo(cardCode(card)))}</b><span>→ {fieldLeaveLabel(card.zone,card.faceUp)}</span><i>Change</i>
      </button>)}
      {!open && fresh.length > NOTE_MAX ? <span className={s.depMore}>+{fresh.length - NOTE_MAX}</span> : null}
    </div>
    <button type="button" className={s.depChip} aria-expanded={open === 'all'} onClick={() => { setOpen(open === 'all' ? null : 'all'); setGone(new Set(items.map(i => i.event.id))); }}>Departures ({items.length})</button>
  </div>;
}
