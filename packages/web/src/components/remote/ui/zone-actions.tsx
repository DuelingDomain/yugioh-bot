'use client';
import { useState, type ButtonHTMLAttributes } from 'react';
import type { RemoteRoom } from '@yugidraft/shared/remote';
import { PopupFrame, type PopAt } from './popup';
import { ZoneCardPicker } from './zone-card-picker';
import type { ZonePick, ZoneCardAction } from './zone-placement';
import { cardCode, cellsFor, hasExtraZones, type TwinCard, type ZoneKey, ZN } from './model';
import { cardArt, useCardInfo } from './catalog';
import { Icon, type IconName } from './icons';
import { fieldSummonKind } from '@/lib/remote/field-summons';
import { isFieldSpell } from '@/lib/remote/field-legality';
import { recentReadsFor } from '@/lib/remote/recent-reads';
import { playerStamp } from '@/lib/remote/field-timing';
import type { QuickMove } from './quick-moves';
import s from './remote-ui.module.css';


/** One menu row: icon, plain label, and a chevron when the tap opens a next step. */
function Row({ icon, next, primary, children, ...rest }: { icon: IconName; next?: boolean; primary?: boolean; children: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className' | 'type'>) {
  return <button type="button" className={`${s.zaRow} ${primary ? s.zaPrimary : ''}`} {...rest}><Icon name={icon} /><span>{children}</span>{next ? <Icon name="chev" className={s.zaNext} /> : null}</button>;
}

export function ZoneActions({ tokenOnly, room, seat, zone, at, deck, targetRef, startPicker=false, initialFaceUp, busy, error, onPick, onAction, onSet, onToken, onGive, onDetails, onClose, quick = [] }: {
  room: RemoteRoom; seat: number; zone: ZoneKey; at: PopAt; deck: number[]; targetRef?: string; initialFaceUp?: boolean;
  busy: boolean; error: string; startPicker?: boolean; onPick(pick: ZonePick): void; onAction(action: ZoneCardAction): void;
  onSet(): void; onToken(): void; /** An empty zone of another player's field: the menu only offers a token and a card from my hand. */ tokenOnly?: boolean; /** Give a card from my hand to this zone (the opponent's field only). */ onGive?: () => void; onDetails(card: TwinCard): void; onClose(): void;
  /** The important card moves (give control, position, send, remove proxy), same set as the Tap-mode card popup. */ quick?: QuickMove[];
}) {
  const twins = room.state.seats[seat].twin;
  const card = cellsFor(twins, hasExtraZones(room.format?.id))[zone]?.card;
  const [mode, setMode] = useState<'actions' | 'place' | 'top' | 'flip'>(targetRef || startPicker ? 'place' : 'actions');
  const [topRef, setTopRef] = useState(card?.ref);
  const [pick, setPick] = useState<ZonePick | null>(null);
  const [materials, setMaterials] = useState<string[]>(card ? [card.ref] : []);
  const info = useCardInfo([pick?.cardId, ...twins.map(cardCode)]);
  const topChanged = !!pick && card?.ref !== topRef;
  const actorSeat = room.solo ? seat : room.mySeat;
  const action = (proposal: ZoneCardAction) => onAction({ ...proposal, cam: playerStamp('zone-actions') });
  const names = (c: TwinCard) => c.token ? (c.name ?? 'Token') : (c.name ?? info(cardCode(c))?.name ?? (c.faceUp ? 'Card' : 'Face-down card'));
  if (pick && (!card || topChanged)) return <PopupFrame at={at} layer="zone" label="Zone changed" testid="zone-changed-error"><p role="alert">This zone changed. Close and open it again.</p><button type="button" className={s.btn} onClick={onClose}>Close</button></PopupFrame>;
  if (pick && card) {
    const summon = fieldSummonKind(info(pick.cardId));
    const usable = twins.filter(c => !c.token && c.ref !== pick.fromRef && ['monster','extra-monster'].includes(c.zone));
    return <PopupFrame at={at} layer="zone" label="Put a card on top" testid="zone-top-actions" className={`${s.zonePicker} ${s.zoneMenu}`} busy={busy}>
      <header className={s.zmHead}>
        <button type="button" className={`${s.btn} ${s.q} ${s.zpClose}`} disabled={busy} onClick={() => setPick(null)}><Icon name="back" />Back</button>
        <strong title={`${pick.name} on top`}>{pick.name} on top</strong>
        <button type="button" className={`${s.btn} ${s.q} ${s.zpClose}`} disabled={busy} onClick={onClose}>Close</button>
      </header>
      <div className={s.zmBody}>
        <p className={s.zpNote}>Choose what happens to the card(s) here.</p>
        {summon ? <fieldset className={s.zmSet} disabled={busy}><legend>Summon materials</legend>{usable.map(c => <label key={c.ref} className={s.zmCheck}>
          <input type="checkbox" checked={materials.includes(c.ref)} disabled={c.ref === card.ref} onChange={e => setMaterials(before => e.target.checked ? [...before, c.ref] : before.filter(ref => ref !== c.ref))} />
          <span className={s.zmCheckName} title={names(c)}>{names(c)}</span><span className={s.zmCheckAt}>{c.zone === 'extra-monster' ? `EMZ ${c.slot}` : `M${c.slot}`}</span>
        </label>)}</fieldset> : <p className={s.zpNote}>Summon needs an Xyz, Synchro, Fusion or Link Monster.</p>}
        {summon ? <p className={s.zpNote}>{summon.kind === 'xyz' ? 'Materials stay under the top card, including materials already attached.' : 'Summon materials go to the Graveyard.'}</p> : null}
        {error ? <p role="alert" className={s.zpErr}>{error}</p> : null}
      </div>
      <div className={s.zmFoot}>
        <button type="button" className={`${s.btn} ${s.go} ${s.zmBtn}`} disabled={busy || !summon} onClick={() => onPick({ ...pick, faceUp: true, top: { ref: card.ref, kind: 'summon', materialRefs: materials } })}>Summon using the card(s) here as material</button>
        <button type="button" className={`${s.btn} ${s.zmBtn}`} disabled={busy} onClick={() => onPick({ ...pick, faceUp: true, top: { ref: card.ref, kind: 'replace' } })}>Replace (old card to GY)</button>
        {busy ? <p role="status" className={s.zpNote}>Saving…</p> : null}
      </div>
    </PopupFrame>;
  }
  if (mode !== 'actions') return <ZoneCardPicker title={mode === 'top' ? 'Put a card on top' : mode === 'flip' ? 'Flip: which card is it?' : undefined} seat={seat} zone={zone} at={at} deck={deck} recent={recentReadsFor(room, seat)} twin={twins}
    targetRef={mode === 'flip' ? topRef : mode === 'place' ? targetRef : undefined} initialFaceUp={mode === 'flip' || mode === 'top' ? true : initialFaceUp}
    allowFaceDown={mode !== 'flip' && mode !== 'top'} excludeRef={mode === 'top' ? card?.ref : undefined}
    busy={busy} error={error} onClose={onClose} onPick={chosen => {
      if (mode !== 'top') onPick(chosen);
      else if (card && isFieldSpell(info(chosen.cardId))) onPick({ ...chosen, top: { ref: card.ref, kind: 'replace' } });
      else { setPick(chosen); setMaterials(card ? [card.ref] : []); }
    }} />;
  const held = card?.materials?.length ?? 0;
  const move = (id: QuickMove['id']) => quick.find(m => m.id === id);
  // Close first: a move that opens its own layer (the Return control zone choice) must be the last layer change.
  const go = (m: QuickMove) => { onClose(); m.run(); };
  const sends = (['grave', 'banish', 'hand'] as const).map(move).filter((m): m is QuickMove => !!m);
  const set = /^[ms][1-5]$/.test(zone);
  return <PopupFrame at={at} layer="zone" label={`Actions in ${ZN[zone]}`} className={`${s.zonePicker} ${s.zoneMenu}`} testid="zone-actions" busy={busy}>
    <header className={s.zmHead}>
      <div className={s.zmTitle}><strong>{ZN[zone]}</strong><span title={card ? names(card) : undefined}>{card ? `${names(card)}${held ? ` · ${held} material${held === 1 ? '' : 's'}` : ''}` : 'Empty'}</span></div>
      <button type="button" className={`${s.btn} ${s.q} ${s.zpClose}`} disabled={busy} onClick={onClose}>Close</button>
    </header>
    <div className={s.zmBody}>
      {card?.faceUp&&card.nameCandidates?<section aria-label="Unsure name" className={s.zaList}>
        <p className={s.zpNote}>Unsure · choose the card name</p>
        {card.nameCandidates.map(candidate=><Row key={candidate.cardId} icon="check" disabled={busy} onClick={()=>action({type:'card.identified',actorSeat,seat,cardRef:card.ref,cardId:candidate.cardId,name:candidate.name,source:'click'})}>{candidate.name}</Row>)}
      </section>:null}
      <div className={s.zaList}>
        {tokenOnly ? null : card ? <>
          {move('activate') ? <Row icon="check" primary disabled={busy} onClick={() => go(move('activate')!)} data-testid="zone-activate">{move('activate')!.label}</Row> : null}
          {!card.token ? <Row icon="layers" next primary={!move('activate')} data-autofocus="" disabled={busy} onClick={() => { setTopRef(card.ref); setMode('top'); }}>Put a card on top</Row> : null}
          {move('give') ? <Row icon="hand" disabled={busy} onClick={() => go(move('give')!)} data-testid="zone-give">{move('give')!.label}</Row> : null}
          {move('return') ? <Row icon="hand" disabled={busy} onClick={() => go(move('return')!)} data-testid="zone-return">{move('return')!.label}</Row> : null}
          {move('position') ? <Row icon="flip" disabled={busy} onClick={() => go(move('position')!)}>{move('position')!.label}</Row> : null}
          {!card.faceUp && !card.token ? <Row icon="flip" next disabled={busy} onClick={() => { setTopRef(card.ref); setMode('flip'); }}>Flip</Row> : null}
          {card.faceUp && !card.token && set ? <Row icon="cardback" disabled={busy} onClick={() => action({type:'twin.flip',actorSeat,seat,cardRef:card.ref,faceUp:false,...(card.zone==='monster'?{position:'defense' as const}:{})})}>Set (turn face down)</Row> : null}
        </> : <>
          <Row icon="plus" next primary data-autofocus="" disabled={busy} onClick={() => setMode('place')}>Put a card here</Row>
          {set ? <Row icon="cardback" disabled={busy} onClick={onSet}>Set a card here</Row> : null}
        </>}
        {!tokenOnly && card && sends.length ? <div className={s.zaSend} role="group" aria-label="Send the card to"><span>Send to</span>
          {sends.map(m => <button type="button" key={m.id} className={`${s.btn} ${s.sm} ${s.q}`} disabled={busy} onClick={() => go(m)} data-testid={`zone-${m.id}`}>{m.label.replace('To ', '')}</button>)}</div> : null}
        {!tokenOnly && move('remove') ? <Row icon="x" disabled={busy} onClick={() => go(move('remove')!)} data-testid="zone-remove-proxy">{move('remove')!.label}</Row> : null}
        {!tokenOnly || /^m[1-5]$/.test(zone) ? <Row icon="coin" next primary={tokenOnly} data-autofocus={tokenOnly ? "" : undefined} disabled={busy} onClick={onToken} data-testid="zone-token">{!card && /^m[1-5]$/.test(zone) ? 'Add token here' : 'Add token'}</Row> : null}
        {tokenOnly && onGive ? <Row icon="hand" next primary={!/^m[1-5]$/.test(zone)} data-autofocus={/^m[1-5]$/.test(zone) ? undefined : ""} disabled={busy} onClick={() => { onClose(); onGive(); }} data-testid="zone-give-hand">Give a card from my hand here</Row> : null}
        {card && !tokenOnly ? <Row icon="info" next disabled={busy} onClick={() => onDetails(card)}>Card details</Row> : null}
      </div>
      {card?.materials?.length ? <section className={s.zmMats} aria-label="Materials">
        <h3>Materials <b>{card.materials.length}</b></h3>
        {card.materials.map(ref => {
          const material = twins.find(c => c.ref === ref);
          const code = material ? cardCode(material) : undefined;
          const label = material ? names(material) : 'Material';
          return <div role="group" aria-label={`Detach ${label}`} className={s.zmMat} key={ref}>
            {code ? <img src={cardArt(code, 'small')} alt="" loading="lazy" draggable={false} /> : <i aria-hidden="true" />}
            <span title={label}>{label}</span>
            {(['graveyard', 'banished'] as const).map(destination => <button type="button" className={s.btn} key={destination} disabled={busy} aria-label={`Detach material to ${destination === 'graveyard' ? 'GY' : 'banished'}`}
              onClick={() => action({ type: 'twin.detach', actorSeat, seat, cardRef: card.ref, materialRef: ref, zone: destination })}>{destination === 'graveyard' ? 'To GY' : 'Banish'}</button>)}
          </div>;
        })}
      </section> : null}
      {error ? <p role="alert" className={s.zpErr}>{error}</p> : null}
      {busy ? <p role="status" className={s.zpNote}>Saving…</p> : null}
    </div>
  </PopupFrame>;
}
