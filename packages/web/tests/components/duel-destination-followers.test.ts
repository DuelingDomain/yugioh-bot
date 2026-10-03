// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followMoveDestination } from "@/components/duel/event-queue";
import type { DuelEvent } from "@yugidraft/shared/duels";

const event: DuelEvent = { id: 1, kind: "move", text: "move" };
let frames: Map<number, FrameRequestCallback>;
let stops: Array<() => void>;
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  frames = new Map();
  stops = [];
  let next = 0;
  request = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({}));
});
afterEach(() => { stops.forEach((stop) => stop()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function frame() {
  const [id, callback] = frames.entries().next().value!;
  frames.delete(id);
  callback(0);
}

describe("shared destination followers", () => {
  it.each(["read", "write"] as const)("reports and removes a failed %s while healthy followers keep running", (phase) => {
    const order: string[] = [];
    const error = new Error(`failed ${phase}`);
    const badRead = vi.fn(() => {
      order.push("bad read");
      if (phase === "read") throw error;
      return "bad sample";
    });
    const badWrite = vi.fn(() => { order.push("bad write"); throw error; });
    stops.push(followMoveDestination(event, badRead, badWrite));
    stops.push(followMoveDestination(event, () => { order.push("healthy read"); return 42; }, (sample) => {
      expect(sample).toBe(42);
      order.push("healthy write");
    }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(frame).not.toThrow();
    expect(order).toEqual(phase === "read"
      ? ["bad read", "healthy read", "healthy write"]
      : ["bad read", "healthy read", "bad write", "healthy write"]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).message).toContain(error.message);
    order.length = 0;
    expect(frame).not.toThrow();
    expect(order).toEqual(["healthy read", "healthy write"]);
    expect(badRead).toHaveBeenCalledTimes(1);
    expect(badWrite).toHaveBeenCalledTimes(phase === "read" ? 0 : 1);
    expect(frames.size).toBe(1);
  });
});
