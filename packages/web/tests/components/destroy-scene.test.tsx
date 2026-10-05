// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { SummonFx } from "@/components/duel/summon-fx";
import { MoveFx } from "@/components/duel/move-fx";
import { ChainFx } from "@/components/duel/chain-fx";
import { DestroyFx } from "@/components/duel/destroy-fx";
import { MOVE_TIMING, resetMoveSchedule } from "@/components/duel/move-plan";
import { resetChainBeats } from "@/components/duel/chain-beats";
import { resetEffectSequence } from "@/components/duel/effect-sequence";
import { clearBattleHolds } from "@/components/duel/battle-hold";
import { withDestroyCards } from "@/components/duel/destroy-cards";
import { duelFxClock } from "@/components/duel/fx-clock";
import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { setSharedFx3d } from "@/components/duel/fx3d/shared";
import type { FxScene } from "@/components/duel/fx3d/types";
import { CARDS as C } from "@/components/duel/fx-lab/cards";
import { createTimeline, type Timeline } from "./fx-timeline";

// SummonFx publishes the canvas it gets from useFx3d: the test puts a mock canvas there (or none).
const canvasHolder = vi.hoisted(() => ({ api: null as unknown }));
vi.mock("@/components/duel/fx3d/use-fx3d", () => ({ useFx3d: () => ({ current: canvasHolder.api }) }));

/**
 * The scene layer (DestroyFx) on a mocked canvas: what the scene receives, and what the page shows on each zone
 * until the canvas takes the card. The canvas itself is not drawn (jsdom has no WebGL).
 */
const MZONE = 0x04, SZONE = 0x08, HAND = 0x02, DECK = 0x01, GRAVE = 0x10;
const zone = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const key = (z: DuelZoneRef) => `${z.controller}:${z.location}:${z.sequence}`;

const RECTS: Record<string, [number, number]> = {
  "0:8:1": [300, 520], "0:4:1": [400, 400], "0:16:0": [900, 520], "0:2:0": [100, 700],
  "1:8:1": [300, 120], "1:8:2": [400, 120], "1:4:1": [400, 240], "1:4:2": [500, 240], "1:16:0": [900, 120],
  "1:1:0": [1000, 120], "1:32:0": [1000, 240], "1:2:0": [500, 20],
};
const rectOf = (el: Element) => {
  const zoneEl = el.closest<HTMLElement>("[data-zones]");
  const at = zoneEl ? RECTS[zoneEl.dataset.zones!.split(/\s+/)[0]] : undefined;
  if (at) return { left: at[0], top: at[1], width: 70, height: 100 };
  if (el.getAttribute("data-test-host") === "true" || (el.getAttribute("aria-hidden") === "true" && el.tagName === "DIV" && !(el as HTMLElement).style.position)) return { left: 0, top: 0, width: 1200, height: 800 };
  return { left: 0, top: 0, width: 0, height: 0 };
};

let tl: Timeline;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  resetMoveSchedule("x");
  resetChainBeats("x");
  resetEffectSequence();
  // A 3D wipe arms a battle hold on each zone it clears: it must not reach the next test.
  clearBattleHolds();
  setAnimationSpeed(1);
  duelFxClock.setReducedMotion(false);
  duelFxClock.resetReviewTimeline();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const r = rectOf(this);
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r } as DOMRect;
  });
  tl = createTimeline();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: tl.animate });
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, writable: true, value: () => [] });
});
afterEach(() => {
  cleanup();
  canvasHolder.api = null;
  setSharedFx3d(null);
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
});

const ev = (e: Partial<DuelEvent> & Pick<DuelEvent, "id" | "kind">): DuelEvent => ({ text: e.kind, ...e }) as DuelEvent;
const source = (id: number, card: DuelCardInfo, at: DuelZoneRef): DuelEvent[] => [
  ev({ id, kind: "move", card, from: zone(0, HAND, 0), zone: at, reason: "activate" }),
  ev({ id: id + 1, kind: "activate", card, zone: at, chainIndex: 1 }),
  ev({ id: id + 2, kind: "chain-resolving", chainIndex: 1 }),
];
const destroyOf = (id: number, card: DuelCardInfo | undefined, at: DuelZoneRef, by: DuelCardInfo): DuelEvent =>
  ev({ id, kind: "destroy", card, zone: at, cause: "effect", sourceCode: by.code, sourceKind: "spell", sourceSeat: 0 });

