/**
 * Replay a duel journal in the engine, the way the duel host recovers a duel (`recover` in src/host.ts).
 * The journal is the JSON that a failed E2E test attaches as `duel-journal-<slug>.json`
 * (format "yugidraft-duel-journal/1": seed, decks, settings and every accepted answer).
 *
 *   npx tsx scripts/replay-journal.ts path/to/duel-journal-<slug>.json
 *   npx tsx scripts/replay-journal.ts <file> --stop-at 12 --views     stop after 12 answers, print the boards
 *   npx tsx scripts/replay-journal.ts <file> --trace                  print every answer
 *   npx tsx scripts/replay-journal.ts <file> --wasm path/to/core.wasm  run on this wasm (standard core for 1v1, the multi-duelist core for 3 or 4 seats)
 *   npx tsx scripts/replay-journal.ts <file> --json                   print ONE JSON object on stdout (logs go to stderr)
 *
 * `--json` prints { ok, failedStep, replayed, total, seatCount, bundleVersion, decks, deckMasters, known, views }.
 * `decks[seat]` are all card codes of that seat's decks. `known["0".."N-1"|"spectator"]` are the numbers of 5 to 10
 * digits that appeared in that viewer's engine view at any step (the codes the viewer may legally hold).
 * `knownStep[viewer][number]` is the first step at which it appeared: 0 before any answer, n after n answers.
 * `views` (only with `--views` too) are the final views of every seat and the spectator. The E2E leak scan (packages/e2e) uses this.
 *
 * Needs the same engine data as the run (DUEL_DATA_DIR, default data/duel-engine-next). A different bundle
 * version is reported, because the replay can then differ from the original duel.
 * Exit code 1 when a step does not match the journal or the engine throws.
 *
 * This is not the fuzz format: `fuzz-repro.ts` rebuilds decks from a seed, and a browser duel has its own decks.
 */
import { readFileSync } from "node:fs";
import { parseJournalText } from "./lib/journal-file.js";
import { join } from "node:path";
import { isDuelFormat, legacyDuelSettings, normalizeDuelSettings, seatCountFor, type DuelAnswer, type DuelDeck, type DuelFormat, type DuelMasterRule, type DuelMode } from "@yugidraft/shared/duels";
import { engineDataDirectory } from "../tests/fuzz/config.js";
import { createEngineGame, eliminationCodeOf } from "../src/engine.js";
import { activeMultiScriptsHash, pinnedEngineVersion } from "../src/multi-scripts.js";

