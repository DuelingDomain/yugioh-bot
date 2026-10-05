// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";
import { SummonFx } from "@/components/duel/summon-fx";
import { MoveFx } from "@/components/duel/move-fx";
import { ChainFx } from "@/components/duel/chain-fx";
import { BattleFx } from "@/components/duel/battle-fx";
import { getMovePlan, resetMoveSchedule } from "@/components/duel/move-plan";
import { resetChainBeats } from "@/components/duel/chain-beats";
import { resetEffectSequence } from "@/components/duel/effect-sequence";
import { withDestroyCards } from "@/components/duel/destroy-cards";
import { duelFxClock } from "@/components/duel/fx-clock";
import { setAnimationSpeed } from "@/components/duel/animation-speed";
import { CARDS as C } from "@/components/duel/fx-lab/cards";
import { createTimeline, type Timeline } from "./fx-timeline";

vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

const MZONE = 0x04, SZONE = 0x08, HAND = 0x02, DECK = 0x01, GRAVE = 0x10, REMOVED = 0x20;
const zone = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const key = (z: DuelZoneRef) => `${z.controller}:${z.location}:${z.sequence}`;

/** Where each zone sits on the 1200x800 test board (the opponent's side is on top). */
const RECTS: Record<string, [number, number]> = {
  "0:8:1": [300, 520], "0:4:1": [400, 400], "0:16:0": [900, 520], "0:2:0": [100, 700],
  "1:8:1": [300, 120], "1:8:2": [400, 120], "1:4:1": [400, 240], "1:4:2": [500, 240], "1:16:0": [900, 120],
  "1:1:0": [1000, 120], "1:32:0": [1000, 240], "1:2:0": [500, 20],
};
const rectOf = (el: Element) => {
  const zoneEl = el.closest<HTMLElement>("[data-zones]");
  const handEl = el.closest<HTMLElement>("[data-hand-seat]");
  const at = zoneEl ? RECTS[zoneEl.dataset.zones!.split(/\s+/)[0]] : undefined;
  if (at) return { left: at[0], top: at[1], width: 70, height: 100 };
  if (handEl && !zoneEl) return { left: 300, top: 10, width: 600, height: 100 };
  if (el.getAttribute("aria-hidden") === "true" && el.tagName === "DIV") return { left: 0, top: 0, width: 1200, height: 800 };
  return { left: 0, top: 0, width: 0, height: 0 };
};

let tl: Timeline;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  resetMoveSchedule("x");
  resetChainBeats("x");
  resetEffectSequence();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
});

const PHOENIX = { ...C.solemn, code: 63356631, name: "Phoenix Wing Wind Blast" } as DuelCardInfo;

type Victim = { card: DuelCardInfo; at: DuelZoneRef; /** The zone showed the card face (a Set card does not). */ up: boolean; defense?: boolean };

function Board({ events, victims, committed }: { events: DuelEvent[]; victims: Victim[]; committed: boolean }) {
  const keys = new Set<string>(["0:8:1", "0:16:0", "1:16:0", "1:1:0", "1:32:0", "0:2:0", ...victims.map((v) => key(v.at))]);
  return (
    <div>
      <div data-hand-seat="1" data-side="opp"><div data-hand-card="true" data-hand-id="h1"><div data-zones="1:2:0" data-side="opp"><span data-card-art /></div></div></div>
      {[...keys].filter((k) => k !== "1:2:0").map((k) => {
        const victim = victims.find((v) => key(v.at) === k);
        return (
          <div key={k} data-zones={k} data-side={k.startsWith("1") ? "opp" : "you"} data-defense={victim?.defense ? "true" : undefined}>
            {victim && !committed ? (
              <span data-card-art>{victim.up ? <img src={`/api/cards/${victim.card.code}/image?size=small`} alt="" /> : null}</span>
            ) : null}
          </div>
        );
      })}
      <SummonFx events={events} duelKey="x" reducedMotion={false} shake="off" />
      <MoveFx events={events} duelKey="x" reducedMotion={false} />
      <BattleFx events={events} reducedMotion={false} />
      <ChainFx events={events} chain={[]} duelKey="x" reducedMotion={false} mySeat={0} playerName={() => "P"} />
    </div>
  );
}

