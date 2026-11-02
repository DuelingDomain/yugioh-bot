import { DesktopPhoneLink } from "./phone-desktop";
import type { PhoneReading, PhoneScan } from "./phone-protocol";
import {
  ConnectionState, Room, RoomEvent, Track, VideoPresets, createLocalVideoTrack,
  type ConnectionQuality, type LocalVideoTrack, type RemoteVideoTrack, type RemoteAudioTrack,
} from "livekit-client";
import {
  participantSeat, RecognitionChannel, RECOGNITION_TOPIC, PENDING_TOPIC, NO_ANSWER,
  type VideoMember, type RecognitionAnswer, type RecognitionRequest, type RecognitionResult,
} from "./video-protocol";
import {FieldTrackCache,FIELD_TRACKS_TOPIC} from './field-track-cache';
import type {RemoteFieldTracks} from '@yugidraft/shared/remote';

export type VideoFeed = { seat: number; video?: LocalVideoTrack | RemoteVideoTrack; audio?: RemoteAudioTrack; quality: ConnectionQuality; muted: boolean; phone?: boolean; mode?: string };
export type VideoSnapshot = {
  connection: ConnectionState; feeds: VideoFeed[]; devices: MediaDeviceInfo[];
  cameraId: string; microphone: boolean; error: string; /** The signal link dropped and the SDK is trying to resume it. */ signalLost?: boolean; result?: { fromSeat: number; message: RecognitionResult };
};
/** @yugidraft/vision integration point: crop/recognize on this unprocessed local capture track.
 * Honor signal; return at most five candidates, with the reader's tier, within 10 seconds. No frames enter the data channel.
 */
export type RecognizeRawFeed = (input: { track: MediaStreamTrack; request: RecognitionRequest; signal: AbortSignal }) => Promise<RecognitionAnswer>;

