import { describe, it, expect, vi, afterEach } from "vitest";
import { signedRequestHeaders, signedTransport, recordingTransport, readSignedRequest } from "../../src/internal-auth/index.js";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("signedRequestHeaders", () => {
  it.each(["POST", "PUT"])("authenticates an in-process %s request with its query and exact body", async method => {
    const url = "http://duel/internal/duel?mode=one";
    const body = '{ "op": "capabilities" }';
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    const headers = signedRequestHeaders({ url, method, body, secret: "secret", purpose: "duel-host" });
    const request = new Request(url, { method, body, headers });
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("x-internal-signature")).toMatch(/^t=1800000000,v2=[a-f0-9]{64}$/);
    expect(await readSignedRequest(request, { secret: "secret", purpose: "duel-host" }))
      .toEqual({ ok: true, body: { op: "capabilities" } });
  });
});

describe("signedTransport", () => {
  it("signs the body and posts to url+path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const t = signedTransport({ purpose: "ws-broadcast", url: "http://ws:4002", secret: "s3cret" });

    const res = await t.post("/internal/draft/pick", JSON.stringify({ slug: "abc" }));

    expect(res.ok).toBe(true);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe("http://ws:4002/internal/draft/pick");
    expect(await readSignedRequest(new Request(calledUrl, init), { secret: "s3cret", purpose: "ws-broadcast" })).toEqual({ ok: true, body: { slug: "abc" } });
  });

  it("returns ok:false without throwing when not configured", async () => {
    const t = signedTransport({ purpose: "ws-broadcast", url: "", secret: "" });
    const res = await t.post("/internal/draft/pick", "{}");
    expect(res).toEqual({ ok: false, status: 0, text: "not configured" });
  });

  it("returns ok:false on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    const t = signedTransport({ purpose: "ws-broadcast", url: "http://ws", secret: "x" });
    const res = await t.post("/p", "{}");
    expect(res).toEqual({ ok: false, status: 0, text: "boom" });
  });
});

describe("recordingTransport", () => {
  it("records calls and reports ok", async () => {
    const rec = recordingTransport();
    await rec.transport.post("/internal/announce/draft-created", '{"draftId":1}');
    expect(rec.calls).toEqual([{ path: "/internal/announce/draft-created", body: '{"draftId":1}' }]);
  });
});

it("bounds a stalled request", async () => {
  let aborted = false;
  vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      aborted = true;
      reject(init.signal!.reason);
    }, { once: true });
  })));
  const result = await signedTransport({ purpose: "ws-broadcast", url: "http://bot", secret: "secret", timeoutMs: 5 }).post("/x", "{}");
  expect(aborted).toBe(true);
  expect(result.ok).toBe(false);
  expect(result.status).toBe(0);
  expect(result.text).toMatch(/timed out/i);
});

it("sets no deadline unless the caller asks for one", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.signal).toBeUndefined();
    return new Response("ok");
  });
  vi.stubGlobal("fetch", fetch);
  expect((await signedTransport({ purpose: "ws-broadcast", url: "http://duel", secret: "secret" }).post("/x", "{}")).ok).toBe(true);
});

it("returns a failed result for an invalid destination URL", async () => {
  expect(await signedTransport({ url: "invalid", secret: "secret", purpose: "ws-broadcast" }).post("/test", "{}"))
    .toMatchObject({ ok: false, status: 0 });
});
