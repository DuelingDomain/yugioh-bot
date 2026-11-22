import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication, type RemoteVideoTrack } from "livekit-client";
import { remoteDataMessageSchema } from "@yugidraft/shared/remote";
import { NO_ANSWER, SPECTATOR_READ_GAP_MS, SPECTATOR_READ_TOPIC, participantSeat, type RecognitionAnswer, type VideoMember } from "./video-protocol";
import { FIELD_TRACKS_TOPIC, FieldTrackCache } from "./field-track-cache";
import { CAMERA_PUBLISH } from "./video-profile";
import { PEER_VISION_TOPIC, PeerVisionCache } from "./peer-vision";
import { PEER_PREVIEW_TOPIC, peerPreviews } from "./peer-preview";

export type SpectatorVideoSnapshot = { connection: ConnectionState; feeds: { seat: number; video: RemoteVideoTrack }[]; error: string; /** Another tab of this person holds the video: only a click takes it back, else the two tabs would remove each other for ever. */ needsClick?: boolean };
/** A spectator asks for the same top simulcast layer as a seated player (`CAMERA_PUBLISH.receiverLayer`). LiveKit alone falls back to a lower layer when the network cannot carry it. Adaptive stream stays off so a small tile does not pick a lower layer. */
const spectatorLayer = () => CAMERA_PUBLISH.receiverLayer;

/** A server-minted phone identity. A spectator has no phone roster, and the server removes a revoked phone from the room. */
function phoneSeat(identity: string, metadata: string | undefined, guildId: string, slug: string, members: VideoMember[]): number | undefined {
  try {
    const p = JSON.parse(metadata ?? "");
    if (p.role === "field-phone" && p.tableId === slug && p.guildId === guildId && identity === `remote-phone-${p.pairId}` && members.some(m => m.seat === p.seat && m.userId === p.userId && m.userId !== null)) return p.seat as number;
  } catch { /* Untrusted metadata never identifies a seat. */ }
}

/**
 * Receive only: cameras and the public field outlines. It holds no local track, no card reader and no microphone subscription. Its token
 * cannot publish a track. It may send data, and sends only one thing: a read request to the owner of a feed, which the owner answers to
 * this spectator alone (`requestRead`).
 */
