import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, judgeBridgePair,
  type ArchetypeBridge, type BridgeGraphData, type BridgeJudgeClient } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeEngineQueries } from "../src/bridge-engine-queries.js";

it("caps resource synergy reviews and accepted display without bridge coverage or extra judge calls", async () => {
  const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
  try {
    // Three disjoint curated packages share Ashtra's real printed consumer.
    // Real catalog cards and effects pass through discovery, gates and projection.
    const graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph WHERE id=1").get() as { graph_json: string }).graph_json) as BridgeGraphData;
    const fillers = [...new Set(Object.values(graph.groups).flat())].filter(id => !graph.groups.Toy!.includes(id)
      && !graph.groups.Ashtra!.includes(id)).slice(0, 9);
    for (let i = 0; i < 3; i++) {
      const name = `Set resource consumer ${i}`;
      graph.groups[name] = [1710647, ...fillers.slice(i * 3, i * 3 + 3)];
      graph.group_policies = { ...graph.group_policies, [name]: { curated: true, aliases: ["Ashtra"] } };
    }
    db.prepare("UPDATE bridge_graph SET graph_json=? WHERE id=1").run(JSON.stringify(graph));
    const service = createBridgeService(db), queries = new BridgeEngineQueries(db);
    const rows = service.deepCandidates("Toy", "advanced", undefined, false).filter(row => row.kind === "synergy");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const query = { source: "Toy", engines: ["Toy"], format: "advanced" as const };
    const shortlist = queries.shortlist(rows, query);
    expect(shortlist).toHaveLength(1);
    expect(shortlist[0]).toMatchObject({ kind: "synergy", covered: 0, twoWay: [] });
    let calls = 0;
    const client: BridgeJudgeClient = { messages: { create: async request => {
      calls++;
      expect(request.model).toBe("claude-haiku-5-5");
      const evidence = JSON.parse(request.messages[0]!.content as string);
      const reason = evidence.reasons[0], names = (id: number) => evidence.cards.find((card: { id: number }) => card.id === id).name;
      return { id: `msg_synergy_${calls}`, model: request.model, stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 },
        content: [{ type: "text", text: JSON.stringify({ verdict: "valid", grade: "niche", pros: [], cons: [], lock_note: "",
          line: [names(reason.steps[0].from), names(reason.setup.using), names(reason.setup.card)], format_ok: true }) }] };
    } } };
    for (const row of rows) {
      expect(buildBridgeJudgeEvidence(db, row)?.kind).toBe("synergy");
      expect(bridgeGate(db, { ...row, kind: undefined }).state).toBe("invalid");
      await judgeBridgePair(db, row, { client, env: {} });
      expect(bridgeGate(db, row).state).toBe("shown");
    }
    expect(calls).toBe(rows.length * 2);
    const shown = queries.project(rows, query, 8);
    expect(shown.next).toHaveLength(2);
    expect(shown.next.every(row => row.kind === "synergy" && row.covered === 0 && row.twoWay.length === 0)).toBe(true);
    expect(shown.between).toEqual([]);
    const selected = queries.project(rows, { ...query, engines: ["Toy", "Ashtra"] }, 8);
    expect(selected.between).toEqual([]);
    await judgeBridgePair(db, rows[0] as ArchetypeBridge, { client, env: {} });
    expect(calls).toBe(rows.length * 2);
    expect(service.deepBetween("Toy", "Ashtra")).toBeNull();
  } finally { db.close(); }
}, 30_000);
