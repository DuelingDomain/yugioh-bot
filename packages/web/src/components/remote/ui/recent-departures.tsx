'use client';
import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
import { FIELD_LEAVE_DESTINATIONS, fieldLeaveLabel } from '@/lib/remote/field-proposals';
import { playerStamp } from '@/lib/remote/field-timing';
import { cardCode, cardName } from './model';
import { cardInfo } from './catalog';
import s from './remote-ui.module.css';

/** The toast is a shortcut. These independent refs remain reachable in the owner's notices. */
export function RecentDepartures({ room, seat, onAction }: { room: RemoteRoom; seat: number; onAction(action: RemoteActionProposal): void }) {
  if (!(room.solo || seat === room.mySeat)) return null;
  const events = [...room.events].reverse().filter(e => e.action.type === 'twin.move' && e.action.seat === seat && e.action.source === 'auto' && e.action.cam?.by !== 'player' && ['hand','extra','graveyard','banished'].includes(e.action.zone));
  const seen = new Set<string>();
  const items = events.flatMap(e => {
    if (e.action.type !== 'twin.move' || seen.has(e.action.cardRef)) return [];
    seen.add(e.action.cardRef);
    const ref=e.action.cardRef,card = room.state.seats[seat]?.twin.find(c => c.ref === ref);
    return card ? [{ card, event: e }] : [];
  }).slice(0, 6);
  if (!items.length) return null;
  const live = room.status === 'active' && !room.state.ended && !room.state.seats[seat]?.eliminated;
  return <details className={s.departureHistory} data-testid="recent-departures"><summary>Recent departures ({items.length})</summary>
    {items.map(({ card, event }) => {
      const change = [...room.state.undoHistory??[]].sort((a,b)=>b.order-a.order).find(e => !e.undone && e.actorSeat === (room.solo ? seat : room.mySeat) && e.cards.includes(`${seat}:${card.ref}`));
      return <div key={event.id} role="group" aria-label={`Departure: ${cardName(card, cardInfo(cardCode(card)))}`}>
        <b>{cardName(card, cardInfo(cardCode(card)))}</b><span> → {fieldLeaveLabel(card.zone,card.faceUp)}</span>
        {FIELD_LEAVE_DESTINATIONS.map(d => <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} key={d.title} disabled={!live || !['hand','deck','extra','graveyard','banished'].includes(card.zone) || card.zone === d.zone && (d.zone !== 'banished' || card.faceUp === !('down' in d))} onClick={() => onAction({type:'twin.move',actorSeat:room.solo?seat:room.mySeat,seat,cardRef:card.ref,zone:d.zone,confirmed:true,cam:playerStamp('recent-departure'),...(d.zone === 'banished' ? {faceUp:!('down' in d)} : d.zone === 'graveyard' ? {faceUp:true} : d.zone === 'extra'&&card.faceUp&&/pendulum/i.test(cardInfo(cardCode(card))?.type??'')?{faceUp:true,pendulum:true}:d.zone === 'deck' || d.zone === 'extra' ? {faceUp:false} : {})})}>{d.title}</button>)}
        <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} disabled={!live || !change || !!change.reason} title={change?.reason} onClick={() => { if (change) onAction({type:'undo',actorSeat:room.solo?seat:room.mySeat,targetActionId:change.actionId,cam:playerStamp('recent-departure-undo')}); }}>Undo</button>
      </div>;
    })}
  </details>;
}
