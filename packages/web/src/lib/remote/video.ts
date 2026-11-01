import {
  ConnectionState, Room, RoomEvent, Track, VideoPresets, createLocalVideoTrack,
  type ConnectionQuality, type LocalVideoTrack, type RemoteVideoTrack, type RemoteAudioTrack,
} from "livekit-client";
import {
  participantSeat, RecognitionChannel, RECOGNITION_TOPIC, PENDING_TOPIC,
  type VideoMember, type RecognitionRequest, type RecognitionResult,
} from "./video-protocol";

export type VideoFeed = { seat: number; video?: LocalVideoTrack | RemoteVideoTrack; audio?: RemoteAudioTrack; quality: ConnectionQuality; muted: boolean };
export type VideoSnapshot = {
  connection: ConnectionState; feeds: VideoFeed[]; devices: MediaDeviceInfo[];
  cameraId: string; microphone: boolean; error: string; result?: { fromSeat: number; message: RecognitionResult };
};
/** @yugidraft/vision integration point: crop/recognize on this unprocessed local capture track.
 * Honor signal; return at most five candidates within 10 seconds. No frames enter the data channel.
 */
export type RecognizeRawFeed = (input: { track: MediaStreamTrack; request: RecognitionRequest; signal: AbortSignal }) => Promise<RecognitionResult["candidates"]>;

