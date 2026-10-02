import { defineScenario, activate, expectBoard } from "../../support/dsl.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { SOURCE } from "./nseat-scenarios.js";
import { teamOneVariant } from "./team-variants.js";

const base = defineScenario({
  id: "team-variant-tag-hand-count-after-pot-of-greed",
  title: "Tag: Pot of Greed gives p0 two cards; the team 1 variant also counts the draw of turn 2",
  source: `${SOURCE} [R-TAG-ORDER]`,
  rules: ["R-TAG-ORDER"],
  tags: ["multiplayer", "tag", "draw", "card:55144522"],
  setup: { format: "tag", deckSize: 4, p0: { hand: ["Pot of Greed"] } },
  steps: [
    activate("Pot of Greed", "p0"),
    expectBoard({
      p0: { lp: 16000, hand: { count: 2 }, deckCount: 2, monsters: [], spells: [], grave: ["Pot of Greed"], banished: [] },
      p1: { lp: 16000, hand: { count: 0 }, deckCount: 4, monsters: [], spells: [], grave: [], banished: [] },
      p2: { lp: 16000, hand: { count: 0 }, deckCount: 4, monsters: [], spells: [], grave: [], banished: [] },
      p3: { lp: 16000, hand: { count: 0 }, deckCount: 4, monsters: [], spells: [], grave: [], banished: [] },
    }),
  ],
});

describeWithCores("live Tag team variant hand counts", liveNseat, () => {
  runScenarios("multiplayer/team-variants-draw", [base, teamOneVariant(base)]);
});
