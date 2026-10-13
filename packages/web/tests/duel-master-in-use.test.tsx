// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelEngineView, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LOCATION_DMZONE, LOCATION_MZONE } from "@/components/duel/constants";
import { MasterDock, masterStatus } from "@/components/duel/field";
import { COST_SUFFIX, findMasterCard, masterActionParts, masterActionText, masterInUse, masterNextCost, masterPlace, masterSummonLine } from "@/components/duel/master-place";
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

  it("the summon is the live shape: the summon alone, with no move out of the DMZ", () => {
    const events = masterCycle(0)[1].events ?? [];
    expect(events.map((event) => event.kind)).toEqual(["summon"]);
  });
});

describe("the Summon cost line", () => {
  const withCost = (nextCost: number, inZone = true) => seatView({ inZone, deckMaster: { card: info, inZone, returns: nextCost / 500, nextCost } });

  it("says what the next summon from the zone costs, and that the first one is free", () => {
    expect(masterSummonLine(withCost(500))).toBe("Next summon: 500 LP");
    expect(masterSummonLine(withCost(1500))).toBe("Next summon: 1,500 LP");
    expect(masterSummonLine(withCost(0))).toBe("Next summon: Free");
  });

  it("is shown in every state of the master, and absent only without a master", () => {
    expect(masterSummonLine(withCost(500, false))).not.toBeNull();
    expect(masterSummonLine(seatView({ deckMaster: undefined }))).toBeNull();
  });

  it("out of the zone says the cost after the recall, one return more: the first summon was free, the next costs 500 LP", () => {
    // returns 0, nextCost 0 (the engine's price of leaving the zone now), the master is on the field.
    expect(masterSummonLine(withCost(0, false))).toBe("Next summon: 500 LP");
    expect(masterSummonLine(withCost(500, false))).toBe("Next summon: 1,000 LP");
    expect(masterSummonLine(withCost(1500, false))).toBe("Next summon: 2,000 LP");
    // In the zone the server's number stands.
    expect(masterSummonLine(withCost(0, true))).toBe("Next summon: Free");
    expect(masterNextCost(withCost(0, false).deckMaster!)).toBe(500);
    expect(masterNextCost(withCost(1000, true).deckMaster!)).toBe(1000);
  });

  it("shows on the plate (compact and wide) in the zone, on the field, and out of play, on a multi-seat table only", () => {
    for (const wide of [false, true]) {
      for (const [inZone, text] of [[true, "Next summon: 500 LP"], [false, "Next summon: 1,000 LP"]] as const) {
        plate(withCost(500, inZone), { showInUse: true, wide });
        expect(screen.getByTestId("hud-master-summon").textContent).toBe(text);
        cleanup();
      }
      plate(withCost(0), { showInUse: true, wide });
      expect(screen.getByTestId("hud-master-summon").textContent).toBe("Next summon: Free");
      cleanup();
    }
    plate(withCost(500));
    expect(screen.queryByTestId("hud-master-summon")).toBeNull();
    cleanup();
    for (const [inZone, text] of [[true, "Next summon: Free"], [false, "Next summon: 500 LP"]] as const) {
      render(
        <MasterDock title="Your Master" view={withCost(0, inZone)} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => []}
          onActivate={noop} onChooseAction={noop} onInspect={noop} showInUse />,
      );
      expect(screen.getByTestId("master-dock-summon").textContent).toBe(text);
      cleanup();
    }
  });
});

describe("the next cost in the chips", () => {
  const chipView = (inZone: boolean) => seatView({ inZone, deckMaster: { card: info, inZone, returns: 0, nextCost: 0 } });

  it("the table chip says Free in the zone and the cost after the recall (500 LP) out of it", () => {
    render(<MasterChip view={chipView(true)} label="Your Master" onOpen={noop} />);
    expect(screen.getByTestId("master-chip").getAttribute("aria-label")).toContain("next 0 LP");
    cleanup();
    render(<MasterChip view={chipView(false)} label="Your Master" onOpen={noop} />);
    expect(screen.getByTestId("master-chip").getAttribute("aria-label")).toContain("next 500 LP");
    expect(screen.getByTestId("master-chip").textContent).toContain("500 LP");
  });
});

