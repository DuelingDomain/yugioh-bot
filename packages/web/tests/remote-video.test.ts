import { afterEach, expect, it, vi } from "vitest";
const media = vi.hoisted(() => ({
  stop: vi.fn(), restart: vi.fn(async (_options: unknown) => {}),
  raw: { contentHint: "", readyState: "live" },
}));
vi.mock("livekit-client", () => ({
  ConnectionState: { Disconnected: "disconnected", Connecting: "connecting", Connected: "connected" },
  Track: { Source: { Camera: "camera", Microphone: "microphone" }, Kind: { Video: "video", Audio: "audio" } },
  VideoPresets: { h360: {}, h720: {} }, RoomEvent: {},
  Room: class {
    static async getLocalDevices() { return []; }
    state = "disconnected"; remoteParticipants = new Map();
    localParticipant = { connectionQuality: "excellent", publishTrack: vi.fn(async () => {}), setMicrophoneEnabled: vi.fn(async () => {}) };
    on() { return this; }
    off() { return this; }
    async connect() { this.state = "connected"; }
    async disconnect() { this.state = "disconnected"; }
  },
  createLocalVideoTrack: async () => ({ mediaStreamTrack: media.raw, stop: media.stop, restartTrack: media.restart, getDeviceId: async () => "camera-a", isMuted: false }),
}));
import { RemoteVideo } from "../src/lib/remote/video";
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function connected() {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ seat: 0, room: "remote-t", url: "ws://local", token: "test" })));
  const video = new RemoteVideo({ slug: "t", guildId: "g", seat: 0, members: [{ seat: 0, userId: 1 }] });
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
