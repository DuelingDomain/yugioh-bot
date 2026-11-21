import { useSyncExternalStore } from 'react';
import { ZONE_PREVIEW_TTL_MS, createPreviewBoard, decodePreview, encodePreview, previewForZone, type PreviewKind, type ZonePreview } from '@yugidraft/vision';
import type { RemoteActionProposal, RemoteRoom, TwinCard } from '@yugidraft/shared/remote';

/**
 * Peer preview ("speed route 4"). When my client queues a board change it also sends a tiny preview on the table data channel, so the
 * opponent and the spectators see the change in about 100 ms instead of waiting for the server write and broadcast.
 *
 * The server stays the truth. A preview is display only: it never reaches the reducer, the log, undo, LP or any rule. The server event
 * that carries the same idempotency key replaces it; with no such event in about 3 s the preview rolls back without a trace.
 *
 * Privacy (same rule as spectator projection in shared/remote/privacy.ts): only a card that is face up in a field zone may name itself.
 * A face-down card carries no id, no name and no ref. A hand, deck or Extra Deck card never gets a preview. The receiver takes the
 * seat from the data packet's sender identity, never from the payload, so only the owner of a seat can preview on it.
 */
export const PEER_PREVIEW_TOPIC = 'remote.board.preview.v1';
export const PEER_PREVIEW_STORAGE_KEY = 'dd-peer-preview';
/** One seat may send or be heard at most this many previews per second. A full board in one scan is far below it. */
export const PEER_PREVIEW_RATE = 30;

/** On by default. Kill switches: NEXT_PUBLIC_REMOTE_PEER_PREVIEW=0 (build) or localStorage dd-peer-preview=0 (one browser). */
export const peerPreviewEnabled = (): boolean => {
  if (process.env.NEXT_PUBLIC_REMOTE_PEER_PREVIEW === '0') return false;
  try { return !(typeof localStorage !== 'undefined' && localStorage.getItem(PEER_PREVIEW_STORAGE_KEY) === '0'); } catch { return true; }
};

/** The camera zone names of zone-peer, and back to the table zone. Pendulum, piles and the hand have no preview. */
const camZone = (zone: string, slot: number | undefined): string | null => {
  if (zone === 'field') return 'FIELD';
  if (slot === undefined || !Number.isInteger(slot) || slot < 1 || slot > 5) return null;
  if (zone === 'monster') return `M${slot}`;
  if (zone === 'spell-trap') return `S${slot}`;
  if (zone === 'extra-monster' && slot <= 2) return `EMZ${slot}`;
  return null;
};
const tableZone = (zone: string): { zone: string; slot?: number } | null => {
  if (zone === 'FIELD') return { zone: 'field' };
  const n = Number(zone.at(-1));
  if (/^M[1-5]$/.test(zone)) return { zone: 'monster', slot: n };
  if (/^S[1-5]$/.test(zone)) return { zone: 'spell-trap', slot: n };
  if (/^EMZ[1-2]$/.test(zone)) return { zone: 'extra-monster', slot: n };
  return null;
};
const sideways = (zone: string) => zone === 'monster' || zone === 'extra-monster';
const kindOf = (zone: string, faceUp: boolean, position: string | undefined): PreviewKind =>
  sideways(zone) && position === 'defense' ? (faceUp ? 'sideways-up' : 'sideways-down') : faceUp ? 'face-up' : 'face-down';

export interface PreviewDraft { zone: string; kind: PreviewKind; face?: { cardId: number; name?: string } }

/** What one queued proposal looks like to the table. Empty for anything that is not a visible change of one of my own field cells. */
export function previewDrafts(room: RemoteRoom, proposal: RemoteActionProposal): PreviewDraft[] {
  if (!('seat' in proposal) || proposal.seat !== room.mySeat || room.mySeat < 0) return [];
  const mine = room.state.seats[room.mySeat]?.twin ?? [];
  const drafts: PreviewDraft[] = [];
  const old = (card: TwinCard) => { const zone = camZone(card.zone, card.slot); if (zone) drafts.push({ zone, kind: 'empty' }); };
  const idOf = (card: { cardId?: number; passcode?: number }) => card.cardId ?? card.passcode;
  const show = (zone: string, slot: number | undefined, faceUp: boolean, position: string | undefined, id: number | undefined, name: string | undefined) => {
    const cam = camZone(zone, slot); if (!cam) return;
    // Identity only for a face-up card: the previewForZone filter drops anything passed for a card that lies face down.
    drafts.push({ zone: cam, kind: kindOf(zone, faceUp, position), ...(faceUp && id ? { face: { cardId: id, ...(name ? { name } : {}) } } : {}) });
  };
  switch (proposal.type) {
    case 'twin.place': {
      const card = proposal.card;
      if (card.token) return [];
      show(proposal.zone, card.slot, card.faceUp !== false, card.position, idOf(card), card.name);
      break;
    }
    case 'twin.move': {
      const card = mine.find(item => item.ref === proposal.cardRef);
      if (!card) return [];
      const faceUp = proposal.faceUp ?? card.faceUp;
      const slot = proposal.slot ?? (proposal.zone === card.zone ? card.slot : undefined);
      // A card leaves its old cell, unless it lands in the same one.
      if (camZone(card.zone, card.slot) !== camZone(proposal.zone, slot)) old(card);
      // A card that leaves the Monster Zones turns back to Attack (leavePosition in the board model).
      show(proposal.zone, slot, faceUp, proposal.position ?? (sideways(proposal.zone) ? card.position : 'attack'), idOf(card), proposal.name ?? card.name);
      break;
    }
    case 'twin.flip': {
      const card = mine.find(item => item.ref === proposal.cardRef);
      if (!card) return [];
      show(card.zone, card.slot, proposal.faceUp, proposal.position ?? card.position, proposal.cardId ?? idOf(card), proposal.name ?? card.name);
      break;
    }
    case 'twin.remove': {
      const card = mine.find(item => item.ref === proposal.cardRef);
      if (card) old(card);
      break;
    }
    default: return [];
  }
  return drafts;
}

