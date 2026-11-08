/**
 * A small public summary of how a player's card reader and camera run, shown as a chip on that player's feed.
 * It travels on a room-wide data topic (LiveKit attributes need `canUpdateOwnMetadata`, which the table tokens keep off so
 * the signed seat metadata cannot be rewritten). It is not a game event and never enters the log.
 */
export const PEER_VISION_TOPIC = "remote.peer-vision.v1";
/** At most one message this often, and only when a value changed meaningfully. */
export const PEER_VISION_INTERVAL_MS = 3000;
/** An unchanged summary is repeated this often, so a player who joins later gets it. */
export const PEER_VISION_REFRESH_MS = 15_000;
/** A summary nobody refreshed for this long is dropped (the sender left or stopped). */
const EXPIRE_MS = 45_000;

export type PeerVision = {
  /** Where the card reader runs: the graphics card, the processor, or not started yet. */
  backend: "gpu" | "cpu" | "pending";
  /** Last read time in ms, rounded to 5. */
  ms?: number;
  /** Auto-detect watches the field; "tap" is Auto-detect off (a click reads a card). */
  detect: "auto" | "tap";
  /** Frames per second and size of the video this computer sends. */
  fps?: number; width?: number; height?: number;
};

const BACKENDS = { g: "gpu", c: "cpu", p: "pending" } as const;
const CODES = { gpu: "g", cpu: "c", pending: "p" } as const;
const clampInt = (value: unknown, max: number) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.round(value)) : undefined;

export const roundMs = (ms: number) => Math.max(5, Math.round(ms / 5) * 5);

export function encodePeerVision(value: PeerVision): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify({ b: CODES[value.backend], d: value.detect === "tap" ? "t" : "a", m: value.ms, f: value.fps, w: value.width, h: value.height }));
}
/** Untrusted input: anything that is not this exact shape is dropped. */
export function parsePeerVision(bytes: Uint8Array): PeerVision | undefined {
  if (bytes.byteLength > 256) return undefined;
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
    if (!raw || typeof raw !== "object" || typeof raw.b !== "string" || !(raw.b in BACKENDS) || (raw.d !== "a" && raw.d !== "t")) return undefined;
    const ms = clampInt(raw.m, 9999), fps = clampInt(raw.f, 240), width = clampInt(raw.w, 16384), height = clampInt(raw.h, 16384);
    return { backend: BACKENDS[raw.b as keyof typeof BACKENDS], detect: raw.d === "t" ? "tap" : "auto",
      ...(ms === undefined ? {} : { ms }), ...(fps === undefined ? {} : { fps }), ...(width === undefined || height === undefined ? {} : { width, height }) };
  } catch { return undefined; }
}

/** True when the new summary is worth a message: a state change, a read time that moved by 10 ms or 20%, or a frame rate that moved by 3. */
export function peerVisionChanged(before: PeerVision | undefined, next: PeerVision): boolean {
  if (!before) return true;
  if (before.backend !== next.backend || before.detect !== next.detect || before.width !== next.width || before.height !== next.height) return true;
  if ((before.ms === undefined) !== (next.ms === undefined) || (before.fps === undefined) !== (next.fps === undefined)) return true;
  if (before.ms !== undefined && next.ms !== undefined && Math.abs(before.ms - next.ms) >= Math.max(10, before.ms * 0.2)) return true;
  return before.fps !== undefined && next.fps !== undefined && Math.abs(before.fps - next.fps) >= 3;
}

/** The chip text, or null when there is nothing to say yet (the reader has not started and Auto-detect is on). */
export function peerVisionLabel(value: PeerVision): string | null {
  if (value.detect === "tap") return "Auto-detect off";
  if (value.backend === "pending") return null;
  return [value.backend === "gpu" ? "GPU" : "CPU", value.ms === undefined ? "" : `${value.ms} ms`, value.fps === undefined ? "" : `${value.fps} fps`].filter(Boolean).join(" · ");
}
export function peerVisionTitle(value: PeerVision, name: string): string {
  const reader = value.backend === "pending" ? "Card reader is starting." : `Card reader runs on the ${value.backend === "gpu" ? "graphics card (GPU)" : "processor (CPU)"}${value.ms === undefined ? "." : `. Last read: about ${value.ms} ms.`}`;
  return [`${name}'s computer.`, reader,
    value.detect === "tap" ? "Auto-detect is off: a click reads a card." : "Auto-detect watches the field.",
    value.fps === undefined ? "" : `Video sent: ${value.fps} fps${value.width && value.height ? ` at ${value.width}x${value.height}` : ""}.`].filter(Boolean).join(" ");
}

/** Latest summary per seat, as a store. A seat that stays silent for 45 s drops out. */
export class PeerVisionCache {
  private seats = new Map<number, { value: PeerVision; timer: ReturnType<typeof setTimeout> }>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { for (const listener of this.listeners) listener(); }
  get(seat: number): PeerVision | undefined { return this.seats.get(seat)?.value; }
  receive(seat: number, bytes: Uint8Array) {
    const value = parsePeerVision(bytes);
    if (!value || !Number.isInteger(seat) || seat < 0 || seat > 3) return false;
    const old = this.seats.get(seat);
    if (old) clearTimeout(old.timer);
    const timer = setTimeout(() => { this.seats.delete(seat); this.notify(); }, EXPIRE_MS);
    // Keep the same object while nothing changed, so a store read stays stable.
    const same = old && JSON.stringify(old.value) === JSON.stringify(value);
    this.seats.set(seat, { value: same ? old.value : value, timer });
    if (!same) this.notify();
    return true;
  }
  clear() {
    if (!this.seats.size) return;
    for (const { timer } of this.seats.values()) clearTimeout(timer);
    this.seats.clear(); this.notify();
  }
}
