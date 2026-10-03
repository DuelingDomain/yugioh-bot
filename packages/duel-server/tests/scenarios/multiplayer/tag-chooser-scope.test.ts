import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickOptions, expectPrompt, pickOpponent, select, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";

const trapPath=process.env.CORE_SCOPE_TRAP_WASM ?? "";
const trapCore=needs.file("Tag chooser trap core",trapPath,"Set CORE_SCOPE_TRAP_WASM to a YGO_N_TRAP build.");
if(trapCore.ok) trapCore.ok=readFileSync(trapPath).includes(Buffer.from("NFOLD %c"));

const cards = ["Giant Rat", "Dark Magician", "Summoned Skull", "Blue-Eyes White Dragon"];
const seatId = (seat: number) => `p${seat}` as DuelistId;

// Tag uses one card from each team. The chosen cards keep their real controller seats.
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`Tag chooser scope (${mode})`, mode === "domain" ? [liveNseat, trapCore, ...needs.domainMulti()] : [liveNseat,trapCore], () => {
    for (let actor = 0; actor < 4; actor++) {
      const opponents = [0, 1, 2, 3].filter((seat) => seat % 2 !== actor % 2);
      for (const chooser of opponents) {
        for (const fromPartner of [false, true]) {
          it(`p${actor} chooses ${fromPartner ? "a partner card" : "an own card"}; p${chooser} chooses a partner card`, async () => {
            const own = fromPartner ? (actor + 2) % 4 : actor;
            const other = (chooser + 2) % 4;
            const setup: Scenario["setup"] = { format: "tag", mode };
            for (let seat = 0; seat < 4; seat++) {
              setup[seatId(seat)] = { monsters: [cards[seat]!, "Mystical Elf"], ...(seat === actor ? { hand: ["Creature Swap"] } : {}), ...(mode === "domain" ? { deckMaster: "Mystical Elf" } : {}) };
            }
            const steps: Step[] = [];
            for (let seat = 0; seat < actor; seat++) steps.push(endTurn(seatId(seat)));
            const ownOptions = [0, 1, 2, 3].filter((seat) => seat % 2 === actor % 2).flatMap((seat) => [{ seat: seatId(seat), card: cards[seat]! }, { seat: seatId(seat), card: "Mystical Elf" }]);
            const otherOptions = opponents.flatMap((seat) => [{ seat: seatId(seat), card: cards[seat]! }, { seat: seatId(seat), card: "Mystical Elf" }]);
            steps.push(
              activate("Creature Swap", seatId(actor)),
              expectPrompt({ by: seatId(actor), kind: "cards" }),
              expectPickOptions(ownOptions, seatId(actor)),
              select({ card: cards[own]!, owner: seatId(own) }),
              expectPrompt({ by: seatId(actor), kind: "choice" }),
              expectPickOptions(opponents.map((seat) => ({ seat: seatId(seat) })), seatId(actor)),
              pickOpponent(seatId(chooser), seatId(actor)),
              expectPrompt({ by: seatId(chooser), kind: "cards" }),
              expectPickOptions(otherOptions, seatId(chooser)),
              select({ card: cards[other]!, owner: seatId(other) }),
            );
            const board: Parameters<typeof expectBoard>[0] = {};
            for (let seat = 0; seat < 4; seat++) {
              const received = seat === own ? cards[other]! : seat === other ? cards[own]! : cards[seat]!;
              board[seatId(seat)] = { monsters: [received, "Mystical Elf"], spells: [], grave: seat === actor ? ["Creature Swap"] : [], banished: [], lp: 16000, ...(mode === "domain" ? { deckMaster: { inZone: true } } : {}) };
            }
            steps.push(expectBoard(board));
            const scenario = defineScenario({ id: `tag-chooser-scope-${mode}-${actor}-${chooser}-${own}`, title: "Tag chooses one card from each team and swaps the two controller seats", source: "ADR-0002 [R-TAG-SHARED-CARDS]; owner decisions Q5 and Q7", rules: ["R-TAG-SHARED-CARDS","R-TAG-PARTNER"], tags: ["multiplayer", "tag", "card:31036355"], setup, steps });
            const compiled = compileBoard(setup);
            const wasm = mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary();
            expect(Buffer.from(new Uint8Array(wasm ?? new ArrayBuffer(0))).includes(Buffer.from("NFOLD %c")), "The loaded core must emit fold traps").toBe(true);
            const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: wasm, seed: ["1", "2", "3", "4"] });
            try {
              const session = new Session(scenario, game);
              session.reachMainPhase();
              session.startRecording();
              steps.forEach((step, index) => {
                session.run(step, index + 1);
              });
              const diagnostics = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => entry.detail);
              expect(diagnostics.filter((line) => /^NFOLD [UcW] |YGO_N_TRAP/.test(line))).toEqual([]);
            } finally {
              game.close();
            }
          });
        }
      }
    }
  });
}
