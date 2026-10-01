import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import {
  chainBeatAt,
  chainBeatsEndAt,
  chainEffectAt,
  planChainBeats,
  resetChainBeats,
} from "../../src/components/duel/chain-beats";
import { chainEffectLead, chainStepDelay } from "../../src/components/duel/chain-state";

let nextId = 1;
const ev = (kind: DuelEvent["kind"], chainIndex?: number): DuelEvent => ({
  id: nextId++, kind, text: kind, ...(chainIndex != null ? { chainIndex } : {}),
});

const NOW = 1000;
const plan = (fresh: DuelEvent[], reduced = false, now = NOW) => planChainBeats(fresh, { now, reduced, duelKey: "t" });

beforeEach(() => {
  nextId = 1;
  resetChainBeats("t");
});

describe("chain step lengths (the hold the board keeps per beat)", () => {
  it("gives the resolving beat 900-1300 ms of visible emphasis", () => {
    const ms = chainStepDelay("chain-resolving", 1, false);
    expect(ms).toBeGreaterThanOrEqual(900);
    expect(ms).toBeLessThanOrEqual(1300);
  });

  it("gives a negated link time to show its slash before it clears", () => {
    expect(chainStepDelay("chain-negated", 1, false)).toBeGreaterThanOrEqual(600);
  });

  it("keeps a clear-away beat long enough to see the badge go", () => {
    expect(chainStepDelay("chain-resolved", 1, false)).toBeGreaterThanOrEqual(450);
  });

  it("keeps a short hold under reduced motion, so the order still reads", () => {
    expect(chainStepDelay("chain-resolving", 1, true)).toBeGreaterThanOrEqual(450);
    expect(chainStepDelay("chain-resolved", 1, true)).toBeGreaterThanOrEqual(300);
  });

  it("starts the effect of a link after the badge has pulsed, sooner under reduced motion", () => {
    expect(chainEffectLead(false)).toBeGreaterThanOrEqual(250);
    expect(chainEffectLead(false)).toBeLessThan(chainStepDelay("chain-resolving", 1, false));
    expect(chainEffectLead(true)).toBeLessThan(chainEffectLead(false));
  });
});

describe("planChainBeats", () => {
  it("lays the beats of a resolution one after another, top link first", () => {
    const events = [ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("chain-end")];
    plan(events);
    const at = events.map((e) => chainBeatAt(e.id));
    expect(at[0]).toBe(NOW);
    for (let i = 1; i < at.length; i += 1) {
      expect(at[i] - at[i - 1]).toBe(chainStepDelay(events[i - 1].kind, events.length - i, false));
    }
    expect(chainBeatsEndAt()).toBe(at[4] + chainStepDelay("chain-end", 0, false));
  });

  it("starts a new batch after the beats that are still queued", () => {
    const first = [ev("chain-resolving", 2)];
    plan(first);
    const second = [ev("chain-resolved", 2)];
    plan(second, false, NOW + 100);
    expect(chainBeatAt(second[0].id)).toBe(NOW + chainStepDelay("chain-resolving", 0, false));
  });

  it("is idempotent: planning the same batch again changes nothing", () => {
    const events = [ev("chain-resolving", 1), ev("chain-resolved", 1)];
    plan(events);
    const before = events.map((e) => chainBeatAt(e.id));
    plan(events, false, NOW + 5000);
    expect(events.map((e) => chainBeatAt(e.id))).toEqual(before);
  });

  it("holds the effects of a link until its badge has pulsed", () => {
    const events = [
      ev("chain-resolving", 2), ev("move"), ev("chain-resolved", 2),
      ev("chain-resolving", 1), ev("destroy"), ev("chain-resolved", 1),
    ];
    plan(events);
    expect(chainEffectAt(events[1].id)).toBe(chainBeatAt(events[0].id) + chainEffectLead(false));
    expect(chainEffectAt(events[4].id)).toBe(chainBeatAt(events[3].id) + chainEffectLead(false));
    expect(chainEffectAt(events[4].id)).toBeGreaterThan(chainEffectAt(events[1].id));
  });

  it("lets an effect play at once when it is not inside a resolving link", () => {
    const events = [ev("move"), ev("chain-resolving", 1), ev("chain-resolved", 1), ev("summon")];
    plan(events);
    expect(chainEffectAt(events[0].id)).toBe(0);
    expect(chainEffectAt(events[3].id)).toBe(0);
  });

  it("keeps the window of a link open into the next batch", () => {
    const first = [ev("chain-resolving", 1)];
    plan(first);
    const late = [ev("destroy")];
    plan(late, false, NOW + 40);
    expect(chainEffectAt(late[0].id)).toBe(NOW + chainEffectLead(false));
  });

  it("does not hold an effect whose moment has already passed", () => {
    const first = [ev("chain-resolving", 1)];
    plan(first);
    const late = [ev("move")];
    plan(late, false, NOW + 2000);
    expect(chainEffectAt(late[0].id)).toBe(0);
  });

  it("holds ordinary activations and negations on the board beat too", () => {
    const events = [ev("activate", 1), ev("chain-resolving", 1), ev("chain-negated", 1), ev("chain-resolved", 1)];
    plan(events);
    expect(chainBeatAt(events[2].id)).toBeGreaterThan(chainBeatAt(events[1].id));
    expect(chainBeatAt(events[3].id) - chainBeatAt(events[2].id)).toBe(chainStepDelay("chain-negated", 1, false));
  });

  it("shortens every beat under reduced motion but keeps their order", () => {
    const events = [ev("chain-resolving", 2), ev("chain-resolved", 2), ev("chain-resolving", 1)];
    plan(events, true);
    const at = events.map((e) => chainBeatAt(e.id));
    expect(at[1] - at[0]).toBe(chainStepDelay("chain-resolving", 2, true));
    expect(at[2]).toBeGreaterThan(at[1]);
  });

  it("starts over when the room changes", () => {
    plan([ev("chain-resolving", 1)]);
    resetChainBeats("other");
    expect(chainBeatsEndAt()).toBe(0);
  });

  it("returns 0 for an event it never planned", () => {
    expect(chainBeatAt(9999)).toBe(0);
    expect(chainEffectAt(9999)).toBe(0);
  });
});
