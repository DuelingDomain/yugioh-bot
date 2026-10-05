/**
 * Replay one fuzz duel and print what happened.
 *
 *   npx tsx scripts/fuzz-repro.ts --seed 10 --mode domain --master-rule 5 --max-steps 9
 *   npx tsx scripts/fuzz-repro.ts --file tests/fuzz/failures/engine-throw-seed10-domain.json
 *
 * Add --trace to print every prompt and answer.
 *
 * A differential failure file (tests/differential/failures/<mode>-<seed>.json) has a journal and the
 * engine options. --file replays that journal instead of playing the seed again:
 *
 *   npx tsx scripts/fuzz-repro.ts --file tests/differential/failures/long-123.json --wasm domain-core/dist/ocgcore.multi.sync.wasm
 *
 * --wasm <path> runs the duel on that core (Standard or Domain, like the file's mode). Without it the
 * core of the engine data directory is used, as before. --wasm only works with a differential file.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Scenario } from "../tests/fuzz/config.js";
import { engineDataDirectory } from "../tests/fuzz/config.js";
import { describeFailure } from "../tests/fuzz/failures.js";
import { runDuel } from "../tests/fuzz/driver.js";
import { runAndVerify } from "../tests/fuzz/run-one.js";
import type { DuelMasterRule, DuelMode } from "@yugidraft/shared/duels";
import { createEngineGame, registerDomainCoreFactory } from "../src/engine.js";
import { applyJournaledCommand, isPromptlessCommand } from "../src/journal-command.js";
import { createDomainCore } from "../src/domain-core.js";
import { readViews } from "../tests/fuzz/driver.js";
import { viewsHash } from "../tests/fuzz/invariants.js";
import { savedFuzzFirstTurnDraw } from "./lib/fuzz-draw-rule.js";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface DifferentialFile {
  scenario: Scenario;
  journal: Array<{ seat: number; promptId: string; revision: number; answer: never }>;
  engine?: Parameters<typeof createEngineGame>[0] extends infer O ? Omit<O & object, "dataDirectory" | "standardWasmBinary"> : never;
  differential?: { firstDifference?: string; referenceWasm?: string; multiWasm?: string; found?: string };
}

/** Replay a saved differential journal. The tests freeze the clock the same way. */
async function replayDifferentialFile(saved: DifferentialFile, dataDirectory: string, wasmPath: string | undefined): Promise<void> {
  const d = saved.differential;
  if (d) {
    console.log(`differential ${d.found ?? ""}: reference ${d.referenceWasm}, multi ${d.multiWasm}`);
    if (d.firstDifference) console.log(d.firstDifference);
  }
  const bytes = wasmPath ? readFileSync(resolve(wasmPath)) : null;
  const wasm = bytes ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : undefined;
  console.log(`replaying ${saved.journal.length} answers on ${wasmPath ? resolve(wasmPath) : "the core of the data directory"}`);
  // Lua seeds from time(NULL). The differential tests freeze Date.now, so do the same here.
  const realNow = Date.now;
  Date.now = () => Date.UTC(2026, 0, 1);
  try {
    if (wasm) registerDomainCoreFactory((ctx) => createDomainCore({ ...ctx, wasmBinary: new Uint8Array(wasm) }));
    const engine = saved.engine!;
    const firstTurnDraw = savedFuzzFirstTurnDraw(engine.firstTurnDraw, engine.mode, engine.masterRule, engine.format);
    const game = await createEngineGame({ ...engine, firstTurnDraw, dataDirectory, ...(wasm ? { standardWasmBinary: wasm } : {}) } as Parameters<typeof createEngineGame>[0]);
    try {
      for (const [i, command] of saved.journal.entries()) {
        const view = game.view(command.seat);
        if (view.revision !== command.revision) throw new Error(`journal entry ${i}: revision ${view.revision}, journal ${command.revision}`);
        if (!isPromptlessCommand(command.promptId) && view.prompt?.id !== command.promptId) throw new Error(`journal entry ${i}: prompt ${view.prompt?.id ?? "none"}, journal ${command.promptId}`);
        if (process.argv.includes("--trace")) console.log(`  ${i}: seat ${command.seat} ${command.promptId} ${JSON.stringify(command.answer)}`);
        applyJournaledCommand(game, command.seat, command);
      }
      const views = readViews(game);
      console.log(`replay done: turn ${views.v0.turn}, result ${JSON.stringify(views.v0.result)}, final views hash ${viewsHash(views)}`);
    } finally {
      game.close();
    }
  } finally {
    Date.now = realNow;
  }
}

let scenario: Scenario;
let firstTurnDraw: boolean | undefined;
const file = arg("file");
const wasmArg = arg("wasm");
if (file) {
  const saved = JSON.parse(readFileSync(file, "utf8")) as DifferentialFile;
  if (saved.engine && Array.isArray(saved.journal) && saved.differential) {
    try {
      await replayDifferentialFile(saved, engineDataDirectory(), wasmArg);
    } catch (error) {
      console.log(`replay failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
    process.exit(0);
  }
  scenario = saved.scenario;
  firstTurnDraw = savedFuzzFirstTurnDraw(saved.engine?.firstTurnDraw, scenario.mode, scenario.masterRule);
} else {
  const seed = Number(arg("seed"));
  if (!Number.isInteger(seed)) throw new Error("Give --seed N or --file path");
  scenario = {
    seed,
    mode: (arg("mode") ?? "normal") as DuelMode,
    masterRule: Number(arg("master-rule") ?? 5) as DuelMasterRule,
    maxSteps: Number(arg("max-steps") ?? 2000),
  };
}
if (wasmArg) throw new Error("--wasm needs --file with a differential failure file (tests/differential/failures/*.json)");
if (arg("max-steps")) scenario = { ...scenario, maxSteps: Number(arg("max-steps")) };

const dataDirectory = engineDataDirectory();
console.log(`scenario ${JSON.stringify(scenario)} data ${dataDirectory}`);
const outcome = process.argv.includes("--no-replay")
  ? await runDuel(scenario, dataDirectory, { firstTurnDraw })
  : await runAndVerify(scenario, dataDirectory, 1, { firstTurnDraw });
console.log(`decks: main ${outcome.decks.map((d) => d.main.length).join("/")}, extra ${outcome.decks.map((d) => d.extra.length).join("/")}, ${outcome.deckNotes.join(" | ")}, disjoint ${outcome.disjoint}`);
console.log(`steps ${outcome.steps}, turns ${outcome.turns}, ended ${outcome.ended}, result ${JSON.stringify(outcome.result)}, soft rejections ${outcome.softRejections}, final views hash ${outcome.finalHash}`);
if (process.argv.includes("--trace")) for (const [i, e] of outcome.journal.entries()) console.log(`  ${i}: seat ${e.seat} ${e.promptId} ${JSON.stringify(e.answer)}`);
if (outcome.failure) {
  console.log(describeFailure(outcome, dataDirectory));
  const violations = (outcome.failure.detail as { violations?: Array<{ message: string; detail?: unknown }> } | undefined)?.violations;
  for (const v of violations ?? []) console.log(`  - ${v.message} ${JSON.stringify(v.detail ?? "").slice(0, 400)}`);
  process.exit(1);
}
console.log("no failure");