type Victim = { card: DuelCardInfo; at: DuelZoneRef; up: boolean };

function Board({ events, victims, committed, reduced = false }: { events: DuelEvent[]; victims: Victim[]; committed: boolean; reduced?: boolean }) {
  const keys = new Set<string>(["0:8:1", "0:16:0", "1:16:0", "1:1:0", "1:32:0", "0:2:0", ...victims.map((v) => key(v.at))]);
  const withCards = withDestroyCards(events);
  return (
    <div data-test-host="true">
      <div data-hand-seat="1" data-side="opp"><div data-hand-card="true" data-hand-id="h1"><div data-zones="1:2:0" data-side="opp"><span data-card-art /></div></div></div>
      {[...keys].filter((k) => k !== "1:2:0").map((k) => {
        const victim = victims.find((v) => key(v.at) === k);
        return (
          <div key={k} data-zones={k} data-side={k.startsWith("1") ? "opp" : "you"}>
            {victim && !committed ? (
              <span data-card-art>{victim.up ? <img src={`/api/cards/${victim.card.code}/image?size=small`} alt="" /> : null}</span>
            ) : null}
          </div>
        );
      })}
      <SummonFx events={withCards} duelKey="x" reducedMotion={reduced} shake="off" />
      <MoveFx events={withCards} duelKey="x" reducedMotion={reduced} />
      <DestroyFx events={withCards} reducedMotion={reduced} mySeat={0} />
      <ChainFx events={withCards} chain={[]} duelKey="x" reducedMotion={reduced} mySeat={0} playerName={() => "P"} />
    </div>
  );
}

/** Stand-ins of one card at its zone, counted the way a viewer sees them (the wipe ghost sits by position). */
function standIns(code: number, at: DuelZoneRef): { wipe: number; sleeveWipe: number; whole: number; ghost: number; source: number } {
  const [left, top] = RECTS[key(at)];
  const shows = (el: Element) => tl.opacityAt(el, document.body) > 0.3;
  const wipeEls = [...document.body.querySelectorAll<HTMLElement>("div[aria-hidden=true]")].filter((el) =>
    el.style.position === "fixed" && el.style.left === `${left}px` && el.style.top === `${top}px` && el.firstElementChild != null && shows(el));
  const holds = (el: Element) => el.querySelector(`img[src*="/cards/${code}/"]`) != null ||
    [...el.querySelectorAll<HTMLElement>("i")].some((i) => i.style.backgroundImage.includes(`/cards/${code}/`));
  return {
    wipe: wipeEls.length,
    sleeveWipe: wipeEls.filter((el) => (el.firstElementChild as HTMLElement).style.background.includes("card-back")).length,
    whole: [...document.body.querySelectorAll("[class*=destroyWhole]")].filter((el) => holds(el) && shows(el)).length,
    ghost: [...document.body.querySelectorAll("[data-style]")].filter((el) => holds(el) && shows(el)).length,
    // Reduced motion: the card stands on its source zone (a sleeve for a Set card) and fades out there.
    source: [...document.body.querySelectorAll("[data-stand-in]")].filter(shows).length,
  };
}
/** Stand-ins of the victims that a viewer can still see, and the wipe ghosts still in the page. */
const stuck = (victims: Victim[]): number => {
  return victims.reduce((sum, v) => {
    const s = standIns(v.card.code, v.at);
    return sum + s.wipe + s.whole + s.ghost + s.source;
  }, 0) + document.body.querySelectorAll("div[aria-hidden=true][style*=fixed]:has(> img), div[aria-hidden=true][style*=fixed]:has(> div)").length;
};

async function step(ms: number, each?: (t: number) => void, size = 25) {
  for (let t = 0; t < ms; t += size) {
    await act(async () => { vi.advanceTimersByTime(size); });
    each?.(t + size);
  }
}

