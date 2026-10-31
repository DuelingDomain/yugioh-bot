import { bridgeQueryFixture } from "./helpers/bridge-query-fixture.js";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { BRIDGE_JUDGE_FRAMINGS, bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, makeBridgeJudgementRecord,
  rankEngineCandidates, coPlayPair, saveBridgeJudgement, shownBridge, type ArchetypeBridge } from "@yugidraft/shared/cards/effects";
import { createBridgeService } from "@yugidraft/shared/services";
import { BridgeApi } from "../src/bridge-api.js";
import { BridgeEngineQueries, type EngineQuery } from "../src/bridge-engine-queries.js";
import { bridgeProjectionRows, type BridgeProjectionInput } from "../src/bridge-projection-input.js";
import { searchBridgeEngines } from "../src/bridge-multi-search.js";
import type { BridgeScan } from "../src/deck-suggestion-workers.js";
import { seedIdentity } from "./helpers/identity.js";

const ownerDeck = {
  main: [87979586,27204313,27204313,27204313,60411677,60411677,60411677,68304193,68304193,32909498,34926568,63198739,
    97522863,97522863,97522863,42141493,42141493,42141493,14558127,14558127,14558127,59438930,59438930,59438930,
    94145022,32236916,32236916,73628505,35269904,35269904,35269904,29095457,29095457,69540484,56506740,56506740,
    56506740,29762407,69299029,69299029,69299029,10045474,10045474,10045474,85888377,85888377,95561146,23626223],
  extra: [97800311,97800311,60465049,17020474,9464441,43419178,43419178,29301450,1528054,65741787,98978921],
};

it("reuses a still-valid accepted line when a scan discovers alternative evidence", async () => {
  const { db, queries, review, workers, pair } = fixture();
  try {
    const old = pair("Odion", "Blue-Eyes");
    review(old);
    const current = { ...old, evidence_hash: "f".repeat(64), warnings: [...old.warnings, "Alternative discovery revision"] };
    workers.bridgeCandidates.mockImplementation(async scan => scan.op === "outgoing" ? [current] : []);
    const records = db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all();
    const result = await searchBridgeEngines(db, workers, { source: "Odion", engines: ["Odion"], format: "advanced" }, () => {});
    expect(result.rows[0]!.evidence_hash).toBe(old.evidence_hash);
    expect(queries.project(result.rows, { source: "Odion", engines: ["Odion"], format: "advanced" }, 6).next.map(row => row.engine)).toContain("Blue-Eyes");
    expect(workers.rateBridge).not.toHaveBeenCalled();
    expect(db.prepare("SELECT judgement_json FROM bridge_judgement ORDER BY judge").all()).toEqual(records);
  } finally { db.close(); }
});

function fixture() {
  const db = new Database(":memory:"); migrate(db); importBridgeArtifact(db);
  const queries = new BridgeEngineQueries(db), service = createBridgeService(db);
  const review = (row: ArchetypeBridge, verdicts: readonly ("valid" | "invalid")[] = ["valid", "valid"], line?: string[]) => {
    const evidence = buildBridgeJudgeEvidence(db, row)!;
    expect(evidence).not.toBeNull();
    for (const [i, framing] of BRIDGE_JUDGE_FRAMINGS.entries()) saveBridgeJudgement(db, makeBridgeJudgementRecord(evidence, framing, {
      verdict: verdicts[i]!, grade: "good", pros: [], cons: [], lock_note: "",
      line: verdicts[i] === "valid" ? line ?? evidence.cards.slice(0, 3).map(card => card.name) : [], format_ok: true,
    }));
  };
  const workers = { ...bridgeQueryFixture(db),
    bridgeEngineShortlist: vi.fn(async (rows: ArchetypeBridge[], query: EngineQuery) => queries.shortlist(rows, query)),
    bridgeEngineProjection: async (input: BridgeProjectionInput, query: EngineQuery) => queries.project(bridgeProjectionRows(db, input), query, 6),
    bridgeEngines: vi.fn(),
    bridgeCandidates: vi.fn(async (scan: BridgeScan) => service.engineRows([scan.source], scan.format)
      .filter(row => scan.op === "into" ? row.target === scan.source : row.source === scan.source)),
    rateBridge: vi.fn(async (_row: ArchetypeBridge) => {}),
  };
  const pair = (source: string, target: string) => service.deepBetween(source, target)!;
  return { db, queries, service, review, workers, pair };
}

