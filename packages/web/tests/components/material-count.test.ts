import { describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";
import type { PromptDraft } from "@/components/duel/prompts";
import { materialCountScenarios, runMaterialCountScenario } from "../../../duel-server/tests/material-count-fixture.js";
import { describeWithCores, needs } from "../../../duel-server/tests/support/cores.js";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { pickCopy } from "@/components/duel/prompt-center";
import { canConfirm } from "@/components/duel/prompts";

function draft(prompt: DuelPrompt, selected = prompt.mandatory ?? []): PromptDraft {
  const noop = () => {};
  return {
    selected, setSelected: noop, counts: {}, setCounts: noop, value: 0, setValue: noop,
    cardCode: null, setCardCode: noop, highlight: 0, setHighlight: noop,
  };
}

// These run the real stock core on cards.cdb: skipped without the engine bundle, a failure with DUEL_REQUIRE_CORES=1
// (the engine job of .github/workflows/test.yml runs them).
describeWithCores("material-count: real summon prompts through the web pick counter", [needs.cards(), needs.standard()], () => {
  it.each(materialCountScenarios.filter((scenario) => ["xyz", "link"].includes(scenario.kind)))(
    "$kind does not advertise one material as the total requirement", async (scenario) => {
      const { prompts } = await runMaterialCountScenario(scenario);
      expect(prompts.map((prompt) => prompt.kind)).toEqual(["toggle", "toggle"]);
      expect(prompts.map((prompt) => prompt.max)).toEqual([1, 1]);
      expect(prompts[1].finishable).toBe(false);
      // Without explicit total metadata, show the count alone; don't infer a total of two from the card text.
      expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false).counter)).toEqual(["0 selected", "1 selected"]);
      expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false).title)).toEqual(["Choose a material", "Choose a material"]);
      expect(pickCopy(prompts[0], draft(prompts[0]), false).remaining).toBeNull();
    },
  );

  it("shows the real Junk Archer target and current material Levels for zero, one and two Synchro picks", async () => {
    const { prompts } = await runMaterialCountScenario(materialCountScenarios[0]);
    expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false))).toMatchObject([
      { title: "Choose a material", counter: "Level 0 / 7", met: false },
      { title: "Choose a material", counter: "Level 3 / 7", met: false },
    ]);
    // The real core completes immediately on the second click; show that accepted pair pending submission.
    const secondPick = { ...prompts[1], options: prompts[1].options.map((option) => ({ ...option, selected: true })) };
    expect(pickCopy(secondPick, draft(secondPick), false)).toMatchObject({ counter: "Level 7 / 7", met: true });
    // A changed Level from the view takes precedence over printed card info.
    const changed = { ...secondPick, options: secondPick.options.map((option) =>
      option.card?.name === "Junk Synchron" ? { ...option, currentLevel: 2 } : option) };
    expect(pickCopy(changed, draft(changed), false)).toMatchObject({ counter: "Level 6 / 7", met: false });
    expect(pickCopy({ ...changed, target: undefined }, draft(changed), false).counter).toBe("2 selected");
  });

  it("Fusion retains an actual two-material total supplied by its script", async () => {
    const scenario = materialCountScenarios.find((entry) => entry.kind === "fusion")!;
    const { prompts } = await runMaterialCountScenario(scenario);
    expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false).counter)).toEqual(["0/2 selected", "1/2 selected"]);
  });

  it("variable-material Fusion does not advertise one material as the total requirement", async () => {
    const scenario = materialCountScenarios.find((entry) => entry.monster === "Chimeratech Overdragon")!;
    const { prompts } = await runMaterialCountScenario(scenario);
    expect(prompts.map((prompt) => prompt.max)).toEqual([1, 1]);
    expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false).counter)).toEqual(["0 selected", "1 selected"]);
    expect(prompts.map((prompt) => pickCopy(prompt, draft(prompt), false).title)).toEqual(["Choose a material", "Choose a material"]);
  });

  it("a two-Tribute Normal Summon asks for two tributes and counts what they are worth against what is needed", async () => {
    const scenario = materialCountScenarios.find((entry) => entry.kind === "tribute")!;
    const { prompts } = await runMaterialCountScenario(scenario);
    expect(prompts[0]).toMatchObject({ kind: "tribute", min: 2, max: 2 });
    expect(pickCopy(prompts[0], draft(prompts[0]), false)).toMatchObject({ title: "Tribute 2 monsters", counter: "0/2" });
    expect(pickCopy(prompts[0], draft(prompts[0], prompts[0].options.map((option) => option.id)), false).counter).toBe("2/2");
  });

  it("Ritual level sums do not turn a target Level into a required material count", async () => {
    const scenario = materialCountScenarios.find((entry) => entry.kind === "ritual")!;
    const { prompts } = await runMaterialCountScenario(scenario);
    expect(prompts).toHaveLength(1);
    const prompt = prompts[0];
    expect(prompt).toMatchObject({ kind: "sum", target: 4, sumMode: "at-least" });
    const selected = prompt.options.map((option) => option.id);
    expect(pickCopy(prompt, draft(prompt), false).counter).toBe("Level total 0");
    expect(pickCopy(prompt, draft(prompt, selected), false).counter).toBe("Level total 2 + 3 = 5");
    expect(canConfirm(prompt, draft(prompt))).toBe(false);
    expect(canConfirm(prompt, draft(prompt, [selected[0]]))).toBe(false);
    expect(canConfirm(prompt, draft(prompt, selected))).toBe(true);
  });

  it("Ritual instructions retain the at-least semantics of White Dragon Ritual", async () => {
    const scenario = materialCountScenarios.find((entry) => entry.kind === "ritual")!;
    // The real core accepts Level 2 + Level 3 for a Level 4 Ritual. It isn't an exact sum.
    const { prompts } = await runMaterialCountScenario(scenario);
    expect(pickCopy(prompts[0], draft(prompts[0]), false).instruction).toBe("Total at least 4");
  });
});

