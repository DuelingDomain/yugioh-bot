import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import createCore, { OcgDuelMode } from "ocgcore-wasm";

it("loads the Sabersaurus suffix in the stock chunk's alternate artwork context", async () => {
  const core = await createCore({ sync: true });
  const errors: string[] = [];
  const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 0 };
  const duel = core.createDuel({
    flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n], team1: team, team2: team,
    cardReader: () => null, scriptReader: () => null,
    errorHandler: (_type, message) => { errors.push(message); },
  });
  if (!duel) throw new Error("Failed to create Lua test duel");
  try {
    const stock = readFileSync(new URL("./fixtures/card-scripts/c3743515.lua", import.meta.url), "utf8");
    const suffix = readFileSync(new URL("../card-script-patches/c3743515.lua", import.meta.url), "utf8");
    const context = "local artwork={}\nfunction GetID() return artwork,3743516 end\nc3743515=nil\n";
    const assertions = "\nassert(s==artwork)\nassert(type(artwork.atkcon)=='function')\nassert(type(artwork.atktg)=='function')\n";
    expect(core.loadScript(duel, "c3743516.lua", context + stock + suffix + assertions), errors.join("\n")).toBe(true);
    expect(errors).toEqual([]);
  } finally { core.destroyDuel(duel); }
});