describe("the Deck Master action text", () => {
  const view = (nextCost: number, inZone = true) => seatView({ inZone, deckMaster: { card: info, inZone, returns: nextCost / 500, nextCost } });
  const opt = (id: string, label: string, location?: number): DuelPromptOption => ({ id, label, ...(location === undefined ? {} : { location }) });
  const summon = (label = "Normal Summon Dark Magician Girl", location: number | undefined = LOCATION_DMZONE) => opt("summon:0", label, location);

  it("adds the next cost to Summon and Set, and Free for the first", () => {
    expect(masterActionText(summon(), view(500), true)).toBe("Summon · 500 LP");
    expect(masterActionText(opt("mset:0", "Set monster Dark Magician Girl", LOCATION_DMZONE), view(0), true)).toBe("Set · Free");
    expect(masterActionText(opt("spsummon:0", "Special Summon Dark Magician Girl", LOCATION_DMZONE), view(500), true)).toBe("Summon · 500 LP");
    expect(masterActionText(summon(), view(1000), false)).toBe("Normal Summon Dark Magician Girl · 1,000 LP");
  });

  it("shows no cost for a summon from hand, Graveyard or Extra Deck, or while the master is out of its zone", () => {
    expect(masterActionText(summon("Normal Summon Dark Magician Girl", 0x2), view(500), true)).toBe("Summon");
    expect(masterActionText(summon("Special Summon Dark Magician Girl", 0x10), view(500), false)).toBe("Special Summon Dark Magician Girl");
    expect(masterActionText(summon(), view(500, false), true)).toBe("Summon");
  });

  it("shows the cost once when the server label already ends in it", () => {
    expect(masterActionText(summon("Normal Summon Dark Magician Girl (costs 500 LP)"), view(500), true)).toBe("Summon · 500 LP");
    expect(masterActionText(summon("Normal Summon Dark Magician Girl (costs 500 LP)"), view(500), false)).toBe("Normal Summon Dark Magician Girl · 500 LP");
    expect(masterActionText(summon("Normal Summon Dark Magician Girl (costs 0 LP)"), view(0), true)).toBe("Summon · Free");
    // The format of the server suffix (docs/api/deck-master-cost.md): a space, "(costs ", the number with its separators, " LP)".
    expect(COST_SUFFIX.exec("Normal Summon X (costs 1,500 LP)")?.[1]).toBe("1,500");
    expect(COST_SUFFIX.test("Normal Summon X (costs 500 LP) extra")).toBe(false);
  });

  it("reads the kind from the option id, not the words of the label", () => {
    const activate = opt("activate:0", "Activate Summon Sorceress: Draw 1 card", LOCATION_DMZONE);
    expect(masterActionParts(activate, view(500), true)).toEqual({ text: "Activate Summon Sorceress: Draw 1 card", cost: null, move: false });
    expect(masterActionText(opt("pos:0", "Change position of Dark Magician Girl"), view(500), true)).toBe("Change position of Dark Magician Girl");
  });

  it("keeps the key words of an Activate label and drops the master's own name on the plate", () => {
    const label = `Activate ${info.name}: Draw 1 card`;
    const activate = opt("activate:0", label, LOCATION_DMZONE);
    expect(masterActionText(activate, view(500), true)).toBe("Activate: Draw 1 card");
    expect(masterActionText(activate, view(500), false)).toBe(label);
    expect(masterActionText({ ...activate, label: `${label} (costs 500 LP)` }, view(500), true)).toBe("Activate: Draw 1 card · 500 LP");
  });
});

