import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
export type RecentRead = { cardId: number; name: string };
const reads = new Map<string, RecentRead[]>();
const keyOf = (room: RemoteRoom, seat: number) => `${room.guildId}:${room.slug}:${seat}`;
export const recentReadsFor = (room: RemoteRoom, seat: number): readonly RecentRead[] => reads.get(keyOf(room, seat)) ?? [];
/** Local owner only. Private deck choices never become an opponent's recent-read list. */
export function rememberRecentRead(room: RemoteRoom, action: RemoteActionProposal) {
  if (!('seat' in action) || !(room.solo || action.seat === room.mySeat)) return;
  const candidates = action.type === 'twin.place' ? [action.card] : action.type === 'card.identified' ? [action] : action.type === 'cards.identified' ? action.cards : [];
  for (const card of candidates) {
    if (!card.cardId || !card.name) continue;
    const key = keyOf(room, action.seat);
    reads.set(key, [{ cardId: card.cardId, name: card.name }, ...(reads.get(key) ?? []).filter(c => c.cardId !== card.cardId)].slice(0, 40));
  }
}
