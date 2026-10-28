import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, type ArchetypeBridge, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService, parseDeckSuggestionQuery } from "@yugidraft/shared/services";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { DeckSuggestionWorkers } from "../src/deck-suggestion-workers.js";
import { deckSuggestionScope } from "../src/deck-legality.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

describe("bridge scanner isolation", () => {
  it("queues bridge scans on one scanner and leaves a scanner available for Suggestions", async () => {
    const db = new Database(":memory:");
    migrate(db); importBridgeArtifact(db);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const workers = new DeckSuggestionWorkers(db, directory);
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
      const suggestions = workers.run({
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      });
      expect(jobs()).toHaveLength(2);
      const [result, queued, filtered, normal] = await Promise.all([first, second, genesys, suggestions]);
      expect(Array.isArray(result)).toBe(true);
      expect(Array.isArray(queued)).toBe(true);
      expect(Array.isArray(filtered) && filtered.length > 0 && filtered.every(row => row.format === "genesys")).toBe(true);
      expect(normal).toHaveProperty("rows");
      expect(progress).toContain("score");
      expect(progress.at(-1)).toBe("done");
    } finally { await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);

  it("judges on the host with at most two requests while both scanners remain free", async () => {
    const db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
    const directory = createHostDataFixture([{ code: 89631139, name: "Blue-Eyes White Dragon", type: 0x11 }]);
    const service = createBridgeService(db);
    const bridges = [["Odion", "Argostars"], ["Branded", "Despia"], ["Swordsoul", "Tenyi"]]
      .map(([source, target]) => service.bridgeBetween(source!, target!)!);
    let release!: () => void, active = 0, maximum = 0, calls = 0;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const client: BridgeJudgeClient = { messages: { async create(request) {
      active++; calls++; maximum = Math.max(maximum, active);
      const evidence = JSON.parse(String(request.messages[0]!.content)) as ReturnType<typeof buildBridgeJudgeEvidence>;
      await gate; active--;
      return { id: `msg_pool_${calls}`, model: "claude-haiku-5-5", stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "good", format_ok: true,
          pros: ["The supplied cards interact.", "Enables the proposed line."], cons: ["Needs the supplied cards.", "Requires the printed conditions."],
          lock_note: "Apply the supplied restrictions.", line: evidence!.cards.map(card => card.name) }) }] };
    } } };
    const workers = new DeckSuggestionWorkers(db, directory, 120_000, { client, env: {}, log: () => {} });
    const pending: Promise<void>[] = [];
    try {
      for (const bridge of bridges) { expect(bridge).toBeTruthy(); pending.push(workers.rateBridge(bridge as ArchetypeBridge)); }
      expect(active).toBe(2);
      expect((workers as unknown as { jobs: unknown[] }).jobs).toHaveLength(0);
      const scan = {
        query: parseDeckSuggestionQuery({ op: "suggestRows", deck: { main: [89631139], extra: [], side: [] } })!,
        legality: deckSuggestionScope("normal", directory, defaultDuelSettings("normal"), { cardBlocks: [] }),
      };
      const normal = await Promise.all([workers.run(scan), workers.run(scan)]);
      expect(normal.every(result => "rows" in result)).toBe(true);
      expect(active).toBe(2);
      release(); await Promise.all(pending);
      expect(calls).toBe(6);
      expect(maximum).toBe(2);
    } finally { release(); await Promise.allSettled(pending); await workers.close(); db.close(); rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);

});
