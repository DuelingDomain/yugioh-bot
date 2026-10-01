/**
 * Load a fuzz failure JSON (`tests/fuzz/failures/*.json`) or a browser duel journal
 * (`duel-journal-<slug>.json`, format "yugidraft-duel-journal/1") and replay it to answer N.
 * Same paths as `scripts/fuzz-repro.ts` (seed and decks) and `scripts/replay-journal.ts` (journal), which run at import time
 * and so cannot be imported.
 */
import { existsSync, readFileSync } from "node:fs";
import { parseJournalText } from "./journal-file.js";
import { resolve } from "node:path";
import { legacyDuelSettings, normalizeDuelSettings, type DuelAnswer, type DuelDeck, type DuelEngineView, type DuelFormat, type DuelMasterRule, type DuelMode, type DuelSettings } from "@yugidraft/shared/duels";
import { createDomainCore } from "../../src/domain-core.js";
import { createEngineGame, eliminationCodeOf, registerDomainCoreFactory } from "../../src/engine.js";
import { engineSeed } from "../../tests/fuzz/rng.js";

export interface SourceCommand {
  seat: number;
  promptId: string;
  revision: number;
  answer: DuelAnswer;
}

export interface DuelSource {
  kind: "fuzz" | "journal";
  label: string;
  mode: DuelMode;
  masterRule: DuelMasterRule;
  decks: DuelDeck[];
  seed: string[];
  settings?: DuelSettings;
  /** Only a differential file of the scenarios mode has these (Layer 1 board scripts). */
  startupScripts?: Array<{ name: string; content: string }>;
  format?: DuelFormat;
  /** The core the file was recorded or found on (differential file): the multi core, or the reference core for a harness self-check. */
  wasmPath?: string;
  commands: SourceCommand[];
  /** The step a fuzz failure was found at. */
  failureStep?: number;
}

export function loadSource(file: string): DuelSource {
  const json = parseJournalText(readFileSync(file, "utf8"));
  if (json.format === "yugidraft-duel-journal/1") {
    if (!json.seed) throw new Error("The journal has no seed: the duel never started");
    if ((json.decks as unknown[]).some((deck) => !deck)) throw new Error("The journal has an empty deck");
    return {
      kind: "journal",
      label: json.slug ?? file,
      mode: json.mode,
      masterRule: json.masterRule,
      decks: json.decks,
      seed: json.seed,
      settings: json.settings == null ? legacyDuelSettings() : normalizeDuelSettings(json.mode, json.settings),
      ...(Array.isArray(json.startupScripts) && json.startupScripts.length > 0
        ? { startupScripts: json.startupScripts as Array<{ name: string; content: string }> }
        : Array.isArray(json.setup?.startupScripts) && json.setup.startupScripts.length > 0
          ? { startupScripts: (json.setup.startupScripts as string[]).map((content, index) => ({ name: `startup-${index}.lua`, content })) }
          : {}),
      commands: (json.commands as Array<{ seat: number; command: Omit<SourceCommand, "seat"> }>).map(({ seat, command }) => ({ seat, ...command })),
    };
  }
  if (json.scenario && Array.isArray(json.journal) && Array.isArray(json.decks)) {
    const scenario = json.scenario as { seed: number; mode: DuelMode; masterRule: DuelMasterRule };
    // A differential file has an `engine` block: the exact options of the run (board decks, seed, settings, scripts).
    // Without it (old files and plain fuzz files) the duel is rebuilt from the scenario seed.
    const engine = json.engine as
      | { mode?: DuelMode; masterRule?: DuelMasterRule; decks?: DuelDeck[]; seed?: string[]; settings?: DuelSettings; startupScripts?: Array<{ name: string; content: string }>; format?: DuelFormat }
      | undefined;
    const differential = json.differential as { mode?: string; seed?: number; scenarioId?: string; found?: string; multiWasm?: string; referenceWasm?: string } | undefined;
    const wasmPath = differential ? (differential.found === "reference-self-check" ? differential.referenceWasm : differential.multiWasm) : undefined;
    return {
      kind: "fuzz",
      label: differential
        ? `differential ${differential.mode ?? ""} seed ${differential.seed ?? scenario.seed}${differential.scenarioId ? ` ${differential.scenarioId}` : ""}`
        : `fuzz seed ${scenario.seed} ${scenario.mode} MR${scenario.masterRule}`,
      mode: engine?.mode ?? scenario.mode,
      masterRule: engine?.masterRule ?? scenario.masterRule,
      decks: engine?.decks ?? json.decks,
      seed: engine?.seed ?? engineSeed(scenario.seed),
      ...(engine?.settings ? { settings: engine.settings } : {}),
      ...(engine?.startupScripts ? { startupScripts: engine.startupScripts } : {}),
      ...(engine?.format ? { format: engine.format } : {}),
      ...(wasmPath ? { wasmPath } : {}),
      commands: json.journal,
      failureStep: json.failure?.step,
    };
  }
  throw new Error(`${file} is neither a fuzz failure (scenario, journal, decks) nor a duel journal (format yugidraft-duel-journal/1)`);
}

