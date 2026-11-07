import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, VideoQuality, type RemoteTrackPublication, type RemoteVideoTrack } from "livekit-client";
import { participantSeat, type VideoMember } from "./video-protocol";
import { FIELD_TRACKS_TOPIC, FieldTrackCache } from "./field-track-cache";
import { CAMERA_PUBLISH } from "./video-profile";

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
 * Receive only: cameras and the public field outlines. It holds no local track, no card reader, no recognition channel and no microphone
 * subscription. Its token has no publish rights, so the SFU refuses anything else.
 */
export class SpectatorVideo {
  private room = new Room({ adaptiveStream: false, dynacast: false, disconnectOnPageLeave: true });
  readonly tracks = new FieldTrackCache();
  private listeners = new Set<() => void>();
  private snapshot: SpectatorVideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], error: "" };
  private closed = false;
  private layer = spectatorLayer();
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private options: { slug: string; guildId: string; members: VideoMember[] }) {
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantMetadataChanged, RoomEvent.ConnectionStateChanged]) this.room.on(event, sync);
    this.room.on(RoomEvent.Disconnected, reason => {
      if (this.closed) return;
      if (reason === DisconnectReason.DUPLICATE_IDENTITY) this.patch({ error: "This table is open in another tab. Video plays there.", needsClick: true });
      else this.later();
    });
    this.room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
      if (topic !== FIELD_TRACKS_TOPIC || bytes.byteLength > 8192 || !participant) return;
      const seat = this.seatOf(participant);
      if (seat === undefined) return;
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
  dispose() { clearTimeout(this.timer); this.closed = true; this.listeners.clear(); this.tracks.clear(); void this.room.disconnect(); }
}