export class RemoteVideo {
  private room = new Room({ adaptiveStream: true, dynacast: true });
  readonly phone: DesktopPhoneLink;
  private camera?: LocalVideoTrack;
  private channel?: RecognitionChannel;
  private scans = new AbortController();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private starting = false;
  private closed = false;
  private fieldTracks=new FieldTrackCache();
  private snapshot: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "" };
  constructor(private options: { slug: string; guildId: string; seat: number; members: VideoMember[]; recognize?: RecognizeRawFeed;
    readPhone?: (canvas: HTMLCanvasElement, point: {x:number;y:number}, signal: AbortSignal) => Promise<PhoneReading>;
    onPhoneScan?: (scan: PhoneScan | null) => void; onPhonePresence?: () => void }) {
    this.phone = new DesktopPhoneLink(this.room, { ...options, read: options.readPhone, onScan: options.onPhoneScan, changed: () => this.sync() });
    this.room.on(RoomEvent.ParticipantConnected, () => this.options.onPhonePresence?.());
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionQualityChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantMetadataChanged]) this.room.on(event, sync);
    this.room.on(RoomEvent.SignalReconnecting, () => this.patch({ signalLost: true }));
    this.room.on(RoomEvent.SignalConnected, () => this.patch({ signalLost: false }));
    this.room.on(RoomEvent.ConnectionStateChanged, connection => {
      this.patch({ connection, ...(connection === ConnectionState.Connected ? { signalLost: false } : {}) }); this.sync();
      if (connection !== ConnectionState.Connected) this.fieldTracks.clear();
      if (connection === ConnectionState.Disconnected) { this.channel?.close(); this.scans.abort(); }
    });
    this.room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic, _encryption, identity) => {
      if (bytes.byteLength > 8192) return;
      // OSS may omit data-only newcomers from remoteParticipants. The sixth argument is
      // SFU-authenticated; bind it to the current HTTP roster, never to message JSON.
      const from = participant ? this.seatOf(participant) : this.options.members.find(member =>
        member.userId !== null && identity === `remote-user-${member.userId}`)?.seat;
      if (from === undefined) return;
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if(topic===FIELD_TRACKS_TOPIC){this.fieldTracks.receive(from,value);return;}
        if(!this.channel)return;
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
      const phoneSeat = this.phone.seat(participant);
      const seat = phoneSeat ?? this.seatOf(participant);
      const camera = participant.getTrackPublication(Track.Source.Camera);
      // Never subscribe to a revoked device, unknown identity, extra camera or unsupported source.
      for (const publication of participant.trackPublications.values()) {
        const allowed = seat !== undefined && (phoneSeat !== undefined
          ? publication === camera && this.phone.mode(participant) !== "scan"
          : publication.source === Track.Source.Camera || publication.source === Track.Source.Microphone);
        if (publication.isDesired !== allowed) publication.setSubscribed(allowed);
      }
      if (seat === undefined) continue;
      const mic = participant.getTrackPublication(Track.Source.Microphone);
      feeds.push({ seat, phone: phoneSeat !== undefined, mode: phoneSeat !== undefined ? this.phone.mode(participant) : undefined, video: camera?.track?.kind === Track.Kind.Video && this.phone.mode(participant) !== "scan" ? camera.videoTrack : undefined,
        audio: mic?.track?.kind === Track.Kind.Audio ? mic.audioTrack as RemoteAudioTrack : undefined,
        quality: participant.connectionQuality, muted: camera?.isMuted ?? false });
    }
    for(const phone of this.phone.dataOnlyFeeds())feeds.push({...phone,phone:true,quality:local.connectionQuality,muted:false});
    this.patch({ feeds: feeds.filter(f => f.phone || !feeds.some(p => p.phone && p.seat === f.seat)) });
    this.fieldTracks.retain(new Set(this.snapshot.feeds.filter(f=>f.video&&!f.muted).map(f=>f.seat)));
  }
  private async refreshDevices() {
    const devices = await Room.getLocalDevices("videoinput", false);
    this.patch({ devices, cameraId: await this.camera?.getDeviceId() ?? this.snapshot.cameraId });
  }
  async connect(deviceId = this.snapshot.cameraId, capture = true) {
    if (this.closed || this.starting) return;
    this.starting = true; const epoch = ++this.epoch;
    this.patch({ error: "", connection: ConnectionState.Connecting });
    try {
      await this.room.disconnect(); this.camera = undefined;
      const response = await fetch(`/api/remote/${encodeURIComponent(this.options.slug)}/livekit${capture ? "" : "?receive=1"}`, { method: "POST", cache: "no-store" });
      const credentials = await response.json();
      if (!response.ok) throw new Error(credentials.error ?? "Video is unavailable");
      if (credentials.seat !== this.options.seat || credentials.room !== `remote-${this.options.slug}`) throw new Error("Video membership changed; reload the table");
      if (this.closed || epoch !== this.epoch) return;
      this.patch({ connection: ConnectionState.Connecting });
      await this.room.connect(credentials.url, credentials.token, { autoSubscribe: false });
      if (this.closed || epoch !== this.epoch) { await this.room.disconnect(); return; }
      if (capture) {
      const camera = await createLocalVideoTrack({ deviceId: deviceId ? { exact: deviceId } : undefined,
        facingMode: "environment", resolution: { width: 1920, height: 1080, aspectRatio: 16 / 9, frameRate: 24 } });
      if (this.closed || epoch !== this.epoch) { camera.stop(); await this.room.disconnect(); return; }
      this.camera = camera; camera.mediaStreamTrack.contentHint = "detail";
      await this.room.localParticipant.publishTrack(camera, { name: "field-cam", source: Track.Source.Camera,
        videoCodec: "vp8", simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 24 }, degradationPreference: "maintain-resolution" });
      if (this.closed || epoch !== this.epoch) { await this.room.disconnect(); return; }
      }
      this.scans = new AbortController();
      this.channel = new RecognitionChannel(this.options.seat, async (message, destination, announcement) => {
        const member = this.options.members.find(p => p.seat === destination && p.userId !== null);
        const identity = member ? `remote-user-${member.userId}` : undefined;
        if (destination !== undefined && !identity) throw new Error("The feed owner is disconnected");
        const data = announcement ? { requestId: message.requestId, feedOwnerSeat: "feedOwnerSeat" in message ? message.feedOwnerSeat : undefined } : message;
        const bytes = new TextEncoder().encode(JSON.stringify(data));
        if (bytes.byteLength > 8192) throw new Error("Recognition message is too large");
        await this.room.localParticipant.publishData(bytes, { reliable: true, topic: announcement ? PENDING_TOPIC : RECOGNITION_TOPIC,
          destinationIdentities: identity ? [identity] : undefined });
      }, async request => {
        const cached=!request.force?this.trackedAt(this.options.seat,request.x,request.y):undefined;
        if(cached)return {candidates:[{cardId:cached.cardId,name:cached.name??`Card ${cached.cardId}`,score:0}],tier:'sure',faceDown:false,covered:false};
        if (this.phone.forSeat(this.options.seat)) {
          const result = await this.phone.read(request.x, request.y, this.scans.signal);
          if (result.reader !== "vision") return NO_ANSWER;
          return { candidates: result.guesses.map(g => ({ ...g, score: Math.max(0, Math.min(1, g.score ?? 0)) })), tier: result.tier ?? "low match", faceDown: !!result.faceDown, covered: !!result.covered };
        }
        if (!this.rawLocalTrack || !this.options.recognize) return NO_ANSWER; // Attach @yugidraft/vision here via options.recognize.
        return this.options.recognize({ track: this.rawLocalTrack, request, signal: this.scans.signal });
      }, (message, fromSeat) => this.patch({ result: { fromSeat, message } }), Date.now,
        owner => this.phone.forSeat(owner) ? 60_000 : 10_000);
      this.patch({ connection: this.room.state, microphone: false }); this.sync(); await this.refreshDevices();
    } catch (error) {
      this.camera?.stop(); this.camera = undefined; await this.room.disconnect();
      if (epoch === this.epoch) { this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false }); this.fail(error); }
    } finally { this.starting = false; }
  }
  async suspendCamera() {
    const camera = this.camera; this.camera = undefined;
    if (camera) { await this.room.localParticipant.unpublishTrack(camera); camera.stop(); }
    this.sync();
  }
  async selectCamera(deviceId: string) {
    const camera = this.camera; const epoch = this.epoch;
    if (!camera) { this.patch({ cameraId: deviceId }); return; }
    await camera.restartTrack({ deviceId: deviceId ? { exact: deviceId } : undefined, resolution: { width: 1920, height: 1080, aspectRatio: 16 / 9, frameRate: 24 } });
    if (this.closed || epoch !== this.epoch || camera !== this.camera) { camera.stop(); return; }
    camera.mediaStreamTrack.contentHint = "detail";
    this.patch({ cameraId: deviceId }); this.sync();
  }
  async setMicrophone(enabled: boolean) {
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
    if (this.closed) { await this.room.disconnect(); return; }
    this.patch({ microphone: enabled });
  }
  trackedAt(seat:number,x:number,y:number) {return this.room.state===ConnectionState.Connected?this.fieldTracks.hit(seat,x,y):undefined;}
  trackedCards(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.snapshot(seat):[];}
  async publishFieldTracks(message:RemoteFieldTracks) {
    if(this.room.state!==ConnectionState.Connected)return;
    this.fieldTracks.receive(this.options.seat,message);
    let bytes=new TextEncoder().encode(JSON.stringify(message));
    // Long names are already in the public twin state; retain every quad within
    // the same small packet budget used by recognition messages.
    if(bytes.byteLength>8192)bytes=new TextEncoder().encode(JSON.stringify({...message,cards:message.cards.map(({name:_,...card})=>card)}));
    if(bytes.byteLength>8192)throw new Error('Field snapshot is too large');
    await this.room.localParticipant.publishData(bytes,{reliable:true,topic:FIELD_TRACKS_TOPIC});
  }
  requestRecognition(seat: number, x = 0.5, y = 0.5, force=false) {
    if (!this.channel || this.room.state !== ConnectionState.Connected) return Promise.reject(new Error("Connect table video first"));
    return this.channel.request(seat, x, y,undefined,force);
  }
  startAudio() { return this.room.startAudio(); }
  fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Video failed" }); }
  async stop() {
    this.phone.reset();
    this.fieldTracks.clear();
    ++this.epoch; this.channel?.close(); this.channel = undefined; this.scans.abort();
    this.camera?.stop(); this.camera = undefined; await this.room.disconnect();
    this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false, result: undefined });
  }
  dispose() { this.phone.dispose(); this.closed = true; this.listeners.clear(); void this.stop(); }
}
