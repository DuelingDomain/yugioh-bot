// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { DuelChainLink, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";

const seen = vi.hoisted(() => ({ calls: [] as Array<{ name: string; props: Record<string, unknown> }> }));
vi.mock("@/components/duel/battle-fx", () => ({ BattleFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "BattleFx", props }), null) }));
vi.mock("@/components/duel/destroy-fx", () => ({ DestroyFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "DestroyFx", props }), null) }));
vi.mock("@/components/duel/feedback", () => ({ DuelFeedback: (props: Record<string, unknown>) => (seen.calls.push({ name: "DuelFeedback", props }), null) }));
vi.mock("@/components/duel/master-return-fx", () => ({ MasterReturnFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "MasterReturnFx", props }), null) }));
vi.mock("@/components/duel/move-fx", () => ({ MoveFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "MoveFx", props }), null) }));
vi.mock("@/components/duel/position-fx", () => ({ PositionFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "PositionFx", props }), null) }));
vi.mock("@/components/duel/chain-fx", () => ({ ChainFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "ChainFx", props }), null) }));
vi.mock("@/components/duel/summon-fx", () => ({ SummonFx: (props: Record<string, unknown>) => (seen.calls.push({ name: "SummonFx", props }), null) }));

import { TagFx, dedupeTeamDamage, tagPriority, type TagFxController } from "@/components/duel/tag/tag-fx";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { PriorityChips } from "@/components/duel/priority-chips";

vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined }));

const prefs = { soundEnabled: true, soundVolume: 0.7, shake: "medium" as const };
const main = TAG_FIXTURES.states.main.room;
const damage = (id: number, seat: number, amount = 800, cause = "effect"): DuelEvent => ({ id, kind: "damage", seat, amount, cause: cause as never, text: `d${id}` });

function controllerWith(events: DuelEvent[], over: Partial<DuelEngineView> = {}, reducedMotion = false): TagFxController {
  const engine = { ...main.engine!, events, ...over } as DuelEngineView;
  return { engine, room: { ...main, engine }, viewerSeat: 0, nameOf: (seat) => `P${seat}`, prompt: null, reducedMotion };
}
const chainOf = (...seats: number[]) => seats.map((seat, index) => ({ index: index + 1, seat }) as DuelChainLink);
// The effect gets the events again on each render, so read what its latest render got.
const damageSeen = (name: string) => {
  const latest = seen.calls.filter((call) => call.name === name).at(-1);
  return ((latest?.props.events as DuelEvent[] | undefined) ?? []).filter((event) => event.kind === "damage");
};

describe("TagFx", () => {
  it("renders no effects while fxActive is false", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([damage(1, 0)])} fxActive={false} preferences={prefs} />);
    expect(seen.calls).toEqual([]);
  });

  it("renders the whole effects set while fxActive is true", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([])} preferences={prefs} />);
    expect(new Set(seen.calls.map((call) => call.name))).toEqual(
      new Set(["DuelFeedback", "SummonFx", "MoveFx", "PositionFx", "ChainFx", "MasterReturnFx", "BattleFx", "DestroyFx"]),
    );
  });

  it("passes one damage event to the effects as one effect", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([damage(1, 1)])} preferences={prefs} />);
    expect(damageSeen("BattleFx")).toHaveLength(1);
    expect(damageSeen("DuelFeedback")).toHaveLength(1);
  });

  it("plays two equal hits on team mates twice: they are two real hits", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([damage(1, 1), damage(2, 3)])} preferences={prefs} />);
    expect(damageSeen("BattleFx").map((event) => event.id)).toEqual([1, 2]);
    expect(damageSeen("DestroyFx").map((event) => event.id)).toEqual([1, 2]);
  });

  it("gives the chain effect the Tag response order", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([], { chain: chainOf(0) })} preferences={prefs} />);
    const chain = seen.calls.find((call) => call.name === "ChainFx")!;
    expect((chain.props.priority as Array<{ seat: number }>).map((slot) => slot.seat)).toEqual([1, 3, 0, 2]);
  });

  it("marks the deciding seat for a viewer who holds no prompt (a spectator or a partner)", () => {
    seen.calls.length = 0;
    const controller = { ...controllerWith([], { chain: chainOf(0), prioritySeat: 3 }), viewerSeat: null };
    render(<TagFx controller={controller} preferences={prefs} passedSeats={[1]} />);
    const chain = seen.calls.find((call) => call.name === "ChainFx")!;
    expect(chain.props.priority).toEqual([
      { seat: 1, choosing: false },
      { seat: 3, choosing: true },
      { seat: 0, choosing: false },
      { seat: 2, choosing: false },
    ]);
  });

  it("marks no seat while the engine processes and the viewer holds no prompt", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([], { chain: chainOf(0), prioritySeat: null })} preferences={prefs} />);
    const chain = seen.calls.find((call) => call.name === "ChainFx")!;
    expect((chain.props.priority as Array<{ choosing: boolean }>).some((slot) => slot.choosing)).toBe(false);
  });

  it("passes the reduced motion flag on", () => {
    seen.calls.length = 0;
    render(<TagFx controller={controllerWith([], {}, true)} preferences={prefs} />);
    expect(seen.calls.every((call) => call.props.reducedMotion === true)).toBe(true);
  });
});

