import { useSyncExternalStore } from 'react';
import { ZONE_PREVIEW_TTL_MS, decodePreview, encodePreview, previewForZone, type PreviewKind, type ZonePreview } from '@yugidraft/vision';
import type { RemoteActionProposal, RemoteEvent, RemoteRoom, TwinCard } from '@yugidraft/shared/remote';
import { isFieldSpell } from './field-legality';

/**
 * When my client posts a board change it also sends a tiny preview on the table data channel, so the
 * opponent and the spectators see the change in about 100 ms instead of waiting for the server write and broadcast.
 *
 * The server stays the truth. A preview is display only: it never reaches the reducer, the log, undo, LP or any rule. The server event
 * that confirms the key or touches the same cell replaces it. Each cell has 3 s from the first unconfirmed preview.
 *
 * A card that is face up on a field cell after the write is public (the camera shows it to the whole table), so its identity travels
 * with the preview and the opponent never sees a card back flip. Anything face down, of unknown face, or not on the field stays anonymous.
 * The receiver takes the seat from the data packet's sender identity, never from the payload, so only the owner of a seat can preview on it.
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

export interface PreviewDraft { zone: string; kind: PreviewKind; face?: { cardId: number; name?: string } }

/** The card facts the Field Spell redirect needs. The table screen registers its catalog lookup, so lib/ never imports from components/. */
type CardFacts = NonNullable<Parameters<typeof isFieldSpell>[0]>;
let cardFacts: (code: number | undefined) => CardFacts | undefined = () => undefined;
export function setPeerPreviewCardFacts(lookup: (code: number | undefined) => CardFacts | undefined): void { cardFacts = lookup; }

const redirectableZones = new Set(['monster', 'spell-trap', 'extra-monster', 'pendulum']);

/** Match the server's Field Spell redirection, or omit the preview while the card's type is unresolved. */
function fieldSpellDestination(zone: string, card: { cardId?: number; passcode?: number; name?: string }): string | undefined {
  if (!redirectableZones.has(zone)) return zone;
  const code = card.cardId ?? card.passcode;
  if (!code && !card.name) return zone;
  const facts = cardFacts(code);
  if (!facts) return undefined;
  if (isFieldSpell(facts)) return 'field';
  if (/\bspell\b/i.test(facts.type ?? "") && !facts.race?.trim()) return undefined;
  return zone;
}

