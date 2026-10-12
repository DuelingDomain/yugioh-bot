import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isTracingSuppressed } from "@sentry/core";

const dsn = "https://public@o123.ingest.sentry.io/456";
const fetch = vi.fn<typeof globalThis.fetch>();
const envelope = (value = dsn) => Buffer.from(`${JSON.stringify({ dsn: value })}\n{"type":"event"}\n{"message":"failed"}`);
async function post(body: BodyInit, headers: HeadersInit = {}) {
  const { POST } = await import("../app/monitoring/route");
  return POST(new Request("https://example.test/monitoring", { method: "POST", body, headers, duplex: "half" } as RequestInit));
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", dsn);
  vi.stubGlobal("fetch", fetch);
  fetch.mockResolvedValue(new Response(null, { status: 200 }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it("forwards the envelope bytes with only content-type and no incoming credentials", async () => {
  let tracingSuppressed = false;
  fetch.mockImplementationOnce(async () => {
    tracingSuppressed = isTracingSuppressed();
    return new Response(null, { status: 200 });
  });
  const body = Buffer.concat([envelope(), Buffer.from([10, 0, 255, 128])]);
  const response = await post(body, {
    cookie: "__session=private", authorization: "Bearer private", "x-clerk-auth-token": "private",
    "x-forwarded-for": "192.0.2.1", "x-forwarded-host": "example.test", "content-type": "text/plain",
  });
  expect(response.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(String(url)).toBe("https://o123.ingest.sentry.io/api/456/envelope/?sentry_key=public&sentry_version=7");
  expect(options?.method).toBe("POST");
  expect(Array.from(new Headers(options?.headers).entries())).toEqual([["content-type", "application/x-sentry-envelope"]]);
  expect(Buffer.from(await new Response(options?.body).arrayBuffer())).toEqual(body);
  expect(tracingSuppressed).toBe(true);
});
it.each([
  "https://public@other.ingest.sentry.io/456", "https://public@o123.ingest.sentry.io/789",
  "https://public@o123.ingest.sentry.io:8443/456", "http://public@o123.ingest.sentry.io/456",
  "https://public@o123.ingest.sentry.io/other/456", "https://other@o123.ingest.sentry.io/456",
])("refuses a mismatched envelope DSN %s", async value => {
  expect((await post(envelope(value))).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["not-json", "{}\n{}", '{"dsn":null}\n{}', '{"dsn":"invalid"}\n{}'])("refuses an invalid envelope header %s", async body => {
  expect((await post(body)).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("returns 404 when no DSN is configured", async () => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
  expect((await post(envelope())).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
it("refuses a body exceeding one MiB without trusting content-length", async () => {
  const body = Buffer.concat([envelope(), Buffer.alloc(1024 * 1024)]);
  expect((await post(body, { "content-length": "1" })).status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});
it("stops reading an oversized stream", async () => {
  let cancelled = false;
  let reads = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(Buffer.alloc(512 * 1024)); },
    cancel() { cancelled = true; },
  });
  expect((await post(body)).status).toBe(413);
  expect(cancelled).toBe(true);
  expect(reads).toBeLessThanOrEqual(4);
  expect(fetch).not.toHaveBeenCalled();
});
it("accepts a body at the size limit", async () => {
  const body = Buffer.concat([envelope(), Buffer.alloc(1024 * 1024 - envelope().length)]);
  expect((await post(body)).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
});
