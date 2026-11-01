import { bridgeQueryFixture } from "./helpers/bridge-query-fixture.js";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, BRIDGE_JUDGE_IDENTITIES, bridgeHash, buildBridgeJudgeEvidence, importBridgeArtifact,
  makeBridgeJudgementRecord, saveBridgeJudgement, shownBridge, type ArchetypeBridge, type BridgeEnginesResponse,
  type CardCapability, type ShownBridge } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { BridgeEngineQueries, type EngineQuery } from "../src/bridge-engine-queries.js";
import { bridgeProjectionRows, type BridgeProjectionInput } from "../src/bridge-projection-input.js";
import { seedIdentity } from "./helpers/identity.js";

let db: Database.Database;
beforeAll(() => { db = new Database(":memory:"); migrate(db); importBridgeArtifact(db); });
afterAll(() => db.close());
function approve(row: ArchetypeBridge, line: string[]) {
  const evidence = buildBridgeJudgeEvidence(db, row)!;
  for (const framing of BRIDGE_JUDGE_FRAMINGS) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
    verdict: "valid", grade: "good", pros: [], cons: [], lock_note: "", line, format_ok: true,
  }));
  return evidence;
}

const odionLine = ["Temple of the Kings", "Yoa the Plague Deity Ashtra", "Ashtra Divine Domain"];
const sinfulLine = ["Sinful Spoils Subdual", "Regenesis Lord", "Regenesis Birth"];

