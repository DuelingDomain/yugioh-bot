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
    const replay = { session: source.session, role: "spectator" as const, mySeat: null, frames };
    const response = replayJsonResponse({ replay, viewJson: [serialized.json] });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual(replay);
    const deadline = new AbortController();
    const expired = replayJsonResponse({ replay, viewJson: [serialized.json] }, deadline.signal);
    deadline.abort(new Error("Replay response timed out"));
    await expect(expired.arrayBuffer()).rejects.toThrow("Replay response timed out");
  } finally { spy.mockRestore(); await encoder.close(); }
});
