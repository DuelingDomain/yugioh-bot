// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelEngineView, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_DMZONE, LOCATION_MZONE } from "@/components/duel/constants";
import { MasterDock, masterStatus } from "@/components/duel/field";
import { masterActionText, masterInUse, masterPlace, masterSummonLine } from "@/components/duel/master-place";
import { detectMasterReturns } from "@/components/duel/master-return";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { FFA4_FIXTURES } from "@/components/duel/table/fixtures/ffa4";
import { engineAtStep, isSceneId, masterCycle, sceneSteps } from "@/components/duel/table/fixtures/scenes";
import { GridMasterToken } from "@/components/duel/table/grid-master";
import { HoloLp } from "@/components/duel/table/holo-lp";
import { MasterChip } from "@/components/duel/table/master-chip";
import { TAG_FIXTURES, tagDomainVariant } from "@/components/duel/tag/fixtures";

afterEach(cleanup);

const info: DuelCardInfo = { code: 9, name: "Dark Magician", description: "A mage.", type: 1, attack: 2500, defense: 2100, level: 7, attribute: 1, race: "Spellcaster" };

function seatView(over: Partial<DuelSeatView> & { inZone?: boolean } = {}): DuelSeatView {
  const { inZone = true, ...rest } = over;
  return {
    seat: 0, lp: 8000, hand: [], deckCount: 30, extraCount: 0, extra: [],
    monsters: [null, null, null, null, null, null, null], spells: [null, null, null, null, null, null, null, null],
    graveyard: [], banished: [], deckMaster: { card: info, inZone, returns: 1, nextCost: 500 }, ...rest,
  } as DuelSeatView;
}

const onField = { controller: 0, location: LOCATION_MZONE, sequence: 2, position: 1, code: 9 };

describe("the shared Deck Master place", () => {
  it("reads the zone, the field and elsewhere from one view", () => {
    expect(masterPlace(seatView())).toBe("zone");
    expect(masterPlace(seatView({ inZone: false, monsters: [null, null, onField, null, null, null, null] }))).toBe("field");
    expect(masterPlace(seatView({ inZone: false, graveyard: [{ ...onField, location: 0x10 }] }))).toBe("elsewhere");
    expect(masterPlace(seatView({ inZone: false }))).toBe("elsewhere");
    expect(masterPlace(seatView({ deckMaster: undefined }))).toBe("none");
    expect(masterPlace(undefined)).toBe("none");
  });

  it("is in use whenever the master is out of its zone, and feeds the 1v1 status text", () => {
    expect(masterInUse(seatView())).toBe(false);
    expect(masterInUse(seatView({ inZone: false }))).toBe(true);
    expect(masterInUse(seatView({ deckMaster: undefined }))).toBe(false);
    expect(masterStatus(seatView())).toBe("In Deck Master Zone");
    expect(masterStatus(seatView({ inZone: false, monsters: [null, null, onField, null, null, null, null] }))).toBe("On field");
    expect(masterStatus(seatView({ inZone: false }))).toBe("Elsewhere");
  });
});

const noop = () => undefined;
function plate(view: DuelSeatView, over: { showInUse?: boolean; wide?: boolean } = {}) {
  return render(
    <GridMasterToken view={view} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => []} open={false}
      title="Your Master" onToggle={noop} onClose={noop} onChooseAction={noop} onInspect={noop} {...over} />,
  );
}

describe("the Deck Master plate of a multi-seat table", () => {
  it("draws an empty In use slot while the master is out of its zone, in every form", () => {
    for (const wide of [false, true]) {
      plate(seatView({ inZone: false }), { showInUse: true, wide });
      expect((document.querySelector("section[data-in-use]") as HTMLElement).dataset.inUse).toBe("true");
      expect(screen.getByTestId("hud-master-in-use").textContent).toBe("In use");
      expect(screen.getByTestId("hud-master-token").getAttribute("aria-label")).toContain("in use");
      cleanup();
    }
  });

  it("shows the card while it is in the zone, and is the zone anchor of its seat", () => {
    const { container } = plate(seatView({ seat: 2 }), { showInUse: true });
    expect((document.querySelector("section[data-in-use]") as HTMLElement).dataset.inUse).toBe("false");
    expect(screen.queryByTestId("hud-master-in-use")).toBeNull();
    const art = container.querySelector("[data-master-dock]") as HTMLElement;
    expect(art.dataset.masterDock).toBe("2");
    expect(art.dataset.masterSource).toBe("2");
  });

  it("keeps the 1v1 plate as it was: no empty slot, no zone anchor", () => {
    const { container } = plate(seatView({ inZone: false }));
    expect((document.querySelector("section[data-in-use]") as HTMLElement).dataset.inUse).toBe("false");
    expect(container.querySelector("[data-master-dock]")).toBeNull();
  });
});

