import { DesktopPhoneLink } from "./phone-desktop";
import type { PhoneReading, PhoneScan } from "./phone-protocol";
import {
  ConnectionState, Room, RoomEvent, Track, TrackEvent, createLocalVideoTrack,
  type ConnectionQuality, type LocalVideoTrack, type RemoteVideoTrack, type RemoteAudioTrack,
} from "livekit-client";
import {
  participantSeat, RecognitionChannel, RECOGNITION_TOPIC, PENDING_TOPIC, NO_ANSWER,
  type VideoMember, type RecognitionAnswer, type RecognitionRequest, type RecognitionResult,
} from "./video-protocol";
import {FieldTrackCache,FIELD_BACKS_TOPIC,FIELD_TRACKS_TOPIC,emptyBacks} from './field-track-cache';
import type {RemoteFieldTracks} from '@yugidraft/shared/remote';
import { FIELD_CAMERA } from "@/components/remote/ui/camera-choice";
import { RemoteVoice } from "./voice";
import { REMOTE_TABLE_TALK } from "./table-talk";
import { keepCameraAuto, optimizeRecognitionCapture, releaseCameraLock } from './camera-lock';
import { CAMERA_PUBLISH, applyCameraRate, capSendResolution, cpuLimited, publishCamera, republishAsFallback, watchCpuLimit, watchEncoder } from './video-profile';
import { readVideoRate, saveVideoRate, type VideoRate } from './video-rate';
import { cameraTraffic, type CameraTraffic } from './video-stats';
import { PEER_VISION_INTERVAL_MS, PEER_VISION_REFRESH_MS, PEER_VISION_TOPIC, PeerVisionCache, encodePeerVision, peerVisionChanged, roundMs, type PeerVision } from './peer-vision';
import { watchSendHealth } from './send-health';
import { recognitionGeneration } from '@/components/remote/ui/recognition-backend';

export type VideoFeed = { seat: number; video?: LocalVideoTrack | RemoteVideoTrack; audio?: RemoteAudioTrack; quality: ConnectionQuality; muted: boolean; phone?: boolean; mode?: string };
export type VideoSnapshot = {
  connection: ConnectionState; feeds: VideoFeed[]; devices: MediaDeviceInfo[];
  cameraId: string; microphone: boolean; error: string; /** The signal link dropped and the SDK is trying to resume it. */ signalLost?: boolean; /** The browser encoder stayed CPU limited for 20 s while the page was visible. Only tells; nothing changes by itself. */ cpuConstrained?: boolean; /** Frames per second sent for my webcam. */ videoRate: VideoRate; /** The camera could not be published again after the encoder failed: opponents see nothing, the local capture still runs. */ sendFailed?: boolean; result?: { fromSeat: number; message: RecognitionResult };
};
/** @yugidraft/vision integration point: crop/recognize on this unprocessed local capture track.
 * Honor signal; return at most five candidates, with the reader's tier, within 10 seconds. No frames enter the data channel.
 */
export type RecognizeRawFeed = (input: { track: MediaStreamTrack; request: RecognitionRequest; signal: AbortSignal }) => Promise<RecognitionAnswer>;

