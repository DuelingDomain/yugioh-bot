import { signedHeaders } from "./helpers/signed-request.js";
import { describe, expect, it, vi } from "vitest";
import { createInternalHttpHandler } from "../src/internal-http.js";

const SECRET = "shh";

function makeIo() {
  const emit = vi.fn();
  const to = vi.fn().mockReturnValue({ emit });
  return { io: { to }, to, emit };
}

async function makeRequest(path: string, body: object, sig?: string) {
  const raw = JSON.stringify(body);
  return new Request(`http://x${path}`, {
    method: "POST",
    headers: { ...await signedHeaders(raw, SECRET, `http://x${path}`, "ws-broadcast"), ...(sig ? { "x-internal-signature": sig } : {}), "content-type": "application/json" },
    body: raw,
  });
}

describe("createInternalHttpHandler — tournament routes", () => {
  it("broadcasts participant-joined to the tournament room", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(
      await makeRequest("/internal/tournament/participant-joined", { slug: "abc", playerId: 9, displayName: "Alice" }),
    );
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:participant-joined", { playerId: 9, displayName: "Alice" });
  });

  it("broadcasts participant-left", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(
      await makeRequest("/internal/tournament/participant-left", { slug: "abc", playerId: 9 }),
    );
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:participant-left", { playerId: 9 });
  });

  it("broadcasts started", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(await makeRequest("/internal/tournament/started", { slug: "abc" }));
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:started", {});
  });

  it("broadcasts cancelled", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(await makeRequest("/internal/tournament/cancelled", { slug: "abc" }));
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:cancelled", {});
  });

  it("broadcasts completed", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(await makeRequest("/internal/tournament/completed", { slug: "abc" }));
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:completed", {});
  });

  it("broadcasts match-updated to the tournament room", async () => {
    const { io, to, emit } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(await makeRequest("/internal/tournament/match-updated", { slug: "abc" }));
    expect(res.status).toBe(204);
    expect(to).toHaveBeenCalledWith("tournament:abc");
    expect(emit).toHaveBeenCalledWith("tournament:match-updated", {});
  });

  it("rejects participant-joined with bad payload (empty slug)", async () => {
    const { io } = makeIo();
    const handle = createInternalHttpHandler({ io: io as any, secret: SECRET });
    const res = await handle(
      await makeRequest("/internal/tournament/participant-joined", { slug: "", playerId: 9, displayName: "Alice" }),
    );
    expect(res.status).toBe(400);
  });
});
