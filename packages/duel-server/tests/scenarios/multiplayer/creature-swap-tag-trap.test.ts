import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { currentDomainMultiWasm, currentNseatWasm, describeWithCores, needs } from "../../support/cores.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickOptions, expectPrompt, pickOpponent, select, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";

const cards = ["Giant Rat", "Dark Magician", "Summoned Skull", "Blue-Eyes White Dragon"];
const seatId = (seat: number) => `p${seat}` as DuelistId;

// TABLE_TRAP_WASM can select a debug core. Release cores still run all duel checks.
function selectedCorePath(mode: "normal" | "domain"): string {
  return resolve(process.env.TABLE_TRAP_WASM ?? (mode === "domain" ? currentDomainMultiWasm() : currentNseatWasm()));
}

function selectedCore(mode: "normal" | "domain") {
  const bytes = readFileSync(selectedCorePath(mode));
  return {
    wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    // fold_trap has this format string only in a -DYGO_N_TRAP build.
    hasTraps: bytes.includes(Buffer.from("NFOLD %c")),
  };
}

function coreNeeds(mode: "normal" | "domain") {
  const path = selectedCorePath(mode);
  const core = needs.file("Creature Swap multi core", path, "Set TABLE_TRAP_WASM for a -DYGO_N_TRAP build, or NSEAT_WASM / DOMAIN_MULTI_WASM for another core.");
  return [liveNseat, core, ...(mode === "domain" ? needs.domainMulti(engineDataDirectory, path) : [])];
}

// Tag uses one card from each team. The chosen cards keep their real controller seats.
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`Creature Swap Tag trap (${mode})`, coreNeeds(mode), () => {
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
            const scenario = defineScenario({ id: `creature-swap-tag-trap-${mode}-${actor}-${chooser}-${own}`, title: "Tag chooses one card from each team and swaps the two controller seats", source: "ADR-0002 [R-TAG-SHARED-CARDS]; owner decisions Q5 and Q7", rules: [], tags: ["multiplayer", "tag", "card:31036355"], setup, steps });
            const compiled = compileBoard(setup);
            const core = selectedCore(mode);
            const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: core.wasmBinary, seed: ["1", "2", "3", "4"] });
            try {
              const session = new Session(scenario, game);
              session.reachMainPhase();
              steps.forEach((step, index) => session.run(step, index + 1));
              if (core.hasTraps) {
                const diagnostics = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => entry.detail);
                expect(diagnostics.filter((line) => /^NFOLD [UcW] |YGO_N_TRAP/.test(line))).toEqual([]);
              }
            } finally {
              game.close();
            }
          });
        }
      }
    }
  });
}

// An invalid Lua player keeps the board. A trap build must also write trap d.
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`Invalid player trap (${mode})`, coreNeeds(mode), () => {
    for (const format of ["ffa3", "tag"] as const) {
      it(`${format} keeps the board after an invalid player call`, async () => {
        const count = format === "ffa3" ? 3 : 4;
        const setup: Scenario["setup"] = { format, mode };
        const board: Parameters<typeof expectBoard>[0] = {};
        for (let seat = 0; seat < count; seat++) {
          setup[seatId(seat)] = { monsters: [cards[seat]!], ...(mode === "domain" ? { deckMaster: "Mystical Elf" } : {}) };
          board[seatId(seat)] = { monsters: [cards[seat]!], grave: [], spells: [], banished: [] };
        }
        const compiled = compileBoard(setup);
        const fixture = `local c=Duel.GetFieldCard(0,LOCATION_MZONE,0)
local e=Effect.CreateEffect(c)
e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS)
e:SetCode(EVENT_PHASE|PHASE_END)
e:SetCountLimit(1)
e:SetRange(LOCATION_MZONE)
e:SetOperation(function() Duel.Draw(7,1,REASON_EFFECT) end)
c:RegisterEffect(e)`;
        const steps = [endTurn("p0"), expectBoard(board)];
        const scenario = defineScenario({ id: `invalid-player-trap-${mode}-${format}`, title: "An invalid player keeps the board and writes trap d on a trap build", source: "The fold trap contract", rules: [], tags: ["multiplayer", format], setup, steps });
        const core = selectedCore(mode);
        const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: core.wasmBinary, seed: ["1", "2", "3", "4"], startupScripts: [...compiled.options.startupScripts!, { name: "invalid-player-control.lua", content: fixture }] });
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          steps.forEach((step, index) => session.run(step, index + 1));
          if (core.hasTraps) {
            const diagnostics = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => entry.detail);
            expect(diagnostics.some((line) => /^NFOLD d .*fn=Draw/.test(line))).toBe(true);
          }
        } finally {
          game.close();
        }
      });
    }
  });
}
