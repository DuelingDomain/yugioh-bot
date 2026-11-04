import { afterEach, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({
  stop: vi.fn(), restart: vi.fn(async (_options?: unknown, _isUnmuting?: boolean) => {}),
  raw: { contentHint: "", readyState: "live" }, rooms: [] as any[], publish: vi.fn(async () => {}),
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Disconnected: "disconnected", Connecting: "connecting", Connected: "connected" },
  Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Video: "video", Audio: "audio" } },
  VideoPresets: { h360: {}, h720: {} }, RoomEvent: new Proxy({}, {get: (_,key) => String(key)}), TrackEvent: { Restarted: 'restarted' },
  Room: class {
    static async getLocalDevices() { return []; }
    state = "disconnected"; remoteParticipants = new Map();
    handlers = new Map<string, Function[]>();
    constructor() { media.rooms.push(this); }
    emit(event: string,...args: unknown[]) { for(const fn of this.handlers.get(event)??[])fn(...args); }
    localParticipant = { publishData: media.publish, connectionQuality: "excellent", publishTrack: vi.fn(async () => {}), setMicrophoneEnabled: vi.fn(async () => {}) };
    on(event: string,fn: Function) { this.handlers.set(event,[...(this.handlers.get(event)??[]),fn]);return this; }
    off() { return this; }
    async connect() { this.state = "connected"; }
    async disconnect() { this.state = "disconnected"; }
  },
  createLocalVideoTrack: async () => ({ mediaStreamTrack: media.raw, stop: media.stop, restart: media.restart,
    async restartTrack(options: unknown) { await this.restart(options); },
    getDeviceId: async () => "camera-a", isMuted: false, on: () => undefined }),
}));
import { RemoteVideo,type RecognizeRawFeed } from "../src/lib/remote/video";
import { CameraLock, cameraFrameCounter, type CameraLight } from "../src/lib/remote/camera-lock";
afterEach(() => { media.raw.readyState = "live"; vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function connected(recognize?:ConstructorParameters<typeof RemoteVideo>[0]["recognize"]) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ seat: 0, room: "remote-t", url: "ws://local", token: "test" })));
  const video = new RemoteVideo({ slug: "t", guildId: "g", seat: 0, recognize, members: [{ seat: 0, userId: 1 }] });
  await video.connect(); return video;
}
it("can choose Default camera after a specific camera without ending the capture", async () => {
  media.restart.mockImplementation(async options => {
    if ((options as { deviceId?: { exact: string } }).deviceId?.exact === "") throw new Error("OverconstrainedError");
  });
  const video = await connected();
  await expect(video.selectCamera("")).resolves.toBeUndefined();
  expect(video.rawLocalTrack).toBe(media.raw);
  await video.stop();
});
it("ignores a camera switch that completes after Stop", async () => {
  let finish!: () => void;
  media.restart.mockImplementation(() => new Promise<void>(done => { finish = done; }));
  const video = await connected();
  const switching = video.selectCamera("camera-b");
  await vi.waitFor(() => expect(media.restart).toHaveBeenCalled());
  await video.stop(); finish();
  await expect(switching).resolves.toBeUndefined();
  expect(video.rawLocalTrack).toBeUndefined();
  expect(video.getSnapshot().feeds).toEqual([]);
});
it("allows retry after the token service returns 503", async () => {
  const video = await connected(); await video.stop();
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "Video is not configured" }, { status: 503 })));
  await video.connect();
  expect(video.getSnapshot().connection).toBe("disconnected");
  expect(video.getSnapshot().error).toBe("Video is not configured");
  video.dispose();
});

it.each([undefined, true])("resumes reads after SDK restart acquisition failures (isUnmuting=%s)", async isUnmuting => {
  const recognize = vi.fn(async () => ({ candidates: [{ cardId: 46986414, name: "Dark Magician", score: .99 }], tier: "sure" as const, faceDown: false, covered: false }));
  const video = await connected(recognize);
  const camera = video.getSnapshot().feeds[0].video as unknown as { restart(constraints?: unknown, isUnmuting?: boolean): Promise<unknown> };
  media.restart.mockImplementation(async () => { media.raw.readyState = "live"; });
  for (let attempt = 0; attempt < 2; attempt++) media.restart.mockImplementationOnce(async () => {
    media.raw.readyState = "ended";
    throw new Error("Transient SDK camera acquisition failure");
  });
  try {
    await expect(camera.restart(undefined, isUnmuting)).resolves.toBeDefined();
    expect(media.restart).toHaveBeenCalledTimes(3);
    expect(media.restart.mock.calls.every(call => call[1] === isUnmuting)).toBe(true);
    expect(video.rawLocalTrack).toBe(media.raw);
    await video.requestRecognition(0, .4, .4, true);
    expect(recognize).toHaveBeenCalledOnce();
  } finally { await video.stop(); video.dispose(); }
});