export class RemoteVideo {
  private room = new Room({ adaptiveStream: true, dynacast: true });
  private camera?: LocalVideoTrack;
  private channel?: RecognitionChannel;
  private scans = new AbortController();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private starting = false;
  private closed = false;
  private snapshot: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "" };
  constructor(private options: { slug: string; guildId: string; seat: number; members: VideoMember[]; recognize?: RecognizeRawFeed }) {
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionQualityChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantMetadataChanged]) this.room.on(event, sync);
    this.room.on(RoomEvent.ConnectionStateChanged, connection => {
      this.patch({ connection }); this.sync();
      if (connection === ConnectionState.Disconnected) { this.channel?.close(); this.scans.abort(); }
    });
    this.room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
      if (!participant || bytes.byteLength > 8192 || !this.channel) return;
      const from = this.seatOf(participant); if (from === undefined) return;
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if (topic === PENDING_TOPIC) this.channel.announce(from, value.requestId, value.feedOwnerSeat);
        else if (topic === RECOGNITION_TOPIC) void this.channel.receive(from, value).catch(error => this.fail(error));
      } catch { /* Invalid data is ignored, never executed or persisted. */ }
    });
    this.room.on(RoomEvent.MediaDevicesChanged, () => void this.refreshDevices().catch(error => this.fail(error)));
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  /** Raw camera capture, before any SFU encoding, available at its actual native resolution. */
  get rawLocalTrack() { return this.camera?.mediaStreamTrack; }
  private patch(value: Partial<VideoSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...value }; for (const listener of this.listeners) listener();
  }
  private seatOf(participant: { identity: string; metadata?: string }) {
    return participantSeat(participant.identity, participant.metadata, this.options.guildId, this.options.slug, this.options.members);
  }
  setMembers(members: VideoMember[]) { this.options.members = members; this.sync(); }
  private sync() {
    const feeds: VideoFeed[] = [];
    const local = this.room.localParticipant;
    if (this.camera && this.room.state !== ConnectionState.Disconnected) feeds.push({ seat: this.options.seat, video: this.camera, quality: local.connectionQuality, muted: this.camera.isMuted });
    for (const participant of this.room.remoteParticipants.values()) {
      const seat = this.seatOf(participant); if (seat === undefined) continue;
      const camera = participant.getTrackPublication(Track.Source.Camera);
      const mic = participant.getTrackPublication(Track.Source.Microphone);
      feeds.push({ seat, video: camera?.track?.kind === Track.Kind.Video ? camera.videoTrack : undefined,
        audio: mic?.track?.kind === Track.Kind.Audio ? mic.audioTrack as RemoteAudioTrack : undefined,
        quality: participant.connectionQuality, muted: camera?.isMuted ?? false });
    }
    this.patch({ feeds });
  }
  private async refreshDevices() {
    const devices = await Room.getLocalDevices("videoinput");
    this.patch({ devices, cameraId: await this.camera?.getDeviceId() ?? this.snapshot.cameraId });
  }
  async connect(deviceId = this.snapshot.cameraId) {
    if (this.closed || this.starting) return;
    this.starting = true; const epoch = ++this.epoch;
    this.patch({ error: "", connection: ConnectionState.Connecting });
    try {
      await this.room.disconnect(); this.camera = undefined;
      const response = await fetch(`/api/remote/${encodeURIComponent(this.options.slug)}/livekit`, { method: "POST", cache: "no-store" });
      const credentials = await response.json();
      if (!response.ok) throw new Error(credentials.error ?? "Video is unavailable");
      if (credentials.seat !== this.options.seat || credentials.room !== `remote-${this.options.slug}`) throw new Error("Video membership changed; reload the table");
      if (this.closed || epoch !== this.epoch) return;
      this.patch({ connection: ConnectionState.Connecting });
      await this.room.connect(credentials.url, credentials.token, { autoSubscribe: true });
      if (this.closed || epoch !== this.epoch) { await this.room.disconnect(); return; }
      const camera = await createLocalVideoTrack({ deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: "environment", resolution: { width: 1920, height: 1080, frameRate: 24 } });
      if (this.closed || epoch !== this.epoch) { camera.stop(); await this.room.disconnect(); return; }
      this.camera = camera; camera.mediaStreamTrack.contentHint = "detail";
      await this.room.localParticipant.publishTrack(camera, { name: "field-cam", source: Track.Source.Camera,
        videoCodec: "vp8", simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 24 }, degradationPreference: "maintain-resolution" });
      if (this.closed || epoch !== this.epoch) { await this.room.disconnect(); return; }
      this.scans = new AbortController();
      this.channel = new RecognitionChannel(this.options.seat, async (message, destination, announcement) => {
        const participant = destination === undefined ? undefined : [...this.room.remoteParticipants.values()].find(p => this.seatOf(p) === destination);
        if (destination !== undefined && !participant) throw new Error("The feed owner is disconnected");
        const data = announcement ? { requestId: message.requestId, feedOwnerSeat: "feedOwnerSeat" in message ? message.feedOwnerSeat : undefined } : message;
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        if (bytes.byteLength > 8192) throw new Error("Recognition message is too large");
        await this.room.localParticipant.publishData(bytes, { reliable: true, topic: announcement ? PENDING_TOPIC : RECOGNITION_TOPIC,
          destinationIdentities: participant ? [participant.identity] : undefined });
      }, async request => {
        if (!this.rawLocalTrack || !this.options.recognize) return []; // Attach @yugidraft/vision here via options.recognize.
        return this.options.recognize({ track: this.rawLocalTrack, request, signal: this.scans.signal });
      }, (message, fromSeat) => this.patch({ result: { fromSeat, message } }));
      this.patch({ connection: this.room.state, microphone: false }); this.sync(); await this.refreshDevices();
    } catch (error) {
      this.camera?.stop(); this.camera = undefined; await this.room.disconnect();
      if (epoch === this.epoch) { this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false }); this.fail(error); }
    } finally { this.starting = false; }
  }
  async selectCamera(deviceId: string) {
    const camera = this.camera; const epoch = this.epoch;
    if (!camera) { this.patch({ cameraId: deviceId }); return; }
    await camera.restartTrack({ deviceId: deviceId ? { exact: deviceId } : undefined, resolution: { width: 1920, height: 1080, frameRate: 24 } });
    if (this.closed || epoch !== this.epoch || camera !== this.camera) { camera.stop(); return; }
    camera.mediaStreamTrack.contentHint = "detail";
    this.patch({ cameraId: deviceId }); this.sync();
  }
  async setMicrophone(enabled: boolean) {
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
    if (this.closed) { await this.room.disconnect(); return; }
    this.patch({ microphone: enabled });
  }
  requestRecognition(seat: number, x = 0.5, y = 0.5) {
    if (!this.channel || this.room.state !== ConnectionState.Connected) return Promise.reject(new Error("Connect table video first"));
    return this.channel.request(seat, x, y);
  }
  startAudio() { return this.room.startAudio(); }
  fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Video failed" }); }
  async stop() {
    ++this.epoch; this.channel?.close(); this.channel = undefined; this.scans.abort();
    this.camera?.stop(); this.camera = undefined; await this.room.disconnect();
    this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false, result: undefined });
  }
  dispose() { this.closed = true; this.listeners.clear(); void this.stop(); }
}
