import { once } from "node:events";
import { expect, it, vi } from "vitest";
import { signedTransport } from "@yugidraft/shared/internal-auth";
import { listenInternalHttp } from "../src/internal-http.js";
import type { TypedServer } from "../src/events.js";

it("keeps serving after an oversize body and a handler failure", async () => {
  const emit = vi.fn().mockImplementationOnce(() => { throw new Error("Handler failed"); });
  const server = listenInternalHttp({ port: 0, secret: "secret", io: { to: () => ({ emit }) } as unknown as TypedServer });
  try {
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");
    const transport = signedTransport({ url: `http://127.0.0.1:${address.port}`, secret: "secret", purpose: "ws-broadcast" });
    expect((await transport.post("/internal/draft/status", "x".repeat(65537))).status).toBe(413);
    const body = JSON.stringify({ slug: "room", status: "active" });
    expect((await transport.post("/internal/draft/status", body)).status).toBe(500);
    expect((await transport.post("/internal/draft/status", body)).status).toBe(204);
  } finally {
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  }
});
