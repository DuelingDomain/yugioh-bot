import Database from "better-sqlite3";
import sharp from "sharp";
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as Database.Database | null, auth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => state.db! }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture(state.auth);
});

let jpegBase64: string;
const fetcher = vi.fn();
const input = (extra = {}) => ({ jpegBase64, localTier: "not sure", explicitRequest: false, ...extra });
const request = (body: unknown = input(), headers = {}) => new Request("http://localhost/api/remote-vision/ai", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const reply = (value: unknown = { name: "Dark Magician" }, extra = {}) => Response.json({
  model: "claude-haiku-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }], ...extra,
});
async function post(req = request()) { const { POST } = await import("../app/api/remote-vision/ai/route"); return POST(req); }

beforeAll(async () => {
  jpegBase64 = (await sharp({ create: { width: 224, height: 320, channels: 3, background: "white" } }).jpeg().toBuffer()).toString("base64");
});
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("OWNER_USER_IDS", "7,8");
  vi.stubEnv("REMOTE_VISION_AI", "1");
  vi.stubEnv("REMOTE_DUELS", "1");
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("NEXT_PUBLIC_REMOTE_VISION_LAB", "1");
  state.auth.mockReset().mockResolvedValue({ user: { id: "7", name: "Owner" } });
  state.db = new Database(":memory:");
  state.db.exec(`CREATE TABLE card_catalog(ygoprodeck_id INTEGER PRIMARY KEY, name TEXT, card_sets_json TEXT);
    INSERT INTO card_catalog VALUES(46986414,'Dark Magician','[{"set_code":"LOB-005"}]');
    INSERT INTO card_catalog VALUES(89631139,'Blue-Eyes White Dragon','[]');`);
  fetcher.mockReset().mockImplementation(async () => reply());
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  state.db?.close();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

it('local field diagnostics require the owner and loopback origin, validate crops and cap retained samples',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'field-diagnostics-'));vi.stubEnv('VISION_DATA_DIR',directory);
  try{
    const {POST}=await import('../app/api/remote-vision/diagnostics/route');
    const value={jpegBase64,tier:'not sure',reason:'uncertain',zone:'M2',top5:[{cardId:'27204311',name:'Nibiru, the Primal Being',score:.73}],quad:[{x:.2,y:.2},{x:.3,y:.2},{x:.3,y:.4},{x:.2,y:.4}],priors:{decklist:['27204311'],seen:['25311006']},backend:'wasm',runtime:{crossOriginIsolated:true,wasmThreads:2,simd:true},quality:{hypothesis:'art-box',fallback:false},timingsMs:{total:120}};
    const req=(body:unknown=value,origin='http://localhost')=>new Request(`${origin}/api/remote-vision/diagnostics`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    state.auth.mockResolvedValue(null);expect((await POST(req())).status).toBe(401);
    state.auth.mockResolvedValue({user:{id:'9'}});expect((await POST(req())).status).toBe(404);
    state.auth.mockResolvedValue({user:{id:'7'}});expect((await POST(req(value,'https://example.com'))).status).toBe(404);
    const cross=req();cross.headers.set('origin','https://example.com');expect((await POST(cross)).status).toBe(403);
    expect((await POST(req({...value,jpegBase64:'not-a-jpeg'}))).status).toBe(400);
    expect((await POST(req({...value,priors:{decklist:Array(513).fill('27204311')}}))).status).toBe(400);
    expect((await POST(req({...value,jpegBase64:'A'.repeat(100000)}))).status).toBe(413);
    for(let i=0;i<25;i++)expect((await POST(req())).status).toBe(201);
    const files=await readdir(join(directory,'diagnostics/field'));expect(files.filter(f=>f.endsWith('.json'))).toHaveLength(24);expect(files.filter(f=>f.endsWith('.jpg'))).toHaveLength(24);
    const record=JSON.parse(await readFile(join(directory,'diagnostics/field',files.find(f=>f.endsWith('.json'))!),'utf8'));
    expect(record.top5).toEqual(value.top5);expect(record.jpegBase64).toBeUndefined();expect(record.crop).toMatch(/\.jpg$/);expect(fetcher).not.toHaveBeenCalled();
    expect(record.quad).toEqual(value.quad);expect(record.priors).toEqual(value.priors);expect(record.backend).toBe('wasm');expect(record.runtime).toEqual(value.runtime);expect(record.embedding).toBeUndefined();
    const assets=await import('../app/dev/vision-assets/[...path]/route');
    expect((await assets.GET(new Request('http://localhost/dev/vision-assets/diagnostics/field/'+record.crop),{params:Promise.resolve({path:['diagnostics','field',record.crop]})})).status).toBe(404);
  }finally{await rm(directory,{recursive:true,force:true});}
});

