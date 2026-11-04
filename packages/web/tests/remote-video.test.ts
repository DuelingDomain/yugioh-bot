import { afterEach, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({
  stop: vi.fn(), restart: vi.fn(async (_options: unknown) => {}),
  raw: { contentHint: "", readyState: "live" }, rooms: [] as any[], cameras: [] as any[], publish: vi.fn(async () => {}),
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
  createLocalVideoTrack: async () => {
    const listeners = new Map<string, () => void>();
    const camera = { mediaStreamTrack: media.raw, stop: media.stop, restartTrack: media.restart, getDeviceId: async () => "camera-a", isMuted: false,
      on: (event: string, callback: () => void) => listeners.set(event, callback), emit: (event: string) => listeners.get(event)?.() };
    media.cameras.push(camera); return camera;
  },
}));
import { RemoteVideo,type RecognizeRawFeed } from "../src/lib/remote/video";
import { CameraLock, measureCameraLight, optimizeRecognitionCapture } from "../src/lib/remote/camera-lock";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
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

it('notifies the owner when LiveKit replaces its native camera during recovery', async () => {
  const video = await connected();
  const changed = vi.fn(), off = video.subscribe(changed);
  const camera = media.cameras.at(-1), replacement = { contentHint: '', readyState: 'live' };
  camera.mediaStreamTrack = replacement; camera.emit('restarted');
  expect(video.rawLocalTrack).toBe(replacement); expect(changed).toHaveBeenCalled();
  off(); await video.stop();
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

function lockableCamera() {
  const settings = { deviceId: 'uvc', exposureMode: 'continuous', exposureTime: 120, whiteBalanceMode: 'continuous', colorTemperature: 4600, focusMode: 'continuous', focusDistance: 2 };
  const caps = { exposureMode: ['continuous', 'manual'], exposureTime: { min: 10, max: 1000 }, whiteBalanceMode: ['continuous', 'manual'], colorTemperature: { min: 2000, max: 8000 }, focusMode: ['continuous', 'manual'], focusDistance: { min: 0, max: 10 }, width: { min: 640, max: 1920 }, height: { min: 480, max: 1080 }, frameRate: { min: 1, max: 30 } };
  const apply = vi.fn(async (constraints: MediaTrackConstraints) => { for (const part of constraints.advanced ?? []) Object.assign(settings, part); });
  const track = { readyState: 'live', getCapabilities: () => caps, getSettings: () => ({ ...settings }), getConstraints: () => ({ deviceId: { exact: 'uvc' } }), applyConstraints: apply, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaStreamTrack;
  return { track, settings, caps, apply };
}

it('locks settled camera values, restores automatic modes and re-locks after light changes', async () => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start();
    await vi.advanceTimersByTimeAsync(1499); expect(apply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ deviceId: { exact: 'uvc' }, advanced: [{ exposureMode: 'manual', exposureTime: 120 }, { whiteBalanceMode: 'manual', colorTemperature: 4600 }, { focusMode: 'manual', focusDistance: 2 }] }));
    expect(lock.getSnapshot()).toMatchObject({ supported: true, enabled: true, locked: true, busy: false });
    await lock.setEnabled(false);
    expect(settings).toMatchObject({ exposureMode: 'continuous', whiteBalanceMode: 'continuous', focusMode: 'continuous' });
    await lock.setEnabled(true); await vi.advanceTimersByTimeAsync(1500);
    await lock.relock();
    expect(settings.exposureMode).toBe('continuous');
    settings.exposureTime = 220; settings.colorTemperature = 5100;
    await vi.advanceTimersByTimeAsync(1500);
    expect(settings).toMatchObject({ exposureMode: 'manual', exposureTime: 220, whiteBalanceMode: 'manual', colorTemperature: 5100 });
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('keeps unsupported or ignored constraints off and cancels work for a stopped camera', async () => {
  vi.useFakeTimers();
  const { track, apply } = lockableCamera();
  apply.mockImplementation(async () => {}); // Some drivers silently ignore advanced constraints.
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    expect(lock.getSnapshot()).toMatchObject({ locked: false, busy: false });
    await lock.relock(); lock.dispose(); apply.mockClear();
    await vi.advanceTimersByTimeAsync(2000); expect(apply).not.toHaveBeenCalled();
    const unsupported = new CameraLock({ readyState: 'live' } as MediaStreamTrack, 'guild:101', () => {});
    unsupported.start();
    expect(unsupported.getSnapshot()).toMatchObject({ supported: false, locked: false, busy: false });
    unsupported.dispose();
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('saves the choice for this user and device and tolerates blocked calibration storage', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  const { track } = lockableCamera();
  const first = new CameraLock(track, 'guild:101', () => {}); first.start(); await first.setEnabled(false); first.dispose();
  const same = new CameraLock(track, 'guild:101', () => {}); same.start(); expect(same.getSnapshot().enabled).toBe(false); same.dispose();
  const other = new CameraLock(track, 'guild:102', () => {}); other.start(); expect(other.getSnapshot().enabled).toBe(true); other.dispose();
  const secondCamera = lockableCamera(); secondCamera.settings.deviceId = 'other';
  const second = new CameraLock(secondCamera.track, 'guild:101', () => {}); second.start(); expect(second.getSnapshot().enabled).toBe(true); second.dispose();
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
  const blocked = new CameraLock(track, 'guild:101', () => {}); blocked.start(); await expect(blocked.setEnabled(false)).resolves.toBeUndefined(); blocked.dispose();
});

it('requests 1080p at 30 fps with a 720p fallback without replacing the capture track', async () => {
  const { track, apply } = lockableCamera();
  apply.mockRejectedValueOnce(new DOMException('Unsupported size', 'OverconstrainedError'));
  await optimizeRecognitionCapture(track);
  expect(apply.mock.calls[0][0]).toMatchObject({ deviceId: { exact: 'uvc' }, width: { exact: 1920 }, height: { exact: 1080 }, frameRate: { exact: 30 } });
  expect(apply.mock.calls[1][0]).toMatchObject({ width: { exact: 1280 }, height: { exact: 720 } });
});

it('restores automatic settings when Off arrives during a pending lock', async () => {
  vi.useFakeTimers();
  const { track, apply, settings } = lockableCamera();
  const original = apply.getMockImplementation()!;
  let finish!: () => Promise<void>;
  apply.mockImplementationOnce(constraints => new Promise<void>(resolve => {
    finish = async () => { await original(constraints); resolve(); };
  }));
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    const off = lock.setEnabled(false); await finish(); await off;
    expect(settings.exposureMode).toBe('continuous');
    expect(lock.getSnapshot()).toMatchObject({ enabled: false, locked: false, busy: false });
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('locks the remaining controls when a driver rejects white balance and supports one-shot focus', async () => {
  vi.useFakeTimers();
  const { track, caps, apply, settings } = lockableCamera();
  caps.focusMode = ['continuous', 'single-shot'];
  const original = apply.getMockImplementation()!;
  apply.mockImplementation(async constraints => {
    if (constraints.advanced?.some(part => 'whiteBalanceMode' in part)) throw new Error('Driver rejected white balance');
    await original(constraints);
  });
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    expect(settings).toMatchObject({ exposureMode: 'manual', whiteBalanceMode: 'continuous', focusMode: 'single-shot' });
    expect(lock.getSnapshot()).toMatchObject({ locked: true, busy: false });
    expect(lock.getSnapshot().note).not.toContain('whiteBalance');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('keeps a failed Off operation visible and permits another Off attempt', async () => {
  vi.useFakeTimers();
  const { track, apply, settings } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    apply.mockImplementationOnce(async () => {});
    await lock.setEnabled(false);
    expect(lock.getSnapshot()).toMatchObject({ enabled: false, locked: true, busy: false });
    expect(lock.getSnapshot().note).toContain('Try camera lock again');
    await lock.setEnabled(false);
    expect(settings.exposureMode).toBe('continuous');
    expect(lock.getSnapshot()).toMatchObject({ enabled: false, locked: false, busy: false });
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('re-enables automatic modes before re-locking an initially manual camera', async () => {
  vi.useFakeTimers();
  const { track, settings } = lockableCamera();
  settings.exposureMode = 'manual'; settings.focusMode = 'manual';
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    await lock.relock();
    expect(settings).toMatchObject({ exposureMode: 'continuous', focusMode: 'continuous', whiteBalanceMode: 'continuous' });
    expect(lock.getSnapshot()).toMatchObject({ enabled: true, locked: false, busy: true });
    settings.exposureTime = 200;
    await vi.advanceTimersByTimeAsync(1500);
    expect(settings).toMatchObject({ exposureMode: 'manual', exposureTime: 200 });
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('uses the last matching camera label after a device ID rotates, as calibration does', async () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  const camera = lockableCamera(); Object.defineProperty(camera.track, 'label', { value: 'USB webcam' });
  const first = new CameraLock(camera.track, 'guild:101', () => {}); first.start(); await first.setEnabled(false); first.dispose();
  camera.settings.deviceId = 'rotated';
  const same = new CameraLock(camera.track, 'guild:101', () => {}); same.start(); expect(same.getSnapshot().enabled).toBe(false); same.dispose();
  const other = lockableCamera(); Object.defineProperty(other.track, 'label', { value: 'Other webcam' });
  const different = new CameraLock(other.track, 'guild:101', () => {}); different.start(); expect(different.getSnapshot().enabled).toBe(false); different.dispose();
  other.settings.deviceId = 'new-camera';
  const fresh = new CameraLock(other.track, 'guild:101', () => {}); fresh.start(); expect(fresh.getSnapshot().enabled).toBe(true); fresh.dispose();
});

it('checks capabilities again after the first frames have settled', async () => {
  vi.useFakeTimers();
  const { track, caps } = lockableCamera();
  const saved = { exposureMode: caps.exposureMode, whiteBalanceMode: caps.whiteBalanceMode, focusMode: caps.focusMode };
  caps.exposureMode = []; caps.whiteBalanceMode = []; caps.focusMode = [];
  const lock = new CameraLock(track, 'guild:101', () => {});
  try {
    lock.start(); expect(lock.getSnapshot()).toMatchObject({ supported: false, busy: true });
    Object.assign(caps, saved);
    await vi.advanceTimersByTimeAsync(1500);
    expect(lock.getSnapshot()).toMatchObject({ supported: true, locked: true, busy: false });
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('measures clipped highlights inside the mat polygon or the centre 70% of the image', () => {
  const width = 100, height = 100, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = x < 15 || x >= 85 || y < 15 || y >= 85 ? 255 : 100;
    data.set([value, value, value, 255], (y * width + x) * 4);
  }
  expect(measureCameraLight({ data, width, height })).toEqual({ clipped: 0, mean: 100 });
  // Bright bounding-box corners lie outside this diamond and must not count as glare.
  const corners = [{ x: .5, y: .15 }, { x: .85, y: .5 }, { x: .5, y: .85 }, { x: .15, y: .5 }];
  data.set([255, 255, 255, 255], (16 * width + 16) * 4);
  expect(measureCameraLight({ data, width, height }, corners)).toEqual({ clipped: 0, mean: 100 });
  const mat = [{ x: 0, y: 0 }, { x: .1, y: 0 }, { x: .1, y: .1 }, { x: 0, y: .1 }];
  const light = measureCameraLight({ data, width, height }, mat)!;
  expect(light.clipped).toBe(1); expect(light.mean).toBeCloseTo(255);
});

it('checks glare every two seconds for ten seconds and logs the measured exposure result', async () => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera(); settings.exposureTime = 156;
  const measure = vi.fn(() => ({ clipped: settings.exposureTime === 156 ? .06 : .01, mean: 120 }));
  const lock = new CameraLock(track, 'guild:101', () => {}, measure);
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(1999); expect(measure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(settings.exposureTime).toBe(120);
    await vi.advanceTimersByTimeAsync(8000);
    expect(measure).toHaveBeenCalledTimes(5); expect(apply).toHaveBeenCalledTimes(1);
    expect(lock.getSnapshot().debug).toContain('camera: exposure 156→120, glare 6%→1%');
    expect(settings).toMatchObject({ whiteBalanceMode: 'manual', focusMode: 'manual' });
    await vi.advanceTimersByTimeAsync(10000); expect(measure).toHaveBeenCalledTimes(5);
    await lock.relock(); await vi.advanceTimersByTimeAsync(3500);
    expect(measure).toHaveBeenCalledTimes(6);
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('limits glare correction to three bounded driver-aligned exposure steps', async () => {
  vi.useFakeTimers();
  const { track, settings, caps, apply } = lockableCamera();
  Object.assign(caps.exposureTime, { min: 40, max: 1000, step: 10 }); settings.exposureTime = 200;
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: 120 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(apply).toHaveBeenCalledTimes(3);
    const values = apply.mock.calls.map(([c]) => (c.advanced![0] as { exposureTime: number }).exposureTime);
    expect(values).toEqual([150, 110, 80]);
    await lock.relock(); settings.exposureTime = 40;
    await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(10000); expect(apply).not.toHaveBeenCalled();
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it.each([45, 55, 230])('keeps exposure unchanged when mean luminance %s cannot stay in range', async mean => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(settings.exposureTime).toBe(120); expect(apply).not.toHaveBeenCalled();
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('restores the last safe exposure if measured luminance drops below range', async () => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: settings.exposureTime === 120 ? 100 : 35 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(2000); expect(settings.exposureTime).toBeLessThan(120);
    await vi.advanceTimersByTimeAsync(8000);
    expect(settings.exposureTime).toBe(120); expect(apply).toHaveBeenCalledTimes(2);
    expect(lock.getSnapshot().debug).toContain('luminance');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it.each(['rounded', 'partially rejected'])('restores safe exposure after a driver %s the requested change', async mode => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: settings.exposureTime === 120 ? 100 : 35 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    const original = apply.getMockImplementation()!;
    apply.mockImplementationOnce(async constraints => {
      await original(constraints); settings.exposureTime -= 20;
      if (mode === 'partially rejected') throw new Error('Partial driver failure');
    });
    await vi.advanceTimersByTimeAsync(4000);
    expect(settings.exposureTime).toBe(120); expect(apply).toHaveBeenCalledTimes(2);
    expect(lock.getSnapshot().debug).toContain('exposure restored');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('verifies an exposure write that completes after the ten-second window', async () => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: settings.exposureTime === 120 ? 100 : 35 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    const original = apply.getMockImplementation()!;
    let finish!: () => Promise<void>;
    apply.mockImplementationOnce(constraints => new Promise<void>(resolve => {
      finish = async () => { await original(constraints); resolve(); };
    }));
    await vi.advanceTimersByTimeAsync(12000); await finish();
    await vi.advanceTimersByTimeAsync(2000);
    expect(settings.exposureTime).toBe(120);
    expect(lock.getSnapshot().debug).toContain('camera: exposure 120→92');
    expect(lock.getSnapshot().debug).toContain('exposure restored to 120');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('restores safe exposure when no frame can verify the change before the window ends', async () => {
  vi.useFakeTimers();
  const { track, settings } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => settings.exposureTime === 120 ? { clipped: .06, mean: 100 } : null);
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(11500);
    expect(settings.exposureTime).toBe(120);
    expect(lock.getSnapshot().debug).toContain('measurement unavailable');
    expect(lock.getSnapshot().debug).toContain('exposure restored');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it.each(['ignored', 'rejected'])('stops glare correction when the driver %s the exposure constraint', async mode => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: 120 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    apply.mockImplementation(async () => { if (mode === 'rejected') throw new Error('Unsupported exposure'); });
    await vi.advanceTimersByTimeAsync(10000);
    expect(settings.exposureTime).toBe(120); expect(apply).toHaveBeenCalledTimes(1);
    expect(lock.getSnapshot()).toMatchObject({ locked: true, busy: false });
    expect(lock.getSnapshot().debug).toContain('exposure');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it.each(['off', 'ended', 'disposed'])('cancels glare checks when the camera is %s', async mode => {
  vi.useFakeTimers();
  const { track, apply } = lockableCamera(), measure = vi.fn(() => ({ clipped: .06, mean: 120 }));
  const lock = new CameraLock(track, 'guild:101', () => {}, measure);
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    if (mode === 'off') await lock.setEnabled(false);
    else if (mode === 'disposed') lock.dispose();
    else Object.defineProperty(track, 'readyState', { value: 'ended' });
    apply.mockClear(); await vi.advanceTimersByTimeAsync(10000);
    expect(measure).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('does not lower exposure at the three percent clipping threshold', async () => {
  vi.useFakeTimers();
  const { track, apply } = lockableCamera(), measure = vi.fn(() => ({ clipped: .03, mean: 120 }));
  const lock = new CameraLock(track, 'guild:101', () => {}, measure);
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(measure).toHaveBeenCalledTimes(5); expect(apply).not.toHaveBeenCalled();
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('keeps a focus-only lock when manual exposure is unavailable', async () => {
  vi.useFakeTimers();
  const { track, caps, apply } = lockableCamera(); caps.exposureMode = ['continuous'];
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: 120 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500); apply.mockClear();
    await vi.advanceTimersByTimeAsync(10000);
    expect(apply).not.toHaveBeenCalled(); expect(lock.getSnapshot().locked).toBe(true);
    expect(lock.getSnapshot().debug).toContain('manual exposure unavailable');
  } finally { lock.dispose(); vi.useRealTimers(); }
});

it('finishes an exposure write before restoring auto mode when Off arrives during glare correction', async () => {
  vi.useFakeTimers();
  const { track, settings, apply } = lockableCamera();
  const lock = new CameraLock(track, 'guild:101', () => {}, () => ({ clipped: .06, mean: 120 }));
  try {
    lock.start(); await vi.advanceTimersByTimeAsync(1500);
    const original = apply.getMockImplementation()!;
    let finish!: () => Promise<void>;
    apply.mockImplementationOnce(constraints => new Promise<void>(resolve => {
      finish = async () => { await original(constraints); resolve(); };
    }));
    await vi.advanceTimersByTimeAsync(2000);
    const off = lock.setEnabled(false); await finish(); await off;
    expect(settings.exposureMode).toBe('continuous');
    expect(lock.getSnapshot()).toMatchObject({ enabled: false, locked: false, debug: undefined });
    apply.mockClear(); await vi.advanceTimersByTimeAsync(10000); expect(apply).not.toHaveBeenCalled();
  } finally { lock.dispose(); vi.useRealTimers(); }
});
