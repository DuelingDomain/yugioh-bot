// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { armBattleDestroy, clearBattleHolds } from "../../src/components/duel/battle-hold";
import {
  beginDestroyHide,
  beginPileHold,
  clearDestroyHides,
  DESTROY_HIDE_CAP_MS,
  endDestroyHide,
  holdMatchesCard,
  isDestroyHidden,
  pileHeldCount,
  reconcileDestroyHides,
  shownPileCount,
  startDestroyHideGuard,
} from "../../src/components/duel/destroy-hide";
import { pieceFrames, pieceMotion } from "../../src/components/duel/move-fx";
import { BREAK_SETTLE_MS } from "../../src/components/duel/battle-hold";
import { MOVE_TIMING, planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";
import { SHARDS } from "../../src/components/duel/summon-fx";

const MZONE = 0x04;
const GRAVE = 0x10;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const card = { code: 1234, name: "Test", level: 4, type: 1 } as unknown as DuelEvent["card"];
const geometry = () => ({ distance: 300 });

const events = (cause: "battle" | "effect" = "effect"): DuelEvent[] => [
  { id: 1, kind: "destroy", text: "d", zone: z(0, MZONE, 2), card, cause },
  { id: 2, kind: "move", text: "m", seat: 0, from: z(0, MZONE, 2), zone: z(0, GRAVE, 0), card, reason: "destroy" },
];

beforeEach(() => {
  resetMoveSchedule("t");
  clearBattleHolds();
  clearDestroyHides();
});
afterEach(() => {
  clearDestroyHides();
  clearBattleHolds();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("a destroyed card leaves as pieces, never as the intact card", () => {
  it("marks the flight of an effect destroy as a burst of pieces that leaves at the break", () => {
    const [plan] = planMoves(events("effect"), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(plan.destroy).toBe(true);
    expect(plan.pieces).toBe("burst");
    expect(plan.style).toBe("toss");
    expect(plan.startAt).toBe(100 + MOVE_TIMING.destroyBreakMs);
  });

  it("marks the flight after a fight slice as pieces that appear already apart, after the slice was seen", () => {
    armBattleDestroy("7:attacker", z(0, MZONE, 2), 1120, 100);
    const [plan] = planMoves(events("battle"), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(plan.destroy).toBe(true);
    expect(plan.pieces).toBe("scattered");
    expect(plan.startAt).toBeGreaterThanOrEqual(1120 + BREAK_SETTLE_MS);
  });

  it("draws no pieces when the canvas breaks the card (a fade into the pile) or with reduced motion", () => {
    armBattleDestroy("7:attacker", z(0, MZONE, 2), 1120, 100, true);
    const [three] = planMoves(events("battle"), { now: 100, reduced: false, duelKey: "t", geometry });
    expect(three.destroy).toBe(true);
    expect(three.pieces).toBeNull();
    expect(three.style).toBe("fade");
    resetMoveSchedule("t");
    clearBattleHolds();
    const [reduced] = planMoves(events("effect"), { now: 100, reduced: true, duelKey: "t", geometry });
    expect(reduced.destroy).toBe(true);
    expect(reduced.pieces).toBeNull();
  });

  it("does not mark an ordinary move as a destroy", () => {
    const move: DuelEvent = { id: 5, kind: "move", text: "m", seat: 0, from: z(0, 0x02, 1), zone: z(0, MZONE, 1), card };
    const [plan] = planMoves([move], { now: 0, reduced: false, duelKey: "t", geometry });
    expect(plan.destroy).toBe(false);
    expect(plan.pieces).toBeNull();
  });

  it("starts every piece whole or fully hidden, and ends every piece at nothing", () => {
    const motion = pieceMotion(SHARDS[0], 9, 0, 80, 116);
    const burst = pieceFrames(motion, "burst");
    const scattered = pieceFrames(motion, "scattered");
    expect(burst[0].opacity).toBe(1);
    expect(burst[burst.length - 1].opacity).toBe(0);
    // the pieces spring apart early in the flight: by a fifth of it they are away from the card
    expect(burst.find((f) => f.offset === 0.2)?.transform).not.toBe(burst[0].transform);
    expect(scattered[0].opacity).toBe(0);
    expect(scattered[scattered.length - 1].opacity).toBe(0);
    for (const frames of [burst, scattered]) {
      const offsets = frames.map((f) => f.offset as number);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    }
  });
});

describe("the real card is hidden in its zone from the start of the destroy until the flight lands", () => {
  it("is hidden at once, matches by passcode and is released by one call", () => {
    const zone = z(0, MZONE, 2);
    expect(isDestroyHidden(zone, 1234)).toBe(false);
    const release = beginDestroyHide("move:2", zone, 1234);
    expect(isDestroyHidden(zone, 1234)).toBe(true);
    expect(isDestroyHidden(zone, 0)).toBe(true);
    expect(isDestroyHidden(zone, 999)).toBe(false);
    expect(isDestroyHidden(z(0, MZONE, 3), 1234)).toBe(false);
    release();
    expect(isDestroyHidden(zone, 1234)).toBe(false);
    release();
    endDestroyHide("move:2");
    expect(isDestroyHidden(zone, 1234)).toBe(false);
  });

  it("keeps two destroys in one zone apart", () => {
    const zone = z(0, MZONE, 2);
    beginDestroyHide("a", zone, 1);
    beginDestroyHide("b", zone, 2);
    endDestroyHide("a");
    expect(isDestroyHidden(zone, 1)).toBe(false);
    expect(isDestroyHidden(zone, 2)).toBe(true);
  });

  it("releases on its own after the failsafe time, and never holds longer than the cap", () => {
    vi.useFakeTimers();
    const zone = z(0, MZONE, 2);
    beginDestroyHide("a", zone, 1234, 1500);
    vi.advanceTimersByTime(1499);
    expect(isDestroyHidden(zone, 1234)).toBe(true);
    vi.advanceTimersByTime(2);
    expect(isDestroyHidden(zone, 1234)).toBe(false);
    beginDestroyHide("b", zone, 1234, 10 * DESTROY_HIDE_CAP_MS);
    vi.advanceTimersByTime(DESTROY_HIDE_CAP_MS + 1);
    expect(isDestroyHidden(zone, 1234)).toBe(false);
  });

  it("counts the pile one lower per card in flight, never below zero", () => {
    const pile = z(0, GRAVE, 0);
    beginPileHold("a", pile);
    beginPileHold("b", pile);
    expect(pileHeldCount(pile)).toBe(2);
    expect(shownPileCount(5, pileHeldCount(pile))).toBe(3);
    expect(shownPileCount(1, 2)).toBe(0);
    expect(shownPileCount(Number.NaN, 1)).toBe(0);
  });

  it("matches a hold to the card shown, and to a card with no known face", () => {
    expect(holdMatchesCard(1234, 1234)).toBe(true);
    expect(holdMatchesCard(1234, 0)).toBe(true);
    expect(holdMatchesCard(0, 77)).toBe(true);
    expect(holdMatchesCard(1234, 77)).toBe(false);
  });
});

function board(code: number, count: number): { zone: HTMLElement; frame: HTMLElement; label: HTMLElement } {
  document.body.innerHTML = `
    <div id="mz" data-zones="0:4:2"><button><div id="frame">
      <div class="artWrap"><div data-card-art><img src="/api/cards/${code}/image?size=small" /></div></div>
      <span id="plate">1800</span><span id="marks">glow</span>
    </div></button></div>
    <div id="gy" data-zones="0:16:0"><button><b id="count" data-pile-count="${count}">${count}</b></button></div>`;
  return {
    zone: document.getElementById("mz") as HTMLElement,
    frame: document.getElementById("frame") as HTMLElement,
    label: document.getElementById("count") as HTMLElement,
  };
}

describe("the zone and the pile in the DOM", () => {
  it("hides the card, its plate and the zone marks at once, and shows them again at the landing", () => {
    const { frame } = board(1234, 4);
    const children = Array.from(frame.children) as HTMLElement[];
    beginDestroyHide("move:2", z(0, MZONE, 2), 1234);
    for (const child of children) expect(child.style.visibility).toBe("hidden");
    endDestroyHide("move:2");
    for (const child of children) expect(child.style.visibility).toBe("");
  });

  it("leaves a different card in the zone alone", () => {
    const { frame } = board(555, 4);
    beginDestroyHide("move:2", z(0, MZONE, 2), 1234);
    for (const child of Array.from(frame.children) as HTMLElement[]) expect(child.style.visibility).toBe("");
  });

  it("holds the pile count one lower until the flight lands, then shows the real count", () => {
    const { label } = board(1234, 4);
    beginPileHold("move:2", z(0, GRAVE, 0));
    expect(label.textContent).toBe("3");
    endDestroyHide("move:2");
    expect(label.textContent).toBe("3");
    clearDestroyHides();
    expect(label.textContent).toBe("4");
  });

  it("orders the hand-off: hidden at planning, pile held, both released at the landing", () => {
    vi.useFakeTimers();
    const { frame, label } = board(1234, 4);
    const [plan] = planMoves(events("effect"), { now: 0, reduced: false, duelKey: "t", geometry });
    const wait = plan.landAt + plan.holdMs;
    const releases = [beginDestroyHide(`move:${plan.id}`, plan.event.from as DuelZoneRef, 1234, wait + 1500), beginPileHold(`move:${plan.id}`, plan.event.zone as DuelZoneRef, wait + 1500)];
    const first = frame.firstElementChild as HTMLElement;
    // before the break, at the break and just before the landing: the zone is empty and the pile has not counted the card
    for (const at of [0, plan.startAt, wait - 1]) {
      vi.setSystemTime(at);
      expect(first.style.visibility).toBe("hidden");
      expect(label.textContent).toBe("3");
    }
    releases.forEach((release) => release());
    expect(first.style.visibility).toBe("");
    expect(label.textContent).toBe("4");
  });

  it("hides a card node that React draws again during the hold", async () => {
    const { zone, frame } = board(1234, 4);
    const stop = startDestroyHideGuard(document.body);
    beginDestroyHide("move:2", z(0, MZONE, 2), 1234);
    const fresh = document.createElement("div");
    fresh.dataset.cardArt = "";
    fresh.innerHTML = '<img src="/api/cards/1234/image?size=small" />';
    const wrap = document.createElement("div");
    wrap.appendChild(fresh);
    frame.replaceChildren(wrap);
    await Promise.resolve();
    await Promise.resolve();
    expect(wrap.style.visibility).toBe("hidden");
    expect(zone.contains(wrap)).toBe(true);
    stop();
    reconcileDestroyHides();
  });
});
