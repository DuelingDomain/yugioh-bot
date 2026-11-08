import { remotePublicCard, type RemoteRoom } from '@yugidraft/shared/remote';
import { VoicePrior } from '@yugidraft/vision';
const cardCode = (card: {cardId?:number;passcode?:number}) => card.cardId ?? card.passcode;

export type Priors = { decklist: number[]; seen: number[]; context?: number[]; scope?: string };
const voice = new VoicePrior();
const scopeFor = (room: RemoteRoom, seat: number) => `${room.slug}:${room.state.match.games?.length ?? 0}:${seat}`;
/** Public hook for a resolved voice intent. Each hint expires after ten seconds. */
export function mentionVoiceCard(room: RemoteRoom, seat: number, passcode: number, heardAt = Date.now()): void {
  voice.mention(scopeFor(room, seat), passcode, heardAt, Date.now());
}
export const voiceHintFor = (scope?: string) => ({ cards: scope ? voice.current(scope) : [], expiresAt: scope ? voice.expiresAt(scope) : undefined });

/** Derive knowledge from one seat and one game; hidden zones do not seed related cards. */
export function recognitionPriorsFor(room: RemoteRoom, seat: number): Priors {
  const publicCard = (c: {zone?:string;faceUp?:boolean;publicIdentity?:boolean}) => c.zone !== 'hand' && remotePublicCard(c);
  const twins = room.state.seats.find(s => s.seat === seat)?.twin ?? [];
  const publicCards = twins.filter(publicCard);
  const board = publicCards.flatMap(c => cardCode(c) ? [cardCode(c)!] : []);
  const byRef = new Map(twins.map(c => [c.ref, c]));
  const undone = new Set(room.state.undoHistory?.filter(h => h.undone).map(h => h.actionId));
  const events = room.events ?? [];
  let start = -1;
  for(let i=events.length-1;i>=0;i--) if(events[i].action.type==='match.first'||events[i].action.type==='table.started'){start=i;break;}
  const previousGameEndedAt = room.state.match.games?.at(-1)?.endedAt;
  const history = events.slice(Math.max(0, start + 1)).filter(e => !undone.has(e.id)
    && (previousGameEndedAt === undefined || e.at > previousGameEndedAt));
  // A card from an opponent's Graveyard or field can end up on my side (Monster Reborn, Change of Heart), so what they show is a prior too.
  const opposing = room.state.seats.filter(s => s.seat !== seat && !s.eliminated).flatMap(s => s.twin.filter(c => c.zone !== 'hand' && c.zone !== 'deck' && c.zone !== 'extra' && publicCard(c)).flatMap(c => cardCode(c) ? [cardCode(c)!] : []));
  const recent: number[] = [], seen = new Set([...board, ...opposing]);
  for (const event of history) {
    const a = event.action;
    const owner = 'seat' in a ? a.seat : event.actorSeat;
    if (owner !== seat) continue;
    const ids: number[] = [];
    const add = (c: { cardId?: number; passcode?: number }) => { const id = cardCode(c); if (id) ids.push(id); };
    const publicIdentification = (c: {cardRef?:string;zone?:string}) => c.cardRef
      ? !!byRef.get(c.cardRef) && publicCard(byRef.get(c.cardRef)!)
      : c.zone === undefined || publicCard({zone:c.zone,faceUp:true});
    if (a.type === 'twin.place' && publicCard({...a.card,zone:a.zone})) add(a.card);
    if (a.type === 'card.identified' && publicIdentification(a)) add(a);
    if (a.type === 'cards.identified') for (const c of a.cards) if (publicIdentification(c)) add(c);
    if (a.type === 'effect.activated') add(a.source);
    if (a.type === 'twin.flip' && a.faceUp) add(a);
    if (a.type === 'twin.move') {
      const c = byRef.get(a.cardRef); if (c && publicCard(c)) add(c);
    }
    for (const id of ids) { seen.add(id); recent.push(id); }
  }
  const deck=room.seats.find(s=>s.seat===seat)?.deck?.deck;
  return { decklist: deck?[...deck.main,...deck.extra,...deck.side]:[], seen: [...seen].slice(-512),
    context: [...new Set([...board, ...recent.slice(-24), ...opposing.slice(-16)])].slice(0, 64), scope: scopeFor(room, seat) };
}
