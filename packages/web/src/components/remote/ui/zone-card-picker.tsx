'use client';
import { useEffect, useState } from 'react';
import { PopupFrame, type PopAt } from './popup';
import { searchCards, useCardInfo } from './catalog';
import { cardCode, type TwinCard, type ZoneKey, ZN } from './model';
import type { RecentRead } from '@/lib/remote/recent-reads';
import type { ZonePick } from './zone-placement';
import s from './remote-ui.module.css';

const SOURCES = ['My deck', 'Recent reads', 'Search'];

export function ZoneCardPicker({ seat, zone, targetRef, initialFaceUp=true, at, deck, recent, twin, busy, error, onPick, onClose }: {
  seat: number; zone: ZoneKey; targetRef?: string; initialFaceUp?:boolean; at: PopAt; deck: number[]; recent: readonly RecentRead[]; twin: readonly TwinCard[];
  busy: boolean; error: string; onPick(pick: ZonePick): void; onClose(): void;
}) {
  const [tab, setTab] = useState('My deck'), [query, setQuery] = useState(''), [results, setResults] = useState<RecentRead[]>([]);
  const [selected, setSelected] = useState<RecentRead | null>(null), [faceUp, setFaceUp] = useState(initialFaceUp);
  const info = useCardInfo(deck);
  useEffect(() => { let alive = true; const timer = setTimeout(() => { void searchCards(query).then(cards => { if (alive) setResults(cards.map(c => ({ cardId: c.id, name: c.name }))); }); }, 200); return () => { alive = false; clearTimeout(timer); }; }, [query]);
  const rows = tab === 'My deck' ? [...new Set(deck)].flatMap(id => { const c = info(id); return c ? [{ cardId: id, name: c.name }] : []; }) : tab === 'Recent reads' ? recent : results;
  const copies = selected && !targetRef ? twin.filter(c => cardCode(c) === selected.cardId && !c.token && c.zone !== 'material') : [];
  const choose = (card: RecentRead, origin?: { fromRef?: string; anotherCopy?: boolean }) => {
    if (busy) return;
    if (!origin && !targetRef && twin.some(c => cardCode(c) === card.cardId && !c.token && c.zone !== 'material')) { setSelected(card); return; }
    onPick({ seat, key: zone, cardId: card.cardId, name: card.name, faceUp, targetRef, ...origin });
  };
  return <PopupFrame at={at} layer="zone" label={`Place a card in ${ZN[zone]}`} testid="zone-card-picker" className={s.zonePicker}>
    <header><strong>{targetRef ? 'Choose the right card' : `Place in ${ZN[zone]}`}</strong><button type="button" className={`${s.btn} ${s.q} ${s.zpClose}`} onClick={onClose} disabled={busy}>Close</button></header>
    <label className={s.zpFace}><input type="checkbox" checked={!faceUp} disabled={busy} onChange={e => setFaceUp(!e.target.checked)} /> Face down (private)</label>
    <div role="tablist" aria-label="Card source" className={s.zpTabs} onKeyDown={e => {
      const at = SOURCES.indexOf(tab), next = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : -1;
      if (next < 0) return;
      e.preventDefault(); const to = SOURCES[(next + SOURCES.length) % SOURCES.length]!; setTab(to); setSelected(null);
      requestAnimationFrame(() => (e.currentTarget.querySelector('[aria-selected="true"]') as HTMLElement | null)?.focus());
    }}>{SOURCES.map(t => <button type="button" role="tab" aria-selected={t === tab} tabIndex={t === tab ? 0 : -1} className={s.zpTab} key={t} onClick={() => { setTab(t); setSelected(null); }}>{t}</button>)}</div>
    {tab === 'Search' ? <label className={s.zpSearch}><span className={s.cap}>Search cards</span><input className={s.inp} value={query} onChange={e => { setQuery(e.target.value); setSelected(null); }} autoComplete="off" /></label> : null}
    {error ? <p role="alert" className={s.zpErr}>{error}</p> : null}
    {selected ? <div role="group" aria-label="Choose a physical copy" className={s.zpList}><p className={s.zpNote}><b>{selected.name}</b> is already on your side. Which copy?</p>{copies.map(c => <button type="button" className={s.zpRow} key={c.ref} disabled={busy} onClick={() => choose(selected, { fromRef: c.ref })}>Use {c.zone}{c.slot ? ` ${c.slot}` : ''} copy</button>)}<button type="button" className={s.zpRow} disabled={busy} onClick={() => choose(selected, { anotherCopy: true })}>Another physical copy</button><button type="button" className={`${s.zpRow} ${s.zpBack}`} onClick={() => setSelected(null)}>Back</button></div>
      : <div role="group" aria-label="Cards" className={s.zpList}>{rows.map(card => { const n = tab === 'My deck' ? deck.filter(id => id === card.cardId).length : 0;
        return <button type="button" className={s.zpRow} key={card.cardId} disabled={busy} aria-label={n ? `${card.name} (${n})` : undefined} onClick={() => choose(card)}><span className={s.zpName}>{card.name}</span>{n > 1 ? <span className={s.zpCount} aria-hidden="true">×{n}</span> : null}</button>; })}{!rows.length ? <p className={s.zpNote}>{tab === 'My deck' ? 'No deck cards loaded. Use Search.' : tab === 'Search' ? 'Type at least two letters.' : 'No recent reads yet.'}</p> : null}</div>}
    {busy ? <p role="status" className={s.zpNote}>Saving…</p> : null}
  </PopupFrame>;
}
