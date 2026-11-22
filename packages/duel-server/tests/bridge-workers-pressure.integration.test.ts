import { rmSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { bridgeDatabase, FAST_QUERY_TIMEOUT_MS } from "./helpers/bridge-worker-database.js";

describe("bridge scanner isolation", () => {
  it("finishes outgoing and incoming scans under interactive pressure and warms a cold scanner", async () => {
    const db = bridgeDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
    const scan = { kind: "bridges", op: "live", source: "Odion", format: "advanced" } as const;
    try {
      const [outgoing, incoming] = await Promise.all([
        workers.bridgeCandidates({ ...scan, op: "outgoing", source: "Blue-Eyes" }),
        workers.bridgeCandidates({ ...scan, op: "into", source: "Blue-Eyes" }),
      ]);
      expect(Array.isArray(outgoing) && outgoing.length > 0 && outgoing.every(row => row.source === "Blue-Eyes")).toBe(true);
      expect(Array.isArray(incoming) && incoming.length > 0 && incoming.every(row => row.target === "Blue-Eyes")).toBe(true);
      const pressure = Array.from({ length: 20 }, () => workers.bridgeEngineProjection([], {
        source: "Odion", engines: ["Odion"], format: "advanced",
      }).then(() => "done", error => error.status));
      await expect(workers.bridgeCandidates({ ...scan, op: "from", limit: 1 })).resolves.toBeInstanceOf(Array);
      const answers = await Promise.all(pressure);
      expect(answers).toContain(503);
      const cold = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
      try {
        await expect(cold.bridgeEngines({ engines: ["Odion"] }, "g", 1)).rejects.toMatchObject({ status: 503 });
        const jobs = (cold as unknown as { jobs: { reject?: unknown; worker: unknown }[] }).jobs;
        expect(jobs).toHaveLength(1);
        const scanner = jobs[0]!.worker;
        // The caller deadline stays short, but the cold scan may finish warming.
        await vi.waitFor(() => expect(jobs[0]?.reject).toBeUndefined(), { timeout: 30_000 });
        await expect(cold.bridgeEngines({ engines: ["Odion"] }, "g")).resolves.toMatchObject({ engines: ["Odion"] });
        expect(jobs[0]!.worker).toBe(scanner);
      } finally { await cold.close(); }
    } finally { await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 180_000); // Several real deep scans plus cold initialization; admission and caller deadlines stay checked above.
});
