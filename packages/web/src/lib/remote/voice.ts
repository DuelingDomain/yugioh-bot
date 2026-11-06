import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type RemoteAudioTrack } from "livekit-client";
import { participantSeat, type VideoMember } from "./video-protocol";

/**
 * The players' talk, in its own LiveKit room with tokens for seated players only. A spectator can subscribe to all of the table room, so
 * no microphone is ever published there. It follows the table video connection, and comes back by itself after a lost connection.
 */
export class RemoteVoice {
  private room = new Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: false, disconnectOnPageLeave: false });
  private wanted = false;
  private microphone = false;
  private starting = false;
  private attempts = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private options: { slug: () => string; guildId: () => string; members: () => VideoMember[]; changed: () => void; failed: (error: unknown) => void }) {
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantMetadataChanged]) this.room.on(event, sync);
    // Two tabs of one player would remove each other for ever, so the tab that lost stays out.
    this.room.on(RoomEvent.Disconnected, reason => { if (this.wanted && reason !== DisconnectReason.DUPLICATE_IDENTITY) this.later(); });
  }
  private seatOf(participant: { identity: string; metadata?: string }) {
    return participantSeat(participant.identity, participant.metadata, this.options.guildId(), this.options.slug(), this.options.members());
  }
  /** Never subscribe to an unknown identity or to anything but a microphone. */
  private sync() {
    for (const participant of this.room.remoteParticipants.values()) {
      const seated = this.seatOf(participant) !== undefined;
      for (const publication of participant.trackPublications.values()) {
        const allowed = seated && publication.source === Track.Source.Microphone;
        if (publication.isDesired !== allowed) publication.setSubscribed(allowed);
      }
    }
    this.options.changed();
  }
  audio(seat: number): RemoteAudioTrack | undefined {
    for (const participant of this.room.remoteParticipants.values()) {
      if (this.seatOf(participant) !== seat) continue;
      const track = participant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track?.kind === Track.Kind.Audio) return track as RemoteAudioTrack;
    }
  }
  private later() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.start(), Math.min(30_000, 2000 * 2 ** this.attempts++));
  }
  async start() {
    this.wanted = true;
    if (this.starting || this.room.state !== ConnectionState.Disconnected) return;
    this.starting = true;
    try {
      const response = await fetch(`/api/remote/${encodeURIComponent(this.options.slug())}/livekit?voice=1`, { method: "POST", cache: "no-store" });
      const credentials = await response.json();
      // A refusal does not change by asking again. It stays quiet on a solo table, which has no token.
      if (response.status >= 400 && response.status < 500) { this.options.failed(new Error(credentials.error ?? "Voice is unavailable")); return; }
      if (!response.ok) throw new Error(credentials.error ?? "Voice is unavailable");
      if (!credentials.token || !this.wanted) return;
      await this.room.connect(credentials.url, credentials.token, { autoSubscribe: false });
      if (!this.wanted) { await this.room.disconnect(); return; }
      this.attempts = 0; this.sync();
      if (this.microphone) await this.room.localParticipant.setMicrophoneEnabled(true).catch(error => this.options.failed(error));
    } catch { if (this.wanted) this.later(); }
    finally { this.starting = false; }
  }
  /** The choice holds when the room is not connected yet: it applies on each connection. */
  async setMicrophone(enabled: boolean) {
    this.microphone = enabled;
    if (this.room.state === ConnectionState.Connected) await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }
  startAudio() { return this.room.startAudio(); }
  async stop() {
    this.wanted = false; this.microphone = false; clearTimeout(this.timer); this.attempts = 0;
    await this.room.disconnect();
  }
}