describe("checked physical Niche recall and incoming single-engine discovery", () => {
  it("restores owner deck 10 from four to five using co-play, cached agreements and no review calls", async () => {
    const { db, queries, service, review, workers, pair } = fixture();
    const engines = ["Kashtira", "Odion", "Primite"], query: EngineQuery = {
      source: engines[0]!, engines, format: "advanced", deckCards: [...ownerDeck.main, ...ownerDeck.extra],
    };
    try {
      for (const [from, to] of [["Kashtira", "Tearlaments"], ["Odion", "Ashtra"], ["Odion", "Argostars"],
        ["Odion", "Altergeist"], ["Odion", "Blue-Eyes"]]) {
        const line = to === "Ashtra" ? ["Temple of the Kings", "Ashtra Divine Domain"]
          : to === "Argostars" ? ["Temple of the Kings", "Argostars - Slayer Eteo"]
          : to === "Tearlaments" ? ["Tearlaments Kashtira", "Tearlaments Cryme"] : undefined;
        review(pair(from!, to!), ["valid", "valid"], line);
      }
      for (const [from, to] of [["Kashtira", "Scareclaw"], ["Dragon Ruler", "Primite"], ["Kashtira", "Genex"],
        ["Kashtira", "The Weather"], ["Odion", "The Weather"]]) review(pair(from!, to!), ["invalid", "invalid"]);
      review(pair("Odion", "Gravekeeper's"), ["valid", "invalid"]);
      // Even two synthetic cached approvals cannot promote a hub-derived path.
      review(pair("Kashtira", "Gusto"));
      const rows = service.engineRows(engines, "advanced"), accepted = rows.flatMap(row => {
        const shown = shownBridge(db, row); return shown ? [shown] : [];
      });
      expect(rankEngineCandidates(engines, accepted, service.rankingContext(), 8, { acceptedNiche: () => false }))
        .toHaveLength(4);
      const result = await searchBridgeEngines(db, workers, query, () => {});
      const next = queries.project(result.rows, query, 6).next;
      expect(next.map(row => row.engine)).toEqual(["Tearlaments", "Ashtra", "Argostars", "Altergeist", "Blue-Eyes"]);
      expect(next.slice(3).every(row => row.tier === "niche" && row.score < 4)).toBe(true);
      expect(next.flatMap(row => row.links).every(link => link.bridge.judge === "accepted")).toBe(true);
      expect(next.find(row => row.engine === "Blue-Eyes")!.links).toHaveLength(1);
      expect(next.find(row => row.engine === "Blue-Eyes")!.links[0]!.from).toBe("Odion");
      // The accepted line stays separate from optional evidence. Its union
      // with the core uses maximum multiplicity and canonical Main+Extra copies.
      for (const [engine, bridgeNeeded, engineNeeded] of [["Argostars", 1, 12], ["Ashtra", 1, 10], ["Tearlaments", 2, 11]] as const) {
        const suggestion = next.find(row => row.engine === engine)!;
        const required = new Map<number, number>();
        for (const name of suggestion.links.flatMap(link => link.bridge.review.line)) {
          const row = db.prepare("SELECT passcode FROM card_capability WHERE json_extract(capabilities_json,'$.card.name')=?").get(name) as { passcode: number };
          required.set(row.passcode, 1);
        }
        const missing = () => [...required].reduce((n, [code, copies]) => n + Math.max(0, copies - query.deckCards!.filter(id => id === code).length), 0);
        expect(missing(), `${engine} bridge`).toBe(bridgeNeeded);
        for (const card of suggestion.core!.cards) required.set(card.code, Math.max(required.get(card.code) ?? 0, card.copies));
        expect(missing(), `${engine} engine`).toBe(engineNeeded);
      }
      expect(workers.rateBridge).not.toHaveBeenCalled();
      expect(workers.bridgeCandidates.mock.calls.map(([scan]) => [scan.op, scan.source])).toEqual([
        ["outgoing", "Kashtira"], ["into", "Kashtira"], ["outgoing", "Odion"], ["into", "Odion"],
        ["outgoing", "Primite"], ["into", "Primite"],
      ]);
      expect(service.deepBetween("Odion", "Labrynth")).toMatchObject({ tier: "niche", judge: "pending" });
      review(pair("Odion", "Blue-Eyes"), ["valid", "invalid"]);
      expect(bridgeGate(db, pair("Odion", "Blue-Eyes")).state).toBe("review");
      expect(queries.project(rows, query, 6).next.map(row => row.engine)).not.toContain("Blue-Eyes");
    } finally { db.close(); }
  });

  it("reserves two accepted subfloor slots plus one co-play slot within eight total", () => {
    const { db, queries, service, review, pair } = fixture();
    const engines = ["Kashtira", "Odion", "Primite", "Snake-Eye"];
    try {
      const pairs = [["Kashtira", "Tearlaments"], ["Odion", "Ashtra"], ["Odion", "Argostars"],
        ["Odion", "Altergeist"], ["Odion", "Blue-Eyes"], ["Snake-Eye", "Fire King"], ["Snake-Eye", "Diabell"],
        ["Azamina", "Snake-Eye"], ["Snake-Eye", "Dragon Ruler"]].map(([from, to]) => pair(from!, to!));
      pairs.forEach(row => review(row));
      const shortlist = queries.shortlist(pairs, { source: engines[0]!, engines, format: "advanced" });
      expect(shortlist).toHaveLength(8);
      expect(shortlist.filter(row => row.score < 4).map(row => row.engine)).toEqual(["Dragon Ruler", "Altergeist", "Blue-Eyes"]);
      expect(coPlayPair("Primite", "Blue-Eyes", "tcg")!.decks).toBeGreaterThanOrEqual(2);
      db.exec("DELETE FROM bridge_judgement");
      const pending = queries.shortlist(pairs, { source: engines[0]!, engines, format: "advanced" });
      expect(pending.filter(row => row.score < 4).map(row => row.engine)).toEqual(["Blue-Eyes"]);
    } finally { db.close(); }
  });

  it("scans both directions for a single Snake-Eye job and keeps incoming Azamina out of its legacy directed list", async () => {
    const { db, workers, service, review } = fixture();
    const user = seedIdentity(db);
    const rows = service.engineRows(["Snake-Eye"], "advanced");
    rows.forEach(row => review(row));
    const api = new BridgeApi(db, workers);
    try {
      const started = await api.handle({ userId: user.userId, bridgeRequest: { op: "start", source: "Snake-Eye" } }, "g", user.playerId) as { jobId: string };
      await api.jobs.close();
      const status = await api.jobs.status({ userId: user.userId, guildId: "g" }, started.jobId);
      expect(status.state).toBe("done");
      expect(status.next.map(row => row.engine)).toEqual(expect.arrayContaining(["Fire King", "Diabell", "Azamina", "Dragon Ruler"]));
      expect(status.next).toHaveLength(4);
      expect(status.next.find(row => row.engine === "Azamina")!.links[0]).toMatchObject({ from: "Azamina", to: "Snake-Eye" });
      expect(status.results.every(row => (row as ArchetypeBridge).source === "Snake-Eye")).toBe(true);
      expect(status.results.some(row => (row as ArchetypeBridge).source === "Azamina")).toBe(false);
      expect(workers.bridgeCandidates.mock.calls.map(([scan]) => scan.op)).toEqual(["outgoing", "into"]);
      expect(workers.rateBridge).not.toHaveBeenCalled();
    } finally { await api.jobs.close(); db.close(); }
  });
});