/** What one posted proposal looks like to the table. Only the sender's field cells get a preview. */
export function previewDrafts(room: RemoteRoom, proposal: RemoteActionProposal): PreviewDraft[] {
  if (!('seat' in proposal) || proposal.seat !== room.mySeat || proposal.actorSeat !== room.mySeat || room.mySeat < 0) return [];
  const mine = room.state.seats[room.mySeat]?.twin ?? [];
  const target = (ref: string, source: string | undefined) => mine.find(card =>
    card.ref === ref && (source !== 'auto' || (!card.token && card.ownerSeat === undefined)));
  /**
   * `face` is given only when the card is face up after the write and that face is already public: it was face up before, the camera
   * saw it (source auto), or it is the card of a placement. Anything else is anonymous and shows as a card back.
   */
  const show = (zone: string | undefined, slot: number | undefined, position: string | undefined, face?: { cardId: number | undefined; name?: string }): PreviewDraft | undefined => {
    if (!zone) return undefined;
    const cam = camZone(zone, slot);
    if (!cam) return undefined;
    const cardId = face?.cardId;
    const open = cardId !== undefined && cardId > 0;
    const down = sideways(zone) && position === 'defense';
    const kind: PreviewKind = open ? (down ? 'sideways-up' : 'face-up') : (down ? 'sideways-down' : 'face-down');
    return { zone: cam, kind, ...(open ? { face: { cardId, ...(face?.name ? { name: face.name } : {}) } } : {}) };
  };
  const idOf = (card: { cardId?: number; passcode?: number }) => card.cardId ?? card.passcode;
  const move = (card: TwinCard, destination: PreviewDraft | undefined): PreviewDraft[] => {
    if (!destination) return [];
    const from = camZone(card.zone, card.slot);
    return from && from !== destination.zone ? [destination, { zone: from, kind: 'empty' }] : [destination];
  };
  switch (proposal.type) {
    case 'twin.place': {
      const card = proposal.card;
      if (card.token) return [];
      const face = card.faceUp === true ? { cardId: idOf(card), name: card.name } : undefined;
      const destination = show(fieldSpellDestination(proposal.zone, card), card.slot, card.position, face);
      return destination ? [destination] : [];
    }
    case 'twin.move': {
      const card = target(proposal.cardRef, proposal.source);
      if (!card) return [];
      const slot = proposal.slot ?? (proposal.zone === card.zone ? card.slot : undefined);
      const redirects = proposal.source === 'auto' && (proposal.faceUp ?? card.faceUp);
      const zone = redirects ? fieldSpellDestination(proposal.zone, card) : proposal.zone;
      const faceUp = (proposal.faceUp ?? card.faceUp) === true;
      const face = faceUp && (card.faceUp === true || proposal.source === 'auto') ? { cardId: idOf(card), name: proposal.name ?? card.name } : undefined;
      return move(card, show(zone, slot, proposal.position ?? card.position, face));
    }
    case 'twin.flip': {
      const card = target(proposal.cardRef, proposal.source);
      if (!card) return [];
      const zone = proposal.faceUp && !card.faceUp ? fieldSpellDestination(card.zone, proposal.cardId ? proposal : card) : card.zone;
      const face = proposal.faceUp && (card.faceUp === true || proposal.source === 'auto')
        ? { cardId: proposal.cardId ?? idOf(card), name: proposal.name ?? card.name } : undefined;
      return move(card, show(zone, card.slot, proposal.position ?? card.position, face));
    }
    case 'twin.remove': {
      const card = target(proposal.cardRef, proposal.source);
      const zone = card && camZone(card.zone, card.slot);
      return zone ? [{ zone, kind: 'empty' }] : [];
    }
    default: return [];
  }
}

