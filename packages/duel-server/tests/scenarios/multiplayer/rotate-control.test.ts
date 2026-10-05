import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { multiplayerForbiddenFor } from "../../../src/banlists/multiplayer.js";
import { FILLER_CARD, compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import type { DuelistId } from "../../support/dsl.js";
import { resolveCard } from "../../../src/presets/catalog.js";
import { runScenarios } from "../../support/runner.js";
import { ROTATE_CONTROL_SCENARIOS } from "./rotate-control.js";

it("permits Creature Swap and its aliases at FFA and Tag tables", () => {
  for (const format of ["ffa3", "ffa4", "tag"] as const) {
    expect(multiplayerForbiddenFor(format, 31036355), format).toBeUndefined();
    expect(multiplayerForbiddenFor(format, 99999999, 31036355), format).toBeUndefined();
  }
  for (const code of [15305240, 30426226, 13532663]) {
    expect(multiplayerForbiddenFor("ffa3", code)?.category).toBe("control-swap");
    expect(multiplayerForbiddenFor("ffa4", code)?.category).toBe("control-swap");
  }
});

// Both cores run the real card. Domain cases also keep a Deck Master at every living seat.
for (const mode of ["normal", "domain"] as const) {
  const required = mode === "domain" ? [liveNseat, ...needs.domainMulti()] : liveNseat;
  describeWithCores(`live Creature Swap rotation (${mode})`, required, () => {
    runScenarios(`live Creature Swap rotation (${mode})`, ROTATE_CONTROL_SCENARIOS, async (proof) => {
      const scenario = structuredClone(proof as (typeof ROTATE_CONTROL_SCENARIOS)[number]);
      scenario.setup.mode = mode;
      const count = scenario.setup.format === "ffa3" ? 3 : scenario.setup.format === "1v1" ? 2 : 4;
      for (let seat = 0; seat < count; seat++) {
        const id = `p${seat}` as DuelistId;
        if (mode === "domain") {
          scenario.setup[id] = { ...scenario.setup[id], deckMaster: "Mystical Elf" };
        }
        for (const step of scenario.steps) {
          if (step.op !== "expectBoard") continue;
          const expected = step.board[id];
          if (!expected) throw new Error(`${scenario.id}: final board must check ${id}`);
          expected.spells ??= [];
          expected.banished ??= [];
          expected.lp ??= scenario.setup.format === "tag" ? 16000 : 8000;
          // Only multiplayer Domain draws on turn 1. Standard MR5 and 1v1 Domain skip that draw.
          const drawn = scenario.drawn[id] + (mode === "domain" && scenario.setup.format !== "1v1" && id === "p0" ? 1 : 0);
          if (mode === "domain" && id === "p0" && scenario.id.includes("-serial-spell-") && expected.deckCount !== 0) {
            // Serial Spell discards the Domain first-turn draw with the rest of the hand.
            if (!Array.isArray(expected.grave)) throw new Error(`${scenario.id}: copied rotation needs a complete graveyard`);
            expected.grave.push(FILLER_CARD);
          }
          // The board compiler uses known top cards, then Mystical Elf as Deck filler.
          const hand = (scenario.setup[id]?.hand ?? []).map((entry) =>
            resolveCard(typeof entry === "object" ? entry.card : entry),
          );
          for (let draw = 0; draw < drawn; draw++) {
            hand.push(resolveCard(scenario.setup[id]?.deck?.[draw] ?? FILLER_CARD));
          }
          for (const action of scenario.steps) {
            if ((action.op !== "activate" && action.op !== "specialSummon" && action.op !== "normalSummon") || (action.by ?? "p0") !== id) continue;
            const code = resolveCard(typeof action.sel === "object" ? action.sel.card : action.sel);
            const index = hand.indexOf(code);
            if (index < 0) throw new Error(`${scenario.id}: ${id} uses a card absent from its expected hand`);
            hand.splice(index, 1);
          }
          const expectedHand = expected.deckCount === 0 ? [] : hand;
          if (!Array.isArray(expected.hand)) {
            expected.hand = { ...expected.hand, include: expectedHand, count: expectedHand.length };
          }
          expected.deckCount ??= (scenario.setup.deckSize ?? 20) - drawn;
          expected.extra ??= scenario.setup[id]?.extra ?? [];
          if (mode === "domain") expected.deckMaster = { inZone: expected.deckCount !== 0 };
        }
      }
      const compiled = compileBoard(scenario.setup);
      const game = await createEngineGame({
        ...compiled.options,
        dataDirectory: engineDataDirectory,
        multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
        seed: ["1", "2", "3", "4"],
        startupScripts: [
          ...compiled.options.startupScripts!,
          { name: "rotation-observer.lua", content: scenario.fixture ?? "" },
        ],
      });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        session.startRecording();
        scenario.steps.forEach((step, index) => {
          const leavingDuringRotation = scenario.id.includes("-during-") && step.op === "surrender";
          const chooser = game.view(null).prioritySeat;
          const before = leavingDuringRotation && chooser != null ? game.view(chooser).prompt : null;
          session.run(step, index + 1);
          if (leavingDuringRotation) {
            // Removal waits for card choices, placements and the complete rotation.
            // The host answers only prompts belonging to the departing seat.
            const leaver = Number(step.seat.slice(1));
            expect(game.view(null).seats[leaver]).toMatchObject({ eliminated: false, pendingElimination: true });
            if (before && before.seat !== leaver) expect(game.view(before.seat).prompt).toEqual(before);
          }
        });
        const leavingAnswers = game.diagnostics().filter((entry) => entry.kind === "leaving-answer");
        const leave = scenario.steps.find((step) => step.op === "surrender");
        if (scenario.id.includes("-during-") && leave?.op === "surrender") {
          const cardAnswers = scenario.id.endsWith("during-own-card-choice") ? 1 : 0;
          expect(leavingAnswers).toHaveLength(cardAnswers + 1);
          expect(leavingAnswers.every((entry) => entry.seat === Number(leave.seat.slice(1)))).toBe(true);
          expect(leavingAnswers.filter((entry) => entry.detail.startsWith("cards "))).toHaveLength(cardAnswers);
          expect(leavingAnswers.filter((entry) => entry.detail.startsWith("places "))).toHaveLength(1);
        }
        expect(game.diagnostics().filter((entry) => entry.kind === "stderr")).toEqual([]);
      } finally {
        game.close();
      }
    });
  });
}
