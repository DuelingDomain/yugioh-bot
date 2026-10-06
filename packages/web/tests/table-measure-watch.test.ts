// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LATE_MEASURE_MS, watchMeasure } from "@/components/duel/table/measure-watch";

describe("watchMeasure", () => {
  let frames: FrameRequestCallback[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const flush = () => {
    const run = frames;
    frames = [];
    for (const cb of run) cb(0);
  };

  it("measures on the next frame, when the board settles and once late", () => {
    const measure = vi.fn();
    const stop = watchMeasure(document.createElement("div"), measure, { settleMs: 1500, watch: false });
    flush();
    expect(measure).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LATE_MEASURE_MS);
    expect(measure).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1500);
    expect(measure).toHaveBeenCalledTimes(3);
    stop();
  });

  it("watches the board only while a pick is open", async () => {
    for (const watch of [false, true]) {
      const root = document.createElement("div");
      const measure = vi.fn();
      const stop = watchMeasure(root, measure, { settleMs: 5000, watch });
      flush();
      measure.mockClear();
      root.appendChild(document.createElement("span"));
      // MutationObserver callbacks run as a microtask.
      await Promise.resolve();
      flush();
      expect(measure).toHaveBeenCalledTimes(watch ? 1 : 0);
      stop();
    }
  });

  it("measures again when a zone gets its size, only while a pick is open", () => {
    const observed: Element[] = [];
    let fire: () => void = () => undefined;
    class FakeResizeObserver {
      constructor(cb: () => void) {
        fire = cb;
      }
      observe(node: Element) {
        observed.push(node);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    for (const watch of [false, true]) {
      observed.length = 0;
      fire = () => undefined;
      const root = document.createElement("div");
      root.innerHTML = '<div data-zones="m1"></div><div data-legal="true"></div><div></div>';
      const measure = vi.fn();
      const stop = watchMeasure(root, measure, { settleMs: 5000, watch });
      flush();
      measure.mockClear();
      fire();
      flush();
      expect(observed.length).toBe(watch ? 2 : 0);
      expect(measure).toHaveBeenCalledTimes(watch ? 1 : 0);
      stop();
    }
    vi.unstubAllGlobals();
  });
});
