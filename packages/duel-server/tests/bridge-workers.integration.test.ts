import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact } from "@yugidraft/shared/cards/effects";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";

describe("bridge scanner admission", () => {
  it("runs searches in the scanner pool, reports progress and blocks repeat uncached requests", async () => {
    const db = new Database(":memory:");
    migrate(db); importBridgeArtifact(db);
    const workers = new DeckSuggestionWorkers(db, "unused-read-only-engine");
    try {
      const progress: string[] = [];
      const scan = { kind: "bridges", op: "live", source: "Odion", format: "advanced" } as const;
      const first = workers.runBridge(scan, "player-a", value => {
        progress.push(value.phase);
        if (value.phase === "index") throw new Error("Progress consumer disconnected");
      });
      await expect(workers.runBridge({ ...scan, source: "Blue-Eyes" }, "player-a")).rejects.toMatchObject({ status: 429 });
      const result = await first;
      expect(Array.isArray(result)).toBe(true);
      expect(progress).toContain("score");
      expect(progress.at(-1)).toBe("done");
      await expect(workers.runBridge(scan, "player-a")).resolves.toEqual(result);
      await expect(workers.runBridge({ ...scan, source: " Odion " }, "player-a")).resolves.toEqual(result);
      await expect(workers.runBridge({ ...scan, source: "Blue-Eyes" }, "player-a")).rejects.toMatchObject({ status: 429 });
      await expect(workers.runBridge({ kind: "bridges", op: "explain", source: "Odion", target: "Blue-Eyes", format: "advanced" }, "player-a")).rejects.toMatchObject({ status: 429 });
      expect(db.prepare("SELECT count(*) AS n FROM bridge_search_admission").get()).toEqual({ n: 1 });
    } finally { await workers.close(); db.close(); }
  }, 15_000);
});
