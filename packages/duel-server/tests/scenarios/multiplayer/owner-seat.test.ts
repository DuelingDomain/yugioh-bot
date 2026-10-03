import { createSeatProofData, applySeatProofDrawRule } from "./seat-proof-data.js";
import { afterAll, expect, it } from "vitest";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { resolveCard } from "../../support/card-catalog.js";
import { Session, nseatWasmBinary } from "../../support/session.js";
import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { currentEngineDataDirectory } from "../../engine-data-dir.js";
import { expectLog, expectNoLog } from "../../support/dsl.js";
import { OWNER_SEAT_PROOFS } from "./owner-seat.js";

const seatProofData = createSeatProofData();
afterAll(seatProofData.cleanup);

describeWithCores("owner seat proofs", liveNseat, () => {
  for (const proof of OWNER_SEAT_PROOFS) it(proof.scenario.id, async () => {
    const scenario = structuredClone(proof.scenario);
    if (process.env.SEAT_PROOF_DOMAIN === "1") {
      scenario.setup.mode = "domain";
      for (const seat of ["p0","p1","p2","p3"] as const) if (scenario.setup[seat]) scenario.setup[seat]!.deckMaster = "Blue-Eyes White Dragon";
      for (const step of scenario.steps) if (step.op === "expectBoard") for (const board of Object.values(step.board)) if (board) board.deckMaster = { inZone:true, returns:0, nextCost:0 };
    }
    applySeatProofDrawRule(scenario);
    const compiled = compileBoard(scenario.setup);
    if (proof.exactDecks) {
      for (const [index, seat] of ["p0", "p1", "p2", "p3"].entries()) {
        const cards = scenario.setup[seat as "p0" | "p1" | "p2" | "p3"]!.deck!;
        compiled.options.decks![index].main = cards.map(card => resolveCard(card, currentEngineDataDirectory()));
      }
    }
    const code = proof.watch ? resolveCard(proof.watch, currentEngineDataDirectory()) : 0;
    if (proof.stolen) {
      const stolenCode = resolveCard(proof.stolen.card, currentEngineDataDirectory());
      const original = `Debug.AddCard(${stolenCode},${proof.stolen.controller},${proof.stolen.controller},`;
      compiled.options.startupScripts![0].content = compiled.options.startupScripts![0].content.replace(original, `Debug.AddCard(${stolenCode},${proof.stolen.owner},${proof.stolen.controller},`);
      expect(compiled.options.startupScripts![0].content).not.toContain(original);
      compiled.options.startupScripts![0].content += `
      do local c=Duel.GetFieldGroup(${proof.stolen.controller},LOCATION_MZONE,0):Filter(Card.IsCode,nil,${stolenCode}):GetFirst()
        local control=Effect.CreateEffect(c)
        control:SetType(EFFECT_TYPE_SINGLE)
        control:SetCode(EFFECT_SET_CONTROL)
        control:SetValue(${proof.stolen.controller})
        c:RegisterEffect(control)
      end`;

    }
    if (proof.watch) {
      compiled.options.startupScripts![0].content += `
      do local check=Effect.GlobalEffect()
        check:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        check:SetCode(EVENT_SPSUMMON_SUCCESS)
        check:SetOperation(function(e,tp,eg)
          for c in eg:Iter() do
            if c:IsCode(${code}) and Duel.MPSeatOf(c)==${proof.target} then
              if c:GetSummonPlayer()~=${proof.actor} then
                error('WRONG_SEAT_ACTOR '..c:GetSummonPlayer()..' expected ${proof.actor}')
              else Duel.Hint(HINT_MESSAGE,0,65535) end
            end
          end
        end)
        Duel.RegisterEffect(check,0)
      end`;
    }
    const game = await createEngineGame({ ...compiled.options, dataDirectory: seatProofData.directory, multiScriptsDirectory: process.env.SEAT_PROBE_OVERLAY, multiWasmBinary: nseatWasmBinary(), seed: ["1","2","3","4"] });
    try {
      const session = new Session(scenario,game);
      session.reachMainPhase(); session.startRecording();
      scenario.steps.forEach((step,index) => session.run(step,index+1));
      if (proof.watch) {
        session.run(expectNoLog('WRONG_SEAT_ACTOR'),scenario.steps.length+1);
        session.run(expectLog('SEAT_PROOF_ACTOR_OK'),scenario.steps.length+2);
        session.run(expectLog(`Special Summons ${proof.watch}`),scenario.steps.length+2);
      }
      for (const seat of proof.banish ?? []) {
        expect(game.view(0).events.filter(e => e.kind === "move" && e.reason === "banish" && e.card?.code === 5053103 && e.seat === seat)).toHaveLength(1);
        expect(game.view(0).events.filter(e => e.kind === "move" && e.reason === "summon" && e.card?.code === 5053103 && e.seat === seat)).toHaveLength(1);
      }
    } finally { if (process.env.SEAT_PROBE_OVERLAY) console.log(game.diagnostics().map(d => d.detail).filter(d => d.includes("HECA_")).join("\n")); game.close(); }
  });
});