type Reps = { whole: number; ghost: number; shards: number; sleeve: boolean };
const SAMPLE_MS = 25;
const RUN_MS = 9000;

/** What stands for one card on the overlay at this moment, counted the way a viewer sees it. */
function repsOf(root: HTMLElement, code: number): Reps {
  const shows = (el: Element) => tl.opacityAt(el, root) > 0.3;
  const holds = (el: Element) => el.querySelector(`img[src*="/cards/${code}/"]`) != null ||
    [...el.querySelectorAll<HTMLElement>("i")].some((i) => i.style.backgroundImage.includes(`/cards/${code}/`));
  const whole = [...root.querySelectorAll("[class*=destroyWhole]")].filter((el) => holds(el) && shows(el));
  const ghosts = [...root.querySelectorAll("[data-style]")].filter((el) => holds(el) && shows(el));
  const shards = [...root.querySelectorAll("[class*=shard]:not([class*=shardArt])")].filter((el) => shows(el) &&
    el.closest("[class*=anchor]")?.querySelector("i")?.getAttribute("style")?.includes(`/cards/${code}/`));
  // A ghost that breaks into pieces hides its flipper (the pieces carry the face).
  const sleeve = ghosts.some((el) => {
    const flipper = el.querySelector<HTMLElement>("[class*=flipper]");
    return flipper != null && flipper.style.display !== "none" && flipper.style.transform.includes("rotateY(180deg)");
  }) ||
    whole.some((el) => el.getAttribute("data-face") === "down");
  return { whole: whole.length, ghost: ghosts.length, shards: shards.length > 0 ? 1 : 0, sleeve };
}
const total = (r: Reps) => r.whole + r.ghost + r.shards;

type Run = { samples: Reps[][]; planOf: (id: number) => ReturnType<typeof getMovePlan> };

async function play(events: DuelEvent[], victims: Victim[]): Promise<Run> {
  const view = render(<Board events={[]} victims={victims} committed={false} />);
  view.rerender(<Board events={withDestroyCards(events) as DuelEvent[]} victims={victims} committed />);
  const samples: Reps[][] = [];
  for (let t = 0; t <= RUN_MS; t += SAMPLE_MS) {
    if (t) await act(async () => { vi.advanceTimersByTime(SAMPLE_MS); });
    samples.push(victims.map((v) => repsOf(view.container, v.card.code)));
  }
  return { samples, planOf: getMovePlan };
}

/** The card is on screen from the first frame to its landing: never empty, never twice. */
function expectOneCardUntilLanding(run: Run, victim: number, moveId: number): { firstFlight: number; lastSeen: number } {
  const series = run.samples.map((s) => s[victim]);
  const plan = run.planOf(moveId);
  expect(plan, "the move is planned").not.toBeNull();
  const lastSeen = series.map(total).lastIndexOf(1) * SAMPLE_MS;
  const landAt = plan!.landAt - 1000;
  expect(lastSeen, "the card stays until it lands").toBeGreaterThanOrEqual(landAt - SAMPLE_MS * 2);
  series.forEach((reps, i) => {
    expect(total(reps), `+${i * SAMPLE_MS} ms: shown ${JSON.stringify(reps)}`).toBeLessThanOrEqual(1);
    if (i * SAMPLE_MS <= landAt - SAMPLE_MS * 2) expect(total(reps), `+${i * SAMPLE_MS} ms: the card is missing`).toBe(1);
  });
  return { firstFlight: Math.max(0, plan!.startAt - 1000), lastSeen };
}

