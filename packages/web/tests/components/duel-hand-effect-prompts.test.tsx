// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { promptLegalKeys, optionsForCard } from "@/components/duel/prompts";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { cardAt, HAND, type TableFixtureSet, type TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import { TableShell } from "@/components/duel/table/table-shell";
import { TagShell } from "@/components/duel/tag/tag-shell";

const jet: DuelCardInfo = {
  code: 30576089, name: "Blue-Eyes Jet Dragon", description: "Special Summon this card from your hand or GY.",
  type: 33, attack: 3000, defense: 0, level: 8, attribute: 16, race: "Dragon",
};
const seats = [FFA3_FIXTURES, FFA4_FIXTURES, TAG_FIXTURES].flatMap((fixtures) =>
  fixtures.states.main.room.engine!.seats.map(({ seat }) => ({ fixtures, format: fixtures.format, seat })),
);

beforeAll(() => {
  class RO { constructor(private cb: () => void) {} observe() { this.cb(); } disconnect() {} unobserve() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1100 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 860 });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.removeItem("yugidraft.duelPreferences.v1"); });

function effectPrompt(seat: number): DuelPrompt {
  return {
    id: "hand-trigger", seat, kind: "choice", title: "Use the effect of Blue-Eyes Jet Dragon from your hand?",
    options: [{ id: "yes", label: "Yes", card: jet }, { id: "no", label: "No", card: jet }],
    source: { code: jet.code, name: jet.name, seat, text: jet.description, zone: HAND(seat, 0) }, min: 1, max: 1,
  };
}
function chainPrompt(seat: number): DuelPrompt {
  return {
    id: "hand-quick", seat, kind: "choice", title: "Select a chain link or pass", cancelable: true,
    context: { type: "chain", forced: false }, min: 0, max: 1,
    options: [{ id: "card:7", label: jet.name, card: jet, ...HAND(seat, 0) }],
  };
}
function stateFor(fixtures: TableFixtureSet, seat: number, prompt: DuelPrompt): TableFixtureState {
  const base = fixtures.states.main;
  return {
    ...base, room: {
      ...base.room, mySeat: seat, engine: {
        ...base.room.engine!, prompt, chain: [], events: [],
        seats: base.room.engine!.seats.map((player) => ({
          ...player, hand: [cardAt(jet, HAND(player.seat, 0)), cardAt(jet, HAND(player.seat, 1))],
        })),
      },
    },
  };
}
function Shell({ state, onAnswer, revealed = true }: { state: TableFixtureState; onAnswer: (answer: DuelAnswer) => void; revealed?: boolean }) {
  const base = useFixtureController(state, { reducedMotion: true });
  const controller = { ...base, revealed, onAnswer, onActivate: vi.fn(), onInspect: vi.fn() };
  return state.room.engine!.format === "tag"
    ? <TagShell controller={controller} teamNames={["Team 1", "Team 2"]} />
    : <TableShell controller={controller} />;
}
function handCard(container: HTMLElement, seat: number, sequence = 0): HTMLElement {
  return container.querySelector<HTMLElement>(`[data-hand-seat='${seat}'] [data-zones='${seat}:2:${sequence}']`)!;
}
function clickCard(card: HTMLElement) { fireEvent.click(card.querySelector("button") ?? card); }
function canUse(card: HTMLElement): boolean { return card.dataset.usable === "true" || card.dataset.legal === "true"; }

describe.each(seats)("$format seat $seat hand effects", ({ fixtures, seat }) => {
  it("glows for an effect yes/no and offers Activate for only its source card", async () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell state={stateFor(fixtures, seat, effectPrompt(seat))} onAnswer={onAnswer} />);
    expect(canUse(handCard(container, seat))).toBe(true);
    expect(canUse(handCard(container, seat, 1))).toBe(false);
    clickCard(handCard(container, seat));
    const activate = screen.getByRole("menuitem", { name: `Activate ${jet.name}` });
    expect(activate).toHaveTextContent("Activate");
    expect(screen.queryByRole("menuitem", { name: "No" })).toBeNull();
    await act(async () => { fireEvent.click(activate); });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ choice: "yes" });
  });

  it("keeps No on the effect panel as the exact engine decline answer", async () => {
    const onAnswer = vi.fn();
    render(<Shell state={stateFor(fixtures, seat, effectPrompt(seat))} onAnswer={onAnswer} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "No" })); });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ choice: "no" });
  });

  it("glows for a hand chain response and preserves its engine option index", async () => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell state={stateFor(fixtures, seat, chainPrompt(seat))} onAnswer={onAnswer} />);
    expect(canUse(handCard(container, seat))).toBe(true);
    expect(canUse(handCard(container, seat, 1))).toBe(false);
    clickCard(handCard(container, seat));
    await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: jet.name })); });
    expect(onAnswer).toHaveBeenCalledExactlyOnceWith({ choice: "card:7" });
  });

  it.each([effectPrompt, chainPrompt])("holds hand glow and activation until the panel is revealed (%#)", (makePrompt) => {
    const onAnswer = vi.fn();
    const { container } = render(<Shell state={stateFor(fixtures, seat, makePrompt(seat))} onAnswer={onAnswer} revealed={false} />);
    expect(canUse(handCard(container, seat))).toBe(false);
    clickCard(handCard(container, seat));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe("hand source activation bounds", () => {
  it("does not bind an effect resolution question that names a card but has no source zone", () => {
    const prompt = effectPrompt(0);
    delete prompt.source!.zone;
    expect([...promptLegalKeys(prompt)]).toEqual([]);
    expect(optionsForCard(prompt, cardAt(jet, HAND(0, 0)), ["0:2:0"])).toEqual([]);
  });

  it.each([16, 4])("does not bind a sourced yes/no outside the hand (location %s)", (location) => {
    const prompt = effectPrompt(0);
    prompt.source!.zone!.location = location;
    expect([...promptLegalKeys(prompt)]).toEqual([]);
    expect(optionsForCard(prompt, cardAt(jet, HAND(0, 0)), ["0:2:0"])).toEqual([]);
  });

  it("does not bind a card owned by another seat", () => {
    const prompt = effectPrompt(0);
    prompt.source!.seat = 1;
    prompt.source!.zone!.controller = 1;
    expect([...promptLegalKeys(prompt)]).toEqual([]);
    expect(optionsForCard(prompt, cardAt(jet, HAND(1, 0)), ["1:2:0"])).toEqual([]);
  });
});
