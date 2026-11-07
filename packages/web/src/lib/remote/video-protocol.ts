import { remoteDataMessageSchema, type RemoteDataMessage } from "@yugidraft/shared/remote";

export type RecognitionRequest = Extract<RemoteDataMessage, { type: "recognition.request" }>;
export type RecognitionResult = Extract<RemoteDataMessage, { type: "recognition.result" }>;
/** What the feed owner's reader says about one click: the guesses plus how sure it was. */
export type RecognitionAnswer = Pick<RecognitionResult, "candidates" | "tier" | "faceDown" | "covered">;
export const NO_ANSWER: RecognitionAnswer = { candidates: [], tier: "low match", faceDown: false, covered: false };
export type VideoMember = { seat: number; userId: number | null };
export const RECOGNITION_TOPIC = "remote.recognition.v1";
export const PENDING_TOPIC = "remote.recognition.pending.v1";

/** Metadata is signed by the token route; canUpdateOwnMetadata is disabled. */
export function participantSeat(identity: string, metadata: string | undefined, guildId: string, tableId: string, members: VideoMember[]) {
  try {
    const value = JSON.parse(metadata ?? "");
    if (value.guildId === guildId && value.tableId === tableId && identity === `remote-user-${value.userId}` &&
      members.some(member => member.seat === value.seat && member.userId === value.userId && member.userId !== null)) return value.seat as number;
  } catch { /* Untrusted/missing metadata never identifies a seat. */ }
  return undefined;
}

export class FrameHealth {
  constructor(private lastFrame: number) {}
  frame(now: number) { this.lastFrame = now; }
  frozen(now: number) { return now - this.lastFrame >= 3000; }
}

/** No pixel comparison: an unmoving physical board still produces healthy video frames. */
export function watchVideoFrames(video: HTMLVideoElement, update: (frozen: boolean) => void) {
  const health = new FrameHealth(performance.now());
  let closed = false; let frameId: number | undefined; let frames = 0;
  const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";
  function frame() {
    if (closed) return;
    health.frame(performance.now()); frameId = video.requestVideoFrameCallback(frame);
  }
  if (hasFrameCallback) frameId = video.requestVideoFrameCallback(frame);
  const timer = setInterval(() => {
    if (!hasFrameCallback) {
      const count = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      if (count > frames) { frames = count; health.frame(performance.now()); }
    }
    update(health.frozen(performance.now()));
  }, 250);
  return () => { closed = true; clearInterval(timer); if (frameId !== undefined) video.cancelVideoFrameCallback(frameId); };
}

type Send = (message: RemoteDataMessage, destination?: number, announcement?: boolean) => Promise<void>;
/** Bounded, ephemeral correlation. The SFU binds senders; the server action route owns persistence. */
export class RecognitionChannel {
  private pending = new Map<string, { owner: number; requester: number; at: number; started?: boolean }>();
  private lastAccepted = new Map<number, number>();
  private closed = false;
  constructor(private seat: number, private send: Send,
    private recognize: (request: RecognitionRequest) => Promise<RecognitionAnswer>,
    private onResult: (result: RecognitionResult, fromSeat: number) => void,
    private now = () => Date.now(),
    private lifetime = (_owner: number) => 10_000) {}
  private prune() { for (const [id, value] of this.pending) if (this.now() - value.at > this.lifetime(value.owner)) this.pending.delete(id); }
  announce(from: number, requestId: string, owner: number) {
    this.prune();
    const parsed = remoteDataMessageSchema.safeParse({ type: "recognition.request", requestId, feedOwnerSeat: owner, x: 0, y: 0 });
    if (this.closed || !parsed.success || this.pending.has(requestId) || this.pending.size >= 128) return;
    if (this.now() - (this.lastAccepted.get(from) ?? -Infinity) < 100) return;
    this.pending.set(requestId, { owner, requester: from, at: this.now() });
    this.lastAccepted.set(from, this.now());
  }
  async request(owner: number, x: number, y: number, requestId = crypto.randomUUID(), force=false) {
    const message = remoteDataMessageSchema.parse({ type: "recognition.request", feedOwnerSeat: owner, x, y, requestId,...(force?{force:true}:{}) }) as RecognitionRequest;
    this.announce(this.seat, requestId, owner);
    if (!this.pending.has(requestId)) throw new Error("Wait before requesting another card");
    // Observers see only correlation IDs/owner, never the click coordinates.
    await this.send(message, undefined, true);
    if (owner === this.seat) await this.receive(this.seat, message);
    else await this.send(message, owner);
    return requestId;
  }
  async receive(from: number, input: unknown) {
    this.prune();
    if (this.closed) return;
    const parsed = remoteDataMessageSchema.safeParse(input); if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "recognition.request") {
      if (message.feedOwnerSeat !== this.seat) return;
      if (!this.pending.has(message.requestId)) this.announce(from, message.requestId, this.seat);
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.owner !== this.seat || pending.requester !== from || pending.started) return;
      pending.started = true;
      let answer: RecognitionAnswer;
      try { answer = await this.recognize(message); } catch { answer = NO_ANSWER; }
      if (this.closed || this.now() - pending.at > this.lifetime(pending.owner)) return;
      const result = remoteDataMessageSchema.parse({ type: "recognition.result", requestId: message.requestId, ...answer }) as RecognitionResult;
      await this.send(result);
      await this.receive(this.seat, result);
    } else {
      const pending = this.pending.get(message.requestId);
      if (!pending || pending.owner !== from) return;
      this.pending.delete(message.requestId); this.onResult(message, from);
    }
  }
  close() { this.closed = true; this.pending.clear(); this.lastAccepted.clear(); }
}

