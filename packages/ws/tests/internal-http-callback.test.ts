import { expect, it, vi } from "vitest";
import { signedHeaders } from "./helpers/signed-request.js";
import { listenInternalHttp } from "../src/internal-http.js";
import type { TypedServer } from "../src/events.js";

const state = vi.hoisted(() => ({ callback: null as ((req: any, res: any) => Promise<void>) | null }));
vi.mock("node:http", () => ({ createServer: (callback: typeof state.callback) => {
  state.callback = callback;
  return { listen: vi.fn() };
} }));

async function setup() {
  const emit = vi.fn();
  listenInternalHttp({ port: 0, secret: "secret", io: { to: () => ({ emit }) } as unknown as TypedServer });
  const body = JSON.stringify({ slug: "room", status: "active" });
  const headers = await signedHeaders(body, "secret", "http://localhost/internal/draft/status", "ws-broadcast");
  async function send(chunks: Buffer[], extraHeaders: Record<string, string> = {}) {
    let reads = 0;
    const pause = vi.fn();
    const writeHead = vi.fn();
    const end = vi.fn();
    const iterator = vi.fn(async function* () { for (const chunk of chunks) { reads++; yield chunk; } });
    const req = { method: "POST", url: "/internal/draft/status", headers: { ...headers, ...extraHeaders }, iterator, pause, [Symbol.asyncIterator]: iterator };
    await state.callback!(req, { writeHead, end });
    return { reads, pause, writeHead, end };
  }
  return { send, emit, body };
}

it("refuses a declared oversize body before reading", async () => {
  const { send, body, emit } = await setup();
  const result = await send([Buffer.from(body)], { "content-length": "65537" });
  expect(result.reads).toBe(0);
  expect(result.writeHead).toHaveBeenCalledWith(413, { connection: "close" });
  expect(emit).not.toHaveBeenCalled();
});

it("stops at the first chunk over the body limit", async () => {
  const { send, emit } = await setup();
  const result = await send([Buffer.alloc(40000), Buffer.alloc(40000), Buffer.alloc(40000)], { "content-length": "1" });
  expect(result.reads).toBe(2);
  expect(result.pause).toHaveBeenCalled();
  expect(result.writeHead).toHaveBeenCalledWith(413, { connection: "close" });
  expect(emit).not.toHaveBeenCalled();
});

it("serves the next request after a handler failure", async () => {
  const { send, body, emit } = await setup();
  emit.mockImplementationOnce(() => { throw new Error("Handler failed"); });
  const failed = await send([Buffer.from(body)]);
  expect(failed.writeHead).toHaveBeenCalledWith(500);
  expect(failed.end).toHaveBeenCalledWith("Something went wrong");
  expect((await send([Buffer.from(body)])).writeHead).toHaveBeenCalledWith(204, {});
});
