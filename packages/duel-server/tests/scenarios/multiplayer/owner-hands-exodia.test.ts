import { expect, it } from "vitest";
import { OcgLocation, OcgMessageType, type OcgMessageConfirmCards } from "ocgcore-wasm";
import { createEngineGame } from "../../../src/engine.js";
import { compileBoard } from "../../support/board.js";
import { engineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { Session, nseatWasmBinary, domainNseatWasmBinary } from "../../support/session.js";
import { OWNER_HANDS_EXODIA_SCENARIOS } from "./owner-hands-exodia.js";
import type { Scenario } from "../../support/dsl.js";
import { fileURLToPath } from "node:url";
// Load the UI source at runtime. Its separate TypeScript project uses browser module resolution.
const { placings } = await import(fileURLToPath(new URL("../../../../web/src/components/duel/table/seat-state.ts", import.meta.url)));

async function run(scenario: Scenario, setupExtra = ""): Promise<void> {
  const confirmations: OcgMessageConfirmCards[] = [];
  const options = compileBoard(scenario.setup).options;
  options.startupScripts![0].content += setupExtra;
  const game = await createEngineGame({ ...options, dataDirectory: engineDataDirectory,
    multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(), seed: ["1", "2", "3", "4"],
    onCoreMessage: message => { if (message.type === OcgMessageType.CONFIRM_CARDS) confirmations.push(message); } });
  try {
    const session = new Session(scenario, game);
    session.reachMainPhase();
    if (setupExtra) {
      const xyz = game.view(0).seats[0].monsters[0];
      expect(xyz?.code).toBe(84013237);
      expect(xyz?.materials?.map(card => card.code)).toEqual([15025844]);
      expect(game.diagnostics().some(entry => entry.kind === "msg202" && entry.detail.includes("1:0x10"))).toBe(true);
    }
    session.startRecording();
    scenario.steps.forEach((step, i) => {
      session.run(step, i + 1);
      if (scenario.tags.includes("prior-loss") && step.op === "expectEliminated" && !game.view(null).result) {
        expect(game.view(null).eliminationOrder).toEqual([[1]]);
      }
    });
    const view = game.view(null);
    if (scenario.id.startsWith("owner-exodia-") && !scenario.id.startsWith("owner-exodia-split-")) {
      expect(view.result).toMatchObject({ victory: "exodia" });
      expect(view.eliminationOrder).toEqual([]);
      expect(placings(view, [[0], [1], [2], [3]])).toEqual([]);
      for (const seat of view.seats) {
        expect(game.view(seat.seat).result).toEqual(view.result);
        expect(game.view(seat.seat).prompt).toBeNull();
      }
      if (scenario.tags.includes("exodia-draw")) {
        expect(view.result?.winnerSeat).toBeNull();
        expect(view.seats.every(seat => !seat.eliminated)).toBe(true);
      }
      const winners = view.seats.filter(seat => game.view(seat.seat).seats[seat.seat].hand.some(card => card.code === 33396948));
      expect(winners.length).toBeGreaterThan(0);
      for (const recipient of view.seats.filter(seat => !(scenario.tags.includes("prior-loss") && seat.seat === 1))) {
        for (const winner of winners.filter(seat => seat.seat !== recipient.seat)) {
          const revealed = confirmations.filter(message => message.player === recipient.seat)
            .flatMap(message => message.cards).filter(card => card.controller === winner.seat).map(card => card.code);
          expect(revealed).toEqual(expect.arrayContaining([33396948, 8124921, 44519536, 70903634, 7902349]));
        }
      }
    } else expect(view.result).toBeNull();
    if (scenario.tags.includes("deck-out")) {
      const lost = scenario.id.includes("deck-out-2") ? [1, 2] : [1];
      expect(view.eliminationOrder).toEqual([lost]);
      const places: Array<{ seat: number; place: number }> = placings(view, view.eliminationOrder);
      expect(places.filter(row => lost.includes(row.seat)).map(row => row.place)).toEqual(lost.map(() => 5 - lost.length));
      for (const seat of lost) {
        const draws = game.view(seat).events.filter(event => event.kind === "move" && event.seat === seat
          && event.from?.location === OcgLocation.DECK && event.zone?.location === OcgLocation.HAND);
        expect(draws).toHaveLength(1);
      }
    }
    if (setupExtra) expect(game.diagnostics().some(entry => entry.kind === "msg202" && entry.detail.includes("1:0x0"))).toBe(true);
  } finally { game.close(); }
}

async function runLossCleanup(domain: boolean): Promise<void> {
  const scenario = structuredClone(OWNER_HANDS_EXODIA_SCENARIOS.find(s => s.id === `owner-hands-deck-out-2-ffa4${domain ? "-domain" : ""}`)!);
  scenario.id += "-foreign-material-and-zone-lock";
  for (const step of scenario.steps) {
    if (step.op === "expectBoard" && Array.isArray(step.board.p0?.grave)) step.board.p0.grave.push("Mystical Elf");
  }
  await run(scenario, `
    -- p1 owns an Xyz monster on living p0's field. Its material belongs to p0.
    local xyz=Debug.AddCard(84013237,1,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
    local control=Effect.CreateEffect(xyz)
    control:SetType(EFFECT_TYPE_SINGLE)
    control:SetCode(EFFECT_SET_CONTROL)
    control:SetValue(0)
    xyz:RegisterEffect(control)
    Debug.AddCard(15025844,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,false)
    -- Removing p1's zone lock also sends a FIELD_DISABLED_N cleanup message.
    local c=Debug.AddCard(15025844,1,1,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
    local e=Effect.CreateEffect(c)
    e:SetType(EFFECT_TYPE_FIELD)
    e:SetCode(EFFECT_DISABLE_FIELD)
    e:SetRange(LOCATION_MZONE)
    e:SetValue(0x10)
    c:RegisterEffect(e)
  `);
}

describeWithCores("owner 2026-10-18: Standard hand and Exodia rules", liveNseat, () => {
  it("keeps simultaneous deck-out places through foreign material and zone-lock cleanup", () => runLossCleanup(false));
  runScenarios("multiplayer/owner-hands-exodia", OWNER_HANDS_EXODIA_SCENARIOS.filter(s => s.setup.mode !== "domain"), run);
});
describeWithCores("owner 2026-10-18: Domain hand and Exodia rules", [liveNseat, ...needs.domainMulti()], () => {
  it("keeps simultaneous deck-out places through foreign material and zone-lock cleanup", () => runLossCleanup(true));
  runScenarios("multiplayer/owner-hands-exodia-domain", OWNER_HANDS_EXODIA_SCENARIOS.filter(s => s.setup.mode === "domain"), run);
});
