import { describe, expect, it } from "vitest";
import { BUG_REPORT_BODY_MAX_BYTES, readJsonBody } from "@/lib/bug-reports/read-body";

const post = (init: RequestInit & { duplex?: "half" }) => new Request("http://x/api/bug-reports", { method: "POST", ...init });
/** A body sent in pieces, with no content-length. */
function streamOf(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
}

describe("readJsonBody", () => {
  it("reads a JSON body, also one sent in pieces", async () => {
    expect(await readJsonBody(post({ body: JSON.stringify({ a: "é" }) }))).toEqual({ ok: true, value: { a: "é" } });
    expect(await readJsonBody(post({ body: streamOf(['{"a":', '"b"}']), duplex: "half" }))).toEqual({ ok: true, value: { a: "b" } });
  });

  it("answers 400 for text that is not JSON, an empty body and bytes that are not UTF-8", async () => {
    for (const body of ["{nope", "", new Uint8Array([0x7b, 0xff, 0x7d])]) {
      const result = await readJsonBody(post({ body }));
      expect(result.ok).toBe(false);
      expect(!result.ok && result.response.status).toBe(400);
    }
    const none = await readJsonBody(new Request("http://x/api", { method: "POST" }));
    expect(!none.ok && none.response.status).toBe(400);
  });

  it("answers 413 when content-length is over the cap, without reading the body", async () => {
    const result = await readJsonBody(post({ body: "{}", headers: { "content-length": String(BUG_REPORT_BODY_MAX_BYTES + 1) } }));
    expect(!result.ok && result.response.status).toBe(413);
  });

  it("answers 413 when a body with no content-length grows past the cap, and stops reading", async () => {
    let pulled = 0;
    const big = "x".repeat(40_000);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new TextEncoder().encode(big));
        if (pulled > 1000) controller.close();
      },
    });
    const result = await readJsonBody(post({ body, duplex: "half" }), 100_000);
    expect(!result.ok && result.response.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });

  it("answers 413 when content-length is false and the body is larger than it says", async () => {
    const result = await readJsonBody(post({ body: JSON.stringify({ a: "x".repeat(500) }), headers: { "content-length": "5" } }), 100);
    expect(!result.ok && result.response.status).toBe(413);
  });

  it("accepts a body exactly at the cap", async () => {
    const pad = "x".repeat(100 - '{"a":""}'.length);
    const result = await readJsonBody(post({ body: JSON.stringify({ a: pad }) }), 100);
    expect(result.ok).toBe(true);
  });
});
