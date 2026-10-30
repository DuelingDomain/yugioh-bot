import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { importBridgeArtifact } from "../src/cards/effects/bridge-artifact.js";
import { importCardEffectArtifact } from "../src/cards/effects/artifact.js";
import { createBridgeService } from "../src/services/archetype-bridges.js";
import { bridgeAccessPath, rankEngineCandidates } from "../src/cards/effects/bridge-engine-ranking.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db); });
afterAll(() => db.close());

describe("open-deck bridge engine detection", () => {
  it("deduplicates shared access paths across every source in a multi-engine shortlist", () => {
    const service = createBridgeService(db), context = service.rankingContext();
    for (const engines of [["Odion", "Ashtra"], ["Blue-Eyes", "Fiendsmith"]]) {
      const rows = engines.flatMap(source => [...service.deepCandidates(source, "advanced", undefined, false), ...service.deepInto(source)]);
      const next = rankEngineCandidates(engines, rows, context);
      const owners = new Map<string, string>();
      for (const candidate of next) for (const link of candidate.links) {
        const path = bridgeAccessPath(link.bridge, context.groups);
        if (!path) continue;
        expect(owners.get(path) ?? candidate.engine).toBe(candidate.engine);
        owners.set(path, candidate.engine);
      }
      expect(next.every(row => row.score >= 4)).toBe(true);
      expect(next.filter(row => row.links.some(link => link.bridge.reasons[0]?.evidence.some(text => /Junk Converter/.test(text)))).length).toBeLessThanOrEqual(1);
      if (engines.includes("Odion")) expect(next.some(row => /synchron/i.test(row.engine))).toBe(false);
    }
  }, 20_000);
  it("detects curated and named engines without archetypal hand traps or format staples", () => {
    const fixtures = [
      { main: [29762407, 29762407, 97522863, 97522863, 1710647, 1710647, 37839434, 37839434], expected: ["Ashtra", "Odion"] },
      { main: [89631139, 89631139, 8240199, 8240199], expected: ["Blue-Eyes"] },
      { main: [9674034, 9674034, 45663742, 45663742], expected: ["Snake-Eye"] },
      { main: [60764609, 60764609, 98567237, 98567237], expected: ["Fiendsmith"] },
    ];
    for (const fixture of fixtures) {
      const detected = createBridgeService(db).detectEngines({ main: [...fixture.main, 42141493, 84192580, 87126721, 14558127], extra: [] }, "advanced");
      expect(detected.filter(row => row.status === "engine").map(row => row.name).sort()).toEqual(fixture.expected);
      expect(detected.some(row => row.name === "Mulcharmy" || row.name === "Ash Blossom")).toBe(false);
    }
  });

  it("weights Extra and Deck Master copies but requires two distinct Main cards", () => {
    const service = createBridgeService(db);
    expect(service.detectEngines({ main: [89631139, 8240199], extra: [2129638, 2129638] }, "advanced"))
      .toContainEqual(expect.objectContaining({ name: "Blue-Eyes", weight: 3, copies: 4, distinct: 3, status: "engine" }));
    expect(service.detectEngines({ main: [], extra: [], deckMaster: 89631139 }, "advanced"))
      .toContainEqual(expect.objectContaining({ name: "Blue-Eyes", weight: 2, status: "light" }));
    expect(service.detectEngines({ main: [89631139, 89631139, 89631139], extra: [] }, "advanced"))
      .toContainEqual(expect.objectContaining({ name: "Blue-Eyes", status: "light" }));
    expect(service.detectEngines({ main: [89631139, 89631139, 8240199, 8240199, ...Array(56).fill(0)], extra: [] }, "advanced"))
      .toContainEqual(expect.objectContaining({ name: "Blue-Eyes", weight: 4, status: "light" }));
  });

  it("divides hybrids, folds overlapping in-deck groups, and caps engines at four", () => {
    // Replace only the group labels in a disposable database; identities and tags remain the pinned artifacts.
    const isolated = new Database(":memory:");
    try {
      migrate(isolated); importCardEffectArtifact(isolated); importBridgeArtifact(isolated);
      const graph = JSON.parse((isolated.prepare("SELECT graph_json FROM bridge_graph").get() as { graph_json: string }).graph_json);
      const ids = [29762407, 97522863, 1710647, 37839434, 89631139, 8240199, 9674034, 45663742, 60764609, 98567237];
      graph.groups = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`Engine ${i}`, ids.slice(i * 2, i * 2 + 2)]));
      graph.groups.Alias = graph.groups["Engine 0"];
      isolated.prepare("UPDATE bridge_graph SET graph_json=?,source_version='detector-fixture'").run(JSON.stringify(graph));
      const rows = createBridgeService(isolated).detectEngines({ main: ids.flatMap(id => [id, id]), extra: [] }, "advanced");
      expect(rows.filter(row => row.status === "engine")).toHaveLength(4);
      expect(rows.filter(row => row.status === "light")).toHaveLength(1);
      expect(rows.find(row => row.hybrids.length)).toMatchObject({ name: "Alias", weight: 4, hybrids: [29762407, 97522863], includes: ["Engine 0"] });
    } finally { isolated.close(); }
  });
});
