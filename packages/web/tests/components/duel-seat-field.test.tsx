// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelField, SeatField, extraMonsterKeys } from "@/components/duel/field";
import { LOCATION_HAND, LOCATION_MZONE } from "@/components/duel/constants";
import type { SeatFieldProps } from "@/components/duel/table/types";

afterEach(cleanup);

function card(seat: number, location: number, sequence: number, code: number): DuelCard {
  return { controller: seat, location, sequence, position: 1, code, name: `Card ${code}` };
}

function seatView(seat: number, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null], spells: [null, null, null, null, null, null],
    graveyard: [], banished: [], ...extra,
  };
}

function engine3(): DuelEngineView {
  return {
    revision: 1, format: "ffa3", turn: 1, turnSeat: 0, phase: "main1",
    seats: [
      seatView(0, { hand: [card(0, LOCATION_HAND, 0, 1001), card(0, LOCATION_HAND, 1, 1002)], monsters: [card(0, LOCATION_MZONE, 0, 2001), null, null, null, null, card(0, LOCATION_MZONE, 5, 2002)] }),
      seatView(1, { hand: [{ controller: 1, location: LOCATION_HAND, sequence: 0, position: 1 }, { controller: 1, location: LOCATION_HAND, sequence: 1, position: 1 }, { controller: 1, location: LOCATION_HAND, sequence: 2, position: 1 }], monsters: [null, null, null, null, null, null, card(1, LOCATION_MZONE, 6, 2003)] }),
      seatView(2, { eliminated: true }),
    ],
    prompt: null, chain: [], events: [], log: [], result: null,
  };
}

function props(over: Partial<SeatFieldProps> = {}): SeatFieldProps {
  return {
    engine: engine3(), seat: 1, viewerSeat: 0, masterRule: 4, side: "opp", angleDeg: 158, upright: true, tone: "ice",
    density: "rival", hand: "backs", emz: "own", showTally: false, usable: true, name: "Ryo Sato",
    legalKeys: new Set(), selectedKeys: new Set(), reducedMotion: true, onActivate: vi.fn(), onInspect: vi.fn(),
    ...over,
  };
}

describe("extraMonsterKeys", () => {
  it("keeps the shared 1v1 keys and gives every seat its own keys in own mode", () => {
    expect(extraMonsterKeys(0, 1, "left")).toEqual(["0:4:5", "1:4:6"]);
    expect(extraMonsterKeys(0, 1, "right")).toEqual(["0:4:6", "1:4:5"]);
    expect(extraMonsterKeys(1, 1, "left", "own")).toEqual(["1:4:5"]);
    expect(extraMonsterKeys(1, 1, "right", "own")).toEqual(["1:4:6"]);
  });
});

describe("SeatField", () => {
  it("draws the seat's own Extra Monster Zones, one data-zones per zone", () => {
    const { container } = render(<SeatField {...props()} />);
    const zones = [...container.querySelectorAll("[data-zones]")].map((node) => node.getAttribute("data-zones") ?? "");
    expect(zones.some((z) => z.split(" ").includes("1:4:5"))).toBe(true);
    expect(zones.some((z) => z.split(" ").includes("1:4:6"))).toBe(true);
    expect(zones.some((z) => z.split(" ").includes("0:4:5"))).toBe(false);
    // 5 monster + 5 spell/trap + 2 emz + field + extra + banish + gy + deck
    expect(zones.length).toBe(17);
  });

  it("marks the field and the rival hand for the effects", () => {
    const { container } = render(<SeatField {...props()} />);
    const root = container.querySelector("[data-seat-field]");
    expect(root?.getAttribute("data-side")).toBe("opp");
    expect(root?.getAttribute("data-seat-angle")).toBe("158");
    expect(root?.getAttribute("data-straight")).toBe("true");
    const hand = container.querySelector("[data-hand-seat]");
    expect(hand?.getAttribute("data-hand-seat")).toBe("1");
    expect(hand?.getAttribute("data-count")).toBe("3");
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(0);
  });

  it("renders one LP tally only when asked", () => {
    const { container } = render(<SeatField {...props({ showTally: true })} />);
    expect(container.querySelectorAll("[data-lp-seat]")).toHaveLength(1);
    expect(container.querySelector("[data-lp-seat]")?.getAttribute("data-lp-seat")).toBe("1");
  });

  it("shows your own hand face up and turns art only when the field is far off upright", () => {
    const you = render(<SeatField {...props({ seat: 0, side: "you", angleDeg: 0, hand: "face", tone: "violet", name: "Ren" })} />);
    expect(you.container.querySelector("[data-hand-seat='0']")?.getAttribute("data-side")).toBe("you");
    expect(you.container.querySelector("[data-seat-field]")?.getAttribute("data-straight")).toBe("false");
    you.unmount();
    const off = render(<SeatField {...props({ upright: false })} />);
    expect(off.container.querySelector("[data-seat-field]")?.getAttribute("data-straight")).toBe("false");
  });

  it("greys an eliminated seat with a label and never dims cards", () => {
    const { container, getByText } = render(<SeatField {...props({ seat: 2, hand: "none" })} />);
    expect(container.querySelector("[data-seat-field]")?.getAttribute("data-elim")).toBe("true");
    expect(getByText("Eliminated")).toBeTruthy();
    expect(container.innerHTML).not.toMatch(/dim/i);
  });

  it("legal zones glow for the viewer but only ring for a seat that cannot be used", () => {
    const legal = new Set(["1:4:0"]);
    const a = render(<SeatField {...props({ legalKeys: legal })} />);
    expect(a.container.querySelector("[data-seat-field]")?.getAttribute("data-usable")).toBe("true");
    a.unmount();
    const b = render(<SeatField {...props({ legalKeys: legal, usable: false })} />);
    expect(b.container.querySelector("[data-seat-field]")?.getAttribute("data-usable")).toBe("false");
    expect(b.container.querySelector("[data-zones='1:4:0']")?.getAttribute("data-legal")).toBe("true");
  });
});

describe("DuelField (1v1 default)", () => {
  it("still draws the shared Extra Monster Zone band", () => {
    const engine = engine3();
    const { container } = render(
      <DuelField engine={{ ...engine, format: "1v1", seats: engine.seats.slice(0, 2) }} mySeat={0} masterRule={4} reducedMotion
        legalKeys={new Set()} selectedKeys={new Set()} onActivate={vi.fn()} onInspect={vi.fn()} bottomName="Ren" topName="Ryo" />,
    );
    expect(container.querySelector("[data-zones='0:4:5 1:4:6']")).toBeTruthy();
    expect(container.querySelector("[data-seat-field]")).toBeNull();
  });
});
