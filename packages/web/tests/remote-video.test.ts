import { afterEach, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({
  stop: vi.fn(), restart: vi.fn(async (_options: unknown) => {}),
  raw: { contentHint: "", readyState: "live" }, rooms: [] as any[], publish: vi.fn(async () => {}),
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Disconnected: "disconnected", Connecting: "connecting", Connected: "connected" },
  Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Video: "video", Audio: "audio" } },
  VideoPresets: { h360: {}, h720: {} }, RoomEvent: new Proxy({}, {get: (_,key) => String(key)}),
  Room: class {
    static async getLocalDevices() { return []; }
    state = "disconnected"; remoteParticipants = new Map();
    handlers = new Map<string, Function[]>();
    constructor() { media.rooms.push(this); }
    emit(event: string,...args: unknown[]) { for(const fn of this.handlers.get(event)??[])fn(...args); }
    localParticipant = { publishData: media.publish, connectionQuality: "excellent", publishTrack: vi.fn(async () => {}), setMicrophoneEnabled: vi.fn(async () => {}) };
    on(event: string,fn: Function) { this.handlers.set(event,[...(this.handlers.get(event)??[]),fn]);return this; }
    async connect() { this.state = "connected"; }
    async disconnect() { this.state = "disconnected"; }
  },
  createLocalVideoTrack: async () => ({ mediaStreamTrack: media.raw, stop: media.stop, restartTrack: media.restart, getDeviceId: async () => "camera-a", isMuted: false }),
}));
import { RemoteVideo,type RecognizeRawFeed } from "../src/lib/remote/video";
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

it("broadcasts safe owner tracks and resolves observer clicks only for the authenticated feed",async()=>{
  const {FIELD_TRACKS_TOPIC}=await import('../src/lib/remote/field-track-cache');
  const video=await connected(),room=media.rooms.at(-1),quad=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.5},{x:.2,y:.5}];
  const message={type:'field.tracks' as const,cards:[{ref:'own',cardId:46986414,name:'Dark Magician',quad}]};
  await video.publishFieldTracks(message);
  expect(video.trackedAt(0,.3,.3)?.ref).toBe('own');
  expect(media.publish).toHaveBeenCalledWith(expect.any(Uint8Array),{reliable:true,topic:FIELD_TRACKS_TOPIC});
  const peer={identity:'remote-user-2',metadata:JSON.stringify({guildId:'g',tableId:'t',seat:1,userId:2}),getTrackPublication:()=>({track:{kind:'video'},videoTrack:{kind:'video'},isMuted:false})};
  video.setMembers([{seat:0,userId:1},{seat:1,userId:2}]);room.remoteParticipants.set(peer.identity,peer);room.emit('ParticipantConnected');
  const encoded=(data:unknown)=>new TextEncoder().encode(JSON.stringify(data));
  room.emit('DataReceived',encoded({...message,cards:[{...message.cards[0],ref:'peer'}]}),peer,undefined,FIELD_TRACKS_TOPIC);
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('peer');expect(video.trackedAt(0,.3,.3)?.ref).toBe('own');
  room.emit('DataReceived',encoded({type:'field.tracks',cards:[]}),{...peer,identity:'forged'},undefined,FIELD_TRACKS_TOPIC);
  expect(video.trackedAt(1,.3,.3)?.ref).toBe('peer');
  room.remoteParticipants.delete(peer.identity);room.emit('ParticipantDisconnected');expect(video.trackedAt(1,.3,.3)).toBeUndefined();
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
