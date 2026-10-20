import Database from "better-sqlite3";
import type { Worker } from "node:worker_threads";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

let directory: string;
beforeAll(() => { directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]); });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

it("caps both real scanner heaps and replaces a crashed worker before the next scan", async () => {
  const db = new Database(":memory:"); migrate(db);
  const pool = new DeckSuggestionWorkers(db, directory);
  // Inspect the actual Node workers, without substituting their messages or lifecycle events.
  const jobs = () => (pool as unknown as { jobs: { worker: Worker }[] }).jobs;
  const scan = {
    query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
    legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
  };
  try {
    const initial = [pool.run(scan), pool.run(scan)];
    const workers = jobs().map(job => job.worker);
    const results = await Promise.all(initial);
    expect(workers).toHaveLength(2);
    for (const worker of workers) {
      expect(worker.resourceLimits?.maxOldGenerationSizeMb).toBeGreaterThan(0);
      expect(worker.resourceLimits?.maxOldGenerationSizeMb).toBeLessThanOrEqual(256);
    }
    // Terminate during cold bootstrap, before the scanner can finish its tiny fixture.
    await pool.close();
    const pending = pool.run(scan);
    const crashed = jobs()[0].worker;
    const rejected = expect(pending).rejects.toThrow("Suggestion scanner stopped");
    await crashed.terminate();
    await rejected;
    // Both slots must be available again and the crashed scanner cannot be reused.
    const recovered = [pool.run(scan), pool.run(scan)];
    expect(jobs().map(job => job.worker)).not.toContain(crashed);
    expect(jobs()).toHaveLength(2);
    expect(await Promise.all(recovered)).toEqual(results);
  } finally { await pool.close(); db.close(); }
});