export interface ReplayedViews {
  /** Answers applied. */
  step: number;
  seats: [DuelEngineView, DuelEngineView];
  spectator: DuelEngineView;
}

function read(game: { view(seat: number | null): DuelEngineView }, step: number): ReplayedViews {
  return { step, seats: [game.view(0), game.view(1)], spectator: game.view(null) };
}

/**
 * Replay the first `step` answers. `visit` runs at every step (0 = opening) and returns true to stop early there.
 * Checks revision and prompt id like the duel host does, so a bundle mismatch is reported instead of giving a wrong board.
 */
export async function replaySource(
  source: DuelSource,
  dataDirectory: string,
  step: number,
  visit?: (views: ReplayedViews) => boolean,
  options: { wasmPath?: string } = {},
): Promise<ReplayedViews> {
  if (step < 0 || step > source.commands.length) throw new Error(`--step ${step} is outside 0..${source.commands.length} (the source has ${source.commands.length} answers)`);
  // A file with a recorded core replays on it when the core file exists here (`options.wasmPath` wins). Otherwise the
  // core of the data directory is used. The differential tests freeze Date.now (Lua seeds from time), so do the same.
  const wasmPath = options.wasmPath ?? source.wasmPath;
  const wasmFile = wasmPath && existsSync(resolve(wasmPath)) ? resolve(wasmPath) : null;
  if (options.wasmPath && !wasmFile) throw new Error(`The wasm file ${options.wasmPath} does not exist`);
  const bytes = wasmFile ? readFileSync(wasmFile) : null;
  const wasm = bytes ? (bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer) : undefined;
  const realNow = Date.now;
  if (wasm) {
    Date.now = () => Date.UTC(2026, 0, 1);
    registerDomainCoreFactory((ctx) => createDomainCore({ ...ctx, wasmBinary: new Uint8Array(wasm) }));
  }
  const restore = () => {
    if (!wasm) return;
    Date.now = realNow;
    registerDomainCoreFactory(createDomainCore);
  };
  const multiSeats = source.format !== undefined && source.format !== "1v1";
  let game: Awaited<ReturnType<typeof createEngineGame>>;
  try {
    game = await createEngineGame({
      mode: source.mode,
      masterRule: source.masterRule,
      decks: source.decks,
      seed: source.seed,
      dataDirectory,
      ...(source.settings ? { settings: source.settings } : {}),
      ...(source.startupScripts ? { startupScripts: source.startupScripts } : {}),
      ...(source.format ? { format: source.format } : {}),
      ...(wasm ? (multiSeats ? { multiWasmBinary: wasm } : { standardWasmBinary: wasm }) : {}),
    });
  } catch (error) {
    restore();
    throw error;
  }
  try {
    let done = 0;
    if (visit?.(read(game, 0))) return read(game, 0);
    for (; done < step; done++) {
      const command = source.commands[done]!;
      const view = game.view(command.seat);
      const elimination = eliminationCodeOf(command.promptId);
      if (view.revision !== command.revision || (elimination === null && view.prompt?.id !== command.promptId)) {
        throw new Error(
          `answer ${done}: the journal has revision ${command.revision} prompt ${command.promptId}; the engine has revision ${view.revision} prompt ${view.prompt?.id ?? "none"}. The engine data differs from the recorded run.`,
        );
      }
      if (elimination === null) game.answer(command.seat, command.promptId, command.answer);
      else game.eliminate(command.seat, elimination);
      if (visit?.(read(game, done + 1))) return read(game, done + 1);
    }
    return read(game, done);
  } finally {
    game.close();
    restore();
  }
}
