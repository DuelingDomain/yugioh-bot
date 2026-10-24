import { describe, expect, it } from "vitest";
import { parseSandboxBoard } from "@yugidraft/shared/duels";
import { compileBoard } from "../src/presets/board.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

describe("sandbox compiler start options", () => {
  it("draws on the first turn for the default parsed sandbox", () => {
    const compiled = compileBoard(parseSandboxBoard({}), DATA);
    expect(compiled.options.firstTurnDraw).toBe(true);
    expect(compiled.options.startupScripts![0].content).not.toContain("EFFECT_SKIP_DP");
    expect(compiled.options.settings).toMatchObject({ startingHand: 0, shuffleDeck: false, stopAtEveryWindow: true });
  });

  it("keeps skipOpeningDraw as a compiler option", () => {
    const compiled = compileBoard({ startAt: "draw", skipOpeningDraw: true, turn: "p1" }, DATA);
    expect(compiled.options.firstTurnDraw).toBe(false);
    expect(compiled.options.startupScripts![0].content).toContain("EFFECT_SKIP_DP");
  });

  it("leaves the normal first-turn draw rule to existing preset callers", () => {
    expect(compileBoard({}, DATA).options.firstTurnDraw).toBeUndefined();
  });

  it("does not skip Draw Phase when another sandbox seat starts", () => {
    expect(compileBoard(parseSandboxBoard({ turn: "p1" }), DATA).options.startupScripts![0].content).not.toContain("EFFECT_SKIP_DP");
  });

  it("keeps the captured-board draw behavior of existing p1 presets", () => {
    expect(compileBoard({ turn: "p1" }, DATA).options.startupScripts![0].content).toContain("EFFECT_SKIP_DP");
    expect(compileBoard({ turn: "p1", skipOpeningDraw: false }, DATA).options.startupScripts![0].content).not.toContain("EFFECT_SKIP_DP");
  });
});
