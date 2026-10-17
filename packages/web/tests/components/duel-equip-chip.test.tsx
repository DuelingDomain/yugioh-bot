// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelEvent, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { CardInspector } from "@/components/duel/inspector";
import { resolveEquipLinks } from "@/components/duel/equip-links";
import { LOCATION_MZONE, LOCATION_SZONE, POS_FACEDOWN_DEFENSE, POS_FACEUP_ATTACK, zoneKey } from "@/components/duel/constants";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const dragon: DuelCard = { controller: 0, location: LOCATION_MZONE, sequence: 1, position: POS_FACEUP_ATTACK, code: 11, name: "Blue-Eyes White Dragon" };
const neo: DuelCard = {
  controller: 0, location: LOCATION_SZONE, sequence: 2, position: POS_FACEUP_ATTACK, code: 12, name: "Neo Blue-Eyes Ultimate Dragon",
  equippedTo: { controller: 0, location: LOCATION_MZONE, sequence: 1 },
};
const axe: DuelCard = {
  controller: 0, location: LOCATION_SZONE, sequence: 0, position: POS_FACEUP_ATTACK, code: 13, name: "Axe of Despair",
  equippedTo: { controller: 0, location: LOCATION_MZONE, sequence: 1 },
};

const seat = (n: number, extra: Partial<DuelSeatView> = {}): DuelSeatView => ({
  seat: n, lp: 8000, hand: [], deckCount: 10, extraCount: 0, extra: [],
  monsters: [null, null, null, null, null], spells: [null, null, null, null, null], graveyard: [], banished: [],
  ...extra,
});

const engineOf = (seats: DuelSeatView[], events: DuelEvent[] = []): DuelEngineView => ({
  revision: 1, turn: 1, turnSeat: 0, phase: "main1", seats, prompt: null, chain: [], events, log: [], result: null,
});

const mine = (spells: Array<DuelCard | null>, monsters: Array<DuelCard | null> = [null, dragon, null, null, null]) =>
  seat(0, { monsters, spells: [...spells, ...Array.from({ length: 5 - spells.length }, () => null)] });

function board(engine: DuelEngineView, reducedMotion = false) {
  const ui = (e: DuelEngineView, rm = reducedMotion) => (
    <DuelField engine={e} mySeat={0} masterRule={5} reducedMotion={rm}
      legalKeys={new Set()} selectedKeys={new Set()}
      onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opp" />
  );
  const view = render(ui(engine));
  return { ...view, again: (e: DuelEngineView, rm?: boolean) => view.rerender(ui(e, rm)) };
}

const zone = (c: HTMLElement, controller: number, location: number, sequence: number) =>
  c.querySelector(`[data-zones~="${zoneKey(controller, location, sequence)}"]`) as HTMLElement;
const lines = (c: HTMLElement) => [...c.querySelectorAll("[data-equip-link]")];

describe("equip chips on the board", () => {
  it("marks the equip card 'Equipped' and the monster with its count, and says what it is linked to", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    const equip = zone(container, 0, LOCATION_SZONE, 2);
    const host = zone(container, 0, LOCATION_MZONE, 1);
    const equipChip = equip.querySelector("[data-equip-chip]") as HTMLElement;
    const hostChip = host.querySelector("[data-equip-chip]") as HTMLElement;
    expect(equipChip.getAttribute("data-equip-chip")).toBe("equip");
    expect(equipChip.textContent).toBe("Equipped");
    expect(equipChip.getAttribute("title")).toBe("Equipped to Blue-Eyes White Dragon");
    expect(hostChip.getAttribute("data-equip-chip")).toBe("host");
    expect(hostChip.textContent).toBe("1equip");
    expect(hostChip.getAttribute("title")).toBe("Equipped with Neo Blue-Eyes Ultimate Dragon");
    expect(equip.getAttribute("data-equip")).toBe("equip");
    expect(host.getAttribute("data-equip")).toBe("host");
  });

  it("counts several equips on one monster", () => {
    const { container } = board(engineOf([mine([axe, null, neo]), seat(1)]));
    const chip = zone(container, 0, LOCATION_MZONE, 1).querySelector("[data-equip-chip]") as HTMLElement;
    expect(chip.textContent).toBe("2equips");
    expect(chip.getAttribute("title")).toBe("Equipped with Axe of Despair, Neo Blue-Eyes Ultimate Dragon");
  });

  it("puts the same sentence in the accessible name, once", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    const hit = zone(container, 0, LOCATION_SZONE, 2).querySelector("button") as HTMLElement;
    expect(hit.getAttribute("aria-label")).toMatch(/\. Equipped to Blue-Eyes White Dragon$/);
    expect(zone(container, 0, LOCATION_SZONE, 2).querySelector("[data-equip-chip]")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows nothing on a board without equips", () => {
    const { container } = board(engineOf([mine([null, null, { ...neo, equippedTo: undefined }]), seat(1)]));
    expect(container.querySelector("[data-equip-chip]")).toBeNull();
    expect(container.querySelector("[data-equip]")).toBeNull();
  });

  it("works on the opponent's side and never names a face-down monster", () => {
    const set: DuelCard = { controller: 1, location: LOCATION_MZONE, sequence: 2, position: POS_FACEDOWN_DEFENSE };
    const theirs: DuelCard = {
      controller: 1, location: LOCATION_SZONE, sequence: 1, position: POS_FACEUP_ATTACK, code: 13, name: "Axe of Despair",
      equippedTo: { controller: 1, location: LOCATION_MZONE, sequence: 2 },
    };
    const opp = seat(1, { monsters: [null, null, set, null, null], spells: [null, theirs, null, null, null] });
    const { container } = board(engineOf([seat(0), opp]));
    const equip = zone(container, 1, LOCATION_SZONE, 1).querySelector("[data-equip-chip]") as HTMLElement;
    expect(equip.getAttribute("data-side")).toBe("opp");
    expect(equip.getAttribute("title")).toBe("Equipped to a face-down monster");
    const host = zone(container, 1, LOCATION_MZONE, 2).querySelector("[data-equip-chip]") as HTMLElement;
    expect(host.getAttribute("title")).toBe("Equipped with Axe of Despair");
  });
});

