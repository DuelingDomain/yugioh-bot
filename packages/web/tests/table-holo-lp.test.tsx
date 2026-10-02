// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { HoloLp, formatClock, holoStatus, type HoloLpProps } from "@/components/duel/table/holo-lp";
import { RivalField, seatTransform } from "@/components/duel/table/rival-field";
import type { SeatPose } from "@/components/duel/table/types";

afterEach(cleanup);

function holo(over: Partial<HoloLpProps> = {}): HoloLpProps {
  return {
    seat: 1, name: "Ryo Sato", tone: "ice", lp: 5400, handCount: 4, deckCount: 30, clockMs: 240000,
    status: "active", me: false, x: 8, y: 8, beam: "down", reducedMotion: true, ...over,
  };
}

describe("HoloLp", () => {
  it("owns exactly one data-lp-seat for its seat", () => {
    const { container } = render(<HoloLp {...holo()} />);
    const nodes = container.querySelectorAll("[data-lp-seat]");
    expect(nodes).toHaveLength(1);
    expect(nodes[0].getAttribute("data-lp-seat")).toBe("1");
  });

  it("shows the name and the clock", () => {
    const { container } = render(<HoloLp {...holo()} />);
    expect(container.textContent).toContain("Ryo Sato");
    expect(container.textContent).toContain("04:00");
  });

  it("marks the eliminated state and shows its label", () => {
    const { container } = render(<HoloLp {...holo({ status: "eliminated", lp: 0 })} />);
    expect(container.querySelector("[data-holo]")?.getAttribute("data-elim")).toBeTruthy();
    expect(container.textContent).toContain("Eliminated");
  });

  it("is a button with a key hint when it is legal, and picks on click", () => {
    const onPick = vi.fn();
    const { container } = render(<HoloLp {...holo({ legal: true, hotkey: 2, onPick })} />);
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("2");
    fireEvent.click(button!);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(1);
  });

  it("is not a button when it is not legal", () => {
    const { container } = render(<HoloLp {...holo()} />);
    expect(container.querySelector("button")).toBeNull();
  });
});

describe("formatClock", () => {
  it("formats minutes and seconds, and hides a missing clock", () => {
    expect(formatClock(null)).toBeNull();
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(192000)).toBe("03:12");
  });
});

describe("holoStatus", () => {
  const engine = { turnSeat: 0, seats: [{ seat: 0 }, { seat: 1, eliminated: true }, { seat: 2, pendingElimination: true }, { seat: 3 }] };
  it("picks the first state that applies", () => {
    expect(holoStatus(engine, 1, 1)).toBe("eliminated");
    expect(holoStatus(engine, 2, null)).toBe("leaving");
    expect(holoStatus(engine, 3, 3)).toBe("choosing");
    expect(holoStatus(engine, 0, null)).toBe("turn");
    expect(holoStatus(engine, 3, null)).toBe("active");
  });
});

describe("RivalField", () => {
  const pose: SeatPose = { seat: 1, x: 298, y: 222, scale: 0.66, rotateDeg: 158, tiltDeg: 12, z: 112, docked: false, compact: false, hidden: false };

  it("builds the seat transform in the prototype order", () => {
    expect(seatTransform(pose)).toBe("translate(298px, 222px) translate(-50%, -50%) perspective(1700px) rotateX(12deg) rotate(158deg) scale(0.66)");
    expect(seatTransform({ ...pose, tiltDeg: undefined })).not.toContain("perspective");
  });

  it("passes the pose angle and scale to the renderer", () => {
    const seen: Array<{ angleDeg: number; scale?: number }> = [];
    const { container } = render(
      <RivalField
        pose={pose}
        field={{} as never}
        render={(props) => {
          seen.push({ angleDeg: props.angleDeg, scale: props.scale });
          return <i data-probe />;
        }}
      />,
    );
    expect(seen[0]).toEqual({ angleDeg: 158, scale: 0.66 });
    expect(container.querySelector("[data-seat-slot='1']")).not.toBeNull();
    expect(container.querySelector("[data-probe]")).not.toBeNull();
  });
});