describe("grounded shown bridge steps", () => {
  it("projects checked actions in reviewed order through fast lists, engine links and cached deep status", async () => {
    const service = createBridgeService(db), queries = new BridgeEngineQueries(db);
    const rows = [service.bridgeBetween("Odion", "Ashtra")!, service.bridgeBetween("Sinful Spoils", "Regenesis")!];
    const identities = { ...BRIDGE_JUDGE_IDENTITIES };
    const evidence = rows.map((row, i) => approve(row, i === 0 ? odionLine : sinfulLine));
    const stored = db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all();
    const user = seedIdentity(db);
    const workers = { ...bridgeQueryFixture(db),
      bridgeCandidates: vi.fn(async () => rows), rateBridge: vi.fn(),
      bridgeEngineShortlist: vi.fn(async (candidates: ArchetypeBridge[], query: EngineQuery) => queries.shortlist(candidates, query)),
      bridgeEngines: vi.fn(async (input: Record<string, unknown>, guildId: string) => {
        const { query } = queries.resolve(input, guildId);
        return queries.project(service.engineRows(query.engines, query.format), query);
      }),
      bridgeEngineProjection: async (input: BridgeProjectionInput, query: EngineQuery) => queries.project(bridgeProjectionRows(db, input), query, 6),
    };
    const api = new BridgeApi(db, workers);
    const call = (bridgeRequest: unknown) => api.handle({ userId: user.userId, bridgeRequest }, "g", user.playerId);
    try {
      for (const [i, row] of rows.entries()) {
        const projected = shownBridge(db, row)!;
        expect(projected.review.steps.map(step => step.card)).toEqual(i === 0 ? odionLine : sinfulLine);
        expect(projected.review.steps.every(step => !step.text.includes("printed conditions"))).toBe(true);
        if (i === 0) {
          expect(projected.review.steps[0]!.text).toBe("allows 1 Trap per turn (Ashtra Divine Domain) to be activated the turn it is Set.");
          expect(projected.review.steps[1]!.text).toContain("Set Ashtra Divine Domain from the Deck");
          expect(projected.review.steps[2]!.text).toBe("can be activated the turn it is Set as the 1 Trap per turn allowed by Temple of the Kings.");
        } else {
          expect(projected.review.steps[0]!.text).toContain("add Regenesis Lord from the Deck to the hand");
          expect(projected.review.steps[0]!.text).not.toContain("Summon");
          expect(projected.review.steps[1]!.text).toContain("Set Regenesis Birth from the Deck");
          expect(projected.review.steps[2]!.text).toContain("Set from the Deck by Regenesis Lord");
        }
        const fast = await call({ op: "from", source: row.source }) as { results: ShownBridge[] };
        expect(fast.results.find(value => value.target === row.target)!.review.steps).toEqual(projected.review.steps);
        const engines = await call({ op: "engines", engines: [row.source] }) as BridgeEnginesResponse;
        expect(engines.next.flatMap(value => value.links).find(link => link.to === row.target)!.bridge.review.steps).toEqual(projected.review.steps);
        // Pair selectors were retired; deep searches now scan the source engine.
        const started = await call({ op: "start", source: row.source }) as { jobId: string };
        for (let attempt = 0; attempt < 100; attempt++) {
          if ((await call({ op: "status", jobId: started.jobId }) as { state: string }).state === "done") break;
          await new Promise(resolve => setImmediate(resolve));
        }
        const deep = await call({ op: "status", jobId: started.jobId }) as { results: ShownBridge[] };
        expect(deep.results.find(value => value.target === row.target)!.review.steps).toEqual(projected.review.steps);
        expect(await call({ op: "start", source: row.source, join: true })).toMatchObject({ jobId: started.jobId, cached: true });
        expect(buildBridgeJudgeEvidence(db, row)!.input_hash).toBe(evidence[i]!.input_hash);
      }
      expect(workers.rateBridge).not.toHaveBeenCalled();
      expect(db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all()).toEqual(stored);
      expect(BRIDGE_JUDGE_IDENTITIES).toEqual(identities);
    } finally { await api.jobs.close(); }
  }, 30_000);

  it("reads each card capability once when projecting an approved bridge", () => {
    const row = createBridgeService(db).bridgeBetween("Odion", "Ashtra")!;
    approve(row, odionLine);
    const prepare = vi.spyOn(db, "prepare");
    try {
      expect(shownBridge(db, row)!.review.steps.map(step => step.card)).toEqual(odionLine);
      expect(prepare.mock.calls.filter(([sql]) => /FROM card_capability WHERE passcode=\?/.test(sql))).toHaveLength(row.cards.length);
      expect(prepare.mock.calls.filter(([sql]) => sql.startsWith("SELECT plan FROM card_tag_profiles"))).toHaveLength(2);
    } finally { prepare.mockRestore(); }
  });

  it("describes checked materials, same-effect costs and zones without filling unrelated steps", () => {
    const service = createBridgeService(db);
    const material = service.deepBetween("Odion", "Blue-Eyes")!;
    approve(material, ["The Man with the Mark", "Spirit with Eyes of Blue", "Blue-Eyes White Dragon"]);
    const materialSteps = shownBridge(db, material)!.review.steps;
    expect(materialSteps[0]!.text).toContain("material for Spirit with Eyes of Blue");
    expect(materialSteps[1]!.text).toContain("Special Summon Blue-Eyes White Dragon from the hand or GY");
    const cost = service.deepBetween("Odion", "Gravekeeper's")!;
    const costEvidence = buildBridgeJudgeEvidence(db, cost)!;
    const names = cost.reasons[0]!.cards.map(id => costEvidence.cards.find(card => card.id === id)!.name);
    approve(cost, names);
    const using = costEvidence.cards.find(card => card.id === cost.reasons[0]!.cost!.using)!.name;
    expect(shownBridge(db, cost)!.review.steps.find(step => step.card === using)!.text).toContain("as cost for");
    expect(shownBridge(db, cost)!.review.steps.find(step => step.card === using)!.text).toContain("from the hand");
    const odion = service.bridgeBetween("Odion", "Ashtra")!;
    approve(odion, ["Treasures of the Kings", "Temple of the Kings"]);
    expect(shownBridge(db, odion)!.review.steps).toEqual([
      { card: "Treasures of the Kings", text: "" }, { card: "Temple of the Kings", text: "" },
    ]);
  }, 20_000);

  it("uses compatible source zones and leaves unsupported Extra Deck destinations blank", () => {
    for (const [sourceName, targetName, capability] of [
      ["Lunalight Gold Leo", "Lunalight Leo Dancer", "search"],
      ["Vampire's Desire", "Dhampir Vampire Sheridan", "send_to_gy"],
    ] as const) {
      const rows = (db.prepare("SELECT capabilities_json FROM card_capability WHERE json_extract(capabilities_json,'$.card.name') IN (?,?)")
        .all(sourceName, targetName) as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json) as CardCapability);
      const source = rows.find(row => row.card.name === sourceName)!, target = rows.find(row => row.card.name === targetName)!;
      const reason = { key: "reach" as const, weight: 6, cards: [source.id, target.id],
        evidence: [source, target].map(row => row.card.text.replace(/\r\n?/g, "\n").trim()),
        description: "Fixture zone path", steps: [{ from: source.id, to: target.id, capability }] };
      const row: ArchetypeBridge = { ...createBridgeService(db).bridgeBetween("Sinful Spoils", "Regenesis")!,
        source: source.card.archetype!, target: "Zone fixture", reasons: [reason], cards: reason.cards, evidence_hash: bridgeHash(reason) };
      approve(row, [sourceName, targetName]);
      const steps = shownBridge(db, row)!.review.steps;
      if (capability === "search") expect(steps.map(step => step.text)).toEqual(["", ""]);
      else {
        expect(steps[0]!.text).toContain("send Dhampir Vampire Sheridan from the field to the GY");
        expect(steps[1]!.text).toContain("from the field");
      }
      expect(steps.some(step => step.text.includes("from the Deck"))).toBe(false);
    }
  });
});

it("projects alternative Set paths from cached verdicts for different subscriber decks", () => {
  const service = createBridgeService(db), queries = new BridgeEngineQueries(db);
  const row = service.deepBetween("Azamina", "White Forest")!;
  const evidence = buildBridgeJudgeEvidence(db, row)!;
  const line = row.reasons[0]!.cards.map(id => evidence.cards.find(card => card.id === id)!.name);
  approve(row, line);
  const records = db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all();
  const empty = queries.project([row], { source: "Azamina", engines: ["Azamina", "White Forest"], format: "advanced", deckCards: [] }, 6);
  const owned = queries.project([row], { source: "Azamina", engines: ["Azamina", "White Forest"], format: "advanced", deckCards: row.cards }, 6);
  const first = empty.between.find(bridge => bridge.source === "Azamina")!, second = owned.between.find(bridge => bridge.source === "Azamina")!;
  expect(first.review.alternative_paths!.length).toBeGreaterThanOrEqual(1);
  expect(second.review.alternative_paths).toEqual(first.review.alternative_paths);
  expect(first.missing.length).toBeGreaterThan(0); expect(second.missing).toEqual([]);
  expect(buildBridgeJudgeEvidence(db, row)!.input_hash).toBe(evidence.input_hash);
  expect(db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all()).toEqual(records);
});
