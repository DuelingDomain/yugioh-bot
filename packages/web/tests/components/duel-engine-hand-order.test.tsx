// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelEvent, DuelPrompt } from "@yugidraft/shared/duels";
import { DuelField, type DuelActivateHandler } from "@/components/duel/field";
import { findMoveDestination, moveDestinationRect } from "@/components/duel/event-queue";
import { MoveFx, flipHands, HAND_FLIP_MS, type HandState } from "@/components/duel/move-fx";
import { captureZoneSnapshots, getMovePlan, resetMoveSchedule } from "@/components/duel/move-plan";
import { activatePromptFromField, optionsForCard, type PromptDraft } from "@/components/duel/prompts";
import { applyEdits, cardAt, hiddenAt, HAND, newBoard } from "@/components/duel/fx-lab/board";
import { CARDS } from "@/components/duel/fx-lab/cards";
import { findScenario } from "@/components/duel/fx-lab/scenarios";
import { showcasePhases } from "@/components/duel/add-to-hand";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

type AnimationRecord = { el: Element; frames: Keyframe[]; options: KeyframeAnimationOptions; animation: Animation; start: number; active: boolean };
let animations: AnimationRecord[];
const hand = (ids: string[], seat = 0, revealed = true): DuelCard[] => ids.map((id, sequence) => ({
  ...(revealed ? cardAt(CARDS.cyberDragon, HAND(seat, sequence)) : hiddenAt(HAND(seat, sequence))), handId: id,
}));
const engine = (cards: DuelCard[], opponent: DuelCard[] = [], events: DuelEvent[] = [], revision = 1): DuelEngineView => {
  const board = newBoard();
  board.seats[0].hand = cards; board.seats[1].hand = opponent;
  return { ...board, revision, turn: 1, battleStep: null, prompt: null, chain: [], events, log: [], result: null };
};
function Board({ view, fx = false, reduced = false, mySeat = 0, activate = vi.fn() }: {
  view: DuelEngineView; fx?: boolean; reduced?: boolean; mySeat?: number | null; activate?: DuelActivateHandler;
}) {
  return <div data-testid="board">
    <DuelField engine={view} mySeat={mySeat} masterRule={5} reducedMotion={reduced}
      legalKeys={new Set()} selectedKeys={new Set()} onActivate={activate} onInspect={() => {}} bottomName="You" topName="Opp" />
    {fx ? <MoveFx events={view.events} duelKey="engine-order" reducedMotion={reduced} /> : null}
  </div>;
}
const arrival = (from: number, seat = 0, known = true): DuelEvent => ({
  id: 10, kind: "move", text: "A card moved", seat, handId: "new",
  from: { controller: seat, location: from, sequence: 0 }, zone: HAND(seat, 1),
  card: known ? CARDS.cyberDragon : undefined, addedToHand: from === 1 ? undefined : true, reason: from === 1 ? "draw" : "return",
});
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

function offset(el: Element): { x: number; y: number } {
  const record = animations.findLast((r) => r.el === el && r.active && r.frames[0]?.translate != null);
  if (!record) return { x: 0, y: 0 };
  const [x, y] = String(record.frames[0].translate).split(" ").map(Number.parseFloat);
  const left = 1 - Math.min(1, (performance.now() - record.start) / Number(record.options.duration));
  return { x: x * left, y: (y || 0) * left };
}

beforeEach(() => {
  vi.useFakeTimers(); animations = []; resetMoveSchedule("engine-order");
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: function(this: Element, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const record = { el: this, frames, options, start: performance.now(), active: true } as AnimationRecord;
    const timer = window.setTimeout(() => { record.active = false; resolve(); }, Number(options.duration));
    record.animation = { id: options.id ?? "", finished,
      cancel: () => { record.active = false; window.clearTimeout(timer); resolve(); },
      effect: { getComputedTiming: () => ({ progress: Math.min(1, (performance.now() - record.start) / Number(options.duration)) }) },
    } as unknown as Animation;
    animations.push(record); return record.animation;
  } });
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, writable: true, value: function(this: Element) {
    return animations.filter((r) => r.el === this && r.active).map((r) => r.animation);
  } });
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((el) => {
    const style = computed(el); const at = offset(el);
    Object.defineProperty(style, "translate", { configurable: true, value: `${at.x}px ${at.y}px` });
    return style;
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    const wrapper = this.closest<HTMLElement>("[data-hand-card]");
    const group = wrapper?.parentElement;
    const index = wrapper && group ? Array.from(group.children).indexOf(wrapper) : 0;
    const at = wrapper ? offset(wrapper) : { x: 0, y: 0 };
    const box = wrapper && group ? { left: 610 - group.children.length * 45 + index * 90 + at.x, top: group.dataset.side === "opp" ? 50 + at.y : 700 + at.y, width: 70, height: 100 }
      : this.hasAttribute("data-hand-seat") ? { left: 200, top: this.dataset.side === "opp" ? 50 : 700, width: 800, height: 100 }
      : this.getAttribute("aria-hidden") === "true" && this.tagName === "DIV" ? { left: 0, top: 0, width: 1200, height: 800 }
      : this.hasAttribute("data-zones") ? { left: 900, top: 500, width: 70, height: 100 }
      : { left: 0, top: 0, width: 0, height: 0 };
    return { ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON: () => box } as DOMRect;
  });
});
afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
});

