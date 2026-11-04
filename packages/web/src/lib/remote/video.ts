import { DesktopPhoneLink } from "./phone-desktop";
import type { PhoneReading, PhoneScan } from "./phone-protocol";
import {
  ConnectionState, Room, RoomEvent, Track, TrackEvent, VideoPresets, createLocalVideoTrack,
  type ConnectionQuality, type LocalVideoTrack, type LocalAudioTrack, type RemoteVideoTrack, type RemoteAudioTrack,
} from "livekit-client";
import {
  participantSeat, RecognitionChannel, RECOGNITION_TOPIC, PENDING_TOPIC, NO_ANSWER,
  type VideoMember, type RecognitionAnswer, type RecognitionRequest, type RecognitionResult,
} from "./video-protocol";
import {FieldTrackCache,FIELD_TRACKS_TOPIC,emptyBacks} from './field-track-cache';
import type {RemoteFieldTracks} from '@yugidraft/shared/remote';
import { FIELD_CAMERA } from "@/components/remote/ui/camera-choice";
import { keepCameraAuto, optimizeRecognitionCapture, releaseCameraLock } from './camera-lock';

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
  private room = new Room({ adaptiveStream: true, dynacast: true, stopLocalTrackOnUnpublish: false, disconnectOnPageLeave: false });
  readonly phone: DesktopPhoneLink;
  private camera?: LocalVideoTrack;
  private readyTrack?: MediaStreamTrack;
  private microphoneTrack?: LocalAudioTrack;
  private preparing?: { track: MediaStreamTrack; promise: Promise<void> };
  private channel?: RecognitionChannel;
  private scans = new AbortController();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private starting = false;
  private closed = false;
  private pagehide = () => { void this.room.disconnect().catch(error => this.fail(error)); };
  private fieldTracks=new FieldTrackCache();
  private snapshot: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "" };
  constructor(private options: { slug: string; guildId: string; seat: number; members: VideoMember[]; recognize?: RecognizeRawFeed;
    readPhone?: (canvas: HTMLCanvasElement, point: {x:number;y:number}, signal: AbortSignal) => Promise<PhoneReading>;
    onPhoneScan?: (scan: PhoneScan | null) => void; onPhonePresence?: () => void }) {
    // Guard SDK disconnects too. Do not wait for a driver reset before sending leave.
    const disconnect = this.room.disconnect.bind(this.room);
    this.room.disconnect = stopTracks => {
      const track = this.camera?.mediaStreamTrack;
      if (track) void releaseCameraLock(track);
      return disconnect(stopTracks);
    };
    // beforeunload can be cancelled. Leave only when pagehide confirms the departure.
    if (typeof window !== 'undefined') window.addEventListener('pagehide', this.pagehide);
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
      if (connection === ConnectionState.Disconnected) {
        this.channel?.close(); this.scans.abort();
        this.microphoneTrack?.stop(); this.microphoneTrack = undefined;
        const camera = this.camera; this.camera = undefined; this.readyTrack = undefined; this.preparing = undefined;
        if (camera) { ++this.epoch; void this.stopCamera(camera).catch(error => this.fail(error)); this.sync(); }
      }
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
  get rawLocalTrack() { return this.readyTrack === this.camera?.mediaStreamTrack && this.readyTrack?.readyState === 'live' ? this.readyTrack : undefined; }
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
  private async stopCamera(camera: LocalVideoTrack | undefined) {
    if (!camera) return;
    await releaseCameraLock(camera.mediaStreamTrack);
    camera.stop();
  }
  private prepareCamera(camera: LocalVideoTrack) {
    const track = camera.mediaStreamTrack, epoch = this.epoch;
    if (this.preparing?.track === track) return this.preparing.promise;
    this.readyTrack = undefined; this.sync();
    const promise = (async () => {
      track.contentHint = 'detail';
      await optimizeRecognitionCapture(track);
      if (this.closed || epoch !== this.epoch || this.camera !== camera || camera.mediaStreamTrack !== track) return;
      if (track.readyState === 'ended') throw new Error('The camera stopped. Try again.');
      this.readyTrack = track; this.sync();
    })().catch(error => {
      if (this.preparing?.promise === promise) this.preparing = undefined;
      throw error;
    });
    this.preparing = { track, promise };
    return promise;
  }
  async connect(deviceId = this.snapshot.cameraId, capture = true) {
    if (this.closed || this.starting) return;
    this.starting = true; const epoch = ++this.epoch;
    this.patch({ error: "", connection: ConnectionState.Connecting });
    try {
      const previous = this.camera; this.camera = undefined; this.readyTrack = undefined; this.preparing = undefined;
      await this.stopCamera(previous); await this.room.disconnect();
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
        facingMode: "environment", resolution: FIELD_CAMERA });
      if (this.closed || epoch !== this.epoch) { await this.stopCamera(camera); await this.room.disconnect(); return; }
      this.camera = camera;
      // SDK restarts (unmute, device change, foreground recovery) must release the old UVC controls first.
      const restart = camera.restartTrack.bind(camera), mute = camera.mute?.bind(camera);
      let restarting = false;
      camera.restartTrack = async options => {
        const epoch = this.epoch;
        const current = () => !this.closed && epoch === this.epoch && this.camera === camera;
        this.readyTrack = undefined; this.preparing = undefined; this.sync();
        await releaseCameraLock(camera.mediaStreamTrack);
        if (!current()) return;
        restarting = true;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await restart(options);
              if (!current()) { await this.stopCamera(camera); return; }
              await this.prepareCamera(camera);
              return;
            } catch {
              if (!current()) { await this.stopCamera(camera); return; }
            }
          }
          // LiveKit can stop the old track before acquisition fails. Reopen the default
          // camera in that case; skip format optimization and keep this capture on auto.
          await releaseCameraLock(camera.mediaStreamTrack);
          if (!current()) return;
          if (camera.mediaStreamTrack.readyState === 'ended') await restart({ resolution: FIELD_CAMERA });
          if (!current()) { await this.stopCamera(camera); return; }
          const track = camera.mediaStreamTrack;
          if (track.readyState === 'ended') throw new Error('The camera is unavailable. Reconnect it and try again.');
          await keepCameraAuto(track);
          if (!current()) { await this.stopCamera(camera); return; }
          this.preparing = undefined; this.readyTrack = track;
          this.patch({ cameraId: await camera.getDeviceId() ?? '' });
          this.fail(new Error('Camera restart failed. Card reading is on with the camera on auto.')); this.sync();
        } finally { restarting = false; }
      };
      if (mute) camera.mute = async () => {
        this.readyTrack = undefined; this.preparing = undefined; this.sync();
        await releaseCameraLock(camera.mediaStreamTrack);
        return mute();
      };
      camera.on(TrackEvent.Restarted, () => {
        if (this.camera === camera && !restarting) void this.prepareCamera(camera).catch(() => camera.restartTrack().catch(error => this.fail(error)));
      });
      await this.prepareCamera(camera);
      if (this.closed || epoch !== this.epoch) { await this.stopCamera(camera); return; }
      if (camera.mediaStreamTrack.readyState === 'ended') throw new Error('The camera stopped before it could be shared. Try again.');
      await this.room.localParticipant.publishTrack(camera, { name: "field-cam", source: Track.Source.Camera,
        videoCodec: "vp8", simulcast: true, videoSimulcastLayers: [VideoPresets.h360, VideoPresets.h720],
        videoEncoding: { maxBitrate: 3_000_000, maxFramerate: 30 }, degradationPreference: "maintain-resolution" });
      if (this.closed || epoch !== this.epoch) { await this.stopCamera(camera); await this.room.disconnect(); return; }
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
      await this.stopCamera(this.camera); this.camera = undefined; this.readyTrack = undefined; await this.room.disconnect();
      if (epoch === this.epoch) { this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false }); this.fail(error); }
    } finally { this.starting = false; }
  }
  async suspendCamera() {
    const camera = this.camera; this.camera = undefined; this.readyTrack = undefined;
    if (camera) { await releaseCameraLock(camera.mediaStreamTrack); await this.room.localParticipant.unpublishTrack(camera); camera.stop(); }
    this.sync();
  }
  async selectCamera(deviceId: string) {
    const camera = this.camera; const epoch = this.epoch;
    if (!camera) { this.patch({ cameraId: deviceId }); return; }
    await camera.restartTrack({ deviceId: deviceId ? { exact: deviceId } : undefined, resolution: FIELD_CAMERA });
    if (this.closed || epoch !== this.epoch || camera !== this.camera) { await this.stopCamera(camera); return; }
    this.patch({ cameraId: await camera.getDeviceId() ?? deviceId }); this.sync();
  }
  async setMicrophone(enabled: boolean) {
    const publication = await this.room.localParticipant.setMicrophoneEnabled(enabled);
    this.microphoneTrack = publication?.audioTrack ?? this.microphoneTrack;
    if (this.closed) { await this.room.disconnect(); return; }
    this.patch({ microphone: enabled });
  }
  trackedAt(seat:number,x:number,y:number) {return this.room.state===ConnectionState.Connected?this.fieldTracks.hit(seat,x,y):undefined;}
  trackedCalibration(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.calibration(seat):undefined;}
  trackedCards(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.snapshot(seat):[];}
  subscribeFieldTracks=(listener:()=>void)=>this.fieldTracks.subscribe(listener);
  trackedBacks(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.backs(seat):emptyBacks;}
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
    await this.stopCamera(this.camera); this.camera = undefined; this.readyTrack = undefined; await this.room.disconnect();
    this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false, result: undefined });
  }
  dispose() { if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pagehide); this.phone.dispose(); this.closed = true; this.listeners.clear(); void this.stop(); }
}
