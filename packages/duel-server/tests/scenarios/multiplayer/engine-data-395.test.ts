import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { activate, defineScenario, expectBoard, expectNotOffered, expectOffered, select, type DuelistId, type Scenario } from "../../support/dsl.js";
import { runScenarios } from "../../support/runner.js";
import { expect, it } from "vitest";
import { runSmokeCase } from "../../../scripts/lib/new-card-smoke-runner.js";
import { smokeCasesForCard } from "../../../scripts/lib/new-card-smoke-pool.js";
import { engineDataDirectory } from "../../engine-data-dir.js";

const CARD = "Trirealm Rift of Blue Tuonela";
const ELF = "Mystical Elf";
const scenarios: Scenario[] = [];
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  for (const domain of [false, true]) for (const qualifies of [false, true]) {
    const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" as const } : {}) };
    const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
    for (const seat of seats) setup[seat] = {
      hand: seat === "p0" ? [CARD] : [],
      // Tag ties 1+2 against 2+1, or compares 2+0 against 2+1.
      // A per-player comparison would give the wrong answer in both cases.
      monsters: Array(format === "tag"
        ? ({ p0: qualifies ? 2 : 1, p1: 2, p2: qualifies ? 0 : 2, p3: 1 }[seat])
        : qualifies && seat === "p2" ? 2 : 1).fill(ELF),
      ...(domain ? { deckMaster: "Blue-Eyes White Dragon" } : {}),
    };
    scenarios.push(defineScenario({
      id: `engine-data-395-tuonela-${format}-${domain ? "domain" : "standard"}-${qualifies ? "one-qualifies" : "equal-fields"}`,
      title: "Tuonela needs one larger opponent field in FFA and compares joined teams in Tag",
      source: "ADR-0002 R-FFA-OPP-ONE and R-TAG-SHARED-CARDS",
      rules: ["R-FFA-OPP-ONE", "R-TAG-SHARED-CARDS"],
      tags: ["multiplayer", "card:100458033"], setup,
      steps: [qualifies ? expectOffered("activate", CARD, "p0") : expectNotOffered("activate", CARD, "p0")],
    }));
  }
}
for (const format of ["ffa3", "ffa4", "tag"] as const) for (const domain of [false, true]) {
  const setup: Scenario["setup"] = { format, ...(domain ? { mode: "domain" as const } : {}) };
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  for (const seat of seats) setup[seat] = {
    hand: seat === "p0" ? ['Spell Card "Enemy Controller"'] : [],
    spells: seat === "p0" ? [{ card: "Crackdown", pos: "set" }] : [],
    monsters: seat === "p1" ? ["Blue-Eyes White Dragon", "Blue-Eyes White Dragon"] : [],
    ...(domain ? { deckMaster: ELF } : {}),
  };
  scenarios.push(defineScenario({
    id: `engine-data-395-controller-${format}-${domain ? "domain" : "standard"}`,
    title: "Enemy Controller destroys a target that changes control in the chain",
    source: "Card text; ADR-0002 R-FFA-OPP-ONE and R-TAG-PARTNER",
    rules: ["R-FFA-OPP-ONE", "R-TAG-PARTNER"], tags: ["multiplayer", "card:100459024"], setup,
    steps: [activate('Spell Card "Enemy Controller"', "p0"),
      select({ card: "Blue-Eyes White Dragon", owner: "p1", nth: 0 }),
      activate("Crackdown", "p0"),
      select({ card: "Blue-Eyes White Dragon", owner: "p1", nth: 0 }),
      expectBoard({ p0: { monsters: [] }, p1: { monsters: ["Blue-Eyes White Dragon"], grave: ["Blue-Eyes White Dragon"] } })],
  }));
}
describeWithCores("PR 395 multiplayer card review", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/engine-data-395", scenarios);
  for (const [code, id, seed] of [
    [57809669, "normal/ffa3/deck", 3874076181],
    [73443672, "normal/ffa3/hand", 1861901732],
  ] as const) it(`replays ${code} ${id} after target loss or FFA elimination`, async () => {
    const test = smokeCasesForCard(code, engineDataDirectory, ["ffa3"]).find(test => test.id === id)!;
    const result = await runSmokeCase({ ...test, seed }, engineDataDirectory);
    expect(result.failure).toBeUndefined();
    expect(result.replayed).toBe(true);
  });
  it("checks terminal FFA projections and replays an Exodia win", async () => {
    const test = smokeCasesForCard(33396948, engineDataDirectory, ["ffa3"])
      .find(test => test.id === "domain/ffa3/deck")!;
    test.board.p0!.deck![0] = "Exodia the Forbidden One";
    test.board.p0!.hand = ["Left Arm of the Forbidden One", "Right Arm of the Forbidden One",
      "Left Leg of the Forbidden One", "Right Leg of the Forbidden One"];
    const result = await runSmokeCase(test, engineDataDirectory);
    expect(result.failure).toBeUndefined();
    expect(result.replayed).toBe(true);
  });
});
