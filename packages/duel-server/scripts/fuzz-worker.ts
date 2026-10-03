import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";
import type { FuzzConfig } from "../tests/fuzz/config.js";

// tsx does not map .js imports to .ts inside worker threads by itself, so register it here.
register();
const { scenarioFor } = (await import("../tests/fuzz/config.js")) as typeof import("../tests/fuzz/config.js");
const { runAndVerify } = (await import("../tests/fuzz/run-one.js")) as typeof import("../tests/fuzz/run-one.js");

/** Worker thread for scripts/fuzz-nightly.ts. Receives seeds, runs one duel per seed, posts the result. */
interface WorkerData {
  config: Pick<FuzzConfig, "mode" | "masterRule" | "maxSteps" | "replayRate" | "dataDirectory">;
}

const { config } = workerData as WorkerData;
const port = parentPort;
if (!port) throw new Error("fuzz-worker must run as a worker thread");

port.on("message", async (message: { type: "run"; seed: number } | { type: "stop" }) => {
  if (message.type === "stop") {
    process.exit(0);
  }
  const scenario = scenarioFor(message.seed, config);
  port.postMessage({ type: "start", seed: message.seed });
  try {
    const t0 = performance.now();
    const outcome = await runAndVerify(scenario, config.dataDirectory, config.replayRate);
    const wallMs = performance.now() - t0;
    port.postMessage({
      type: "done",
      seed: message.seed,
      wallMs,
      outcome: outcome.failure ? outcome : { ...outcome, journal: [], decks: undefined, deckNotes: undefined },
    });
  } catch (error) {
    port.postMessage({ type: "crash", seed: message.seed, message: error instanceof Error ? error.stack ?? error.message : String(error) });
  }
});
port.postMessage({ type: "ready" });
