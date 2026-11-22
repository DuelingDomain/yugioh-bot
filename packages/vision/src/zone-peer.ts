/**
 * Peer preview of a settled zone (prototype, not wired into the app).
 *
 * The sender's zone watch settles a zone and the zone-state classifier names its state. The sender publishes one small
 * preview on the table data channel (LiveKit `publishData`, topic below) and writes the real board event to the server at
 * the same time. The server stays the source of truth: a preview is shown with a "pending" mark until the server event
 * for that zone arrives (confirm) or `ttlMs` passes (roll back). A preview never writes to the log.
 *
 * Privacy: the same rule as field tracks in video.ts. Only what the camera shows to the whole table may travel, and a face-down
 * card shows only that it is face down. A hand, an unknown picture, and anything about the sender's hand zone never leave the sender.
 */
import type { ZoneKind } from './zone-state';

export const ZONE_PREVIEW_TOPIC = 'remote.zone-preview.v1';
export const ZONE_PREVIEW_TTL_MS = 3000;
/** Zones that exist on the camera board. The hand is never a zone here. */
const BOARD_ZONE = /^(M[1-5]|S[1-5]|EMZ[1-2]|FIELD|PZ[LR])$/;

export type PreviewKind = 'empty' | 'face-up' | 'face-down' | 'sideways-up' | 'sideways-down';
export interface ZonePreview {
  v: 1;
  /** Sender seat. A receiver checks it against the seat of the data packet (the SFU sets the sender identity, so it is trusted like a seat). */
  seat: number;
  /** Counts up per sender; an older preview for a zone never replaces a newer one. */
  seq: number;
  zone: string;
  kind: PreviewKind;
  /** Only for a face-up kind: the name the embedder gave (may arrive in a second message with the same seq). */
  cardId?: number; name?: string;
  /** The idempotency key of the table action this preview shows. The server event with the same key confirms it. */
  key?: string;
}

/** The preview to send for a classified zone, or null when nothing may be sent. */
export function previewForZone(seat: number, seq: number, zone: string, state: ZoneKind, face?: { cardId: number; name?: string }, key?: string): ZonePreview | null {
  if (!BOARD_ZONE.test(zone)) return null;
  if (state === 'hand' || state === 'unknown') return null;
  const preview: ZonePreview = { v: 1, seat, seq, zone, kind: state };
  if (key !== undefined && key.length > 0 && key.length <= 100) preview.key = key;
  // Identity only for a card that lies face up. Whatever the caller passes for a hidden card is dropped here, by construction.
  if (face && (state === 'face-up' || state === 'sideways-up') && Number.isInteger(face.cardId) && face.cardId > 0) { preview.cardId = face.cardId; if (face.name) preview.name = face.name.slice(0, 120); }
  return preview;
}

export const encodePreview = (preview: ZonePreview) => new TextEncoder().encode(JSON.stringify(preview));

/** Parse and check a received packet. `senderSeat` is the seat of the packet sender, never a field of the packet. */
export function decodePreview(bytes: Uint8Array, senderSeat: number | undefined): ZonePreview | null {
  if (senderSeat === undefined || bytes.byteLength > 512) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (value?.v !== 1 || value.seat !== senderSeat || !Number.isInteger(value.seq) || !BOARD_ZONE.test(value.zone)) return null;
    if (!['empty', 'face-up', 'face-down', 'sideways-up', 'sideways-down'].includes(value.kind)) return null;
    const hidden = value.kind.endsWith('down') || value.kind === 'empty';
    const out: ZonePreview = { v: 1, seat: value.seat, seq: value.seq, zone: value.zone, kind: value.kind };
    if (typeof value.key === 'string' && value.key.length > 0 && value.key.length <= 100) out.key = value.key;
    if (!hidden && Number.isInteger(value.cardId) && value.cardId > 0 && value.cardId <= 0xffffffff) { out.cardId = value.cardId; if (typeof value.name === 'string') out.name = value.name.slice(0, 120); }
    return out;
  } catch { return null; }
}

/** What a receiver shows on top of the server board: previews waiting for their server event. */
export function createPreviewBoard(options: { ttlMs?: number } = {}) {
  const ttlMs = options.ttlMs ?? ZONE_PREVIEW_TTL_MS;
  const pending = new Map<string, { preview: ZonePreview; at: number }>();
  /** Keys the server already confirmed: a preview that arrives after its event is not shown. */
  const confirmed: string[] = [];
  const key = (seat: number, zone: string) => `${seat}:${zone}`;
  const newest = new Map<string, number>();
  return {
    /** Add a decoded preview. A second message with the same seq (the name) updates the first. Returns false for a stale one. */
    apply(preview: ZonePreview, now: number): boolean {
      const k = key(preview.seat, preview.zone), last = newest.get(k) ?? -1;
      if (preview.seq < last || (preview.key !== undefined && confirmed.includes(preview.key))) return false;
      newest.set(k, preview.seq);
      pending.set(k, { preview, at: preview.seq === last ? pending.get(k)?.at ?? now : now });
      return true;
    },
    /** The server event for this zone arrived: it replaces the preview, whether the two agree or not. Returns true when it agreed with the preview. */
    confirm(seat: number, zone: string, serverKind: PreviewKind): boolean {
      const k = key(seat, zone), entry = pending.get(k);
      pending.delete(k);
      return entry?.preview.kind === serverKind;
    },
    /** The server event with this action key arrived: every preview of that key is replaced. Returns the previews that were waiting. */
    confirmKey(actionKey: string): ZonePreview[] {
      const done: ZonePreview[] = [];
      for (const [k, entry] of pending) if (entry.preview.key === actionKey) { pending.delete(k); done.push(entry.preview); }
      confirmed.push(actionKey);
      if (confirmed.length > 64) confirmed.shift();
      return done;
    },
    /** Drop previews that no server event confirmed in time. The caller fades them out. */
    expire(now: number): ZonePreview[] {
      const dropped: ZonePreview[] = [];
      for (const [k, entry] of pending) if (now - entry.at >= ttlMs) { pending.delete(k); dropped.push(entry.preview); }
      return dropped;
    },
    view(): ZonePreview[] { return [...pending.values()].map(entry => entry.preview); },
  };
}
