"use client";

export type SttMatch = { name: string; passcode: number; score: number; span: [number, number] };
export type SttFinal = { requestId: string; text: string; normalizedText: string; cardMatches: SttMatch[]; reason?: string };
export type SttEvents = {
  onPartial?: (requestId: string, text: string) => void;
  onFinal?: (result: SttFinal) => void;
  onCorrection?: (result: SttFinal) => void;
  onError?: (message: string) => void;
  onState?: (state: "connecting" | "ready" | "closed") => void;
};

export const sttUrl = () => process.env.NEXT_PUBLIC_REMOTE_STT_URL || "ws://localhost:4020/ws";

const GAME_WORDS = ["Yu-Gi-Oh", "draw phase", "standby phase", "main phase one", "battle phase", "main phase two", "end phase",
  "end turn", "pass", "next phase", "summon", "normal summon", "set", "tribute", "activate", "chain", "banish", "graveyard", "GY",
  "special summon", "link summon", "XYZ summon", "synchro summon", "fusion summon", "attach", "detach", "negate", "LP", "life points minus 1000", "life points plus 1000"];

/** At most 600 UTF-8 bytes (about 200 English tokens). Cards arrive most recent first. */
export function speechHotwords(cards: readonly string[]): string[] {
  const words: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const value of [...GAME_WORDS, ...cards]) {
    if (!value.trim() || value.length > 120 || /[\r\n]/.test(value)) continue;
    const word = value.trim(); const key = word.toLowerCase();
    const size = new TextEncoder().encode(word).length + (words.length ? 2 : 0);
    if (seen.has(key) || bytes + size > 600) continue;
    words.push(word); seen.add(key); bytes += size;
  }
  return words;
}

/** One socket to the local speech service. One utterance at a time: start, frames, end. */
export class SttClient {
  private socket: WebSocket | null = null;
  private ready: Promise<WebSocket> | null = null;
  private active: { requestId: string; started: boolean; queue: ArrayBuffer[]; ended: boolean; cancelled: boolean } | null = null;
  private serial = 0;
  private readonly session = crypto.randomUUID().slice(0, 8);
  constructor(private readonly events: SttEvents, private readonly url = sttUrl()) {}

  private open(): Promise<WebSocket> {
    if (this.ready) return this.ready;
    this.events.onState?.("connecting");
    this.ready = new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(this.url); socket.binaryType = "arraybuffer";
      const fail = () => { this.ready = null; this.socket = null; this.active = null; this.events.onState?.("closed"); reject(new Error("Speech service is not reachable")); };
      socket.onerror = fail;
      socket.onclose = () => { if (this.socket === socket) fail(); };
      socket.onmessage = event => {
        if (typeof event.data !== "string") return;
        const message = JSON.parse(event.data) as Record<string, unknown> & { type: string; requestId?: string };
        if (message.type === "ready") { this.socket = socket; this.events.onState?.("ready"); resolve(socket); return; }
        this.handle(message);
      };
    });
    return this.ready;
  }

  private handle(message: Record<string, unknown> & { type: string; requestId?: string }) {
    const id = message.requestId;
    const active = this.active;
    if (message.type === "started" && active && active.requestId === id) {
      active.started = true;
      if (active.cancelled) { this.socket?.send(JSON.stringify({ type: "cancel" })); return; }
      for (const frame of active.queue) this.socket?.send(frame);
      active.queue = [];
      if (active.ended) this.socket?.send(JSON.stringify({ type: "end" }));
    } else if (message.type === "partial" && id) this.events.onPartial?.(id, String(message.text ?? ""));
    else if (message.type === "final" && id) { if (this.active?.requestId === id) this.active = null; this.events.onFinal?.(message as unknown as SttFinal); }
    else if (message.type === "correction" && id) this.events.onCorrection?.(message as unknown as SttFinal);
    else if (message.type === "cancelled") this.active = null;
    else if (message.type === "error") { this.active = null; this.events.onError?.(String(message.error ?? "Speech service error")); }
  }

  /** Adds phase/verb vocabulary to recent table/deck cards using the service hotwords protocol. */
  async start(hotwords: string[]): Promise<string | null> {
    if (this.active) return null;
    let socket: WebSocket;
    try { socket = await this.open(); } catch (error) { this.events.onError?.((error as Error).message); return null; }
    if (this.active) return null;
    const requestId = `cmd-${this.session}-${++this.serial}`;
    this.active = { requestId, started: false, queue: [], ended: false, cancelled: false };
    const names = speechHotwords(hotwords);
    socket.send(JSON.stringify({ type: "start", requestId, mode: "ptt", sampleRate: 16000, format: "s16le", partials: true, hotwords: names }));
    return requestId;
  }

  /** 16 kHz signed 16-bit little-endian mono PCM. */
  push(frame: ArrayBuffer) {
    const active = this.active; if (!active || active.ended) return;
    if (active.started) this.socket?.send(frame); else active.queue.push(frame);
  }
  end() {
    const active = this.active; if (!active || active.ended) return;
    active.ended = true;
    if (active.started) this.socket?.send(JSON.stringify({ type: "end" }));
  }
  cancel() {
    if (!this.active) return;
    this.active.ended = true; this.active.cancelled = true; this.active.queue = [];
    if (this.active.started) { this.socket?.send(JSON.stringify({ type: "cancel" })); this.active = null; }
  }
  get busy() { return this.active !== null; }
  close() { const socket = this.socket; this.socket = null; this.ready = null; this.active = null; socket?.close(); }
}
