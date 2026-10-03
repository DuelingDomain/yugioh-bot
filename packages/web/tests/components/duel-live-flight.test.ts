// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { followMoveDestination } from "@/components/duel/event-queue";
import { retargetFlight } from "@/components/duel/live-flight";

const event: DuelEvent = { id: 1, kind: "move", text: "draw", zone: { controller: 0, location: 2, sequence: 0 } };
let left: number;
let destination: HTMLElement;
let overlay: HTMLElement;
const rect = (x: number): DOMRect => ({ left: x, top: 700, width: 70, height: 100 } as DOMRect);
beforeEach(() => {
  vi.useFakeTimers(); left = 500;
  document.body.innerHTML = '<div data-zones="0:2:0"></div><div id="overlay"></div>';
  destination = document.querySelector("[data-zones]")!;
  overlay = document.querySelector("#overlay")!;
  vi.spyOn(destination, "getBoundingClientRect").mockImplementation(() => rect(left));
  vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("live flight geometry", () => {
  it("shares one frame and performs every read before any write", () => {
    const order: string[] = [];
    const raf = vi.spyOn(window, "requestAnimationFrame");
    const stops = [1, 2, 3].map((id) => followMoveDestination(event,
      (dest) => { order.push(`read${id}`); return dest!.getBoundingClientRect(); },
      (r) => { order.push(`write${id}`); destination.style.left = `${r.left}px`; },
    ));
    expect(raf).toHaveBeenCalledTimes(1);
    expect(order).toEqual([]);
    vi.advanceTimersByTime(17);
    expect(order).toEqual(["read1", "read2", "read3", "write1", "write2", "write3"]);
    stops.forEach((stop) => stop());
    const calls = raf.mock.calls.length;
    vi.advanceTimersByTime(50);
    expect(raf).toHaveBeenCalledTimes(calls);
  });

  it.each([504, 667])("blends a mid-flight shuffle over the remaining %s ms flight and lands exactly", (duration) => {
    const ghost = document.createElement("div");
    const flight = retargetFlight({ event, el: ghost, overlay, cx: 535, cy: 750, duration });
    vi.advanceTimersByTime(duration / 2);
    expect(ghost.style.translate).toBe("0px 0px");
    left = 200;
    vi.advanceTimersByTime(17);
    // The first sample of the new target retains the current position.
    expect(ghost.style.translate).toBe("0px 0px");
    vi.advanceTimersByTime(duration / 4);
    const correction = Number.parseFloat(ghost.style.translate);
    expect(correction).toBeLessThan(-50); expect(correction).toBeGreaterThan(-300);
    const final = flight.finish();
    expect(final).toEqual({ dx: -300, dy: 0 });
    expect(535 + final.dx).toBe(destination.getBoundingClientRect().left + 35);
    flight.stop();
  });
});