export const RESCAN_TOPIC = "remote.rescan.v1";
/** One Rescan request per requester seat per this long, checked by both sides. */
export const RESCAN_EVERY_MS = 15_000;
/** How the other side answered. `limited`/`unavailable` come from the requester's own checks or the reply. */
export type RescanResult = "started" | "off" | "limited" | "unavailable";
type RescanMessage = { type: "rescan.request"; id: string } | { type: "rescan.reply"; id: string; result: "started" | "off" | "limited" };
function rescanMessage(value: unknown): RescanMessage | undefined {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || typeof v.id !== "string" || v.id.length < 1 || v.id.length > 100) return undefined;
  if (v.type === "rescan.request") return { type: "rescan.request", id: v.id };
  if (v.type === "rescan.reply" && (v.result === "started" || v.result === "off" || v.result === "limited")) return { type: "rescan.reply", id: v.id, result: v.result };
  return undefined;
}
/**
 * "Rescan" for another seat: a request on the table's data channel, never a game action, so it never moves baseSeq. The other client
 * runs its own Scan field on its local camera and answers `started` or `off` (its Auto-detect is off). `from` is the SFU-bound seat,
 * so a spectator (no seat) never reaches this class. Both sides keep the 15 s limit per requester.
 */
export class RescanChannel {
  private pending = new Map<string, { owner: number; resolve: (result: RescanResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private lastSent = new Map<number, number>();
  private lastAccepted = new Map<number, number>();
  private closed = false;
  constructor(private seat: number, private send: (message: RescanMessage, destination: number) => Promise<void>,
    private handle: (from: number) => "started" | "off", private now = () => Date.now(), private wait = 4000) {}
  async request(owner: number): Promise<RescanResult> {
    if (this.closed || owner === this.seat) return "unavailable";
    if (this.now() - (this.lastSent.get(owner) ?? -Infinity) < RESCAN_EVERY_MS) return "limited";
    this.lastSent.set(owner, this.now());
    const id = crypto.randomUUID();
    const answer = new Promise<RescanResult>(resolve => {
      const timer = setTimeout(() => { this.pending.delete(id); resolve("unavailable"); }, this.wait);
      this.pending.set(id, { owner, resolve, timer });
    });
    try { await this.send({ type: "rescan.request", id }, owner); } catch { const p = this.pending.get(id); if (p) { clearTimeout(p.timer); this.pending.delete(id); } return "unavailable"; }
    return answer;
  }
  async receive(from: number, input: unknown) {
    const message = rescanMessage(input); if (this.closed || !message) return;
    if (message.type === "rescan.request") {
      if (from === this.seat) return;
      const limited = this.now() - (this.lastAccepted.get(from) ?? -Infinity) < RESCAN_EVERY_MS;
      if (!limited) this.lastAccepted.set(from, this.now());
      const result = limited ? "limited" : this.handle(from);
      await this.send({ type: "rescan.reply", id: message.id, result }, from).catch(() => undefined);
    } else {
      const pending = this.pending.get(message.id);
      if (!pending || pending.owner !== from) return;
      clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message.result);
    }
  }
  close() { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.resolve("unavailable"); } this.pending.clear(); }
}
