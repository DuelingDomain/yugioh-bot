import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { BATTLE_STEPS, battleStepInfo, battleStepLabel, resolveBattleStep } from "@/components/duel/station-track";

describe("resolveBattleStep", () => {
  it("trusts the engine's battleStep first", () => {
    expect(resolveBattleStep("battle", "damage")).toBe("damage");
    expect(resolveBattleStep("damage", "end")).toBe("end");
  });

  it("reads the step from the raw phase when the view has none", () => {
    expect(resolveBattleStep("battle_start", null)).toBe("start");
    expect(resolveBattleStep("battle_step", undefined)).toBe("battle");
    expect(resolveBattleStep("damage", null)).toBe("damage");
    expect(resolveBattleStep("damage_cal", null)).toBe("damage-calculation");
    expect(resolveBattleStep("Damage calculation", null)).toBe("damage-calculation");
  });

  it("is unknown for a plain Battle Phase and outside battle", () => {
    expect(resolveBattleStep("battle", null)).toBeNull();
    expect(resolveBattleStep("main1", null)).toBeNull();
    expect(resolveBattleStep(null, null)).toBeNull();
  });
});

describe("battle step copy", () => {
  it("names every step and explains what can happen", () => {
    expect(BATTLE_STEPS.map((step) => step.id)).toEqual(["start", "battle", "damage", "damage-calculation", "end"]);
    expect(battleStepLabel("damage")).toBe("Damage Step");
    expect(battleStepLabel("damage-calculation")).toBe("Damage Calculation");
    expect(battleStepLabel(null)).toBeNull();
    expect(battleStepInfo("damage")?.hint).toMatch(/ATK\/DEF|Counter Trap/);
    expect(battleStepInfo("battle")?.hint).toMatch(/Quick Effects/);
  });
});