describe("the other Deck Master surfaces", () => {
  it("the rival thumb on a seat plate is an empty slot and a zone anchor", () => {
    const base = { seat: 1, name: "Ryo", tone: "ice", lp: 5400, handCount: 4, deckCount: 30, clockMs: 240000, status: "active", me: false, x: 8, y: 8, beam: "down", reducedMotion: true, master: info } as const;
    const { container, rerender } = render(<HoloLp {...base} masterInUse />);
    const thumb = container.querySelector("[data-master-thumb='1']") as HTMLElement;
    expect(thumb.dataset.inUse).toBe("true");
    expect(thumb.dataset.masterDock).toBe("1");
    expect(thumb.querySelector("img")).toBeNull();
    rerender(<HoloLp {...base} />);
    expect(container.querySelector("[data-master-thumb='1'] img")).not.toBeNull();
  });

  it("the rail dock and the chip show the empty zone only on a multi-seat table", () => {
    const view = seatView({ inZone: false });
    const dock = (showInUse: boolean) => (
      <MasterDock title="Your Master" view={view} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => []}
        onActivate={noop} onChooseAction={noop} onInspect={noop} showInUse={showInUse} />
    );
    const { container, rerender } = render(dock(true));
    expect(screen.getByTestId("master-dock-in-use")).toBeTruthy();
    expect(container.querySelector("[data-master-dock] img")).toBeNull();
    rerender(dock(false));
    expect(screen.queryByTestId("master-dock-in-use")).toBeNull();
    expect(container.querySelector("[data-master-dock] img")).not.toBeNull();
    cleanup();
    render(<MasterChip view={view} label="Your Master" onOpen={noop} />);
    expect(screen.getByTestId("master-chip").dataset.inUse).toBe("true");
    cleanup();
    render(<MasterChip view={seatView()} label="Your Master" onOpen={noop} />);
    expect(screen.getByTestId("master-chip").dataset.inUse).toBeUndefined();
  });
});

const MODES: Array<{ mode: string; engine: () => DuelEngineView; seats: number[] }> = [
  { mode: "3-way", engine: () => FFA3_FIXTURES.states.main.room.engine!, seats: [0, 1, 2] },
  { mode: "4-way", engine: () => FFA4_FIXTURES.states.main.room.engine!, seats: [0, 1, 2, 3] },
  { mode: "Tag", engine: () => tagDomainVariant(TAG_FIXTURES).states.main.room.engine!, seats: [0, 1, 2, 3] },
];

describe.each(MODES)("the Deck Master cycle on a $mode table", ({ engine, seats }) => {
  it("starts with every master in use, empties the zone on a summon, and flies the return into the right seat", () => {
    expect(isSceneId("master-3")).toBe(true);
    for (const seat of seats) {
      const base = engine();
      expect(base.seats.every((view) => masterInUse(view))).toBe(true);
      const steps = sceneSteps(`master-${seat as 0 | 1 | 2 | 3}`);
      expect(steps).toEqual(masterCycle(seat).map(() => expect.anything()));
      const at = (count: number) => engineAtStep(base, steps, count, 0);
      // In its zone, summoned (on the field), destroyed (Graveyard), returned.
      expect([1, 2, 3, 4].map((count) => masterInUse(at(count).seats[seat]))).toEqual([false, true, true, false]);
      expect(masterPlace(at(2).seats[seat])).toBe("field");
      expect(masterPlace(at(3).seats[seat])).toBe("elsewhere");
      // The other seats never change.
      for (const other of seats.filter((value) => value !== seat)) expect(masterInUse(at(4).seats[other])).toBe(true);
      // Only the last step is a return, for this seat, and it is the one MasterReturnFx flies.
      expect(detectMasterReturns(at(3).seats, at(4).seats)).toEqual([expect.objectContaining({ seat, code: at(4).seats[seat].deckMaster!.card.code, returns: 1 })]);
      for (const count of [1, 2, 3]) expect(detectMasterReturns(at(count - 1).seats, at(count).seats)).toEqual([]);
    }
  });

  it("the summon leaves from the DMZ", () => {
    const summon = masterCycle(0)[1].events?.[0];
    expect(summon?.from).toEqual(expect.objectContaining({ location: LOCATION_DMZONE }));
  });
});