/** The encoded packets for one posted proposal. */
export function previewPackets(room: RemoteRoom, proposal: RemoteActionProposal, key: string, nextSeq: () => number): Uint8Array<ArrayBuffer>[] {
  const packets: Uint8Array<ArrayBuffer>[] = [];
  for (const draft of previewDrafts(room, proposal)) {
    // One bad draft (an oversize name, say) must not drop the others.
    try {
      const preview = previewForZone(room.mySeat, nextSeq(), draft.zone, draft.kind, draft.face, key);
      if (preview) packets.push(encodePreview(preview));
    } catch { /* Skip this cell only. */ }
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
 * My own client: the mutation queue calls this once per write as soon as it passes the local checks, before the POST.
 * The sequence is time based, so a reload of this tab never sends lower numbers than the receivers already hold.
 */
export function publishPeerPreview(room: RemoteRoom | undefined, proposal: RemoteActionProposal, key: string, now = Date.now()): number {
  if (!room || !transport || !peerPreviewEnabled()) return 0;
  try {
    const packets = previewPackets(room, proposal, key, () => (seq = Math.max(seq + 1, now)));
    sent = sent.filter(at => now - at < 1000);
    if (sent.length + packets.length > PEER_PREVIEW_RATE) return 0;
    for (const bytes of packets) {
      sent.push(now);
      transport(bytes);
    }
    return packets.length;
  } catch { return 0; }
}

/** What a receiver shows for one preview on the seat's board. */
export interface PreviewCard { ref: string; zone: string; slot?: number; faceUp: boolean; position: 'attack' | 'defense'; cardId?: number; name?: string; key?: string; /** The cell is empty on the sender's table: a card left it. */ gone?: boolean }
export const previewCardRef = (preview: ZonePreview) => `pv-${preview.key ?? `${preview.seq}`}-${preview.zone}`;

export interface PeerPreviewDiag { stage: 'previewReceived' | 'serverEvent' | 'previewRolledBack'; key?: string; at: number; seat: number; zone?: string; commitAt?: number }

const cellKey = (seat: number, zone: string) => `${seat}:${zone}`;
const spectatorAlias = (value: unknown): value is string => typeof value === 'string' && /^private-card-\d+$/.test(value);
// Spectator refs are allocated anew in each snapshot. Compare their card contents without those aliases.
const withoutSpectatorAliases = (_key: string, value: unknown) => spectatorAlias(value) ? '' : value;

/** Compare the authoritative cards in a cell, including materials attached to its occupant. */
function cellContents(room: RemoteRoom, seat: number, zone: string): string {
  const twin = room.state.seats[seat]?.twin ?? [];
  const occupants = twin.filter(card => camZone(card.zone, card.slot) === zone);
  const materials = twin.filter(card => card.materialOf && occupants.some(host => host.ref === card.materialOf));
  return JSON.stringify([...occupants, ...materials], room.spectator ? withoutSpectatorAliases : undefined);
}

/** Explicit action locations also catch writes that leave the same contents or are batched into one room update. */
function eventCells(events: readonly RemoteEvent[], room: RemoteRoom, previous: RemoteRoom | undefined): Set<string> {
  const cells = new Set<string>();
  const add = (seat: number, zone: string, slot?: number) => {
    const cell = camZone(zone, slot);
    if (cell) cells.add(cellKey(seat, cell));
  };
  const byRef = (seat: number, ref: string) => {
    for (const board of [previous, room]) {
      if (board === previous && room.spectator && spectatorAlias(ref)) continue;
      const twin = board?.state.seats[seat]?.twin;
      const card = twin?.find(item => item.ref === ref);
      const host = card?.materialOf ? twin?.find(item => item.ref === card.materialOf) : card;
      if (host) add(seat, host.zone, host.slot);
    }
  };
  const twinAt = (seat: number, ref: string) => room.state.seats[seat]?.twin.find(card => card.ref === ref);
  const mark = (action: RemoteEvent['action']) => {
    if ('seat' in action && 'cardRef' in action && action.cardRef) byRef(action.seat, action.cardRef);
    if (action.type === 'twin.place') {
      if (twinAt(action.seat, action.card.ref)?.zone !== 'field') add(action.seat, action.zone, action.card.slot);
      byRef(action.seat, action.card.ref);
      if (action.fromRef) byRef(action.seat, action.fromRef);
      for (const ref of action.summon?.materialRefs ?? []) byRef(action.seat, ref);
    } else if (action.type === 'twin.control' || action.type === 'twin.move') {
      const seat = action.type === 'twin.control' ? action.toSeat : action.seat;
      const redirected = action.type === 'twin.move' && action.source === 'auto' && twinAt(seat, action.cardRef)?.zone === 'field';
      if (!redirected) add(seat, action.zone, action.slot);
      if (action.type === 'twin.control') byRef(seat, action.cardRef);
    } else if (action.type === 'twin.attach') {
      for (const ref of action.materialRefs) byRef(action.materialSeat ?? action.seat, ref);
    } else if (action.type === 'monsters.tribute') {
      for (const target of action.targets) byRef(target.seat, target.cardRef);
    } else if (action.type === 'card.identified' || action.type === 'cards.identified') {
      for (const sight of action.type === 'card.identified' ? [action] : action.cards) {
        if (sight.zone) add(action.seat, sight.zone, sight.slot);
        if (sight.cardRef) byRef(action.seat, sight.cardRef);
      }
    }
  };
  for (const { action } of events) {
    if (action.type === 'undo') {
      const original = room.events.find(event => 'idempotencyKey' in event.action && event.action.idempotencyKey === action.targetActionId);
      if (original) mark(original.action);
    } else mark(action);
  }
  return cells;
}

type PreviewChain = {
  seat: number;
  zone: string;
  seq: number;
  // Keep this after rollback. A server event must end the chain before a packet can start a new one.
  pending?: { key: string; until: number; preview?: ZonePreview };
};

export function createPeerPreviewStore(options: { ttlMs?: number; now?: () => number; enabled?: () => boolean; diag?: (d: PeerPreviewDiag) => void } = {}) {
  const now = options.now ?? (() => performance.now());
  const enabled = options.enabled ?? peerPreviewEnabled;
  const ttlMs = options.ttlMs ?? ZONE_PREVIEW_TTL_MS;
  const chains = new Map<string, PreviewChain>();
  const confirmed = new Set<string>();
  const listeners = new Set<() => void>();
  const heard = new Map<number, number[]>();
  const stamps = new Map<string, number>();
  const cardsBySeat = new Map<number, { snapshot: readonly ZonePreview[]; cards: readonly PreviewCard[] }>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextSweep = Infinity;
  let mine: number | undefined;
  let room: RemoteRoom | undefined;
  let snapshot: readonly ZonePreview[] = [];
  const publish = () => {
    snapshot = [...chains.values()].flatMap(chain => chain.pending?.preview ? [chain.pending.preview] : []);
    for (const listener of listeners) listener();
  };
  const sweep = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    nextSweep = Infinity;
    const at = now();
    let changed = false;
    for (const { pending } of chains.values()) {
      if (!pending?.preview) continue;
      if (at < pending.until) {
        nextSweep = Math.min(nextSweep, pending.until);
        continue;
      }
      const { seat, zone } = pending.preview;
      delete pending.preview;
      changed = true;
      options.diag?.({ stage: 'previewRolledBack', key: pending.key, at, seat, zone });
    }
    if (nextSweep !== Infinity) timer = setTimeout(sweep, nextSweep - at);
    if (changed) publish();
  };
  const confirmKey = (key: string, commitAt?: number): boolean => {
    confirmed.delete(key);
    confirmed.add(key);
    if (confirmed.size > 64) confirmed.delete(confirmed.values().next().value!);
    let changed = false;
    for (const chain of chains.values()) {
      if (chain.pending?.key !== key) continue;
      changed ||= !!chain.pending.preview;
      delete chain.pending;
    }
    const seat = stamps.get(key);
    if (seat !== undefined) {
      options.diag?.({ stage: 'serverEvent', key, at: now(), seat, commitAt });
      stamps.delete(key);
    }
    return changed;
  };
  return {
    /**
     * A data packet. `senderSeat` is the seat of the SFU-bound sender identity (never the payload). Returns true when the preview is now shown.
     * Dropped: kill switch, a packet that is not from the owner of its seat, an echo of my own seat, a bad or old packet, a sender over the rate cap.
     */
    receive(bytes: Uint8Array, senderSeat: number | undefined): boolean {
      if (!enabled() || senderSeat === undefined || senderSeat === mine) return false;
      const preview = decodePreview(bytes, senderSeat);
      if (!preview?.key || typeof preview.zone !== 'string' || !tableZone(preview.zone) ||
          !Number.isSafeInteger(preview.seq) || preview.seq < 0 || confirmed.has(preview.key)) return false;
      const at = now();
      if (at >= nextSweep) sweep();
      const recent = (heard.get(senderSeat) ?? []).filter(time => at - time < 1000);
      if (recent.length >= PEER_PREVIEW_RATE) { heard.set(senderSeat, recent); return false; }
      recent.push(at); heard.set(senderSeat, recent);
      const cell = cellKey(preview.seat, preview.zone);
      const chain = chains.get(cell);
      if (chain && (preview.seq < chain.seq || (preview.seq === chain.seq && !chain.pending?.preview))) return false;
      if (chain?.pending && at >= chain.pending.until) return false;
      const until = chain?.pending?.until ?? at + ttlMs;
      chains.set(cell, { seat: preview.seat, zone: preview.zone, seq: preview.seq, pending: { key: preview.key, until, preview } });
      if (until < nextSweep) {
        if (timer !== undefined) clearTimeout(timer);
        nextSweep = until;
        timer = setTimeout(sweep, until - at);
      }
      stamps.set(preview.key, preview.seat);
      if (stamps.size > 128) stamps.delete(stamps.keys().next().value!);
      options.diag?.({ stage: 'previewReceived', key: preview.key, at, seat: preview.seat, zone: preview.zone });
      publish();
      return true;
    },
    /** For every new server event, confirm its key and restore any affected cell to the authoritative board. */
    confirmRoom(next: RemoteRoom): void {
      if (room && next.lastSeq <= room.lastSeq) return;
      const previous = room;
      room = next;
      const events = (next.events ?? []).filter(event => event.seq > (previous?.lastSeq ?? 0));
      let changed = false;
      for (const { action, at } of events) {
        if ('idempotencyKey' in action && confirmKey(action.idempotencyKey, at)) changed = true;
      }
      // The first snapshot seeds confirmed keys. Later snapshots tell us which cells changed since that baseline.
      if (previous && [...chains.values()].some(chain => chain.pending)) {
        const touched = eventCells(events, next, previous);
        for (const [cell, chain] of chains) {
          if (!chain.pending) continue;
          const { seat, zone } = chain;
          if (!touched.has(cell) && cellContents(previous, seat, zone) === cellContents(next, seat, zone)) continue;
          changed ||= !!chain.pending.preview;
          delete chain.pending;
        }
      }
      if (changed) publish();
    },
    /** My own seat: previews of it are never shown. */
    setMySeat(seat: number | undefined) { mine = seat; },
    clear() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      nextSweep = Infinity;
      room = undefined;
      stamps.clear();
      heard.clear();
      chains.clear();
      confirmed.clear();
      cardsBySeat.clear();
      publish();
    },
    sweep,
    /** The previews of one seat as cards for the board. */
    cardsOf(seat: number): readonly PreviewCard[] {
      const previous = cardsBySeat.get(seat);
      if (previous?.snapshot === snapshot) return previous.cards;
      const cards = cardsOf(snapshot, seat);
      const held = previous?.cards;
      const next = held?.length === cards.length && cards.every((card, i) => sameCard(card, held[i])) ? held : cards;
      cardsBySeat.set(seat, { snapshot, cards: next });
      return next;
    },
    snapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

const EMPTY_CARDS: readonly PreviewCard[] = [];
const sameCard = (a: PreviewCard, b: PreviewCard) =>
  a.ref === b.ref && a.zone === b.zone && a.slot === b.slot && a.faceUp === b.faceUp &&
  a.position === b.position && a.cardId === b.cardId && a.name === b.name && a.gone === b.gone;
function cardsOf(previews: readonly ZonePreview[], seat: number): readonly PreviewCard[] {
  const cards: PreviewCard[] = [];
  for (const preview of previews) {
    if (preview.seat !== seat) continue;
    const where = tableZone(preview.zone); if (!where) continue;
    const up = preview.kind === 'face-up' || preview.kind === 'sideways-up';
    cards.push({ ref: previewCardRef(preview), ...where, faceUp: up, position: preview.kind.startsWith('sideways') ? 'defense' : 'attack', ...(up && preview.cardId ? { cardId: preview.cardId } : {}), ...(up && preview.name ? { name: preview.name } : {}), ...(preview.key ? { key: preview.key } : {}), ...(preview.kind === 'empty' ? { gone: true } : {}) });
  }
  return cards.length ? cards : EMPTY_CARDS;
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