describe("equip line on hover and focus", () => {
  it("draws the line and both rings when either card is hovered, and removes it on leave", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    expect(lines(container)).toHaveLength(0);
    fireEvent.pointerOver(zone(container, 0, LOCATION_SZONE, 2).querySelector("button")!);
    expect(lines(container)).toHaveLength(1);
    expect(lines(container)[0].getAttribute("data-equip-link")).toBe("0:8:2");
    expect(lines(container)[0].querySelectorAll("rect[data-part^='ring']")).toHaveLength(2);
    expect(lines(container)[0].querySelector("path[data-part='line']")).not.toBeNull();
    fireEvent.pointerLeave(container.querySelector("[data-duel-field]")!);
    expect(lines(container)).toHaveLength(0);
    fireEvent.pointerOver(zone(container, 0, LOCATION_MZONE, 1).querySelector("button")!);
    expect(lines(container)).toHaveLength(1);
  });

  it("draws one line per equip on a monster", () => {
    const { container } = board(engineOf([mine([axe, null, neo]), seat(1)]));
    fireEvent.pointerOver(zone(container, 0, LOCATION_MZONE, 1).querySelector("button")!);
    expect(lines(container).map((l) => l.getAttribute("data-equip-link"))).toEqual(["0:8:0", "0:8:2"]);
  });

  it("does nothing when a card without a link is hovered, or the pointer moves off the cards", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    fireEvent.pointerOver(zone(container, 0, LOCATION_MZONE, 3).querySelector("button")!);
    expect(lines(container)).toHaveLength(0);
    fireEvent.pointerOver(zone(container, 0, LOCATION_SZONE, 2).querySelector("button")!);
    fireEvent.pointerOver(container.querySelector("[data-duel-field]")!);
    expect(lines(container)).toHaveLength(0);
  });

  it("shows the same line for keyboard focus", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    fireEvent.focusIn(zone(container, 0, LOCATION_SZONE, 2).querySelector("button")!);
    expect(lines(container)).toHaveLength(1);
    fireEvent.focusOut(zone(container, 0, LOCATION_SZONE, 2).querySelector("button")!);
    expect(lines(container)).toHaveLength(0);
  });

  it("still shows the line, with no animation attribute, in reduced motion", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]), true);
    fireEvent.pointerOver(zone(container, 0, LOCATION_SZONE, 2).querySelector("button")!);
    expect(lines(container)).toHaveLength(1);
    expect(container.querySelector("[data-equip-fx]")).not.toBeNull();
  });

  it("is an overlay the pointer passes through and screen readers skip", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)]));
    expect(container.querySelector("[data-equip-fx]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("equip attach animation", () => {
  const equipEvent = (id: number): DuelEvent => ({
    id, kind: "equip", text: "Player 1 equips a card", seat: 0,
    zone: { controller: 0, location: LOCATION_SZONE, sequence: 2 },
    target: { controller: 0, location: LOCATION_MZONE, sequence: 1 },
  });
  const attached = (c: HTMLElement) => [...c.querySelectorAll('[data-mode="attach"]')];

  it("draws the new link once, then removes it", () => {
    const first = engineOf([mine([null, null, neo]), seat(1)], []);
    const { container, again } = board(first);
    expect(attached(container)).toHaveLength(0);
    act(() => again(engineOf([mine([null, null, neo]), seat(1)], [equipEvent(7)])));
    expect(attached(container)).toHaveLength(1);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(attached(container)).toHaveLength(0);
  });

  it("does not replay an equip that was already in the window when the room opened", () => {
    const { container } = board(engineOf([mine([null, null, neo]), seat(1)], [equipEvent(7)]));
    expect(attached(container)).toHaveLength(0);
  });

  it("skips the animation in reduced motion", () => {
    const { container, again } = board(engineOf([mine([null, null, neo]), seat(1)], []), true);
    act(() => again(engineOf([mine([null, null, neo]), seat(1)], [equipEvent(7)]), true));
    expect(attached(container)).toHaveLength(0);
  });
});

describe("inspector", () => {
  const links = resolveEquipLinks(engineOf([mine([axe, null, neo]), seat(1)]).seats);

  it("says what an equip card is equipped to", () => {
    const { getByText } = render(<CardInspector target={{ type: "card", card: neo }} equipLinks={links} />);
    expect(getByText("Equipped to Blue-Eyes White Dragon")).toBeTruthy();
  });

  it("lists the equips of a monster", () => {
    const { getByText } = render(<CardInspector target={{ type: "card", card: dragon }} equipLinks={links} />);
    expect(getByText("Equipped with Axe of Despair, Neo Blue-Eyes Ultimate Dragon")).toBeTruthy();
  });

  it("says nothing without links", () => {
    const { queryByText } = render(<CardInspector target={{ type: "card", card: neo }} />);
    expect(queryByText(/Equipped/)).toBeNull();
  });
});
