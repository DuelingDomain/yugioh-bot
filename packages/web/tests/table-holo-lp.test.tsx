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
  it("exposes only the current LP number separately from its damage history", () => {
    const { container, rerender } = render(<HoloLp {...holo({ lp: 8000 })} />);
    const panel = container.querySelector('[data-lp-seat="1"]')!;
    expect(panel.querySelector("[data-lp-value]")?.textContent).toBe("8,000");
    expect(panel.querySelector("[data-damage-chip]")).toBeNull();
    rerender(<HoloLp {...holo({ lp: 6000, lastDamage: 2000 })} />);
    expect(panel.querySelector("[data-lp-value]")?.textContent).toBe("6,000");
    expect(panel.querySelectorAll("[data-damage-chip]")).toHaveLength(1);
    rerender(<HoloLp {...holo({ lp: 8000, lastDamage: null })} />);
    expect(panel.querySelector("[data-lp-value]")?.textContent).toBe("8,000");
    expect(panel.querySelector("[data-damage-chip]")).toBeNull();
  });

  it("strikes out the old LP and shows a red chip for the last damage", () => {
    const { container } = render(<HoloLp {...holo({ lp: 6800, lastDamage: 1200 })} />);
    const chip = container.querySelector("[data-damage-chip]") as HTMLElement;
    expect(chip.querySelector("s")?.textContent).toBe("8,000");
    expect(chip.querySelector("b")?.textContent).toBe("-1,200");
  });

  it("shows no chip without damage", () => {
    const { container } = render(<HoloLp {...holo({ lastDamage: null })} />);
    expect(container.querySelector("[data-damage-chip]")).toBeNull();
  });

  it("shows one damage history after a live LP update, without a second LifePoints tally", () => {
    const { container, rerender } = render(<HoloLp {...holo({ lp: 8000 })} />);
    rerender(<HoloLp {...holo({ lp: 6000, lastDamage: 2000 })} />);
    expect(container.querySelectorAll('[data-lp-seat="1"] [data-damage-chip]')).toHaveLength(1);
    expect(container.querySelectorAll("[data-change]")).toHaveLength(0);
  });

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

describe("HoloLp Deck Master thumb", () => {
  const master = { code: 46986414, name: "Dark Magician", description: "", type: 1, attack: 0, defense: 0, level: 7, attribute: 1, race: "Spellcaster" };

  it("shows a rival's master art and inspects it on click, beside the LP node", () => {
    const onInspectMaster = vi.fn();
    const { container } = render(<HoloLp {...holo({ master, onInspectMaster })} />);
    const thumb = container.querySelector("[data-master-thumb='1']") as HTMLElement;
    expect(thumb).not.toBeNull();
    expect(thumb.getAttribute("aria-label")).toContain("Dark Magician");
    fireEvent.click(thumb);
    expect(onInspectMaster).toHaveBeenCalledWith(master);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(1);
  });

  it("has no thumb without a master, and sits outside the pick button of a legal panel", () => {
    expect(render(<HoloLp {...holo()} />).container.querySelector("[data-master-thumb]")).toBeNull();
    cleanup();
    const { container } = render(<HoloLp {...holo({ master, legal: true, hotkey: 1 })} />);
    expect(container.querySelector("button [data-master-thumb]")).toBeNull();
    expect(container.querySelector("[data-master-thumb]")).not.toBeNull();
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
  it("reads a Leaving seat as leaving even when it holds the turn or the prompt", () => {
    const leavingTurn = { turnSeat: 2, seats: engine.seats };
    expect(holoStatus(leavingTurn, 2, null)).toBe("leaving");
    expect(holoStatus(leavingTurn, 2, 2)).toBe("leaving");
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