export class SpectatorVideo {
  private room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
  readonly tracks = new FieldTrackCache();
  /** Each player's reader speed and video rate, for the chip on their feed. */
  readonly vision = new PeerVisionCache();
  private listeners = new Set<() => void>();
  private snapshot: SpectatorVideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], error: "" };
  private closed = false;
  private layer = spectatorLayer();
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private reads = new Map<string, { owner: number; resolve: (answer: RecognitionAnswer) => void; timer: ReturnType<typeof setTimeout> }>();
  private lastRead = -Infinity;
  constructor(private options: { slug: string; guildId: string; members: VideoMember[] }) {
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantMetadataChanged, RoomEvent.ConnectionStateChanged]) this.room.on(event, sync);
    this.room.on(RoomEvent.Disconnected, reason => {
      if (this.closed) return;
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) this.patch({ error: "This table is open in another tab. Video plays there.", needsClick: true });
      else this.later();
    });
    this.room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic, _encryption, identity) => {
      if (topic === SPECTATOR_READ_TOPIC) { this.receiveRead(bytes, participant, identity); return; }
      if ((topic !== FIELD_TRACKS_TOPIC && topic !== PEER_VISION_TOPIC && topic !== PEER_PREVIEW_TOPIC) || bytes.byteLength > 8192 || !participant) return;
      const seat = this.seatOf(participant);
      if (seat === undefined) return;
      if (topic === PEER_VISION_TOPIC) { this.vision.receive(seat, bytes); return; }
      // A board preview from the owner of that seat (the seat is the sender's, not the packet's). Display only.
      if (topic === PEER_PREVIEW_TOPIC) { peerPreviews.receive(bytes, seat); return; }
      try { this.tracks.receive(seat, JSON.parse(new TextDecoder().decode(bytes))); } catch { /* Invalid data is ignored. */ }
    });
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  /** The layer this browser asks for: the check that a spectator asks for the same layer as a player. */
  get layerName() { return this.layer === VideoQuality.HIGH ? "high" : this.layer === VideoQuality.LOW ? "low" : "medium"; }
  private seatOf(participant: { identity: string; metadata?: string }) {
    const { guildId, slug, members } = this.options;
    return phoneSeat(participant.identity, participant.metadata, guildId, slug, members) ?? participantSeat(participant.identity, participant.metadata, guildId, slug, members);
  }
  /** The sender must be the SFU-bound identity of the seat that owns the feed asked. */
  private receiveRead(bytes: Uint8Array, participant: { identity: string; metadata?: string } | undefined, identity: string | undefined) {
    if (bytes.byteLength > 8192) return;
    try {
      const parsed = remoteDataMessageSchema.safeParse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!parsed.success || parsed.data.type !== "recognition.result") return;
      const pending = this.reads.get(parsed.data.requestId); if (!pending) return;
      const from = participant ? this.seatOf(participant) : this.options.members.find(m => m.userId !== null && identity === `remote-user-${m.userId}`)?.seat;
      if (from !== pending.owner) return;
      clearTimeout(pending.timer); this.reads.delete(parsed.data.requestId);
      const { candidates, tier, faceDown, covered } = parsed.data;
      pending.resolve({ candidates, tier, faceDown, covered });
    } catch { /* Invalid data is ignored. */ }
  }
  /**
   * Asks the player who owns a feed to read the card at a point of the frame (0..1). Same reader and same answer as a seated player's click.
   * One request at a time per spectator, at most one a second; the owner checks the same limit.
   */
  async requestRead(owner: number, x: number, y: number): Promise<RecognitionAnswer> {
    const member = this.options.members.find(m => m.seat === owner && m.userId !== null);
    if (!member || this.room.state !== ConnectionState.Connected) return NO_ANSWER;
    const now = Date.now();
    if (this.reads.size || now - this.lastRead < SPECTATOR_READ_GAP_MS) throw new Error("Wait before reading another card");
    this.lastRead = now;
    const message = remoteDataMessageSchema.parse({ type: "recognition.request", feedOwnerSeat: owner, x, y, requestId: crypto.randomUUID() });
    const answer = new Promise<RecognitionAnswer>(resolve => {
      const timer = setTimeout(() => { this.reads.delete(message.requestId); resolve(NO_ANSWER); }, 12_000);
      this.reads.set(message.requestId, { owner, resolve, timer });
    });
    try {
      await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ from: this.room.localParticipant.identity, request: message })), { reliable: true, topic: SPECTATOR_READ_TOPIC, destinationIdentities: [`remote-user-${member.userId}`] });
    } catch (error) { const pending = this.reads.get(message.requestId); if (pending) { clearTimeout(pending.timer); this.reads.delete(message.requestId); } throw error; }
    return answer;
  }
  setMembers(members: VideoMember[]) { this.options.members = members; this.sync(); }
  private patch(value: Partial<SpectatorVideoSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...value }; for (const listener of this.listeners) listener();
  }
  private sync() {
    const feeds = new Map<number, { seat: number; video: RemoteVideoTrack; phone: boolean }>();
    for (const participant of this.room.remoteParticipants.values()) {
      const seat = this.seatOf(participant), phone = participant.identity.startsWith("remote-phone-");
      for (const publication of participant.trackPublications.values() as Iterable<RemoteTrackPublication>) {
        const wanted = seat !== undefined && publication.source === Track.Source.Camera;
        if (publication.isDesired !== wanted) publication.setSubscribed(wanted);
        if (!wanted) continue;
        publication.setVideoQuality(this.layer);
        // As at the table: a seat's phone replaces its webcam.
        if (publication.videoTrack && !feeds.get(seat!)?.phone) feeds.set(seat!, { seat: seat!, video: publication.videoTrack as RemoteVideoTrack, phone });
      }
    }
    this.patch({ connection: this.room.state, feeds: [...feeds.values()].map(({ seat, video }) => ({ seat, video })) });
    this.tracks.retain(new Set(feeds.keys()));
  }
  async connect() {
    if (this.closed || this.room.state !== ConnectionState.Disconnected) return;
    try {
      const response = await fetch(`/api/remote/${encodeURIComponent(this.options.slug)}/livekit`, { method: "POST", cache: "no-store" });
      const credentials = await response.json();
      if (!response.ok) throw new Error(credentials.error ?? "Video is unavailable");
      if (this.closed) return;
      await this.room.connect(credentials.url, credentials.token, { autoSubscribe: false });
      this.attempts = 0; this.patch({ error: "", needsClick: false }); this.sync();
    } catch (error) { this.patch({ error: error instanceof Error ? error.message : "Video is unavailable" }); this.later(); }
  }
  /** The slot can come back with the next poll, so this keeps trying: 2 s, 4 s, then at most every 30 s. */
  private later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.connect(), Math.min(30_000, 2000 * 2 ** this.attempts++));
  }
  retry() { clearTimeout(this.timer); this.attempts = 0; this.patch({ needsClick: false }); void this.connect(); }
  dispose() { clearTimeout(this.timer); this.closed = true; for (const read of this.reads.values()) { clearTimeout(read.timer); read.resolve(NO_ANSWER); } this.reads.clear(); this.listeners.clear(); this.tracks.clear(); this.vision.clear(); void this.room.disconnect(); }
}
