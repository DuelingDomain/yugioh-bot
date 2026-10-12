import { expect, it, vi } from "vitest";
import { ReplayJsonEncoder, replayJsonResponse } from "../src/replay-json.js";
import { ReplayWorker, replaySource } from "./support/replay-fixtures.js";

it("serializes a large view in a worker and streams reusable JSON without serializing frames on the host", async () => {
  const source = replaySource(), worker = new ReplayWorker();
  await worker.create({ mode: "normal", decks: source.decks, seed: source.seed, dataDirectory: "/fixture" });
  const view = await worker.view(null);
  view.log = [{ id: 1, text: "大型 replay ".repeat(100_000) }];
  const frames = [{ step: 0, actorSeat: null, view }];
  const stringify = JSON.stringify;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => {
    if (value === view || value === frames || value?.view === view || value?.frames === frames) {
      throw new Error("Large replay JSON conversion ran on the host");
    }
    return stringify(value, ...args);
  });
  const encoder = new ReplayJsonEncoder();
  try {
    const serialized = await encoder.encode(view);
    expect(serialized.bytes).toBe(Buffer.byteLength(serialized.json));
    const replay = { verification: "exact" as const, session: source.session, role: "spectator" as const, mySeat: null, frames };
    const response = replayJsonResponse({ replay, viewJson: [serialized.json] });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(replay);
    const deadline = new AbortController();
    const expired = replayJsonResponse({ replay, viewJson: [serialized.json] }, deadline.signal);
    deadline.abort(new Error("Replay response timed out"));
    await expect(expired.arrayBuffer()).rejects.toThrow("Replay response timed out");
  } finally { spy.mockRestore(); await encoder.close(); }
});

it("streams metadata-only checkpoints without stringifying the entire step list on the host", async () => {
  const source = replaySource();
  const forkSteps = Array.from({ length: 1500 }, (_, step) => ({ step, frameId: `frame-${step}`, actorSeat: 0,
    kind: "engine" as const, cursor: `sealed-${step}` }));
  const replay = { verification: "exact" as const, version: 2 as const, sourceVersion: "version", visibility: "public" as const, session: source.session,
    role: "spectator" as const, mySeat: null, dataSeat: null, frames: [], forkSteps };
  const stringify = JSON.stringify;
  const spy = vi.spyOn(JSON, "stringify").mockImplementation((value, ...args) => {
    if (value === forkSteps || value?.forkSteps === forkSteps) throw new Error("Entire checkpoint list serialized on host");
    return stringify(value, ...args);
  });
  try { expect(await replayJsonResponse({ replay, viewJson: [] }).json()).toEqual(replay); }
  finally { spy.mockRestore(); }
});
