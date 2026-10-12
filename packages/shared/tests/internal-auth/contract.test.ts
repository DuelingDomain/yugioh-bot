import { afterEach, describe, expect, it, vi } from "vitest";
import { readSignedRequest, recordingTransport, signedTransport, signToken, verifyToken } from "../../src/internal-auth/index.js";

const secret = "secret";
const url = "http://internal";
const now = 1_800_000_000_000;

async function signedRequest(body = '{"value":1}', path = "/internal/test?mode=one", purpose: "ws-broadcast" | "duel-host" = "ws-broadcast") {
  let request!: Request;
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    request = new Request(input, init);
    return new Response(null, { status: 204 });
  });
  vi.spyOn(Date, "now").mockReturnValue(now);
  await signedTransport({ url, secret, purpose }).post(path, body);
  return request;
}

const cfg = { secret, purpose: "ws-broadcast" as const, now: () => now };
const parse = (value: unknown) => value as { value: number };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("internal auth contract", () => {
  it("round trips the exact body and query path", async () => {
    expect(await readSignedRequest(await signedRequest(), cfg)).toEqual({ ok: true, body: { value: 1 } });
  });
  it.each([
    { body: '{"value":2}' }, { path: "/internal/other?mode=one" },
    { path: "/internal/test?mode=two" }, { method: "PUT" },
  ])("refuses changes to signed request fields: %j", async (change) => {
    const original = await signedRequest();
    const request = new Request(url + (change.path ?? "/internal/test?mode=one"), {
      method: change.method ?? "POST", headers: original.headers, body: change.body ?? '{"value":1}',
    });
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 401 });
  });
  it.each([-61, 61])("refuses timestamps outside the window: %s", async (seconds) => {
    expect(await readSignedRequest(await signedRequest(), { ...cfg, now: () => now + seconds * 1000 })).toEqual({ ok: false, status: 401 });
  });
  it.each([-60, 60])("accepts timestamps at the window boundary: %s", async (seconds) => {
    expect((await readSignedRequest(await signedRequest(), { ...cfg, now: () => now + seconds * 1000 })).ok).toBe(true);
  });
  it.each(["", "sha256=00", "t=abc,v2=00", "t=1800000000,v2=00"])("refuses malformed headers: %s", async (header) => {
    const request = await signedRequest();
    request.headers.set("x-internal-signature", header);
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 401 });
  });
  it("refuses a body beyond the default limit", async () => {
    expect(await readSignedRequest(await signedRequest("x".repeat(65537)), cfg)).toEqual({ ok: false, status: 413 });
  });
  it("checks the streamed bytes even with a smaller content length", async () => {
    const request = await signedRequest("x".repeat(65537));
    request.headers.set("content-length", "1");
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 413 });
  });
  it("refuses a declared oversize body without reading it", async () => {
    const request = await signedRequest();
    request.headers.set("content-length", "65537");
    const getReader = vi.spyOn(request.body!, "getReader");
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 413 });
    expect(getReader).not.toHaveBeenCalled();
  });
  it("stops and cancels the stream on the first chunk over the limit", async () => {
    const original = await signedRequest();
    let reads = 0;
    const cancel = vi.fn();
    const body = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(40000)); }, cancel }, { highWaterMark: 0 });
    const request = new Request(original.url, { method: "POST", headers: original.headers, body, duplex: "half" } as RequestInit);
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 413 });
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalled();
  });
  it("parses JSON only after authentication", async () => {
    const request = await signedRequest("{");
    expect(await readSignedRequest(request.clone(), cfg)).toEqual({ ok: false, status: 400 });
    request.headers.delete("x-internal-signature");
    expect(await readSignedRequest(request, cfg)).toEqual({ ok: false, status: 401 });
  });
  it("refuses another request purpose", async () => {
    expect(await readSignedRequest(await signedRequest(), { ...cfg, purpose: "duel-host" })).toEqual({ ok: false, status: 401 });
  });
  it("round trips tokens and separates their purposes", () => {
    const claims = { value: 1 };
    const token = signToken("duel-room", claims, secret);
    expect(verifyToken("duel-room", token, secret, parse)).toEqual(claims);
    expect(verifyToken("draft-room", token, secret, parse)).toBeNull();
    expect(verifyToken("duel-room", token, "other", parse)).toBeNull();
  });
  it.each([
    ["draft-room", "6UTlKGngXE0yrNmiPO_28rbWL9FsID_sPaXN9Vt4Vd8"],
    ["tournament-room", "XrhS5couY_HUKMCVUCnQs7mXK5aZsW0LzmMaPftL8C4"],
  ] as const)("keeps existing %s fixtures valid", (purpose, signature) => {
    const payload = "eyJzbHVnIjoicm9vbSIsImd1aWxkSWQiOiJndWlsZCIsInVzZXJJZCI6NywiZXhwaXJlc0F0IjoyMDAwMDAwMDAwMDAwfQ";
    expect(verifyToken(purpose, `${payload}.${signature}`, secret, (v) => v)).toEqual({ slug: "room", guildId: "guild", userId: 7, expiresAt: 2000000000000 });
  });
  it("retains the recording transport shape", async () => {
    const recorder = recordingTransport();
    expect(await recorder.transport.post("/test", "{}")).toEqual({ ok: true, status: 204, text: "" });
    expect(recorder.calls).toEqual([{ path: "/test", body: "{}" }]);
  });
});
