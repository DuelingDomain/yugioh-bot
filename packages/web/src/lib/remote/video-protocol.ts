import { remoteDataMessageSchema, type RemoteDataMessage } from "@yugidraft/shared/remote";

export type RecognitionRequest = Extract<RemoteDataMessage, { type: "recognition.request" }>;
export type RecognitionResult = Extract<RemoteDataMessage, { type: "recognition.result" }>;
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
    private recognize: (request: RecognitionRequest) => Promise<RecognitionResult["candidates"]>,
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
  async request(owner: number, x: number, y: number, requestId = crypto.randomUUID()) {
    const message = remoteDataMessageSchema.parse({ type: "recognition.request", feedOwnerSeat: owner, x, y, requestId }) as RecognitionRequest;
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
      let candidates: RecognitionResult["candidates"];
      try { candidates = await this.recognize(message); } catch { candidates = []; }
      if (this.closed || this.now() - pending.at > this.lifetime(pending.owner)) return;
      const result = remoteDataMessageSchema.parse({ type: "recognition.result", requestId: message.requestId, candidates }) as RecognitionResult;
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