it("broadcasts safe owner tracks and resolves observer clicks only for the authenticated feed",async()=>{
  const {FIELD_TRACKS_TOPIC}=await import('../src/lib/remote/field-track-cache');
  const video=await connected(),room=media.rooms.at(-1),quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  const message={type:'field.tracks' as const,cards:[{ref:'own',cardId:46986414,name:'Dark Magician',quad}]};
  await video.publishFieldTracks(message);
  expect(video.trackedAt(0,.3,.3)?.ref).toBe('own');
  expect(media.publish).toHaveBeenCalledWith(expect.any(Uint8Array),{reliable:true,topic:FIELD_TRACKS_TOPIC});
  const peer={identity:'remote-user-2',trackPublications:new Map(),metadata:JSON.stringify({guildId:'g',tableId:'t',seat:1,userId:2}),getTrackPublication:()=>({track:{kind:'video'},videoTrack:{kind:'video'},isMuted:false})};
  video.setMembers([{seat:0,userId:1},{seat:1,userId:2}]);room.remoteParticipants.set(peer.identity,peer);room.emit('ParticipantConnected');
  const encoded=(data:unknown)=>new TextEncoder().encode(JSON.stringify(data));
  room.emit('DataReceived',encoded({...message,cards:[{...message.cards[0],ref:'peer'}]}),peer,undefined,FIELD_TRACKS_TOPIC);
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('peer');expect(video.trackedAt(0,.3,.3)?.ref).toBe('own');
  room.emit('DataReceived',encoded({type:'field.tracks',cards:[]}),{...peer,identity:'forged'},undefined,FIELD_TRACKS_TOPIC);
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('peer');
  // The SFU authenticates the sixth argument even when its OSS roster omits a data sender.
  room.emit('DataReceived',encoded({...message,cards:[{...message.cards[0],ref:'sfu-peer'}]}),undefined,undefined,FIELD_TRACKS_TOPIC,undefined,peer.identity);
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('sfu-peer');
  room.emit('DataReceived',encoded({type:'field.tracks',cards:[]}),undefined,undefined,FIELD_TRACKS_TOPIC,undefined,'remote-user-999');
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('sfu-peer');
  room.remoteParticipants.delete(peer.identity);room.emit('ParticipantDisconnected',peer);expect(video.trackedAt(1,.3,.3)).toBeUndefined();
  await video.stop();expect(video.trackedAt(0,.3,.3)).toBeUndefined();
});

it('uses the owner cache for ordinary requests and bypasses it only for an explicit reread',async()=>{
  const recognize=vi.fn(async(_input:Parameters<RecognizeRawFeed>[0])=>({candidates:[{cardId:2,name:'Fresh result',score:.95}],tier:'sure' as const,faceDown:false,covered:false}));
  const video=await connected(recognize),quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  await video.publishFieldTracks({type:'field.tracks',cards:[{ref:'cached',cardId:1,name:'Cached result',quad}]});
  await video.requestRecognition(0,.3,.3);expect(recognize).not.toHaveBeenCalled();
  await new Promise(done=>setTimeout(done,110));await video.requestRecognition(0,.3,.3,true);
  expect(recognize).toHaveBeenCalledOnce();expect(recognize.mock.calls[0][0].request.force).toBe(true);await video.stop();
});