/** The encoded packets for one queued proposal. */
export function previewPackets(room: RemoteRoom, proposal: RemoteActionProposal, key: string, nextSeq: () => number): Uint8Array<ArrayBuffer>[] {
  const packets: Uint8Array<ArrayBuffer>[] = [];
  for (const draft of previewDrafts(room, proposal)) {
    const preview = previewForZone(room.mySeat, nextSeq(), draft.zone, draft.kind, draft.face, key);
    if (preview) packets.push(encodePreview(preview));
  }
  return packets;
}

type Send = (bytes: Uint8Array<ArrayBuffer>) => void;
let transport: Send | null = null;
let seq = 0;
let sent: number[] = [];
/** The table video connection registers how bytes go out (reliable, topic above) while it is connected, and clears it on disconnect. */
export function setPeerPreviewTransport(send: Send): void { transport = send; }
/** Only the connection that set the transport can clear it (a newer connection keeps its own). */
export function releasePeerPreviewTransport(send: Send): void { if (transport === send) transport = null; }

/**
 * My own client: the mutation queue calls this the moment a write is queued, before the server answers.
 * The sequence is time based, so a reload of this tab never sends lower numbers than the receivers already hold.
 */
export function publishPeerPreview(room: RemoteRoom | undefined, proposal: RemoteActionProposal, key: string, now = Date.now()): number {
  if (!room || !transport || !peerPreviewEnabled()) return 0;
  try {
    const packets = previewPackets(room, proposal, key, () => (seq = Math.max(seq + 1, now)));
    sent = sent.filter(at => now - at < 1000);
    let count = 0;
    for (const bytes of packets) {
      if (sent.length >= PEER_PREVIEW_RATE) break;
      sent.push(now); transport(bytes); count++;
    }
    return count;
  } catch { return 0; }
}

/** What a receiver shows for one preview on the seat's board. */
export interface PreviewCard { ref: string; zone: string; slot?: number; faceUp: boolean; position: 'attack' | 'defense'; cardId?: number; name?: string; key?: string; /** The cell is empty on the sender's table: a card left it. */ gone?: boolean }
export const previewCardRef = (preview: ZonePreview) => `pv-${preview.key ?? `${preview.seq}`}-${preview.zone}`;

export interface PeerPreviewDiag { stage: 'previewReceived' | 'serverEvent' | 'previewRolledBack'; key?: string; at: number; seat: number; zone?: string; commitAt?: number }

