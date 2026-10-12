// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelClock } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { HoloLp, type HoloLpProps } from "@/components/duel/table/holo-lp";
import { TeamLpPlate, type PlateMember } from "@/components/duel/tag/team-lp-plate";

beforeEach(() => vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "performance"] }));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// `remainingMs` is the bank at `startedAt`; the answering seat runs down from there.
function clockOf(remainingMs: number[], activeSeat: number | null, serverNow = 10_000): DuelClock {
  return { turn: 1, remainingMs, activeSeat, startedAt: activeSeat == null ? null : serverNow, serverNow };
}

function holo(over: Partial<HoloLpProps> = {}): HoloLpProps {
  return {
    seat: 1, name: "Ryo Sato", tone: "ice", lp: 5400, handCount: 4, deckCount: 30, clockMs: 240_000,
    status: "active", me: false, x: 8, y: 8, beam: "down", reducedMotion: true, ...over,
  };
}

const plateClock = (container: HTMLElement, seat: number) =>
  container.querySelector(`[data-holo="${seat}"] [data-low], [data-holo="${seat}"] span:last-child`);

describe("HoloLp live clock", () => {
  it("counts the answering seat down from the snapshot, and leaves other seats still", () => {
    const clock = clockOf([240_000, 240_000, 240_000], 1);
    const active = render(<HoloLp {...holo({ seat: 1, clock, clockMs: 240_000 })} />);
    expect(active.container.textContent).toContain("04:00");
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(active.container.textContent).toContain("03:55");
    active.unmount();
    const idle = render(<HoloLp {...holo({ seat: 2, clock, clockMs: 240_000 })} />);
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(idle.container.textContent).toContain("04:00");
  });

  it("restarts from the new snapshot on every state change", () => {
    const first = clockOf([240_000, 240_000], 0, 10_000);
    const { container, rerender } = render(<HoloLp {...holo({ seat: 0, clock: first })} />);
    act(() => { vi.advanceTimersByTime(8_000); });
    expect(container.textContent).toContain("03:52");
    rerender(<HoloLp {...holo({ seat: 0, clock: clockOf([200_000, 240_000], 0, 20_000) })} />);
    expect(container.textContent).toContain("03:20");
    rerender(<HoloLp {...holo({ seat: 0, clock: clockOf([200_000, 240_000], 1, 30_000) })} />);
    act(() => { vi.advanceTimersByTime(4_000); });
    expect(container.textContent).toContain("03:20");
  });

  it("marks a clock at one minute or less as low", () => {
    const clock = clockOf([63_000, 240_000], 0);
    const { container } = render(<HoloLp {...holo({ seat: 0, clock })} />);
    expect(container.querySelector('[data-low="true"]')).toBeNull();
    act(() => { vi.advanceTimersByTime(3_000); });
    expect(container.querySelector('[data-low="true"]')?.textContent).toBe("01:00");
  });

  it("falls back to the given clockMs without a duel clock, and hides a duel without a clock", () => {
    const { container } = render(<HoloLp {...holo({ clockMs: 192_000 })} />);
    expect(container.textContent).toContain("03:12");
    expect(plateClock(container, 1)).not.toBeNull();
    const none = render(<HoloLp {...holo({ clockMs: null, clock: null })} />);
    expect(none.container.textContent).not.toMatch(/\d\d:\d\d/);
  });
});

function member(over: Partial<PlateMember> = {}): PlateMember {
  return {
    seat: 0, name: "Ayu Mori", code: "1A", rgb: "120 80 200", ink: "#cbb6ff", you: false, hand: 5, deck: 30,
    clockMs: 240_000, clockRuns: true, now: true, response: null, pickable: false, hotkey: null, locked: false, ...over,
  };
}

describe("Tag plate live clock", () => {
  const plate = (members: PlateMember[]) => (
    <TeamLpPlate teamName="Team 1" glyph="◆" near lp={8000} startLp={8000} state="now" cracked={false} members={members} reducedMotion />
  );

  it("counts the member on the baton down and keeps the partner still", () => {
    const clock = clockOf([240_000, 240_000], 0);
    const { container } = render(plate([member({ seat: 0, clock }), member({ seat: 1, code: "1B", clock, now: false, clockRuns: false })]));
    act(() => { vi.advanceTimersByTime(7_000); });
    const times = [...container.querySelectorAll("[data-member-seat]")].map((node) => node.textContent?.match(/\d\d:\d\d/)?.[0]);
    expect(times).toEqual(["03:53", "04:00"]);
  });

  it("marks a low clock", () => {
    const clock = clockOf([50_000, 240_000], 0);
    const { container } = render(plate([member({ seat: 0, clock })]));
    expect(container.querySelector('[data-low="true"]')?.textContent).toBe("00:50");
  });
});