it('keeps the auto picture when a webcam reports stale exposure or delays its manual frames', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  const scenarios = [
    { name: 'stale minimum', stale: 1, live: 200, locks: true },
    { name: 'Windows quantization', stale: 1.220703125, live: 156.25, quantum: true, locks: true },
    { name: 'overbright default', stale: 800, live: 100, locks: true },
    { name: 'queued auto frames', stale: 1, live: 200, frameDelay: 700, locks: true },
    { name: 'advancing buffered auto frames', stale: 1, live: 200, frameDelay: 700, queuedAdvancing: true, locks: true },
    { name: 'no new frames', stale: 1, live: 200, frameDelay: Infinity, locks: false },
    { name: 'ineffective exposure', stale: 1, live: 200, ineffective: true, locks: false },
    { name: 'negative driver range', stale: -10, live: 200, negative: true, locks: false },
    { name: 'rejected manual write', stale: 1, live: 200, reject: true, locks: false },
    { name: 'late manual write', stale: 1, live: 200, writeDelay: 700, locks: false },
    { name: 'unverified glare rollback', stale: 100, live: 100, glare: true, locks: true },
  ];
  try {
    for (const scenario of scenarios) {
      let mode = 'continuous', exposure = scenario.stale, manualAt = Infinity, glare = false, darkRollback = false;
      let presentFrame = () => {}, lastFrameAt = -Infinity;
      const video = {
        // Chrome's playback clock keeps advancing even when camera pixels stop arriving.
        get currentTime() { return Date.now() / 1000; },
        requestVideoFrameCallback(callback: VideoFrameRequestCallback) { presentFrame = () => callback(Date.now(), {} as VideoFrameCallbackMetadata); return 1; },
        cancelVideoFrameCallback() { presentFrame = () => {}; },
      } as HTMLVideoElement;
      const frames = cameraFrameCounter(video);
      const writes: { at: number; exposure: number }[] = [];
      const range = scenario.negative ? { min: -13, max: -1, step: 1 }
        : scenario.quantum ? { min: 1.220703125, max: 1250, step: 2 } : { min: 1, max: 10000, step: 1 };
      const track = {
        readyState: 'live', label: scenario.name, addEventListener() {}, removeEventListener() {},
        getConstraints: () => ({ width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { exact: 30 } }),
        getCapabilities: () => ({ exposureMode: ['continuous', 'manual'], exposureTime: range }),
        getSettings: () => ({ exposureMode: mode, exposureTime: mode === 'continuous' ? scenario.stale : exposure }),
        async applyConstraints(constraints: MediaTrackConstraints) {
          expect(constraints.width).toEqual({ exact: 1920 });
          for (const value of constraints.advanced ?? []) {
            const control = value as { exposureMode?: string; exposureTime?: number };
            if (control.exposureMode === 'continuous') { mode = 'continuous'; darkRollback = false; }
            if (control.exposureMode === 'manual') {
              if (scenario.reject) throw new Error('Driver rejected manual exposure');
              if (scenario.writeDelay) await new Promise(done => setTimeout(done, scenario.writeDelay));
              if (mode !== 'manual') manualAt = Date.now();
              mode = 'manual';
              if (control.exposureTime !== undefined) {
                writes.push({ at: Date.now(), exposure: control.exposureTime });
                exposure = scenario.quantum ? 10000 * 2 ** Math.trunc(Math.log2(control.exposureTime / 10000)) : control.exposureTime;
                if (glare && exposure < scenario.live) darkRollback = true;
              }
            }
          }
        },
      } as unknown as MediaStreamTrack;
      const measure = (): CameraLight & { frameTime: number } => {
        const queued = mode === 'manual' && Date.now() - manualAt < (scenario.frameDelay ?? 0);
        if (Date.now() !== lastFrameAt && (!queued || scenario.queuedAdvancing)) { lastFrameAt = Date.now(); presentFrame(); }
        const mean = mode === 'continuous' || queued ? 100 : darkRollback || scenario.ineffective ? 8 : Math.min(255, 100 * exposure / scenario.live);
        return { mean, clipped: glare ? .15 : 0, sharpness: 100 * (mean / 100) ** 2, colour: [1/3, 1/3, 1/3],
          frameTime: frames.read() };
      };
      const lock = new CameraLock(track, scenario.name, () => undefined, measure);
      try {
        lock.start();
        // Stop at the first completed lock/fallback, before the glare monitoring window ends.
        for (let elapsed = 0; elapsed < 8000 && lock.getSnapshot().busy; elapsed += 50) await vi.advanceTimersByTimeAsync(50);
        expect(lock.getSnapshot().busy, scenario.name).toBe(false);
        expect(lock.getSnapshot().locked, scenario.name).toBe(scenario.locks);
        if (scenario.locks) {
          expect(measure().mean / 100, scenario.name).toBeGreaterThanOrEqual(.75);
          expect(measure().mean / 100, scenario.name).toBeLessThanOrEqual(1.33);
          expect(mode, scenario.name).toBe('manual');
        } else {
          expect(mode, scenario.name).toBe('continuous');
          expect(measure().mean, scenario.name).toBe(100);
          expect(lock.getSnapshot().note, scenario.name).toBe('Camera lock not supported — auto kept');
          if (writes.length && !scenario.writeDelay) expect(Date.now() - writes[0].at, scenario.name).toBeLessThanOrEqual(1600);
        }
        if (scenario.negative) expect(writes, scenario.name).toHaveLength(0);
        if (scenario.writeDelay) {
          await vi.advanceTimersByTimeAsync(1000);
          expect(mode, scenario.name).toBe('continuous');
          expect(lock.getSnapshot().note, scenario.name).toBe('Camera lock not supported — auto kept');
        }
        if (scenario.glare) {
          glare = true;
          await vi.advanceTimersByTimeAsync(3500);
          expect(mode).toBe('continuous');
          expect(measure().mean).toBe(100);
          expect(lock.getSnapshot().locked).toBe(false);
          expect(writes.length).toBeLessThanOrEqual(5);
        }
        if (scenario.frameDelay === 700) expect(Date.now() - writes[0].at).toBeGreaterThanOrEqual(700);
      } finally {
        await lock.release(); await vi.runOnlyPendingTimersAsync();
        frames.stop();
        expect(mode, `${scenario.name}: release/late write`).toBe('continuous');
      }
    }
  } finally { vi.useRealTimers(); }
});
