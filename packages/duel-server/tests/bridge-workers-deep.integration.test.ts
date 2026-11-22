import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { bridgeDatabase, FAST_QUERY_TIMEOUT_MS } from "./helpers/bridge-worker-database.js";

describe("bridge scanner isolation", () => {
  it("keeps deep scans in their own lane while interactive traffic and Suggestions run", async () => {
    const db = bridgeDatabase();
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, {}, FAST_QUERY_TIMEOUT_MS);
    const jobs = () => (workers as unknown as { jobs: unknown[] }).jobs;
    try {
      const progress: string[] = [];
      const scan = { kind: "bridges", op: "live", source: "Odion", format: "advanced" } as const;
      const first = workers.bridgeCandidates(scan, value => {
        progress.push(value.phase);
        if (value.phase === "index") throw new Error("Progress consumer disconnected");
      });
      const second = workers.bridgeCandidates({ ...scan, source: "Blue-Eyes" });
      const genesys = workers.bridgeCandidates({ ...scan, format: "genesys" });
      expect(jobs()).toHaveLength(1);
      const interactive = workers.bridgeEngines({ engines: ["Odion"] }, "g");
      const suggestions = workers.run({
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      });
      expect(jobs()).toHaveLength(3);
      const [result, queued, filtered, normal, fast] = await Promise.all([first, second, genesys, suggestions, interactive]);
      expect(fast.engines).toEqual(["Odion"]);
      expect(Array.isArray(result)).toBe(true);
      expect(Array.isArray(queued)).toBe(true);
      expect(Array.isArray(filtered) && filtered.length > 0 && filtered.every(row => row.format === "genesys")).toBe(true);
      expect(normal).toHaveProperty("rows");
      expect(progress).toContain("score");
      expect(progress.at(-1)).toBe("done");
    } finally { await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 180_000);
});