const ev = (e: Partial<DuelEvent> & Pick<DuelEvent, "id" | "kind">): DuelEvent => ({ text: e.kind, ...e }) as DuelEvent;
const source = (id: number, card: DuelCardInfo, at: DuelZoneRef): DuelEvent[] => [
  ev({ id, kind: "move", card, from: zone(0, HAND, 0), zone: at, reason: "activate" }),
  ev({ id: id + 1, kind: "activate", card, zone: at, chainIndex: 1 }),
  ev({ id: id + 2, kind: "chain-resolving", chainIndex: 1 }),
];
const sourceSent = (id: number, card: DuelCardInfo, at: DuelZoneRef): DuelEvent =>
  ev({ id, kind: "move", card, from: at, zone: zone(0, GRAVE, 0), reason: "send" });
const destroyOf = (id: number, card: DuelCardInfo | undefined, at: DuelZoneRef, extra: Partial<DuelEvent> = {}): DuelEvent =>
  ev({ id, kind: "destroy", card, zone: at, cause: "effect", sourceCode: C.mst.code, sourceKind: "spell", sourceSeat: 0, ...extra });

describe("an effect that hits a card keeps it on screen from its zone to its destination", () => {
  it("Mystical Space Typhoon on a face-down Set trap: it stays Set, cracks in place, then goes to the Graveyard", async () => {
    const at = zone(1, SZONE, 2);
    const victim: Victim = { card: C.mirrorForce, at, up: false };
    const events = [
      ...source(1, C.mst, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.mirrorForce, from: at, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(6, undefined, at),
      sourceSent(7, C.mst, zone(0, SZONE, 1)),
      ev({ id: 8, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].sleeve, "a Set card first shows its sleeve").toBe(true);
    expect(run.samples.some((s) => s[0].whole === 1), "the crack stand-in shows").toBe(true);
    expect(run.samples.some((s) => s[0].sleeve === false && total(s[0]) === 1), "the face shows when it is hit").toBe(true);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("a flip effect that destroys a face-down Defense Position monster", async () => {
    const at = zone(1, MZONE, 1);
    const victim: Victim = { card: C.sangan, at, up: false, defense: true };
    const events = [
      ev({ id: 1, kind: "position", card: C.manEater, zone: zone(0, MZONE, 1), fromPosition: 0x8, toPosition: 0x1 }),
      ev({ id: 2, kind: "activate", card: C.manEater, zone: zone(0, MZONE, 1), chainIndex: 1 }),
      ev({ id: 3, kind: "chain-resolving", chainIndex: 1 }),
      ev({ id: 4, kind: "move", card: C.sangan, from: at, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(6, undefined, at, { sourceCode: C.manEater.code, sourceKind: "monster", fromPosition: 0x8 }),
      ev({ id: 7, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].sleeve).toBe(true);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("a face-up Defense Position monster destroyed by an effect", async () => {
    const at = zone(1, MZONE, 2);
    const victim: Victim = { card: C.giantSoldier, at, up: true, defense: true };
    const events = [
      ...source(1, C.lightningVortex, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.giantSoldier, from: at, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(6, C.giantSoldier, at, { fromPosition: 0x4, sourceCode: C.lightningVortex.code }),
      sourceSent(7, C.lightningVortex, zone(0, SZONE, 1)),
      ev({ id: 8, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].sleeve).toBe(false);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("Phoenix Wing Wind Blast: the card lifts from its zone and goes to the top of the Deck", async () => {
    const at = zone(1, MZONE, 1);
    const victim: Victim = { card: C.darkMagician, at, up: true };
    const events = [
      ...source(1, PHOENIX, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.darkMagician, from: at, zone: zone(1, DECK, 0), reason: "return" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      sourceSent(6, PHOENIX, zone(0, SZONE, 1)),
      ev({ id: 7, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].ghost, "the card stands where it was at once").toBe(1);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("a bounce to the hand", async () => {
    const at = zone(1, MZONE, 1);
    const victim: Victim = { card: C.celtic, at, up: true };
    const events = [
      ...source(1, C.mst, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.celtic, from: at, zone: zone(1, HAND, 0), reason: "return", addedToHand: true, handId: "h1" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      sourceSent(6, C.mst, zone(0, SZONE, 1)),
      ev({ id: 7, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].ghost).toBe(1);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("a banish", async () => {
    const at = zone(1, MZONE, 1);
    const victim: Victim = { card: C.redEyes, at, up: true };
    const events = [
      ...source(1, C.mst, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.redEyes, from: at, zone: zone(1, REMOVED, 0), reason: "banish" }),
      ev({ id: 5, kind: "chain-resolved", chainIndex: 1 }),
      sourceSent(6, C.mst, zone(0, SZONE, 1)),
      ev({ id: 7, kind: "chain-end" }),
    ];
    const run = await play(events, [victim]);
    expect(run.samples[0][0].ghost).toBe(1);
    expectOneCardUntilLanding(run, 0, 4);
  });

  it("a batch with two targets: each card stays until its own break and flight", async () => {
    const a = zone(1, SZONE, 1);
    const b = zone(1, SZONE, 2);
    const victims: Victim[] = [{ card: C.mirrorForce, at: a, up: false }, { card: C.solemn, at: b, up: false }];
    const events = [
      ...source(1, C.featherDuster, zone(0, SZONE, 1)),
      ev({ id: 4, kind: "move", card: C.mirrorForce, from: a, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 5, kind: "move", card: C.solemn, from: b, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      ev({ id: 6, kind: "chain-resolved", chainIndex: 1 }),
      destroyOf(7, undefined, a, { sourceCode: C.featherDuster.code }),
      destroyOf(8, undefined, b, { sourceCode: C.featherDuster.code }),
      sourceSent(9, C.featherDuster, zone(0, SZONE, 1)),
      ev({ id: 10, kind: "chain-end" }),
    ];
    const run = await play(events, victims);
    expectOneCardUntilLanding(run, 0, 4);
    expectOneCardUntilLanding(run, 1, 5);
  });

  it("a Spell sent to the Graveyard by a rule (an Equip Spell, a replaced Field Spell, a Xyz or Link material) is not empty before it leaves", async () => {
    const at = zone(1, SZONE, 1);
    const victim: Victim = { card: C.solemn, at, up: true };
    const events = [
      ev({ id: 1, kind: "move", card: C.solemn, from: at, zone: zone(1, GRAVE, 0), reason: "other" }),
    ];
    const run = await play(events, [victim]);
    expectOneCardUntilLanding(run, 0, 1);
  });

  it("a Tribute: the Tributed monster stays on its zone until it burns", async () => {
    const at = zone(0, MZONE, 1);
    const victim: Victim = { card: C.redEyes, at, up: true };
    const events = [
      ev({ id: 1, kind: "move", card: C.redEyes, from: at, zone: zone(0, GRAVE, 0), reason: "send" }),
      ev({ id: 2, kind: "move", card: C.darkMagician, from: zone(0, HAND, 0), zone: zone(0, MZONE, 2), reason: "summon" }),
      ev({ id: 3, kind: "summon", card: C.darkMagician, zone: zone(0, MZONE, 2), summonKind: "tribute" }),
    ];
    const run = await play(events, [victim]);
    expectOneCardUntilLanding(run, 0, 1);
  });

  it("a battle destroy: the monster stays face-up on its zone through the strike, then goes to the Graveyard", async () => {
    const at = zone(1, MZONE, 1);
    const victim: Victim = { card: C.giantSoldier, at, up: true };
    const events = [
      ev({ id: 1, kind: "phase", text: "battle" }),
      ev({ id: 2, kind: "attack", seat: 0, zone: zone(0, MZONE, 1), target: at }),
      ev({ id: 3, kind: "damage", seat: 1, amount: 300, cause: "battle" }),
      ev({ id: 4, kind: "move", card: C.giantSoldier, from: at, zone: zone(1, GRAVE, 0), reason: "destroy" }),
      destroyOf(5, C.giantSoldier, at, { cause: "battle" }),
    ];
    const run = await play(events, [victim]);
    expectOneCardUntilLanding(run, 0, 4);
  });
});
