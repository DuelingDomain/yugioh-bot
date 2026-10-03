import { describe, expect, it } from "vitest";
import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessageSelectSum } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { mapPrompt } from "../src/prompts.js";
import { createRevealMap, projectView } from "../src/views.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { materialCountScenarios, runMaterialCountScenario } from "./material-count-fixture.js";

describe("material-count: stock-core summon prompt evidence", () => {
  it("carries the chosen Junk Archer's Level through Synchro picks with another Extra Deck monster present", async () => {
    const result = await runMaterialCountScenario(materialCountScenarios[0], { extraMonsters: ["Stardust Dragon"] });
    expect(result.prompts).toHaveLength(2);
    for (const prompt of result.prompts) {
      expect(prompt).toMatchObject({ kind: "toggle", target: 7, sumMode: "exact", source: { name: "Junk Archer" } });
      expect(prompt.options.find((option) => option.card?.name === "Junk Synchron")?.currentLevel).toBe(3);
    }
    expect(result.prompts[1].options.find((option) => option.card?.name === "Photon Thrasher")?.currentLevel).toBe(4);
    expect(result.completedView.prompt?.target).toBeUndefined();
  });

  it("flags a material whose Synchro Level differs from its Level (Road Synchron counts as 2)", async () => {
    const scenario = { kind: "synchro", monster: "Stardust Charge Warrior", materials: ["Photon Thrasher", "Road Synchron"] } as const;
    const result = await runMaterialCountScenario(scenario as unknown as typeof materialCountScenarios[number]);
    expect(result.prompts.length).toBeGreaterThan(0);
    for (const prompt of result.prompts) {
      expect(prompt).toMatchObject({ kind: "toggle", target: 6, sumMode: "exact", source: { name: "Stardust Charge Warrior" } });
      const road = prompt.options.find((option) => option.card?.name === "Road Synchron");
      if (road) expect(road.synchroLevelVaries).toBe(true);
      expect(prompt.options.find((option) => option.card?.name === "Photon Thrasher")?.synchroLevelVaries).toBeUndefined();
    }
    expect(result.prompts.some((prompt) => prompt.options.some((option) => option.card?.name === "Road Synchron"))).toBe(true);
  });

  it("rejects Ritual at Level 2, retains the same prompt, then accepts Level 2 + 3", async () => {
    let checked = false;
    const scenario = materialCountScenarios.find((entry) => entry.kind === "ritual")!;
    const result = await runMaterialCountScenario(scenario, {
      onMaterialPrompt(game, prompt) {
        const shineBall = prompt.options.find((option) => option.card?.name === "Mystical Shine Ball")!;
        expect(shineBall.values).toEqual([2]);
        expect(() => game.answer(0, prompt.id, { selected: [shineBall.id] })).toThrow("Invalid answer");
        expect(game.view(0).prompt?.id).toBe(prompt.id);
        checked = true;
      },
    });
    expect(checked).toBe(true);
    expect(result.event.summonKind).toBe("ritual");
  });

  it.each(materialCountScenarios)("completes $kind summon of $monster and captures material prompts", async (scenario) => {
    const result = await runMaterialCountScenario(scenario);
    expect(result.prompts.length).toBeGreaterThan(0);
    expect(result.event.summonKind).toBe(scenario.kind);
    expect(result.materialViews.every((view) => view.prompt?.seat === 0)).toBe(true);
    for (const view of [...result.opponentMaterialViews, ...result.spectatorMaterialViews]) {
      expect(view.prompt).toBeNull();
      expect(view.seats[0].hand.every((card) => card.code == null)).toBe(true);
    }
    if (scenario.kind === "ritual") expect(result.prompts[0]).toMatchObject({ target: 4, sumMode: "at-least" });
    if (scenario.kind === "xyz") expect(result.summoned.materials?.map((card) => card.code)).toEqual(expect.arrayContaining(result.materials));
    else expect(result.graveyard.map((card) => card.code)).toEqual(expect.arrayContaining(result.materials));
  });
});

describe("material-count: SELECT_SUM projection", () => {
  it.each([
    { selectMax: 0, sumMode: "exact", hint: "Select the card(s) to use as Synchro Material", max: 2 },
    { selectMax: 1, sumMode: "at-least", hint: "Select the card(s) to use as Ritual Tribute", max: 3 },
  ] as const)("preserves $sumMode requirements, required cards, and engine contributions", ({ selectMax, sumMode, hint, max }) => {
    const cards = loadCardDatabase(engineDataDirectory);
    const card = { code: 0, controller: 0 as const, location: OcgLocation.MZONE, sequence: 0 };
    const message: OcgMessageSelectSum = {
      type: OcgMessageType.SELECT_SUM, player: 0, select_max: selectMax, amount: 7, min: 1, max: 1,
      selects_must: [{ ...card, amount: 3 }],
      selects: [{ ...card, sequence: 1, amount: 4 }, { ...card, sequence: 2, amount: 2 | (4 << 16) }],
    };
    const { prompt } = mapPrompt(message, cards, "sum", hint);
    expect(prompt).toMatchObject({ kind: "sum", sumMode, target: 7, min: 2, max, mandatory: ["must:0"] });
    expect(prompt.options.map((option) => option.values)).toEqual([[3], [4], [2, 4]]);
    expect(mapPrompt(message, cards, "sum").prompt.title).toBe(selectMax ? "Select cards totaling at least 7" : "Select cards totaling 7");
  });
});

describe("material-count: current material Levels", () => {
  it.each([2, 0])("projects a changed Level %i instead of Junk Synchron's printed Level 3", (level) => {
    const cards = loadCardDatabase(engineDataDirectory);
    const vacant = { position: 0, materials: 0 };
    const player = { monsters: Array(7).fill(vacant), spells: Array(8).fill(vacant),
      deck_size: 0, hand_size: 0, grave_size: 0, banish_size: 0, extra_size: 0, extra_faceup_count: 0 };
    const project = (viewer: number, position: number) => projectView({
      lib: {
        duelQueryField: () => ({ flags: 0n, players: [player, player], chain: [] }),
        duelQueryLocation: (_handle: unknown, zone: { controller: number; location: number }) =>
          zone.controller === 0 && zone.location === OcgLocation.MZONE ? [{ code: 63977008, position, level }] : [],
      } as never,
      handle: {} as never, cards, viewer, revision: 0, turn: 1, turnSeat: 0, phase: "main1", lp: [8000, 8000],
      prompt: { id: "p", seat: viewer, kind: "toggle", title: "Select the card(s) to use as Synchro Material",
        options: [{ id: "unselect:0", label: "Junk Synchron", card: cards.get(63977008), controller: 0,
          location: OcgLocation.MZONE, sequence: 0, selected: true }] },
      promptSeat: viewer, log: [], events: [], result: null, reveals: createRevealMap(), mode: "normal",
    });
    const visible = project(0, OcgPosition.FACEUP_ATTACK);
    expect(visible.seats[0].monsters[0]?.level).toBe(level);
    expect(visible.prompt?.options[0]).toMatchObject({ currentLevel: level, card: { level: 3 } });
    const hidden = project(1, OcgPosition.FACEDOWN_DEFENSE);
    expect(hidden.prompt?.options[0].currentLevel).toBeUndefined();
    expect(hidden.prompt?.options[0].card).toBeUndefined();
  });
});