describe("material-count: Level sum progress", () => {
  const prompt: DuelPrompt = {
    id: "sum", seat: 0, kind: "sum", title: "Select the card(s) to use as Synchro Material",
    min: 2, max: 3, target: 7, sumMode: "exact", mandatory: ["must:0"],
    options: [
      { id: "must:0", label: "Tuner", values: [3], selected: true },
      { id: "card:0", label: "Non-Tuner", values: [4] },
      { id: "card:1", label: "Alternative Levels", values: [2, 4] },
    ],
  };

  it("includes the required Tuner and recalculates as materials are added and removed", () => {
    expect(pickCopy(prompt, draft(prompt), false).counter).toBe("Level 3 / 7");
    expect(pickCopy(prompt, draft(prompt, ["must:0", "card:0"]), false)).toMatchObject({
      instruction: "", counter: "Level 7 / 7", met: true, remaining: null,
    });
    expect(pickCopy(prompt, draft(prompt), false).counter).toBe("Level 3 / 7");
  });

  it("keeps alternative engine contributions explicit instead of inventing one total", () => {
    expect(pickCopy(prompt, draft(prompt, ["must:0", "card:1"]), false)).toMatchObject({
      instruction: "", counter: "Level 3 + (2/4) / 7", met: true,
    });
    expect(canConfirm(prompt, draft(prompt, ["must:0", "card:1"]))).toBe(true);
  });

  it("requires an achievable exact sum, including the mandatory Tuner", () => {
    expect(canConfirm(prompt, draft(prompt, ["must:0"]))).toBe(false);
    expect(canConfirm(prompt, draft(prompt, ["card:0"]))).toBe(false);
    expect(canConfirm(prompt, draft(prompt, ["must:0", "card:0", "card:1"]))).toBe(false);
  });
});
