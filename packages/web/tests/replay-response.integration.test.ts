import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { afterAll, beforeAll, expect, it } from "vitest";
import { NodeNextRequest, NodeNextResponse } from "next/dist/server/base-http/node";
import { sendResponse } from "next/dist/server/send-response";
import { replayResponse } from "@/lib/replay-response";

// The same middleware that next/dist/server/lib/router-server.js puts in front of every route when `compress` is on.
const compression = createRequire(import.meta.url)("next/dist/compiled/compression") as
  () => (req: unknown, res: unknown, next: () => void) => void;

// Large and repetitive like real frames, so the size threshold never skips compression.
const replay = {
  version: 2, verification: "exact", mySeat: null,
  frames: Array.from({ length: 200 }, (_, index) => ({ index, view: { seats: [{ lp: 8000, hand: [{ code: 46986414 }] }, { lp: 8000, hand: [{}] }] } })),
};

let server: Server;
let url: string;
beforeAll(async () => {
  const compress = compression();
  // Real Node HTTP through Next's own route send path: compression, then the app-route sendResponse.
  server = createServer((req, res) => {
    compress(req, res, () => {});
    void sendResponse(new NodeNextRequest(req), new NodeNextResponse(res), replayResponse(replay));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/duels/abc/replay?version=2`;
});
afterAll(() => new Promise<void>(resolve => server.close(() => resolve())));

// Next 16.4.5 drops content-encoding from route responses. A body gzipped in the route then reached browsers as gzip
// bytes labelled as JSON, and the replay page said "The server returned an invalid response".
it("a replay sent by Next reaches a gzip browser and an identity client as the same JSON", async () => {
  for (const encoding of ["gzip, deflate, br, zstd", "identity"]) {
    const response = await fetch(url, { headers: { "accept-encoding": encoding } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Accept-Encoding");
    // fetch decodes what content-encoding names, like a browser. Leftover gzip bytes make this throw a SyntaxError.
    expect(await response.json()).toEqual(replay);
  }
});
