import { expect, it } from "vitest";
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEngineGame, type EngineGame } from "../../../src/engine.js";
import { repoMultiScriptsDirectory, resolveMultiScriptsDirectory } from "../../../src/multi-scripts.js";
import { compileBoard } from "../../support/board.js";
import { currentEngineDataDirectory } from "../../engine-data-dir.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { Session, domainNseatWasmBinary, nseatWasmBinary } from "../../support/session.js";
import type { Scenario } from "../../support/dsl.js";
import { LATE_OPPONENT_READ_SCENARIOS, LATE_OPPONENT_DOMAIN_SCENARIOS, LEGACY_PAIR_BEAR_SCENARIOS } from "./late-opponent-read-proof.js";

const SKIP_OPENING_DRAW = `
do local skip=Effect.GlobalEffect(); skip:SetType(EFFECT_TYPE_FIELD); skip:SetCode(EFFECT_SKIP_DP)
skip:SetProperty(EFFECT_FLAG_PLAYER_TARGET); skip:SetTargetRange(1,1); Duel.RegisterEffect(skip,0)
local undo=Effect.GlobalEffect(); undo:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS); undo:SetCode(EVENT_PHASE_START+PHASE_MAIN1)
undo:SetOperation(function(e) skip:Reset() e:Reset() end); Duel.RegisterEffect(undo,0) end`;

async function runProof(scenario: Scenario, legacyPair = false): Promise<void> {
  const compiled = compileBoard(scenario.setup);
  compiled.options.startupScripts![0].content += SKIP_OPENING_DRAW;
  const code = Number(scenario.tags.find(tag => tag.startsWith("card:"))!.slice(5));
  let temporary: string | undefined;
  let game: EngineGame | undefined;
  const traps = new Set<string>();
  const collect = () => {
    for (const entry of game!.diagnostics()) {
      if (entry.kind !== "stderr") continue;
      for (const line of entry.detail.split("\n")) if (/NFOLD |YGO_N_TRAP/.test(line)) traps.add(line.trim());
    }
  };
  try {
    if (legacyPair) {
      temporary = mkdtempSync(join(process.env.LATE_OPPONENT_SCRATCH_DIR ?? tmpdir(), "late-opponent-overlay-"));
      cpSync(resolveMultiScriptsDirectory(currentEngineDataDirectory()) ?? repoMultiScriptsDirectory(), temporary, { recursive: true });
      writeFileSync(join(temporary, "c21501961.lua"), readFileSync(new URL("./fixtures/late-opponent-pair-bear.lua", import.meta.url)));
    }
    game = await createEngineGame({ ...compiled.options, seed: scenario.seed ?? ["1", "2", "3", "4"],
      dataDirectory: currentEngineDataDirectory(),
      multiWasmBinary: scenario.setup.mode === "domain" ? domainNseatWasmBinary() : nseatWasmBinary(),
      ...(temporary ? { multiScriptsDirectory: temporary } : {}),
    });
    const session = new Session(scenario, game);
    session.reachMainPhase(); session.startRecording(); collect();
    scenario.steps.forEach((step, index) => { session.run(step, index + 1); collect(); });
    const unexpected = [...traps].filter(line => new RegExp(`^NFOLD [UcW] card=${code}\\b`).test(line) || line.startsWith("YGO_N_TRAP"));
    expect(unexpected, `${scenario.id}: an opponent read must bind or keep its explicit broad scope`).toEqual([]);
  } finally {
    if (game && process.env.LATE_OPPONENT_TRACE) appendFileSync(process.env.LATE_OPPONENT_TRACE,
      JSON.stringify({ id: scenario.id, legacyPair, traps: [...traps], seats: game.view(0).seats }) + "\n");
    game?.close();
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

describeWithCores("late opponent reads on both real cores", [liveNseat, ...needs.domainMulti()], () => {
  for (const scenario of [...LATE_OPPONENT_READ_SCENARIOS, ...LATE_OPPONENT_DOMAIN_SCENARIOS]) {
    it(scenario.id, () => runProof(scenario));
  }
  for (const scenario of LEGACY_PAIR_BEAR_SCENARIOS) {
    it(scenario.id, () => runProof(scenario, true));
  }
});
