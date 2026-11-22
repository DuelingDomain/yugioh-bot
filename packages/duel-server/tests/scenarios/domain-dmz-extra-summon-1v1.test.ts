// Issue #654: an additional Normal Summon/Set count (Madolche Salon, Gem-Knight Seraphinite) also covers a main deck Deck Master in the
// DMZ [Domain Format rulebook v1.4: the Deck Master leaves the DMZ by Normal Summon or Set, "from the hand" is ignored]. The multiplayer
// case is in multiplayer/domain-ffa4-deck-master.ts. This file runs the same rule on the two 1v1 Domain cores: the frozen legacy core
// (production default, DUEL_1V1_ENGINE=legacy) and the pinned core.
import { join } from "node:path";
import { expect, it } from "vitest";
import { createEngineGame } from "../../src/engine.js";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { engineDataDirectory as DATA } from "../engine-data-dir.js";
import { compileBoard } from "../support/board.js";
import { describeWithCores, needs } from "../support/cores.js";
import { Session } from "../support/session.js";
import { choose, defineScenario, expectBoard, expectOffered, normalSummon, setCard } from "../support/dsl.js";

const SOURCE = "https://github.com/DuelingDomain/yugioh-bot/issues/654";
const scenarios = [
  defineScenario({
    id: "domain-1v1-madolche-salon-normal-summon-deck-master",
    title: "Madolche Salon: after its Normal Summon, p0 Normal Summons its Madolche Deck Master from the DMZ",
    source: SOURCE,
    tags: ["regression", "domain", "deck-master", "summon", "card:71348837"],
    setup: {
      mode: "domain", format: "1v1", skipOpeningDraw: true,
      p0: { deckMaster: "Madolche Magileine", hand: ["Madolche Anjelly"], spells: ["Madolche Salon"] },
      p1: { deckMaster: "Axe Raider" },
    },
    steps: [
      normalSummon("Madolche Anjelly", "p0"),
      choose("opt:0", "p0"),
      expectOffered("normalSummon", { card: "Madolche Magileine", from: "dmz" }, "p0"),
      normalSummon({ card: "Madolche Magileine", from: "dmz" }, "p0"),
      expectBoard({
        p0: { monsters: ["Madolche Anjelly", "Madolche Magileine"], deckMaster: { inZone: false } },
        p1: { deckMaster: { inZone: true } },
      }),
    ],
  }),
  defineScenario({
    id: "domain-1v1-seraphinite-set-deck-master",
    title: "Gem-Knight Seraphinite: after its Normal Summon, p0 Sets its Deck Master from the DMZ (additional Set count)",
    source: SOURCE,
    tags: ["regression", "domain", "deck-master", "set", "card:3113836"],
    setup: {
      mode: "domain", format: "1v1", skipOpeningDraw: true,
      p0: { deckMaster: "Celtic Guardian", hand: ["Madolche Anjelly"], monsters: ["Gem-Knight Seraphinite"] },
      p1: { deckMaster: "Axe Raider" },
    },
    steps: [
      normalSummon("Madolche Anjelly", "p0"),
      choose("opt:0", "p0"),
      expectOffered("set", { card: "Celtic Guardian", from: "dmz" }, "p0"),
      setCard({ card: "Celtic Guardian", from: "dmz" }, "p0"),
      expectBoard({
        p0: { monsters: ["Gem-Knight Seraphinite", "Madolche Anjelly", "Celtic Guardian"], deckMaster: { inZone: false } },
        p1: { deckMaster: { inZone: true } },
      }),
    ],
  }),
];

const engines = [
  { name: "legacy Domain 1v1", file: "ocgcore.domain.legacy.wasm", create: createLegacyEngineGame },
  { name: "pinned Domain 1v1", file: "ocgcore.domain.wasm", create: createEngineGame },
];

for (const engine of engines) {
  describeWithCores(`Issue 654: Deck Master extra summon count, ${engine.name}`, [needs.cards(DATA), needs.file(engine.name, join(DATA, engine.file))], () => {
    it.each(scenarios)("$id", async scenario => {
      const game = await engine.create({ ...compileBoard(scenario.setup).options, dataDirectory: DATA, seed: ["1", "2", "3", "4"] });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        session.startRecording();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
        expect(game.view(null).events.filter(event => event.kind === "script-error")).toEqual([]);
      } finally { game.close(); }
    });
  });
}
