// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
import { isCardPickPrompt, zoneMarkLook } from "@/components/duel/pick-glow";
import { LOCATION_HAND, LOCATION_MZONE, POS_FACEUP_ATTACK, zoneKey } from "@/components/duel/constants";

afterEach(cleanup);

const monster: DuelCard = {
  controller: 0, location: LOCATION_MZONE, sequence: 0, position: POS_FACEUP_ATTACK, code: 11, name: "Monster",
};
const handCard: DuelCard = { controller: 0, location: LOCATION_HAND, sequence: 0, position: 1, code: 12, name: "Hand Card" };

const seat = (n: number, extra: Partial<DuelSeatView> = {}): DuelSeatView => ({
  seat: n, lp: 8000, hand: [], deckCount: 10, extraCount: 0, extra: [],
  monsters: [null, null, null, null, null], spells: [null, null, null, null, null], graveyard: [], banished: [],
  ...extra,
});

const engine: DuelEngineView = {
  revision: 1, turn: 1, turnSeat: 0, phase: "main1",
  seats: [seat(0, { monsters: [monster, null, null, null, null], hand: [handCard] }), seat(1)],
  prompt: null, chain: [], events: [], log: [], result: null,
};

function board(opts: { legal?: string[]; selected?: string[]; picking?: boolean; reducedMotion?: boolean } = {}) {
  return render(
    <DuelField engine={engine} mySeat={0} masterRule={5} reducedMotion={opts.reducedMotion ?? false}
      legalKeys={new Set(opts.legal ?? [])} selectedKeys={new Set(opts.selected ?? [])}
      picking={opts.picking} onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opp" />,
  );
}

const MZ = zoneKey(0, LOCATION_MZONE, 0);
const HAND = zoneKey(0, LOCATION_HAND, 0);
const zoneOf = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-zones~="${key}"]`) as HTMLElement;

describe("isCardPickPrompt", () => {
  const prompt = (kind: DuelPrompt["kind"], context?: DuelPrompt["context"]): DuelPrompt => ({
    id: "p", seat: 0, kind, title: "t", context,
    options: [{ id: "a", label: "A", controller: 0, location: LOCATION_MZONE, sequence: 0 }],
  });

  it("is true for card, tribute, sum and material (toggle) picks", () => {
    for (const kind of ["cards", "tribute", "sum", "toggle"] as const) expect(isCardPickPrompt(prompt(kind))).toBe(true);
  });

  it("is false for the action menu, chain responses, other kinds and no prompt", () => {
    expect(isCardPickPrompt(prompt("choice", { type: "action", phase: "main" }))).toBe(false);
    expect(isCardPickPrompt(prompt("toggle", { type: "chain", forced: false }))).toBe(false);
    expect(isCardPickPrompt(prompt("cards", { type: "action", phase: "battle" }))).toBe(false);
    expect(isCardPickPrompt(prompt("places"))).toBe(false);
    expect(isCardPickPrompt(prompt("choice"))).toBe(false);
    expect(isCardPickPrompt(null)).toBe(false);
  });
});

describe("zoneMarkLook", () => {
  it("glows a card, keeps the outline on an empty zone and on a hand card outside a pick", () => {
    expect(zoneMarkLook({ occupied: true, hand: false, picking: false })).toBe("glow");
    expect(zoneMarkLook({ occupied: false, hand: false, picking: true })).toBe("ring");
    expect(zoneMarkLook({ occupied: true, hand: true, picking: false })).toBe("ring");
    expect(zoneMarkLook({ occupied: true, hand: true, picking: true })).toBe("glow");
  });
});

describe("DuelField card glow", () => {
  it("gives a selectable field card a usable glow and a tag, and no outline", () => {
    const { container } = board({ legal: [MZ] });
    const zone = zoneOf(container, MZ);
    const glow = zone.querySelector("[data-state]");
    expect(glow?.getAttribute("data-state")).toBe("usable");
    expect(glow?.getAttribute("aria-hidden")).toBe("true");
    expect(zone.querySelector("svg")).not.toBeNull();
    expect(container.querySelectorAll("[data-state]")).toHaveLength(1);
  });

  it("shows a picked card with the picked glow and a check, different from the usable glow", () => {
    const usable = board({ legal: [MZ] });
    const usableMarkup = zoneOf(usable.container, MZ).querySelector("[data-state]")?.outerHTML;
    cleanup();
    const { container } = board({ legal: [MZ], selected: [MZ] });
    const zone = zoneOf(container, MZ);
    expect(zone.querySelector("[data-state]")?.getAttribute("data-state")).toBe("picked");
    expect(zone.querySelector("[data-state]")?.outerHTML).not.toBe(usableMarkup);
    expect(zone.querySelector("button")?.getAttribute("aria-pressed")).toBe("true");
  });

  it("does not mark or dim cards that are not selectable", () => {
    const { container } = board({ legal: [MZ] });
    expect(zoneOf(container, HAND).querySelector("[data-state]")).toBeNull();
    expect(zoneOf(container, zoneKey(0, LOCATION_MZONE, 2)).querySelector("span[aria-hidden]")).toBeNull();
  });

  it("keeps the outline on an empty legal zone", () => {
    const empty = zoneKey(0, LOCATION_MZONE, 3);
    const { container } = board({ legal: [empty] });
    const zone = zoneOf(container, empty);
    expect(zone.querySelector("[data-state]")).toBeNull();
    expect(zone.querySelector('[class*="ring"]')).not.toBeNull();
  });

  it("leaves a hand card with its outline while choosing an action", () => {
    const { container } = board({ legal: [HAND], picking: false });
    expect(zoneOf(container, HAND).querySelector("[data-state]")).toBeNull();
    expect(zoneOf(container, HAND).querySelector('[class*="ring"]')).not.toBeNull();
  });

  it("glows a hand card that is picked or selectable in a pick", () => {
    const { container } = board({ legal: [HAND], picking: true });
    expect(zoneOf(container, HAND).querySelector("[data-state]")?.getAttribute("data-state")).toBe("usable");
    cleanup();
    const picked = board({ legal: [HAND], selected: [HAND], picking: true });
    expect(zoneOf(picked.container, HAND).querySelector("[data-state]")?.getAttribute("data-state")).toBe("picked");
  });
});