describe("engine hand order on the board", () => {
  it("shows middle insertion and engine re-sequencing in the lab, keeping the card's DOM identity", () => {
    const script = findScenario("move-hand-order")!.build();
    const after = applyEdits(script.initial, script.steps[0]!.edits!);
    const next = applyEdits(after, script.steps[1]!.edits!);
    const view = render(<Board view={engine(after.seats[0].hand, after.seats[1].hand)} />);
    const node = view.container.querySelector('[data-hand-id="lab-added"]')!;
    expect(node).toBe(view.container.querySelector('[data-hand-seat="0"]')!.children[2]);
    view.rerender(<Board view={engine(next.seats[0].hand, next.seats[1].hand)} />);
    expect(view.container.querySelector('[data-hand-id="lab-added"]')).toBe(node);
    expect(node).toBe(view.container.querySelector('[data-hand-seat="0"]')!.children[1]);
    for (const seat of next.seats) expect(seat.hand.map((c) => c.sequence)).toEqual(seat.hand.map((_, i) => i));
    expect(findMoveDestination({ ...script.steps[0].events![0], id: 1 })).toBe(node.querySelector("[data-zones]"));
  });

  it.each([0, 1, null])("mirrors the far hand's engine sequence for viewer %s", (mySeat) => {
    const view = render(<Board mySeat={mySeat} view={engine(hand(["a", "b", "c"]), hand(["x", "new", "z"], 1, false))} />);
    const farSeat = mySeat === 1 ? 0 : 1;
    const far = view.container.querySelector(`[data-hand-seat="${farSeat}"]`)!;
    expect(Array.from(far.querySelectorAll<HTMLElement>("[data-zones]")).map((el) => el.dataset.zones)).toEqual([`${farSeat}:2:2`, `${farSeat}:2:1`, `${farSeat}:2:0`]);
    const dest = findMoveDestination(arrival(16, 1, false))!;
    expect(dest.dataset.zones).toBe("1:2:1"); expect(dest.querySelector("img")).toBeNull();
    expect(findMoveDestination({ ...arrival(16), handId: "departed" })).toBeNull();
  });

  it("slides continuously through insertion, an in-progress re-sequence, departure, then an unchanged next view", async () => {
    const states = new Map<string, HandState>();
    const view = render(<Board view={engine(hand(["a", "b", "c"]))} />);
    flipHands(view.container, states, false);
    const positions = () => new Map(Array.from(view.container.querySelectorAll<HTMLElement>('[data-hand-seat="0"] > *')).map((el) => [el.dataset.handId, el.getBoundingClientRect().left]));
    const before = positions();
    view.rerender(<Board view={engine(hand(["a", "new", "b", "c"]))} />);
    flipHands(view.container, states, false);
    for (const [id, left] of before) expect(positions().get(id)).toBe(left);
    await advance(120);
    const moving = positions();
    view.rerender(<Board view={engine(hand(["c", "new", "a", "b"]))} />);
    flipHands(view.container, states, false);
    for (const id of ["a", "b", "c"]) expect(positions().get(id)).toBe(moving.get(id));
    await advance(HAND_FLIP_MS);
    const atRest = positions();
    view.rerender(<Board view={engine(hand(["c", "a", "b"]))} />);
    flipHands(view.container, states, false);
    for (const id of ["a", "b", "c"]) expect(positions().get(id)).toBe(atRest.get(id));
    await advance(HAND_FLIP_MS);
    const settled = positions(); const count = animations.length;
    view.rerender(<Board view={engine(hand(["c", "a", "b"]), [], [], 2)} />);
    flipHands(view.container, states, false);
    expect(positions()).toEqual(settled); expect(animations).toHaveLength(count);
  });

  it("measures the resting engine slot while a neighbour slide is running", () => {
    const states = new Map<string, HandState>();
    const view = render(<Board view={engine(hand(["a", "b"]))} />);
    flipHands(view.container, states, false);
    view.rerender(<Board view={engine(hand(["new", "a", "b"]))} />);
    flipHands(view.container, states, false);
    const dest = findMoveDestination({ ...arrival(1), handId: "b" })!;
    expect(dest.getBoundingClientRect().left).toBe(610);
    expect(moveDestinationRect(dest).left).toBe(655);
  });

  it.each([1, 16, 32, 64, 4])("flies from location %s directly to the middle engine slot and hands off without moving", async (source) => {
    const event = arrival(source);
    const view = render(<Board fx view={engine(hand(["a", "b"]))} />);
    captureZoneSnapshots(view.container);
    view.rerender(<Board fx view={engine(hand(["a", "new", "b"]), [], [event])} />);
    const dest = findMoveDestination(event)!;
    expect(dest.dataset.zones).toBe("0:2:1"); expect(dest.style.visibility).toBe("hidden");
    const ghost = view.container.querySelector<HTMLElement>(source === 1 ? '[data-style="draw"]' : '[data-testid="added-ghost"]')!;
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2).toBe(600);
    const target = moveDestinationRect(dest);
    await advance(source === 1 ? 800 : 2200);
    expect(dest.style.visibility).toBe(""); expect(moveDestinationRect(dest)).toEqual(target);
    const old = dest.closest<HTMLElement>("[data-hand-card]")!;
    expect(old.dataset.handArrived).toBeUndefined();
    view.rerender(<Board fx view={engine(hand(["new", "b", "a"]), [], [event], 2)} />);
    expect(findMoveDestination(event)?.closest("[data-hand-card]")).toBe(old);
    expect(old.dataset.handArrived).toBeUndefined();
    await advance(1500); expect(old.dataset.handArrived).toBeUndefined();
  });

  it.each([0, 1, null].flatMap((mySeat) => [false, true].map((revealed) => ({ mySeat, revealed }))))("aims the far hand's off-centre arrival at the mirrored engine slot for viewer $mySeat (revealed=$revealed)", async ({ mySeat, revealed }) => {
    const seat = mySeat === 1 ? 0 : 1;
    const event = { ...arrival(16, seat, revealed), zone: HAND(seat, 0) };
    const hands = (ids: string[], events: DuelEvent[] = []) => engine(seat === 0 ? hand(ids, 0, revealed) : [], seat === 1 ? hand(ids, 1, revealed) : [], events);
    const view = render(<Board fx mySeat={mySeat} view={hands(["a", "b"])} />);
    view.rerender(<Board fx mySeat={mySeat} view={hands(["new", "a", "b"], [event])} />);
    const ghost = view.getByTestId("added-ghost"); expect(ghost.dataset.known).toBe(String(revealed));
    if (!revealed) expect(ghost.querySelector("img")).toBeNull();
    const target = findMoveDestination(event)!;
    expect(target.dataset.side).toBe("opp"); expect(moveDestinationRect(target).left).toBe(655);
    expect(target.closest("[data-hand-card]")).toBe(view.container.querySelector(`[data-hand-seat="${seat}"]`)!.lastElementChild);
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2).toBe(690);
    await advance(showcasePhases(1, false).totalMs + 20);
    expect(target.style.visibility).toBe(""); expect(moveDestinationRect(target).left).toBe(655);
    expect(view.getByTestId("added-ring").style.left).toBe("655px");
  });

  it.each([false, true])("deals all ten opening cards without an arrival glow (reduced=%s)", async (reduced) => {
    const events = [0, 1].flatMap((seat) => Array.from({ length: 5 }, (_, sequence) => ({
      ...arrival(1, seat, seat === 0), id: seat * 5 + sequence + 1, handId: `${seat}-${sequence}`, zone: HAND(seat, sequence),
    })));
    const view = render(<Board fx reduced={reduced} view={engine([])} />);
    view.rerender(<Board fx reduced={reduced} view={engine(hand(["0-0", "0-1", "0-2", "0-3", "0-4"]), hand(["1-0", "1-1", "1-2", "1-3", "1-4"], 1, false), events)} />);
    for (let elapsed = 0; elapsed < 6000; elapsed += 200) {
      await advance(200);
      expect(view.container.querySelectorAll("[data-hand-arrived]")).toHaveLength(0);
    }
    expect(view.container.querySelectorAll("[data-hand-card]")).toHaveLength(10);
    expect(view.container.querySelectorAll("[data-hand-arrived]")).toHaveLength(0);
    expect(animations.some((record) => (record.el as HTMLElement).dataset.testid === "added-ring")).toBe(false);
    expect(view.container.querySelector('[style*="visibility: hidden"]')).toBeNull();
  });

  it.each([0, 1])("shows a departed add at the engine message's missing end slot for seat %s", async (seat) => {
    const event = { ...arrival(16, seat, seat === 0), handId: "departed-10", zone: HAND(seat, 2) };
    const final = (events: DuelEvent[] = []) => engine(seat === 0 ? hand(["a", "b"]) : [], seat === 1 ? hand(["a", "b"], 1, false) : [], events);
    const view = render(<Board fx view={final()} />);
    view.rerender(<Board fx view={final([event])} />);
    const ghost = view.getByTestId("added-ghost");
    const centre = Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2;
    expect(centre).toBe(seat === 0 ? 735 : 465);
    expect(findMoveDestination(event)).toBeNull();
    expect(view.container.querySelector('[style*="visibility: hidden"]')).toBeNull();
    await advance(showcasePhases(1, false).totalMs);
    expect(animations.some((record) => record.el === ghost && record.options.duration === showcasePhases(1, false).flyMs)).toBe(true);
    expect(animations.some((record) => (record.el as HTMLElement).dataset.testid === "added-ring")).toBe(false);
  });

  it.each([false, true])("still presents a departed add when the final hand is empty (reduced=%s)", async (reduced) => {
    const event = { ...arrival(16), handId: "departed-10", zone: HAND(0, 0) };
    const view = render(<Board fx reduced={reduced} view={engine([])} />);
    view.rerender(<Board fx reduced={reduced} view={engine([], [], [event])} />);
    expect(view.getByTestId("added-label").textContent).toContain("Added to hand");
    const ghost = view.getByTestId("added-ghost");
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2).toBe(600);
    await advance(showcasePhases(1, reduced).totalMs);
    expect(animations.some((record) => record.el === ghost && record.options.duration === showcasePhases(1, reduced).flyMs)).toBe(true);
  });

  it("keeps a drawn ghost on the real card during its handoff fade after a new engine sequence", async () => {
    const event = arrival(1);
    const view = render(<Board fx view={engine(hand(["a", "b"]))} />);
    captureZoneSnapshots(view.container);
    view.rerender(<Board fx view={engine(hand(["a", "new", "b"]), [], [event])} />);
    await advance(getMovePlan(event.id)!.landAt - performance.now() + 20);
    view.rerender(<Board fx view={engine(hand(["new", "b", "a"]), [], [event], 2)} />);
    await advance(32);
    const ghost = view.container.querySelector<HTMLElement>('[data-style="draw"]')!;
    expect(ghost).not.toBeNull();
    const visible = findMoveDestination(event)!.getBoundingClientRect();
    const centre = Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2;
    expect(Math.abs(centre - (visible.left + visible.width / 2))).toBeLessThan(3);
  });

  it.each(["select", "activate", "set", "summon", "discard"])("sends the engine option for %s after re-sequencing duplicate hand cards", (action) => {
    const cards = hand(["c", "new", "a", "b"]); const pick = action === "select" || action === "discard";
    const prompt: DuelPrompt = { id: "p", seat: 0, kind: pick ? "cards" : "choice", title: action, min: 1, max: 1,
      options: [...cards].reverse().map((c, index) => ({ id: `${action}:${index}`, label: action, controller: 0, location: 2, sequence: c.sequence, card: CARDS.cyberDragon })),
    };
    const submit = vi.fn(); const draft = { selected: [], setSelected: vi.fn() } as unknown as PromptDraft;
    const activate = vi.fn((keys, c) => {
      if (!activatePromptFromField(prompt, true, keys, c, draft, submit)) submit({ choice: optionsForCard(prompt, c, keys)[0].id });
    });
    const view = render(<Board view={engine(cards)} activate={activate} />);
    fireEvent.click(view.container.querySelector('[data-hand-seat="0"]')!.children[1].querySelector("button")!);
    expect(activate.mock.calls[0][0]).toEqual(["0:2:1"]);
    expect(submit).toHaveBeenCalledWith(pick ? { selected: [`${action}:2`] } : { choice: `${action}:2` });
  });

  it("shows revision-0 recovery in engine order under reduced motion", async () => {
    const view = render(<Board reduced fx view={engine(hand(["c", "a", "b"]), [], [], 0)} />);
    view.rerender(<Board reduced fx view={engine(hand(["c", "new", "a", "b"]), [], [arrival(1)], 0)} />);
    await advance(500);
    expect(Array.from(view.container.querySelectorAll<HTMLElement>('[data-hand-seat="0"] [data-zones]')).map((el) => el.dataset.zones)).toEqual(["0:2:0", "0:2:1", "0:2:2", "0:2:3"]);
    expect(animations.some((a) => a.options.id === "duel-hand-flip")).toBe(false);
  });
});