describe("the Summon cost line", () => {
  const withCost = (nextCost: number, inZone = true) => seatView({ inZone, deckMaster: { card: info, inZone, returns: nextCost / 500, nextCost } });

  it("says what the next summon from the zone costs, and that the first one is free", () => {
    expect(masterSummonLine(withCost(500))).toBe("Summon: costs 500 LP");
    expect(masterSummonLine(withCost(1500))).toBe("Summon: costs 1,500 LP");
    expect(masterSummonLine(withCost(0))).toBe("Summon: free");
  });

  it("has no line while the master is out of its zone, or on a table without a master", () => {
    expect(masterSummonLine(withCost(500, false))).toBeNull();
    expect(masterSummonLine(seatView({ deckMaster: undefined }))).toBeNull();
  });

  it("shows on the plate (compact and wide) and the dock of a multi-seat table only", () => {
    for (const wide of [false, true]) {
      plate(withCost(500), { showInUse: true, wide });
      expect(screen.getByTestId("hud-master-summon").textContent).toBe("Summon: costs 500 LP");
      cleanup();
    }
    plate(withCost(500, false), { showInUse: true });
    expect(screen.queryByTestId("hud-master-summon")).toBeNull();
    cleanup();
    plate(withCost(500));
    expect(screen.queryByTestId("hud-master-summon")).toBeNull();
    cleanup();
    render(
      <MasterDock title="Your Master" view={withCost(0)} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => []}
        onActivate={noop} onChooseAction={noop} onInspect={noop} showInUse />,
    );
    expect(screen.getByTestId("master-dock-summon").textContent).toBe("Summon: free");
  });
});

describe("the Deck Master action text", () => {
  const view = (nextCost: number) => seatView({ inZone: true, deckMaster: { card: info, inZone: true, returns: nextCost / 500, nextCost } });

  it("adds the next cost to Summon and Set, and Free for the first", () => {
    expect(masterActionText("Normal Summon Dark Magician Girl", view(500), true)).toBe("Summon · 500 LP");
    expect(masterActionText("Set Dark Magician Girl", view(0), true)).toBe("Set · Free");
    expect(masterActionText("Normal Summon Dark Magician Girl", view(1000), false)).toBe("Normal Summon Dark Magician Girl · 1,000 LP");
  });

  it("shows the cost once when the server label already ends in it", () => {
    expect(masterActionText("Normal Summon Dark Magician Girl (costs 500 LP)", view(500), true)).toBe("Summon · 500 LP");
    expect(masterActionText("Normal Summon Dark Magician Girl (costs 500 LP)", view(500), false)).toBe("Normal Summon Dark Magician Girl · 500 LP");
    expect(masterActionText("Set Dark Magician Girl (costs 0 LP)", view(0), true)).toBe("Set · Free");
  });

  it("keeps the key words of an Activate label and drops the master's own name on the plate", () => {
    const label = `Activate ${info.name}: Draw 1 card`;
    expect(masterActionText(label, view(500), true)).toBe("Activate: Draw 1 card");
    expect(masterActionText(label, view(500), false)).toBe(label);
    expect(masterActionText(`${label} (costs 500 LP)`, view(500), true)).toBe("Activate: Draw 1 card · 500 LP");
  });
});

describe("the plate buttons", () => {
  it("show the cost, keep the full option text as the accessible name and never shorten an Activate label to an ellipsis", () => {
    const options = [
      { id: "s", label: "Normal Summon Dark Magician Girl", key: "s" },
      { id: "a", label: `Activate ${info.name}: Draw 1 card, then discard 1 card` , key: "a" },
    ] as never;
    const dm = seatView({ inZone: true, deckMaster: { card: info, inZone: true, returns: 1, nextCost: 500 } });
    render(
      <GridMasterToken view={dm} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => options} open={false}
        title="Your Master" onToggle={noop} onClose={noop} onChooseAction={noop} onInspect={noop} showInUse />,
    );
    const buttons = screen.getAllByTestId("hud-master-action");
    expect(buttons.map((b) => b.textContent)).toEqual(["Summon · 500 LP", "Activate: Draw 1 card, then discard 1 card"]);
    expect(buttons[0].getAttribute("aria-label")).toBe("Normal Summon Dark Magician Girl");
  });
});