function mockCanvas() {
  const scenes: Array<{ scene: FxScene; at: number }> = [];
  const play = vi.fn((_id: string, request: { scene: FxScene }) => { scenes.push({ scene: request.scene, at: performance.now() }); return Promise.resolve(); });
  canvasHolder.api = { ready: true, play, prefetchArt() {}, cancelAll() {} };
  return { scenes, play };
}

describe("a 3D wipe of face-down cards", () => {
  const a = zone(1, SZONE, 1);
  const b = zone(1, SZONE, 2);
  const victims: Victim[] = [{ card: C.mirrorForce, at: a, up: false }, { card: C.recklessGreed, at: b, up: true }];
  const events = [
    ...source(1, C.featherDuster, zone(0, SZONE, 1)),
    ev({ id: 4, kind: "move", card: C.mirrorForce, from: a, zone: zone(1, GRAVE, 0), reason: "destroy" }),
    ev({ id: 5, kind: "move", card: C.recklessGreed, from: b, zone: zone(1, GRAVE, 0), reason: "destroy" }),
    ev({ id: 6, kind: "chain-resolved", chainIndex: 1 }),
    destroyOf(7, undefined, a, C.featherDuster),
    destroyOf(8, C.recklessGreed, b, C.featherDuster),
    ev({ id: 9, kind: "chain-end" }),
  ];

  it("casts a Set card with its sleeve and keeps one stand-in on every zone until the canvas takes the card", async () => {
    const canvas = mockCanvas();
    const view = render(<Board events={[]} victims={victims} committed={false} />);
    view.rerender(<Board events={events} victims={victims} committed />);
    const seen: Array<{ t: number; a: ReturnType<typeof standIns>; b: ReturnType<typeof standIns> }> = [];
    const sample = (t: number) => seen.push({ t, a: standIns(C.mirrorForce.code, a), b: standIns(C.recklessGreed.code, b) });
    sample(0);
    await step(7000, sample);
    expect(canvas.play).toHaveBeenCalledTimes(1);
    const { scene, at } = canvas.scenes[0];
    // The Set card has no face in the scene (the sleeve); the face-up card keeps its face.
    expect(scene.victims.map((v) => v.code)).toEqual([0, C.recklessGreed.code]);
    // The face-down zone shows a sleeve, the face-up zone its face, and neither is blank before its take-over.
    const takeA = (scene.victims[0].takeMs ?? 0) + (at - 1000);
    const takeB = (scene.victims[1].takeMs ?? 0) + (at - 1000);
    expect(takeA).toBeGreaterThan(0);
    for (const row of seen) {
      if (row.t < takeA - 50) {
        const total = row.a.wipe + row.a.whole + row.a.ghost;
        expect(total, `+${row.t}: zone A shows ${JSON.stringify(row.a)}`).toBe(1);
        expect(row.a.sleeveWipe, `+${row.t}: zone A shows its sleeve`).toBe(row.a.wipe);
      }
      if (row.t < takeB - 50) expect(row.b.wipe + row.b.whole + row.b.ghost, `+${row.t}: zone B shows ${JSON.stringify(row.b)}`).toBe(1);
    }
    expect(seen.some((row) => row.a.sleeveWipe === 1)).toBe(true);
    expect(seen.some((row) => row.b.wipe === 1 && row.b.sleeveWipe === 0)).toBe(true);
  });
});

