// @vitest-environment jsdom
import React, { useRef } from "react";
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocatorFly, type Moment } from "@/components/tournament/fx/locator-fly";
import type { Motion } from "@/components/tournament/fx/use-animations";

const moment: Moment = { key: "7:1", matchId: 7, winnerId: 5, mine: true };

function Stage({ motion, moment: m }: { motion: Motion; moment: Moment | null }) {
  const root = useRef<HTMLDivElement>(null);
  return (
    <div ref={root}>
      <i data-fly-source="centre" />
      <i data-slot="5:7" data-testid="slot" />
      <LocatorFly moment={m} motion={motion} root={root} />
    </div>
  );
}

function stubAnimate() {
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel, onfinish: null }));
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true, writable: true });
  return { animate, cancel };
}
afterEach(() => { delete (HTMLElement.prototype as { animate?: unknown }).animate; vi.restoreAllMocks(); });

describe("LocatorFly", () => {
  it("does nothing when animations are off", () => {
    const { animate } = stubAnimate();
    const { getByTestId } = render(<Stage motion="off" moment={moment} />);
    expect(getByTestId("slot").style.opacity).toBe("");
    expect(animate).not.toHaveBeenCalled();
  });

  it("just shows the card where animation is not supported", () => {
    const { getByTestId } = render(<Stage motion="full" moment={moment} />);
    expect(getByTestId("slot").style.opacity).toBe("");
    expect(document.body.querySelectorAll("[aria-hidden='true'][style*='position:fixed']")).toHaveLength(0);
  });

  it("calm hides the card, fades it in with opacity only, and restores it on cleanup", () => {
    const { animate, cancel } = stubAnimate();
    const { getByTestId, unmount } = render(<Stage motion="calm" moment={moment} />);
    expect(getByTestId("slot").style.opacity).toBe("0");
    const frames = (animate.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0];
    for (const frame of frames) expect(Object.keys(frame)).toEqual(["opacity"]);
    const slot = getByTestId("slot");
    unmount();
    expect(cancel).toHaveBeenCalled();
    expect(slot.style.opacity).toBe("");
  });

  it("full flies a temporary card on the body, animates transform and opacity only, and cleans up", () => {
    const { animate } = stubAnimate();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 10, top: 20, width: 80, height: 120, right: 90, bottom: 140, x: 10, y: 20, toJSON: () => ({}) });
    const { getByTestId, unmount } = render(<Stage motion="full" moment={moment} />);
    const flyers = () => document.body.querySelectorAll<HTMLElement>("body > div[aria-hidden='true']");
    expect(flyers()).toHaveLength(1);
    expect(getByTestId("slot").style.opacity).toBe("0");
    const frames = (animate.mock.calls[0] as unknown as [Array<Record<string, unknown>>])[0];
    for (const frame of frames) expect(Object.keys(frame).filter((k) => k !== "offset" && k !== "easing").sort()).toEqual(["opacity", "transform"]);
    const slot = getByTestId("slot");
    unmount();
    expect(flyers()).toHaveLength(0);
    expect(slot.style.opacity).toBe("");
  });

  it("plays a moment once: a re-render with the same key does not start it again", () => {
    const { animate } = stubAnimate();
    const { rerender } = render(<Stage motion="calm" moment={moment} />);
    rerender(<Stage motion="calm" moment={{ ...moment }} />);
    expect(animate).toHaveBeenCalledTimes(1);
    rerender(<Stage motion="calm" moment={{ ...moment, key: "7:2" }} />);
    expect(animate).toHaveBeenCalledTimes(2);
  });
});
