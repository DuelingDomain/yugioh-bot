'use client';
import { useState } from 'react';
import type { RemoteRoom } from '@yugidraft/shared/remote';
import { PopupFrame, type PopAt } from './popup';
import { ZoneCardPicker } from './zone-card-picker';
import type { ZonePick, ZoneCardAction } from './zone-placement';
import { cardCode, cellsFor, hasExtraZones, type TwinCard, type ZoneKey, ZN } from './model';
import { useCardInfo } from './catalog';
import { fieldSummonKind } from '@/lib/remote/field-summons';
import { recentReadsFor } from '@/lib/remote/recent-reads';
import { playerStamp } from '@/lib/remote/field-timing';
import s from './remote-ui.module.css';

export function ZoneActions({ room, seat, zone, at, deck, targetRef, startPicker=false, initialFaceUp, busy, error, onPick, onAction, onSet, onToken, onDetails, onClose }: {
  room: RemoteRoom; seat: number; zone: ZoneKey; at: PopAt; deck: number[]; targetRef?: string; initialFaceUp?: boolean;
  busy: boolean; error: string; startPicker?: boolean; onPick(pick: ZonePick): void; onAction(action: ZoneCardAction): void;
  onSet(): void; onToken(): void; onDetails(card: TwinCard): void; onClose(): void;
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
  if (pick && (!card || topChanged)) return <PopupFrame at={at} layer="zone" label="Zone changed" testid="zone-changed-error"><p role="alert">This zone changed. Close and open it again.</p><button type="button" className={s.btn} onClick={onClose}>Close</button></PopupFrame>;
  if (pick && card) {
    const summon = fieldSummonKind(info(pick.cardId));
    const usable = twins.filter(c => !c.token && c.ref !== pick.fromRef && ['monster','extra-monster'].includes(c.zone));
    return <PopupFrame at={at} layer="zone" label="Put a card on top" testid="zone-top-actions" className={s.zonePicker}>
      <header><strong>{pick.name} on top</strong></header>
      <p>Choose what happens to the card(s) here.</p>
      {summon ? <fieldset disabled={busy}><legend>Summon materials</legend>{usable.map(c => <label key={c.ref}>
        <input type="checkbox" checked={materials.includes(c.ref)} disabled={c.ref === card.ref} onChange={e => setMaterials(before => e.target.checked ? [...before, c.ref] : before.filter(ref => ref !== c.ref))} />
        {c.name ?? info(cardCode(c))?.name ?? 'Face-down card'} · {c.zone} {c.slot}
      </label>)}</fieldset> : <p>Summon needs an Xyz, Synchro, Fusion or Link Monster.</p>}
      <p>{summon?.kind === 'xyz' ? 'Materials stay under the top card, including materials already attached.' : 'Summon materials go to the Graveyard.'}</p>
      <button type="button" className={s.btn} disabled={busy || !summon} onClick={() => onPick({ ...pick, faceUp: true, top: { ref: card.ref, kind: 'summon', materialRefs: materials } })}>Summon using the card(s) here as material</button>
      <button type="button" className={s.btn} disabled={busy} onClick={() => onPick({ ...pick, faceUp: true, top: { ref: card.ref, kind: 'replace' } })}>Replace (old card to GY)</button>
      {error ? <p role="alert">{error}</p> : null}
      <button type="button" className={s.btn} disabled={busy} onClick={() => setPick(null)}>Back</button>
      <button type="button" className={s.btn} disabled={busy} onClick={onClose}>Close</button>
    </PopupFrame>;
  }
  if (mode !== 'actions') return <ZoneCardPicker seat={seat} zone={zone} at={at} deck={deck} recent={recentReadsFor(room, seat)} twin={twins}
    targetRef={mode === 'flip' ? topRef : mode === 'place' ? targetRef : undefined} initialFaceUp={mode === 'flip' || mode === 'top' ? true : initialFaceUp}
    allowFaceDown={mode !== 'flip' && mode !== 'top'} excludeRef={mode === 'top' ? card?.ref : undefined}
    busy={busy} error={error} onClose={onClose} onPick={chosen => { if (mode === 'top') { setPick(chosen); setMaterials(card ? [card.ref] : []); } else onPick(chosen); }} />;
  return <PopupFrame at={at} layer="zone" label={`Actions in ${ZN[zone]}`} className={s.zonePicker} testid="zone-actions">
    <header><strong>{ZN[zone]}</strong></header>
    {card ? <>
      {!card.token ? <button type="button" className={s.btn} disabled={busy} onClick={() => { setTopRef(card.ref); setMode('top'); }}>Put a card on top</button> : null}
      {!card.faceUp && !card.token ? <button type="button" className={s.btn} disabled={busy} onClick={() => { setTopRef(card.ref); setMode('flip'); }}>Flip</button> : null}
      {card.faceUp && !card.token && /^[ms][1-5]$/.test(zone) ? <button type="button" className={s.btn} disabled={busy} onClick={() => action({type:'twin.flip',actorSeat,seat,cardRef:card.ref,faceUp:false,...(card.zone==='monster'?{position:'defense' as const}:{})})}>Set a card here</button> : null}
      {card.materials?.map(ref => {
        const material = twins.find(c => c.ref === ref);
        return <div role="group" aria-label={`Detach ${material?.name ?? 'material'}`} key={ref}>
          <span>{material?.name ?? 'Material'}</span>{(['graveyard', 'banished'] as const).map(destination => <button type="button" className={s.btn} key={destination} disabled={busy}
            onClick={() => action({ type: 'twin.detach', actorSeat, seat, cardRef: card.ref, materialRef: ref, zone: destination })}>Detach material to {destination === 'graveyard' ? 'GY' : 'banished'}</button>)}
        </div>;
      })}
      <button type="button" className={s.btn} disabled={busy} onClick={() => onDetails(card)}>Card details</button>
    </> : <>
      <button type="button" className={s.btn} disabled={busy} onClick={() => setMode('place')}>Put a card here</button>
      {/^[ms][1-5]$/.test(zone) ? <button type="button" className={s.btn} disabled={busy} onClick={onSet}>Set a card here</button> : null}
    </>}
    <button type="button" className={s.btn} disabled={busy} onClick={onToken}>Add token</button>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" className={s.btn} disabled={busy} onClick={onClose}>Close</button>
  </PopupFrame>;
}