describe("reduced motion", () => {
  it("MST on a Set card shows the card once on the Graveyard and leaves nothing behind", async () => {
    const at = zone(1, SZONE, 2);
    const victims: Victim[] = [{ card: C.mirrorForce, at, up: false }];
    const events = [
      ...source(1, C.mst, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.mirrorForce, from: at, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(6, undefined, at, C.mst),
      ev({ id: 7, kind: "chain-end" }),
    ];
    duelFxClock.setReducedMotion(true);
    const view = render(<Board events={[]} victims={victims} committed={false} reduced />);
    view.rerender(<Board events={events} victims={victims} committed reduced />);
    const src: number[] = [];
    const dst: number[] = [];
    const sample = () => {
      const s = standIns(C.mirrorForce.code, at);
      src.push(s.source);
      dst.push(s.whole + s.ghost);
    };
    sample();
    // The stand-in shows the sleeve of a Set card, on the source zone: no gap before the move.
    const standIn = document.body.querySelector("[data-stand-in]");
    expect(standIn, "a stand-in on the source zone").not.toBeNull();
    // The face is in the markup (the card is known) but turned away: the flipper shows the sleeve.
    expect((standIn?.firstElementChild as HTMLElement | null)?.style.transform).toBe("rotateY(180deg)");
    expect(standIn?.querySelector("[data-sleeve]")).not.toBeNull();
    await step(6000, sample);
    const firstDest = dst.findIndex((n) => n > 0);
    expect(firstDest, "the card fades in on the Graveyard").toBeGreaterThan(0);
    expect(src[0], "the card shows from the first frame").toBe(1);
    expect(src.slice(0, firstDest + 1).every((n) => n === 1), "no blank sample before the Graveyard fade").toBe(true);
    // Both fade over the same time, so they overlap only for that fade.
    const both = src.filter((n, i) => n > 0 && dst[i] > 0).length;
    expect(both).toBeLessThanOrEqual(Math.ceil(MOVE_TIMING.reduced / 25) + 2);
    expect(Math.max(...src)).toBeLessThanOrEqual(1);
    expect(Math.max(...dst)).toBeLessThanOrEqual(1);
    expect(src[src.length - 1]).toBe(0);
    expect(stuck(victims)).toBe(0);
  });
});

describe("a resync or a remount during a stand-in", () => {
  const at = zone(1, MZONE, 1);
  const victims: Victim[] = [{ card: C.redEyes, at, up: true }];
  const events = [
    ...source(1, C.mst, zone(0, SZONE, 1)),
    ev({ id: 4, kind: "move", card: C.redEyes, from: at, zone: zone(1, DECK, 0), reason: "return" }),
    ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
    ev({ id: 6, kind: "chain-end" }),
  ];

  it("a remount replaying the same events leaves no stuck stand-in", async () => {
    const first = render(<Board events={[]} victims={victims} committed={false} />);
    first.rerender(<Board events={events} victims={victims} committed />);
    await step(300);
    first.unmount();
    // The room remounts with the same events while the board is already committed.
    const second = render(<Board events={events} victims={victims} committed />);
    await step(9000);
    expect(stuck(victims)).toBe(0);
    second.unmount();
  });

  it("control: with no resync nothing is left after the sequence", async () => {
    const view = render(<Board events={[]} victims={victims} committed={false} />);
    view.rerender(<Board events={events} victims={victims} committed />);
    await step(9000);
    expect(stuck(victims)).toBe(0);
  });

  it("a resync that drops the events while the card stands in leaves no stuck stand-in", async () => {
    const view = render(<Board events={[]} victims={victims} committed={false} />);
    view.rerender(<Board events={events} victims={victims} committed />);
    await step(300);
    expect(standIns(C.redEyes.code, at).ghost).toBe(1);
    view.rerender(<Board events={[]} victims={victims} committed />);
    await step(9000);
    expect(stuck(victims)).toBe(0);
  });

  it("a 3D wipe unmounted mid-way removes its ghosts", async () => {
    mockCanvas();
    const a = zone(1, SZONE, 1);
    const wipeVictims: Victim[] = [{ card: C.mirrorForce, at: a, up: false }];
    const wipeEvents = [
      ...source(1, C.featherDuster, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.mirrorForce, from: a, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(6, undefined, a, C.featherDuster),
      ev({ id: 7, kind: "chain-end" }),
    ];
    const view = render(<Board events={[]} victims={wipeVictims} committed={false} />);
    view.rerender(<Board events={wipeEvents} victims={wipeVictims} committed />);
    await step(200);
    expect(standIns(C.mirrorForce.code, a).sleeveWipe).toBe(1);
    view.unmount();
    expect(stuck(wipeVictims)).toBe(0);
  });
});