describe("dedupeTeamDamage", () => {
  it("keeps damage to rivals of different teams", () => {
    const events = [damage(1, 0), damage(2, 1)];
    expect(dedupeTeamDamage(events)).toBe(events);
  });
  it("keeps a team mate hit for the same amount and cause (two real hits)", () => {
    expect(dedupeTeamDamage([damage(1, 1), damage(2, 3)])).toHaveLength(2);
    expect(dedupeTeamDamage([damage(1, 1), damage(2, 3, 900)])).toHaveLength(2);
    expect(dedupeTeamDamage([damage(1, 1), damage(2, 3, 800, "battle")])).toHaveLength(2);
  });
  it("keeps the same seat hit twice in a row", () => {
    expect(dedupeTeamDamage([damage(1, 1), damage(2, 1)])).toHaveLength(2);
  });
  it("drops a repeated event id", () => {
    expect(dedupeTeamDamage([damage(1, 1), damage(1, 1)]).map((event) => event.id)).toEqual([1]);
  });
});

describe("Tag chain chips", () => {
  it("puts the opposing team first, then the link owner's team", () => {
    const engine = { ...main.engine!, chain: chainOf(0) } as DuelEngineView;
    expect(tagPriority(engine, [], 1)).toEqual([
      { seat: 1, choosing: true },
      { seat: 3, choosing: false },
      { seat: 0, choosing: false },
      { seat: 2, choosing: false },
    ]);
  });
  it("is not the seat number order", () => {
    const engine = { ...main.engine!, chain: chainOf(1) } as DuelEngineView;
    expect(tagPriority(engine, [], null)!.map((slot) => slot.seat)).toEqual([0, 2, 1, 3]);
  });
  it("moves to the link owner's team after both rivals passed", () => {
    const engine = { ...main.engine!, chain: chainOf(0) } as DuelEngineView;
    expect(tagPriority(engine, [1, 3], 0)!.map((slot) => slot.seat)).toEqual([0, 2, 1, 3]);
  });
  it("starts each team from the turn seat", () => {
    const engine = { ...main.engine!, turnSeat: 2, chain: chainOf(0) } as DuelEngineView;
    expect(tagPriority(engine, [], null)!.map((slot) => slot.seat)).toEqual([3, 1, 2, 0]);
  });
  it("is empty when both teams passed", () => {
    const engine = { ...main.engine!, chain: chainOf(0) } as DuelEngineView;
    expect(tagPriority(engine, [0, 1, 2, 3], null)).toBeNull();
  });
  it("is empty without a chain", () => {
    expect(tagPriority({ ...main.engine!, chain: [] } as DuelEngineView, [], null)).toBeNull();
  });
  it("renders in the shape the e2e specs read", () => {
    const engine = { ...main.engine!, chain: chainOf(0) } as DuelEngineView;
    const { container } = render(<div data-chain-fx><PriorityChips order={tagPriority(engine, [], 1)!} mySeat={0} nameOf={(s) => `P${s}`} compact /></div>);
    const chips = [...container.querySelectorAll("[data-chain-fx] [data-testid='priority-chips'] [data-seat]")];
    expect(chips.map((node) => node.getAttribute("data-seat"))).toEqual(["1", "3", "0", "2"]);
    expect(container.querySelector("[data-seat='1']")?.getAttribute("data-now")).toBe("true");
  });
});
