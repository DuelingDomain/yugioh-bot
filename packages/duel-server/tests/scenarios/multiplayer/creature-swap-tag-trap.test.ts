import { appendFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { activate, defineScenario, endTurn, expectBoard, expectPickOptions, expectPrompt, pickOpponent, select, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { liveNseat } from "../../support/live-nseat.js";
import { domainNseatWasmBinary, nseatWasmBinary, Session } from "../../support/session.js";
import { engineDataDirectory } from "../../engine-data-dir.js";

const cards = ["Giant Rat", "Dark Magician", "Summoned Skull", "Blue-Eyes White Dragon"];
const seatId = (seat: number) => `p${seat}` as DuelistId;

// Tag uses one card from each team. The chosen cards keep their real controller seats.
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`Creature Swap Tag trap (${mode})`, mode === "domain" ? [liveNseat, ...needs.domainMulti()] : liveNseat, () => {
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
            const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"] });
            try {
              const session = new Session(scenario, game);
              session.reachMainPhase();
              session.startRecording();
              const trace: unknown[] = [];
              steps.forEach((step, index) => {
                session.run(step, index + 1);
                trace.push({ step, prompts: [0, 1, 2, 3].map((seat) => ({ seat, prompt: game.view(seat).prompt })) });
              });
              const diagnostics = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => entry.detail);
              if (process.env.W17_EVIDENCE) appendFileSync(process.env.W17_EVIDENCE, JSON.stringify({ id: scenario.id, core: game.coreInfo(), trace, diagnostics, final: [0, 1, 2, 3].map((seat) => game.view(seat)) }) + "\n");
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

// An invalid Lua player must still produce a diagnostic on a trap build.
for (const mode of ["normal", "domain"] as const) {
  describeWithCores(`Invalid player trap (${mode})`, mode === "domain" ? [liveNseat, ...needs.domainMulti()] : liveNseat, () => {
    for (const format of ["ffa3", "tag"] as const) {
      it(`${format} keeps trap d for an invalid player`, async () => {
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
        const scenario = defineScenario({ id: `invalid-player-trap-${mode}-${format}`, title: "An invalid player keeps trap d", source: "The fold trap contract", rules: [], tags: ["multiplayer", format], setup, steps });
        const game = await createEngineGame({ ...compiled.options, dataDirectory: engineDataDirectory, multiWasmBinary: mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"], startupScripts: [...compiled.options.startupScripts!, { name: "invalid-player-control.lua", content: fixture }] });
        try {
          const session = new Session(scenario, game);
          session.reachMainPhase();
          steps.forEach((step, index) => session.run(step, index + 1));
          const diagnostics = game.diagnostics().filter((entry) => entry.kind === "stderr").map((entry) => entry.detail);
          if (process.env.W17_EVIDENCE) appendFileSync(process.env.W17_EVIDENCE, JSON.stringify({ id: scenario.id, core: game.coreInfo(), diagnostics }) + "\n");
          expect(diagnostics.some((line) => /^NFOLD d .*fn=Draw/.test(line))).toBe(true);
        } finally {
          game.close();
        }
      });
    }
  });
}