export class RemoteVideo {
  private voice = new RemoteVoice({ slug: () => this.options.slug, guildId: () => this.options.guildId, members: () => this.options.members, changed: () => this.sync(), failed: error => this.fail(error) });
  private room = new Room({ adaptiveStream: false, dynacast: true, stopLocalTrackOnUnpublish: false, disconnectOnPageLeave: false });
  readonly phone: DesktopPhoneLink;
  private camera?: LocalVideoTrack;
  private readyTrack?: MediaStreamTrack;
  private preparing?: { track: MediaStreamTrack; promise: Promise<void> };
  private channel?: RecognitionChannel;
  private scans = new AbortController();
  private listeners = new Set<() => void>();
  private epoch = 0;
  private starting = false;
  private closed = false;
  private pagehide = () => { void this.voice.stop(); void this.room.disconnect().catch(error => this.fail(error)); };
  private fieldTracks=new FieldTrackCache();
  private backsSent=false;
  /** What the other players see on this player's feed: reader speed and video rate. Fed by `setVision`, sent over the data channel. */
  readonly vision = new PeerVisionCache();
  private visionReport?: Pick<PeerVision, "backend" | "ms" | "detect">;
  private visionSent?: PeerVision;
  private visionAt = 0;
  /** The last time `sendVision` read the encoder stats: that read is the costly part, so it runs once per interval at most. */
  private visionTried = 0;
  private visionBusy = false;
  private visionTimer?: ReturnType<typeof setInterval>;
  private snapshot: VideoSnapshot = { connection: ConnectionState.Disconnected, feeds: [], devices: [], cameraId: "", microphone: false, error: "", videoRate: readVideoRate() };
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
    this.room.on(RoomEvent.ParticipantConnected, () => { this.options.onPhonePresence?.(); this.visionSent = undefined; });
    const sync = () => this.sync();
    for (const event of [RoomEvent.TrackPublished, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.ConnectionQualityChanged, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ParticipantMetadataChanged]) this.room.on(event, sync);
    this.room.on(RoomEvent.SignalReconnecting, () => this.patch({ signalLost: true }));
    this.room.on(RoomEvent.SignalConnected, () => this.patch({ signalLost: false }));
    this.room.on(RoomEvent.ConnectionStateChanged, connection => {
      this.patch({ connection, ...(connection === ConnectionState.Connected ? { signalLost: false } : {}) }); this.sync();
      if (connection !== ConnectionState.Connected) { this.fieldTracks.clear(); this.vision.clear(); this.stopVisionTimer(); }
      else if (!this.visionTimer) { this.visionTimer = setInterval(() => void this.sendVision(), PEER_VISION_INTERVAL_MS); void this.sendVision(); }
      if (connection === ConnectionState.Disconnected) {
        this.channel?.close(); this.scans.abort();
        void this.voice.stop();
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
      if (topic === PEER_VISION_TOPIC) { if (from !== this.options.seat) this.vision.receive(from, bytes); return; }
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes));
        if(topic===FIELD_TRACKS_TOPIC){this.fieldTracks.receive(from,value,{keepBacks:true});return;}
        if(topic===FIELD_BACKS_TOPIC){this.fieldTracks.receiveBacks(from,value);return;}
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
  setMembers(members: VideoMember[]) { this.options.members = members; this.voice.sync(); }
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
          : publication.source === Track.Source.Camera);
        if (publication.isDesired !== allowed) publication.setSubscribed(allowed);
        // Every player asks for the top layer, as a spectator does: freeze, peek and Read all need the full frame. Adaptive stream is off, so a small tile never picks a lower one.
        if (allowed && !this.pinned.has(publication)) { publication.setVideoQuality(CAMERA_PUBLISH.receiverLayer); if (publication.isSubscribed) this.pinned.add(publication); }
      }
      if (seat === undefined) continue;
      feeds.push({ seat, phone: phoneSeat !== undefined, mode: phoneSeat !== undefined ? this.phone.mode(participant) : undefined, video: camera?.track?.kind === Track.Kind.Video && this.phone.mode(participant) !== "scan" ? camera.videoTrack : undefined,
        audio: phoneSeat === undefined ? this.voice.audio(seat) : undefined,
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
    // A stale camera (replaced while it was starting) must not wipe the state of the current one.
    if (!this.camera || this.camera === camera) this.cameraGone();
    await releaseCameraLock(camera.mediaStreamTrack);
    camera.stop();
  }
  private prepareCamera(camera: LocalVideoTrack) {
    const track = camera.mediaStreamTrack, epoch = this.epoch;
    if (this.preparing?.track === track) return this.preparing.promise;
    this.readyTrack = undefined; this.sync();
    const promise = (async () => {
      track.contentHint = CAMERA_PUBLISH.contentHint;
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
      const previous = this.camera; this.camera = undefined; this.readyTrack = undefined; this.preparing = undefined; this.cameraGone();
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
      // LiveKit's public restartTrack, unmute and foreground recovery all use this
      // protected SDK boundary. Preserve isUnmuting so replacement capture is enabled.
      const sdkCamera = camera as unknown as { restart(constraints?: MediaTrackConstraints, isUnmuting?: boolean): Promise<unknown> };
      const restart = sdkCamera.restart.bind(camera), mute = camera.mute?.bind(camera);
      let restarting = 0;
      sdkCamera.restart = async (constraints, isUnmuting) => {
        const epoch = this.epoch;
        const current = () => !this.closed && epoch === this.epoch && this.camera === camera;
        this.readyTrack = undefined; this.preparing = undefined; this.sync();
        await releaseCameraLock(camera.mediaStreamTrack);
        if (!current()) return;
        restarting++;
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              await restart(constraints, isUnmuting);
              if (!current()) { await this.stopCamera(camera); return; }
              await this.prepareCamera(camera);
              return camera;
            } catch {
              if (!current()) { await this.stopCamera(camera); return; }
            }
          }
          // LiveKit can stop the old track before acquisition fails. Reopen the default
          // camera in that case; skip format optimization and keep this capture on auto.
          await releaseCameraLock(camera.mediaStreamTrack);
          if (!current()) return;
          if (camera.mediaStreamTrack.readyState === 'ended') await restart(FIELD_CAMERA, isUnmuting);
          if (!current()) { await this.stopCamera(camera); return; }
          const track = camera.mediaStreamTrack;
          if (track.readyState === 'ended') throw new Error('The camera is unavailable. Reconnect it and try again.');
          await keepCameraAuto(track);
          if (!current()) { await this.stopCamera(camera); return; }
          this.preparing = undefined; this.readyTrack = track;
          this.patch({ cameraId: await camera.getDeviceId() ?? '' });
          this.fail(new Error('Camera restart failed. Card reading is on with the camera on auto.')); this.sync();
          return camera;
        } finally { restarting--; }
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
      await this.publishCamera(camera);
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
        // Never to the whole room: hidden spectators are in it, and a read answer is for the players only.
        const seated = this.options.members.flatMap(p => p.userId !== null && p.seat !== this.options.seat ? [`remote-user-${p.userId}`] : []);
        if (!identity && !seated.length) return;
        await this.room.localParticipant.publishData(bytes, { reliable: true, topic: announcement ? PENDING_TOPIC : RECOGNITION_TOPIC,
          destinationIdentities: identity ? [identity] : seated });
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
      this.patch({ connection: this.room.state, microphone: false }); this.sync(); if (REMOTE_TABLE_TALK) void this.voice.start(); await this.refreshDevices();
    } catch (error) {
      await this.stopCamera(this.camera); this.camera = undefined; this.readyTrack = undefined; await this.voice.stop(); await this.room.disconnect();
      if (epoch === this.epoch) { this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false }); this.fail(error); }
    } finally { this.starting = false; }
  }
  /** Publish steps (first publish, rate change, republish) run one after the other, so none uses a sender another one is replacing. */
  private publishing: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.publishing.then(work, work);
    this.publishing = run.catch(() => undefined);
    return run;
  }
  /** Publish with the profile (VP8 fallback in `publishCamera`), then watch that the encoder makes frames and whether the CPU limits it. */
  private publishCamera(camera: LocalVideoTrack) {
    const here = () => this.closed || this.camera !== camera;
    return this.serial(async () => {
      if (here()) return;
      this.cameraGone();
      const used = this.snapshot.videoRate;
      const codec = await publishCamera(this.room.localParticipant, camera, () => this.closed, undefined, used);
      if (here()) return;
      this.codec = codec; this.sentRate = used;
      // Send at most 720p although the capture is 1080p (the card reader reads the capture, not the sent stream).
      await capSendResolution(camera).catch(() => undefined);
      // One event is one monitor sample; the offer needs the limit to hold (see watchCpuLimit).
      camera.on(TrackEvent.CpuConstrained, () => {
        if (here() || this.stopCpuWatch) return;
        this.stopCpuWatch = watchCpuLimit(camera, () => { if (!here()) this.patch({ cpuConstrained: true }); }, () => { this.stopCpuWatch = undefined; });
      });
      // The player may have changed the rate while the publish ran: read it again now.
      if (this.snapshot.videoRate !== used) await this.applyRate(camera);
      else this.watchEncoder(camera);
    });
  }
  private codec = "";
  /** The rate the published camera is set to. */
  private sentRate: VideoRate | undefined;
  /** The rate the last republish read: it is what that publish used. */
  private rateRead: VideoRate | undefined;
  private watchEncoder(camera: LocalVideoTrack) {
    const participant = this.room.localParticipant, here = () => this.closed || this.camera !== camera;
    // Smooth video under load: slows card vision while the encoder is CPU limited and resets the encoder in place if the limit stays. Never republishes.
    this.stopHealthWatch?.();
    this.stopHealthWatch = watchSendHealth(camera, { gone: here, rate: () => this.snapshot.videoRate, run: work => this.serial(work), readerGeneration: recognitionGeneration });
    this.stopEncoderWatch = watchEncoder(participant, camera, this.codec, {
      closed: here, connected: () => this.room.state === ConnectionState.Connected,
      rate: () => (this.rateRead = this.snapshot.videoRate),
      run: work => this.serial(work),
      republished: () => {
        this.codec = CAMERA_PUBLISH.fallbackCodec; this.sentRate = this.rateRead;
        if (this.snapshot.sendFailed || this.snapshot.error) this.patch({ sendFailed: false, error: "" });
        this.sync();
      },
      // Both tries failed: the state is shown (health, message, Retry video). The capture is kept alive for card reading.
      failed: () => this.sendFailed(),
    });
  }
  private sendFailed() {
    this.patch({ sendFailed: true });
    this.fail(new Error('Opponents cannot see your camera. Use Retry video, or turn the camera off and on.'));
  }
  /** Retry the publish after it failed. Same steps as the encoder check; the capture is not touched unless the browser ended it. */
  retryVideo() {
    const camera = this.camera;
    if (!camera || this.closed) return Promise.resolve();
    return this.serial(async () => {
      // A second click waits in the queue; by then the first retry may have worked, and good video must stay.
      if (this.closed || this.camera !== camera || !this.snapshot.sendFailed) return;
      this.patch({ error: "" });
      const rate = this.snapshot.videoRate;
      try {
        await republishAsFallback(this.room.localParticipant, camera, () => this.closed || this.camera !== camera, rate);
        if (this.closed || this.camera !== camera) return;
        this.codec = CAMERA_PUBLISH.fallbackCodec; this.sentRate = rate; this.patch({ sendFailed: false, error: "" });
        this.sync();
      } catch { if (!this.closed && this.camera === camera) this.sendFailed(); }
    });
  }
  /** The player's choice of frames per second. Saved; applied to the running camera without a reconnect or a stop of the capture. */
  async setVideoRate(rate: VideoRate) {
    saveVideoRate(rate);
    if (rate === this.snapshot.videoRate) return;
    this.patch({ videoRate: rate });
    const camera = this.camera;
    if (!camera) return;
    await this.serial(async () => {
      // After a publish in flight: `codec` is set by then, and the rate is read again.
      if (this.closed || this.camera !== camera || !this.codec || this.sentRate === this.snapshot.videoRate) return;
      await this.applyRate(camera);
    });
  }
  /** Inside `serial`. */
  private async applyRate(camera: LocalVideoTrack) {
    // The watches belong to the old rate: the CPU flag starts again and the encoder check waits for the change.
    this.endWatches();
    const rate = this.snapshot.videoRate;
    try {
      const how = await applyCameraRate(this.room.localParticipant, camera, this.codec, rate, () => this.closed || this.camera !== camera);
      this.sentRate = rate;
      if (how === "republished" && this.snapshot.sendFailed) this.patch({ sendFailed: false, error: "" });
    } catch { if (!this.closed && this.camera === camera) this.sendFailed(); }
    if (!this.closed && this.camera === camera) { this.watchEncoder(camera); this.sync(); }
  }
  /** Look at the encoder now. Clears the CPU flag when the limit is gone, so an old spike never raises the offer. */
  async cpuStillLimited(): Promise<boolean> {
    const camera = this.camera;
    if (!camera || this.closed) return false;
    let limited = false;
    try { limited = await cpuLimited(camera); } catch { limited = false; }
    if (!limited && this.snapshot.cpuConstrained) this.patch({ cpuConstrained: false });
    return limited;
  }
  private stopEncoderWatch?: () => void;
  private stopCpuWatch?: () => void;
  private stopHealthWatch?: () => void;
  private pinned = new WeakSet<object>();
  /** The watches belong to one camera: end them, and clear the CPU flag, when a camera starts or stops. */
  private endWatches() {
    this.stopEncoderWatch?.(); this.stopEncoderWatch = undefined;
    this.stopCpuWatch?.(); this.stopCpuWatch = undefined;
    this.stopHealthWatch?.(); this.stopHealthWatch = undefined;
    if (this.snapshot.cpuConstrained) this.patch({ cpuConstrained: false });
  }
  /** A camera starts or stops: the watches end, and nothing of the old publish stays (codec, failed state). */
  private cameraGone() {
    this.endWatches(); this.codec = ""; this.sentRate = undefined;
    if (this.snapshot.sendFailed) this.patch({ sendFailed: false });
  }
  /** This player's reader state, from the card reader and the Auto-detect setting. Null when there is no camera to speak for. */
  setVision(report: Pick<PeerVision, "backend" | "ms" | "detect"> | null) {
    const before = this.visionReport;
    this.visionReport = report ?? undefined;
    // Only stores the report: the interval sends it. A new reader backend or Auto-detect mode goes out at once, a read time does not.
    if (report && (!before || before.backend !== report.backend || before.detect !== report.detect)) void this.sendVision();
  }
  private stopVisionTimer() { clearInterval(this.visionTimer); this.visionTimer = undefined; }
  /** Frames per second and size of the top layer this computer sends. Nothing when the camera is a phone or the encoder has no stats yet. */
  private async sentVideo(): Promise<Pick<PeerVision, "fps" | "width" | "height">> {
    const camera = this.camera;
    if (!camera || this.phone.forSeat(this.options.seat)) return {};
    const senders = [camera.sender, ...[...camera.simulcastCodecs.values()].map(codec => codec.sender)];
    const top = (await cameraTraffic("sent", this.options.seat, senders)).sort((a, b) => b.width - a.width)[0];
    return top && top.fps > 0 && top.width > 0 ? { fps: Math.round(top.fps), width: top.width, height: top.height } : {};
  }
  /** At most one stats read and one message per 3 s, and only when a value moved meaningfully (or every 5 s, for a player who joined later). */
  private async sendVision() {
    const report = this.visionReport;
    if (!report || this.closed || this.visionBusy || this.room.state !== ConnectionState.Connected || Date.now() - this.visionTried < PEER_VISION_INTERVAL_MS - 200) return;
    this.visionBusy = true; this.visionTried = Date.now();
    try {
      const next: PeerVision = { backend: report.backend, detect: report.detect, ...(report.ms === undefined ? {} : { ms: roundMs(report.ms) }), ...await this.sentVideo().catch(() => ({})) };
      const now = Date.now();
      if (!peerVisionChanged(this.visionSent, next) && now - this.visionAt < PEER_VISION_REFRESH_MS) return;
      if (this.closed || this.room.state !== ConnectionState.Connected) return;
      // Room wide: spectators see it too. It is the same public summary the player sees on their own feed.
      await this.room.localParticipant.publishData(encodePeerVision(next), { reliable: true, topic: PEER_VISION_TOPIC });
      this.visionSent = next; this.visionAt = now;
    } catch { /* A chip is not worth an error: the next tick tries again. */ }
    finally { this.visionBusy = false; }
  }
  /** Raw WebRTC counters of every camera this device sends or receives, for the owner Debug panel. Never throws. */
  async trafficStats(): Promise<CameraTraffic[]> {
    if (this.room.state !== ConnectionState.Connected) return [];
    const senders = this.camera ? [this.camera.sender, ...[...this.camera.simulcastCodecs.values()].map(codec => codec.sender)] : [];
    const out = await cameraTraffic("sent", this.options.seat, senders);
    for (const feed of this.snapshot.feeds) {
      const track = feed.video as { receiver?: RTCRtpReceiver } | undefined;
      if (feed.seat === this.options.seat || !track?.receiver) continue;
      out.push(...await cameraTraffic("received", feed.seat, [track.receiver]));
    }
    return out;
  }
  async suspendCamera() {
    const camera = this.camera; this.camera = undefined; this.readyTrack = undefined; this.cameraGone();
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
    if (!REMOTE_TABLE_TALK) return;
    await this.voice.setMicrophone(enabled);
    if (this.closed) { await this.voice.stop(); return; }
    this.patch({ microphone: enabled });
  }
  trackedAt(seat:number,x:number,y:number) {return this.room.state===ConnectionState.Connected?this.fieldTracks.hit(seat,x,y):undefined;}
  trackedCalibration(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.calibration(seat):undefined;}
  trackedTap(seat:number){return this.room.state===ConnectionState.Connected&&this.fieldTracks.tap(seat);}
  trackedCards(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.snapshot(seat):[];}
  subscribeFieldTracks=(listener:()=>void)=>this.fieldTracks.subscribe(listener);
  trackedBacks(seat:number){return this.room.state===ConnectionState.Connected?this.fieldTracks.backs(seat):emptyBacks;}
  async publishFieldTracks(message:RemoteFieldTracks) {
    if(this.room.state!==ConnectionState.Connected)return;
    this.fieldTracks.receive(this.options.seat,message);
    // Room wide means spectators too, so Set card outlines never go in this message.
    const {backs,...open}=message;
    let bytes=new TextEncoder().encode(JSON.stringify(open));
    // Long names are already in the public twin state; retain every quad within
    // the same small packet budget used by recognition messages.
    if(bytes.byteLength>8192)bytes=new TextEncoder().encode(JSON.stringify({...open,cards:open.cards.map(({name:_,...card})=>card)}));
    if(bytes.byteLength>8192)throw new Error('Field snapshot is too large');
    await this.room.localParticipant.publishData(bytes,{reliable:true,topic:FIELD_TRACKS_TOPIC});
    // The field watcher sends again each second, so a player who joins or reloads has the outlines within a second. An empty list clears them.
    const seated=this.options.members.flatMap(p=>p.userId!==null&&p.seat!==this.options.seat?[`remote-user-${p.userId}`]:[]);
    if(!seated.length||(!backs?.length&&!this.backsSent))return;
    this.backsSent=!!backs?.length;
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({type:'field.tracks',cards:[],backs:backs??[]})),{reliable:true,topic:FIELD_BACKS_TOPIC,destinationIdentities:seated});
  }
  requestRecognition(seat: number, x = 0.5, y = 0.5, force=false) {
    if (!this.channel || this.room.state !== ConnectionState.Connected) return Promise.reject(new Error("Connect table video first"));
    return this.channel.request(seat, x, y,undefined,force);
  }
  startAudio() { return this.voice.startAudio(); }
  fail(error: unknown) { this.patch({ error: error instanceof Error ? error.message : "Video failed" }); }
  async stop() {
    this.phone.reset();
    this.fieldTracks.clear();
    ++this.epoch; this.channel?.close(); this.channel = undefined; this.scans.abort();
    await this.stopCamera(this.camera); this.camera = undefined; this.readyTrack = undefined; await this.voice.stop(); await this.room.disconnect();
    this.patch({ connection: ConnectionState.Disconnected, feeds: [], microphone: false, result: undefined });
  }
  dispose() { if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.pagehide); this.stopVisionTimer(); this.vision.clear(); this.phone.dispose(); this.closed = true; this.listeners.clear(); void this.stop(); }
}