export function createPeerPreviewStore(options: { ttlMs?: number; now?: () => number; enabled?: () => boolean; diag?: (d: PeerPreviewDiag) => void } = {}) {
  const now = options.now ?? (() => Date.now());
  const enabled = options.enabled ?? peerPreviewEnabled;
  const fresh = () => createPreviewBoard({ ttlMs: options.ttlMs ?? ZONE_PREVIEW_TTL_MS });
  let board = fresh();
  const listeners = new Set<() => void>();
  const heard = new Map<number, number[]>();
  const stamps = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mine: number | undefined;
  let snapshot: readonly ZonePreview[] = [];
  const publish = () => { snapshot = board.view(); for (const listener of listeners) listener(); };
  const sweep = () => {
    timer = undefined;
    const dropped = board.expire(now());
    for (const preview of dropped) options.diag?.({ stage: 'previewRolledBack', key: preview.key, at: now(), seat: preview.seat, zone: preview.zone });
    if (dropped.length) publish();
    if (snapshot.length) timer = setTimeout(sweep, 250);
  };
  return {
    /**
     * A data packet. `senderSeat` is the seat of the SFU-bound sender identity (never the payload). Returns true when the preview is now shown.
     * Dropped: kill switch, a packet that is not from the owner of its seat, an echo of my own seat, a bad or old packet, a sender over the rate cap.
     */
    receive(bytes: Uint8Array, senderSeat: number | undefined): boolean {
      if (!enabled() || senderSeat === undefined || senderSeat === mine) return false;
      const preview = decodePreview(bytes, senderSeat);
      if (!preview) return false;
      const at = now(), recent = (heard.get(senderSeat) ?? []).filter(time => at - time < 1000);
      if (recent.length >= PEER_PREVIEW_RATE) { heard.set(senderSeat, recent); return false; }
      recent.push(at); heard.set(senderSeat, recent);
      if (!board.apply(preview, at)) return false;
      if (preview.key) stamps.set(preview.key, at);
      if (stamps.size > 128) stamps.delete(stamps.keys().next().value as string);
      options.diag?.({ stage: 'previewReceived', key: preview.key, at, seat: preview.seat, zone: preview.zone });
      publish();
      if (timer === undefined) timer = setTimeout(sweep, 250);
      return true;
    },
    /** A server event with this idempotency key arrived: the real board replaces the preview. */
    confirm(key: string, commitAt?: number): void {
      const done = board.confirmKey(key);
      if (stamps.has(key)) { options.diag?.({ stage: 'serverEvent', key, at: now(), seat: done[0]?.seat ?? -1, commitAt }); stamps.delete(key); }
      if (done.length) publish();
    },
    /** My own seat: previews of it are never shown. */
    setMySeat(seat: number | undefined) { mine = seat; },
    clear() { if (timer) clearTimeout(timer); timer = undefined; stamps.clear(); heard.clear(); board = fresh(); publish(); },
    sweep,
    /** The previews of one seat as cards for the board. */
    cardsOf(seat: number): readonly PreviewCard[] { return cardsOf(snapshot, seat); },
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

const EMPTY_CARDS: readonly PreviewCard[] = [];
const cache = new WeakMap<readonly ZonePreview[], Map<number, readonly PreviewCard[]>>();
function cardsOf(previews: readonly ZonePreview[], seat: number): readonly PreviewCard[] {
  let bySeat = cache.get(previews);
  if (!bySeat) cache.set(previews, bySeat = new Map());
  const held = bySeat.get(seat); if (held) return held;
  const cards: PreviewCard[] = [];
  for (const preview of previews) {
    if (preview.seat !== seat) continue;
    const where = tableZone(preview.zone); if (!where) continue;
    const up = preview.kind === 'face-up' || preview.kind === 'sideways-up';
    cards.push({ ref: previewCardRef(preview), ...where, faceUp: up, position: preview.kind.startsWith('sideways') ? 'defense' : 'attack', ...(up && preview.cardId ? { cardId: preview.cardId } : {}), ...(up && preview.name ? { name: preview.name } : {}), ...(preview.key ? { key: preview.key } : {}), ...(preview.kind === 'empty' ? { gone: true } : {}) });
  }
  const out = cards.length ? cards : EMPTY_CARDS;
  bySeat.set(seat, out);
  return out;
}

/** Diagnostics only (same switch as the other peer stamps: sessionStorage remote-peer-latency=1). The event pairs a preview with its server event by key. */
function emitDiag(diag: PeerPreviewDiag): void {
  try {
    if (typeof window === 'undefined' || sessionStorage.getItem('remote-peer-latency') !== '1') return;
    window.dispatchEvent(new CustomEvent('remote-peer-latency', { detail: { ...diag, at: performance.timeOrigin + performance.now() } }));
  } catch { /* Optional diagnostics. */ }
}

/** The one store of this browser. The table video connection feeds it, the room hook confirms from server events, the board reads it. */
export const peerPreviews = createPeerPreviewStore({ diag: emitDiag });

/** The previews waiting on one seat's board. Stable between changes, so a steady table causes no render. */
export function usePeerPreviewCards(seat: number): readonly PreviewCard[] {
  return useSyncExternalStore(peerPreviews.subscribe, () => peerPreviews.cardsOf(seat), () => EMPTY_CARDS);
}

/** The board a seat shows while previews wait: a cell with a preview drops the real card that sat there, and the preview card takes its place. */
export function boardWithPreviews<T extends { ref: string; zone: string; slot?: number }>(twin: readonly T[], previews: readonly PreviewCard[]): { base: readonly T[]; ghosts: readonly PreviewCard[] } {
  if (!previews.length) return { base: twin, ghosts: previews };
  const at = (card: { zone: string; slot?: number }) => previews.some(p => p.zone === card.zone && (p.zone === 'field' || p.slot === card.slot));
  return { base: twin.filter(card => !at(card)), ghosts: previews.filter(p => !p.gone) };
}