interface JournalFile {
  format?: string;
  slug?: string;
  mode: DuelMode;
  /** Table format (`format` names the file format). A journal made before multi-player formats has none: read from the deck count. */
  tableFormat?: DuelFormat;
  masterRule: DuelMasterRule;
  bundleVersion: string | null;
  /** Hash of the Lua overlay folder (duels with more than two seats). Absent in an older journal. */
  multiScriptsHash?: string | null;
  seed: string[] | null;
  settings: unknown;
  decks: Array<DuelDeck | null>;
  /** Lua chunks that ran before the duel started (presets). A report writes them with names; an E2E journal keeps only the texts in `setup`. */
  startupScripts?: Array<{ name: string; content: string }>;
  setup?: { startupScripts?: string[] } | null;
  wasmSha?: string | null;
  wasmFile?: string | null;
  commands: Array<{ seq?: number; seat: number; command: { promptId: string; revision: number; answer: DuelAnswer } }>;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const asJson = process.argv.includes("--json");
// With --json, stdout holds only the JSON object.
const log = asJson ? (...args: unknown[]) => console.error(...args) : (...args: unknown[]) => console.log(...args);

const file = process.argv[2];
if (!file || file.startsWith("--")) throw new Error("Usage: replay-journal.ts <duel-journal.json> [--stop-at N] [--trace] [--views] [--json] [--wasm FILE] [--data DIR]");
// A JSON object (E2E journal) or JSON lines (host report journal.jsonl).
const journal = parseJournalText(readFileSync(file, "utf8")) as JournalFile;
if (journal.format !== "yugidraft-duel-journal/1") throw new Error(`Unknown journal format ${journal.format ?? "(none)"}`);
if (!journal.seed) throw new Error("The journal has no seed: the duel never started");
if (journal.decks.some((deck) => !deck)) throw new Error("The journal has an empty deck");

const dataDirectory = arg("data") ?? engineDataDirectory();
const manifest = JSON.parse(readFileSync(join(dataDirectory, "manifest.json"), "utf8")) as { bundleVersion?: string };
log(`journal ${journal.slug ?? file}: ${journal.mode}, master rule ${journal.masterRule}, ${journal.commands.length} answers, data ${dataDirectory}`);
// The table format decides the seat count. An old journal has no format: read it from the deck count.
const format: DuelFormat = isDuelFormat(journal.tableFormat) ? journal.tableFormat : journal.decks.length === 3 ? "ffa3" : journal.decks.length >= 4 ? "ffa4" : "1v1";
if (journal.decks.length !== seatCountFor(format)) throw new Error(`The journal has ${journal.decks.length} decks but format ${format} has ${seatCountFor(format)} seats`);
if (!isDuelFormat(journal.tableFormat) && format !== "1v1") log(`warning: the journal has no format; assuming ${format} from ${journal.decks.length} decks`);
// A duel with more than two seats pins the Lua overlay with the bundle (see pinnedEngineVersion).
const overlayHash = seatCountFor(format) > 2 ? activeMultiScriptsHash(dataDirectory) : null;
const pinnedVersion = manifest.bundleVersion ? pinnedEngineVersion(manifest.bundleVersion, seatCountFor(format), overlayHash) : undefined;
if (pinnedVersion !== journal.bundleVersion) {
  log(`warning: engine bundle ${pinnedVersion} differs from the journal bundle ${journal.bundleVersion}`);
}
if (seatCountFor(format) > 2 && journal.multiScriptsHash && journal.multiScriptsHash !== overlayHash) {
  log(`warning: the Lua overlay ${overlayHash ?? "(none)"} differs from the journal overlay ${journal.multiScriptsHash}`);
}
const wasmFile = arg("wasm");
const wasmBinary = wasmFile ? (() => { const bytes = readFileSync(wasmFile); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; })() : undefined;

const startupScripts = journal.startupScripts ?? (journal.setup?.startupScripts ?? []).map((content, index) => ({ name: `startup-${index}.lua`, content }));
if (journal.wasmSha) log(`journal core: ${journal.wasmFile ?? "(unnamed)"} sha256 ${journal.wasmSha}`);

const stopAt = arg("stop-at") === undefined ? journal.commands.length : Math.min(Number(arg("stop-at")), journal.commands.length);
const game = await createEngineGame({
  mode: journal.mode,
  masterRule: journal.masterRule,
  ...(format !== "1v1" ? { format } : {}),
  ...(wasmBinary ? (seatCountFor(format) > 2 ? { multiWasmBinary: wasmBinary } : { standardWasmBinary: wasmBinary }) : {}),
  decks: journal.decks as DuelDeck[],
  ...(startupScripts.length > 0 ? { startupScripts } : {}),
  seed: journal.seed,
  dataDirectory,
  // A duel stored without settings is a legacy one: the host reads it with `legacyDuelSettings`.
  settings: journal.settings == null ? legacyDuelSettings() : normalizeDuelSettings(journal.mode, journal.settings),
});
let failed = false;
let failedStep: number | null = null;
let done = 0;
const seatCount = seatCountFor(format);
const viewers: Array<number | null> = [...Array.from({ length: seatCount }, (_, seat) => seat), null];
const known = new Map<number | null, Set<number>>(viewers.map((viewer) => [viewer, new Set<number>()]));
/** The first step (0 = before any answer, n = after n answers) at which a viewer's view held a number. */
const knownStep = new Map<number | null, Map<number, number>>(viewers.map((viewer) => [viewer, new Map<number, number>()]));
/** Every number of 5 to 10 digits in a viewer's view. A superset of the card codes, so it never invents a leak. */
function sample(step: number): void {
  for (const viewer of viewers) {
    const set = known.get(viewer)!;
    const steps = knownStep.get(viewer)!;
    for (const match of JSON.stringify(game.view(viewer)).matchAll(/(?<![\d.])\d{5,10}(?!\d)/g)) {
      const code = Number(match[0]);
      set.add(code);
      if (!steps.has(code)) steps.set(code, step);
    }
  }
}
try {
  sample(0);
  for (; done < stopAt; done++) {
    const { seat, command } = journal.commands[done]!;
    const view = game.view(seat);
    const elimination = eliminationCodeOf(command.promptId);
    if (view.revision !== command.revision || (elimination === null && view.prompt?.id !== command.promptId)) {
      log(`step ${done}: mismatch. Journal has revision ${command.revision} prompt ${command.promptId}; the engine has revision ${view.revision} prompt ${view.prompt?.id ?? "none"}`);
      failed = true;
      failedStep = done;
      break;
    }
    if (process.argv.includes("--trace")) log(`  ${done}: seat ${seat} ${command.promptId} "${view.prompt?.title ?? "(elimination)"}" ${JSON.stringify(command.answer)}`);
    // A host-driven elimination (FFA surrender or time loss) is journaled like an answer.
    if (elimination === null) game.answer(seat, command.promptId, command.answer);
    else game.eliminate(seat, elimination);
    if (asJson) sample(done + 1);
  }
  if (!failed) log(`replayed ${done} of ${journal.commands.length} answers`);
  if (process.argv.includes("--views")) {
    for (let seat = 0; seat < seatCountFor(format); seat++) {
      const view = game.view(seat);
      log(`seat ${seat}: turn ${view.turn} ${view.phase}, turn seat ${view.turnSeat}, revision ${view.revision}, result ${JSON.stringify(view.result)}`);
      if (view.prompt) log(`  open prompt ${view.prompt.id} [${view.prompt.kind}] "${view.prompt.title}": ${view.prompt.options.slice(0, 8).map((option) => option.label).join(" | ")}`);
      for (const entry of view.log.slice(-15)) log(`  log ${entry.id}: ${entry.text}`);
    }
  }
} catch (error) {
  log(`step ${done}: engine threw: ${error instanceof Error ? error.message : String(error)}`);
  failed = true;
  failedStep = done;
} finally {
  if (asJson) {
    const codes = (deck: DuelDeck | null) => (deck ? [...deck.main, ...deck.extra, ...(deck.side ?? [])] : []);
    let views: Record<string, unknown> = {};
    try {
      if (!process.argv.includes("--views")) throw new Error("views not asked");
      views = Object.fromEntries(viewers.map((viewer) => [viewer === null ? "spectator" : String(viewer), game.view(viewer)]));
    } catch {
      // The engine already failed: the known sets are what counts.
    }
    process.stdout.write(
      JSON.stringify({
        ok: !failed,
        failedStep,
        replayed: done,
        total: journal.commands.length,
        seatCount,
        format,
        bundleVersion: pinnedVersion ?? null,
        multiScriptsHash: overlayHash,
        decks: journal.decks.map((deck) => codes(deck)),
        deckMasters: journal.decks.flatMap((deck) => (deck?.deckMaster ? [deck.deckMaster] : [])),
        knownStep: Object.fromEntries(viewers.map((viewer) => [viewer === null ? "spectator" : String(viewer), Object.fromEntries(knownStep.get(viewer)!)])),
        known: Object.fromEntries(viewers.map((viewer) => [viewer === null ? "spectator" : String(viewer), [...known.get(viewer)!]])),
        views,
      }) + "\n",
    );
  }
  game.close();
}
// Let a piped JSON line drain before the process ends.
process.stdout.write("", () => process.exit(failed ? 1 : 0));
