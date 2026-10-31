import Database from "better-sqlite3";
import { afterAll, beforeAll, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { migrate } from "@yugidraft/shared/db";
import { bridgeGate, buildBridgeJudgeEvidence, importBridgeArtifact, importCardEffectArtifact, judgeBridgePair,
  BridgeEngine, bridgeObservations, coPlayPair, mechanicProfile, mechanicComplementarity, validateBridgeObservations,
  deriveEngineCore, observedEngineCore, projectEngineCore, rankEngineCandidates,
  type BridgeJudgeClient, type BridgeGraphData } from "@yugidraft/shared/cards/effects";
import { BridgeEngineQueries } from "../src/bridge-engine-queries.js";

let db: Database.Database, graph: BridgeGraphData, queries: BridgeEngineQueries, testEngine: BridgeEngine;
beforeAll(() => {
  db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  graph = { ...JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph").get() as {graph_json:string}).graph_json),
    capabilities: (db.prepare("SELECT capabilities_json FROM card_capability").all() as {capabilities_json:string}[]).map(row=>JSON.parse(row.capabilities_json)) };
  testEngine = new BridgeEngine(graph); graph = testEngine.data; queries = new BridgeEngineQueries(db);
}, 30000);
afterAll(() => db.close());

it("ships larger hashed format samples, with consistent unrelated pair counts and member copies", () => {
  const artifact = bridgeObservations()!;
  expect(validateBridgeObservations(artifact)).toEqual(artifact);
  const usage = JSON.parse(readFileSync(new URL("../../shared/data/staples/usage.json", import.meta.url), "utf8"));
  expect(artifact.usageVersion).toBe(usage.version);
  for (const format of ["tcg", "domain", "genesys"] as const) {
    expect(artifact.formats[format]!.deckCount).toBeGreaterThan(900);
    expect(usage.formats[format].sources.length).toBeGreaterThan(4);
    for (const pair of artifact.formats[format]!.pairs) expect(testEngine.relatedEngines(pair.a,pair.b)).toBe(false);
  }
  expect(coPlayPair("Blue-Eyes", "Primite", "genesys")!.decks).toBeGreaterThanOrEqual(5);
  const corrupt = structuredClone(artifact); corrupt.formats.genesys!.pairs[0]!.decks++;
  const {version, ...identity} = corrupt;
  corrupt.version=createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  expect(()=>validateBridgeObservations(corrupt)).toThrow(/co-play counts/);
});

it("grounds Temple + Labrynth in Normal Trap mechanics and rejects Fiendsmith's shared stats and broad GY theme", () => {
  const engine = testEngine;
  const profile = (name: string) => mechanicProfile(name, graph.capabilities.filter(row=>graph.groups[name]?.includes(row.id)));
  const temple=profile("Odion"), lab=profile("Labrynth"), smith=profile("Fiendsmith");
  expect(temple.mechanics.trap_set.share).toBeGreaterThan(smith.mechanics.trap_set.share);
  expect(mechanicComplementarity(temple,lab)).toBeGreaterThan(mechanicComplementarity(smith,lab));
  const row=engine.synergyBetween("Odion","Labrynth")!;
  expect(row).toMatchObject({kind:"synergy",tier:"niche",judge:"pending",two_way:false});
  expect(row.score).toBeLessThanOrEqual(3);
  expect(row.reasons[0]!.description).toMatch(/Temple of the Kings.*Welcome Labrynth.*Lady Labrynth/);
  expect(buildBridgeJudgeEvidence(db,row)).toMatchObject({kind:"synergy",access_rule:expect.stringContaining("Mechanic synergy only")});
  expect(engine.synergyBetween("Fiendsmith","Labrynth")).toBeNull();
  expect(engine.deepBetween("Fiendsmith","Labrynth")).toBeNull();
  const genesys = engine.synergyBetween("Fiendsmith","Labrynth","genesys")!;
  expect(genesys.reasons[0]!.description).toMatch(/Fiendsmith Kyrie.*Lady Labrynth/);
  expect(genesys.reasons[0]!.mechanic!.key).toBe("trap_trigger");
  expect(bridgeGate(db,genesys).state).toBe("pending");
  // Pixiel excavates Main Deck cards; it cannot send an Extra Deck Link to GY.
  expect(engine.synergyBetween("Altergeist","Beetrooper")).toBeNull();
  const discard=engine.synergyBetween("Fiendsmith","Dark World")!;
  expect(discard.reasons[0]!.mechanic!.key).toBe("discard_trigger");
  expect(buildBridgeJudgeEvidence(db,discard)?.kind).toBe("synergy");
  expect(buildBridgeJudgeEvidence(db,{...row,kind:undefined})).toBeNull();
  expect(buildBridgeJudgeEvidence(db,{...row,reasons:[{...row.reasons[0]!,description:"Unsupported mechanic"}]})).toBeNull();
});

it("requires both independent Haiku reviews, caps synergy, and never calls it access coverage", async () => {
  const row=testEngine.synergyBetween("Odion","Labrynth")!;
  const query={source:"Odion",engines:["Odion"],format:"advanced" as const};
  expect(bridgeGate(db,row).state).toBe("pending");
  expect(queries.project([row],query).next).toEqual([]);
  let calls=0;
  const client: BridgeJudgeClient={messages:{create:async request=>{
    calls++;
    expect(request.model).toBe("claude-haiku-5-5");
    const evidence=JSON.parse(request.messages[0]!.content as string);
    expect(evidence.access_rule).toContain("Mechanic synergy only");
    expect(evidence.proposed_lines[0].steps[0].action).toBe("mechanic_synergy");
    return {id:`msg_mechanic_${calls}`,model:request.model,stop_reason:"end_turn",usage:{input_tokens:100,output_tokens:50},
      content:[{type:"text",text:JSON.stringify({verdict:"valid",grade:"niche",pros:[],cons:[],lock_note:"",line:evidence.cards.map((card:{name:string})=>card.name).slice(0,3),format_ok:true})}]};
  }}};
  await judgeBridgePair(db,row,{client,env:{}});
  expect(calls).toBe(2); expect(bridgeGate(db,row).state).toBe("shown");
  const shown=queries.project([row],query);
  expect(shown.next).toHaveLength(1); expect(shown.next[0]).toMatchObject({kind:"synergy",covered:0,twoWay:[]});
  expect(shown.between).toEqual([]);
  await judgeBridgePair(db,row,{client,env:{}}); expect(calls).toBe(2);
  const unsupported = { ...row, reasons: [{...row.reasons[0]!, mechanic: {...row.reasons[0]!.mechanic!, provider:60764609}}] };
  expect(bridgeGate(db,unsupported).state).toBe("invalid");
});

it("uses co-play to rank real paths and never publishes unjudged or evidence-free pairs", () => {
  const engine=testEngine, row=engine.deepBetween("Snake-Eye","Fire King","genesys")!;
  expect(row).not.toBeNull();
  expect(coPlayPair("Snake-Eye","Fire King","genesys")!.decks).toBeGreaterThanOrEqual(2);
  const context=queries.service.rankingContext();
  const without=rankEngineCandidates(["Snake-Eye"],[row],context,8,{observationFormat:"genesys-domain"});
  const withPrior=rankEngineCandidates(["Snake-Eye"],[row],context,8,{observationFormat:"genesys"});
  expect(withPrior[0]!.score).toBeGreaterThan(without[0]!.score);
  expect(rankEngineCandidates(["Snake-Eye"],[],context)).toEqual([]);
  expect(queries.project([row],{source:"Snake-Eye",engines:["Snake-Eye"],format:"genesys"}).next).toEqual([]);
});

it("adjusts cores from real sampled quantities while preserving grounded dependencies, Genesys budgets and Domain rules", () => {
  const artifact=bridgeObservations()!, engine="Ashtra", format="genesys" as const;
  const grounded=deriveEngineCore(graph,engine,format);
  const plan=observedEngineCore(grounded,graph,engine,format,"genesys",artifact);
  expect(plan.caption).toMatch(/sampled genesys lists/);
  expect(plan.cards.some(slot=>slot.evidence.some(text=>text.startsWith("Observed in")))).toBe(true);
  for (const slot of plan.cards) {
    const usage=artifact.formats.genesys!.engines.Ashtra!.cards.find(card=>card.code===slot.card.id);
    if (usage && usage.decks/artifact.formats.genesys!.engines.Ashtra!.decks>=0.5 && slot.role!=="material")
      expect(slot.copies).toBe(Math.max(1,Math.min(3,Math.round(usage.copies/artifact.formats.genesys!.engines.Ashtra!.decks))));
  }
  const singleton=projectEngineCore(plan,{format,deck:{main:[],extra:[],mode:"domain"}});
  expect(singleton.cards.every(card=>card.copies===1)).toBe(true);
  const unaffordable=projectEngineCore(plan,{format,genesysRemaining:0});
  expect(unaffordable.ready).toBe(false);expect(unaffordable.gaps.join(" ")).toMatch(/Genesys points/);
  const master=projectEngineCore(plan,{format,deck:{main:[],extra:[],mode:"domain",deckMaster:plan.cards[0]!.card.id}});
  expect(master.ready).toBe(false);expect(master.gaps.join(" ")).toMatch(/Deck Master/);
  const missing={...graph,capabilities:graph.capabilities.filter(row=>row.card.name!=="Ashtra Divine Domain")};
  expect(observedEngineCore(deriveEngineCore(missing,engine,format),missing,engine,format).gaps.join(" ")).toMatch(/Ashtra Divine Domain/);
  expect(observedEngineCore(grounded,graph,engine,format,"tcg")).toBe(grounded);
});

it("builds an unreviewed proposal from prevalent members while keeping readiness provisional", () => {
  const grounded=deriveEngineCore(graph,"Labrynth","genesys");
  const plan=observedEngineCore(grounded,graph,"Labrynth","genesys");
  const usage=bridgeObservations()!.formats.genesys!.engines.Labrynth!;
  expect(plan.cards.length).toBeGreaterThan(0);
  expect(plan.cards.some(slot=>usage.cards.some(card=>card.code===slot.card.id && card.decks/usage.decks>=0.5))).toBe(true);
  expect(projectEngineCore(plan,{format:"genesys"}).ready).toBe(false);
  expect(plan.gaps.join(" ")).toMatch(/provisional/);
});