describe("owner remote vision AI route", () => {
  it("requires a session even when the public lab is enabled", async () => {
    state.auth.mockResolvedValue(null);
    expect((await post()).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("forwards a session outage without making paid requests", async () => {
    state.auth.mockRejectedValue(new Error("session unavailable"));
    expect((await post()).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("denies nonowners without making paid requests", async () => {
    state.auth.mockResolvedValue({ user: { id: "9", name: "Member" } });
    expect((await post()).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["REMOTE_VISION_AI", "ANTHROPIC_API_KEY"])("requires %s", async (key) => {
    vi.stubEnv(key, "");
    expect((await post()).status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the configured current model and only forwards the warped JPEG", async () => {
    fetcher.mockResolvedValue(reply({ name: " dark magician ", setCode: "LOB-005", passcode: "46986414" }));
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ name: "Dark Magician", passcode: 46986414, setCode: "LOB-005", match: { passcode: 46986414, name: "Dark Magician" } });
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(options.redirect).toBe("error");
    expect(options.headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse(options.body);
    expect(body.model).toBe("claude-haiku-5-5");
    expect(body.messages[0].content).toContainEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpegBase64 } });
    expect(options.body).not.toContain("Owner");
  });
  it("rejects sure automatic results and accepts an explicit request", async () => {
    expect((await post(request(input({ localTier: "sure" })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await post(request(input({ localTier: "sure", explicitRequest: true })))).status).toBe(200);
  });
  it("accepts an uncertain low match", async () => {
    expect((await post(request(input({ localTier: "low match" })))).status).toBe(200);
  });
  it.each([
    { localTier: "uncertain" }, { explicitRequest: "yes" }, { explicitRequest: undefined },
    { extraImage: "not allowed" }, { jpegBase64: "aGVsbG8=" }, { jpegBase64: "!!!!" },
    { jpegBase64: "data:image/jpeg;base64,abc" },
  ])("rejects invalid contract or image fields: %j", async (extra) => {
    expect((await post(request(input(extra)))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects a PNG disguised as JPEG", async () => {
    const png = await sharp({ create: { width: 224, height: 320, channels: 3, background: "white" } }).png().toBuffer();
    expect((await post(request(input({ jpegBase64: png.toString("base64") })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[16, 32], [1025, 32]])("rejects JPEG dimensions %i x %i", async (width, height) => {
    const jpeg = await sharp({ create: { width, height, channels: 3, background: "white" } }).jpeg().toBuffer();
    expect((await post(request(input({ jpegBase64: jpeg.toString("base64") })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects truncated JPEG pixel data", async () => {
    const jpeg = Buffer.from(jpegBase64, "base64");
    expect((await post(request(input({ jpegBase64: jpeg.subarray(0, jpeg.length - 30).toString("base64") })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds declared and actual request bytes", async () => {
    expect((await post(request(input(), { "content-length": "500000" }))).status).toBe(413);
    expect((await post(request(input({ jpegBase64: "A".repeat(400000) })))).status).toBe(413);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects invalid JSON without making paid requests", async () => {
    expect((await post(new Request("http://localhost/api/remote-vision/ai", { method: "POST", body: "{" }))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds JPEG decoded bytes independently of the JSON limit", async () => {
    const jpeg = Buffer.from(jpegBase64, "base64");
    const padded = Buffer.concat([jpeg.subarray(0, -2), Buffer.alloc(256 * 1024), jpeg.subarray(-2)]);
    expect((await post(request(input({ jpegBase64: padded.toString("base64") })))).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([null, { name: null }, { name: "Imaginary Test Dragon" }, { name: "Dark Magician", passcode: 89631139 }, { name: "Dark Magician", setCode: "FAKE-001" }])("abstains for unknown or contradictory identity: %j", async (value) => {
    fetcher.mockResolvedValue(reply(value));
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: null, match: null });
    expect(state.db!.prepare("SELECT count(*) n FROM card_catalog").get()).toEqual({ n: 2 });
  });
  it("abstains on ambiguous exact names", async () => {
    state.db!.exec("INSERT INTO card_catalog VALUES(111,'Dark Magician','[]')");
    const response = await post();
    expect(await response.json()).toEqual({ name: null, match: null });
  });
  it("uses a valid visible passcode to disambiguate duplicate catalog names", async () => {
    state.db!.exec("INSERT INTO card_catalog VALUES(111,'Dark Magician','[]')");
    fetcher.mockResolvedValue(reply({ name: "Dark Magician", passcode: 46986414 }));
    expect(await (await post()).json()).toEqual({ name: "Dark Magician", passcode: 46986414, match: { name: "Dark Magician", passcode: 46986414 } });
  });
  it.each([
    { content: [{ type: "text", text: "not JSON" }] },
    { stop_reason: "max_tokens" }, { model: "other-model" },
    { content: [{ type: "text", text: JSON.stringify({ name: "Dark Magician", arbitrary: "ignored?" }) }] },
  ])("abstains on malformed provider results: %j", async (extra) => {
    fetcher.mockResolvedValue(reply(undefined, extra));
    expect(await (await post()).json()).toEqual({ name: null, match: null });
  });
  it("limits each user durably across route module reloads", async () => {
    for (let i = 0; i < 20; i++) expect((await post()).status).toBe(200);
    vi.resetModules();
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(fetcher).toHaveBeenCalledTimes(20);
    state.auth.mockResolvedValue({ user: { id: "8", name: "Other owner" } });
    expect((await post()).status).toBe(200);
    state.auth.mockResolvedValue({ user: { id: "7", name: "Owner" } });
    vi.useFakeTimers(); vi.setSystemTime(Date.now() + 3_600_001);
    expect((await post()).status).toBe(200);
  });
  it("returns a safe error for provider failures without logging payloads", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      fetcher.mockRejectedValue(new Error(`provider echoed ${jpegBase64}`));
      const response = await post();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "ai_unavailable" });
      expect(error).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled();
    } finally { error.mockRestore(); warn.mockRestore(); }
  });
  it("cancels unsuccessful provider response bodies and returns a generic error", async () => {
    let cancelled = false;
    fetcher.mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 429 }));
    const response = await post();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "ai_unavailable" });
    expect(cancelled).toBe(true);
  });
  it("rejects oversized provider response streams", async () => {
    fetcher.mockResolvedValue(new Response("x".repeat(17000)));
    expect((await post()).status).toBe(502);
  });
  it("bounds response reading by the same four-second timeout as fetch", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    let cancelled = false;
    fetcher.mockImplementation(async (_url, options) => {
      providerSignal = options.signal;
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
    });
    const pending = post();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4000);
    expect((await pending).status).toBe(504);
    expect(providerSignal?.aborted).toBe(true);
    expect(cancelled).toBe(true);
  });
  it("times out a provider that never sends headers", async () => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | undefined;
    fetcher.mockImplementation((_url, options) => {
      providerSignal = options.signal;
      return new Promise(() => undefined);
    });
    const pending = post();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(4000);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ error: "ai_timeout" });
    expect(providerSignal?.aborted).toBe(true);
  });
});