describe("a master taken to another seat's field", () => {
  it("reads On field in its owner's panel when only another seat's view holds the card", () => {
    const mine = seatView({ inZone: false });
    const rival = seatView({ inZone: false, seat: 1 });
    rival.monsters = [{ controller: 1, location: LOCATION_MZONE, sequence: 0, position: 1, code: info.code, name: info.name }];
    expect(masterPlace(mine)).toBe("elsewhere");
    expect(masterPlace(mine, [mine, rival])).toBe("field");
    // The status text reads the other seat, but a plate never takes that card as its own (it would glow and select it).
    expect(findMasterCard(mine, info.code)).toBeNull();
  });
});

describe("the plate buttons", () => {
  const options: DuelPromptOption[] = [
    { id: "summon:0", label: "Normal Summon Dark Magician Girl", location: LOCATION_DMZONE },
    { id: "mset:0", label: "Set monster Dark Magician Girl", location: LOCATION_DMZONE },
    { id: "activate:0", label: `Activate ${info.name}: Place this card in your Pendulum Zone`, location: LOCATION_DMZONE },
  ];
  const dm = () => seatView({ inZone: true, deckMaster: { card: info, inZone: true, returns: 1, nextCost: 500 } });
  const draw = (showInUse: boolean) =>
    render(
      <GridMasterToken view={dm()} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => options} open={false}
        title="Your Master" onToggle={noop} onClose={noop} onChooseAction={noop} onInspect={noop} showInUse={showInUse} />,
    );

  it("show the cost, a full-row Activate that is not cut, and the cost in the accessible name", () => {
    draw(true);
    const buttons = screen.getAllByTestId("hud-master-action");
    expect(buttons.map((b) => b.textContent)).toEqual(["Summon · 500 LP", "Set · 500 LP", "Activate: Place this card in your Pendulum Zone"]);
    expect(buttons.map((b) => b.dataset.kind)).toEqual(["move", "move", "other"]);
    expect(buttons[0].getAttribute("aria-label")).toBe("Normal Summon Dark Magician Girl · 500 LP");
    expect(buttons[0].getAttribute("title")).toBe("Normal Summon Dark Magician Girl");
    // Summon and Set, then Inspect, then the Activate row: Inspect never ends up on a row of its own below Activate.
    const row = buttons[0].parentElement!;
    expect([...row.children].map((el) => el.getAttribute("data-testid"))).toEqual(["hud-master-action", "hud-master-action", "hud-master-inspect", "hud-master-action"]);
  });

  it("names the summon line in the token's accessible name", () => {
    draw(true);
    expect(screen.getByTestId("hud-master-token").getAttribute("aria-label")).toContain("Next summon: 500 LP");
  });

  it("keeps the 1v1 plate to its short words", () => {
    draw(false);
    expect(screen.getAllByTestId("hud-master-action").map((b) => b.textContent)).toEqual(["Summon", "Set", `Activate ${info.name}: Place this card in your Pendulum Zone`]);
  });
});

describe("the 1v1 Deck Master dock with a legal summon from the zone", () => {
  it("glows (a usable mark on the card) when the zone can be summoned from or picked, and shows the Summon button", () => {
    const view = seatView({ inZone: true });
    const key = `0:${LOCATION_DMZONE}:0`;
    const option = { id: "spsummon:0", label: "Special Summon Dark Magician", controller: 0, location: LOCATION_DMZONE, sequence: 0 } as DuelPromptOption;
    const dock = (legal: boolean) => (
      <MasterDock title="Your Master" view={view} local legalKeys={new Set(legal ? [key] : [])} selectedKeys={new Set()} canAct
        legalActionsFor={() => (legal ? [option] : [])} onActivate={noop} onChooseAction={noop} onInspect={noop} />
    );
    const { container, rerender } = render(dock(true));
    expect(container.querySelector("section")?.getAttribute("data-legal")).toBe("true");
    expect(container.querySelector("[data-master-dock] [data-state='usable']")).not.toBeNull();
    expect(screen.getByRole("button", { name: /Special Summon Dark Magician/ })).toBeTruthy();
    rerender(dock(false));
    expect(container.querySelector("[data-master-dock] [data-state]")).toBeNull();
  });
});
