// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField } from "@/components/duel/field";
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

function board(opts: { legal?: string[]; selected?: string[]; reducedMotion?: boolean } = {}) {
  return render(
    <DuelField engine={engine} mySeat={0} masterRule={5} reducedMotion={opts.reducedMotion ?? false}
      legalKeys={new Set(opts.legal ?? [])} selectedKeys={new Set(opts.selected ?? [])}
      onActivate={() => {}} onInspect={() => {}} bottomName="You" topName="Opp" />,
  );
}

const MZ = zoneKey(0, LOCATION_MZONE, 0);
const HAND = zoneKey(0, LOCATION_HAND, 0);
const zoneOf = (container: HTMLElement, key: string) =>
  container.querySelector(`[data-zones~="${key}"]`) as HTMLElement;

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

  it("glows an empty legal zone, with a tag and no outline", () => {
    const empty = zoneKey(0, LOCATION_MZONE, 3);
    const { container } = board({ legal: [empty] });
    const zone = zoneOf(container, empty);
    expect(zone.querySelector("[data-state]")?.getAttribute("data-state")).toBe("usable");
    expect(zone.querySelector('[class*="ring"]')).toBeNull();
    expect(zone.querySelector("svg")).not.toBeNull();
  });

  it("shows a picked empty zone with the picked glow and a check", () => {
    const empty = zoneKey(0, LOCATION_MZONE, 3);
    const { container } = board({ legal: [empty], selected: [empty] });
    const zone = zoneOf(container, empty);
    expect(zone.querySelector("[data-state]")?.getAttribute("data-state")).toBe("picked");
    expect(zone.querySelector('[class*="ring"]')).toBeNull();
  });

  it("glows a hand card that can be used now, with no outline and a tag", () => {
    const { container } = board({ legal: [HAND] });
    const zone = zoneOf(container, HAND);
    expect(zone.querySelector("[data-state]")?.getAttribute("data-state")).toBe("usable");
    expect(zone.querySelector('[class*="ring"]')).toBeNull();
    expect(zone.querySelector("svg")).not.toBeNull();
  });

  it("shows a picked hand card with the picked glow, a check and no outline", () => {
    const { container } = board({ legal: [HAND], selected: [HAND] });
    const zone = zoneOf(container, HAND);
    expect(zone.querySelector("[data-state]")?.getAttribute("data-state")).toBe("picked");
    expect(zone.querySelector('[class*="ring"]')).toBeNull();
    expect(zone.querySelector("svg")?.getAttribute("class")).not.toContain("nib");
  });

  it("draws no outline on any occupied card in any state", () => {
    const { container } = board({ legal: [HAND, MZ], selected: [MZ] });
    expect(zoneOf(container, HAND).querySelector('[class*="ring"]')).toBeNull();
    expect(zoneOf(container, MZ).querySelector('[class*="ring"]')).toBeNull();
  });
});
