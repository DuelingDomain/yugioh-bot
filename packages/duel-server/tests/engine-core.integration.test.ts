import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { importBridgeArtifact, importCardEffectArtifact, deriveEngineCore, projectEngineCore, type BridgeGraphData } from "@yugidraft/shared/cards/effects";
import { BridgeSearchJobs } from "../src/bridge-search-jobs.js";
import { BridgeEngineQueries } from "../src/bridge-engine-queries.js";

let db: Database.Database, graph: BridgeGraphData;
beforeAll(() => {
  db = new Database(":memory:"); migrate(db); importCardEffectArtifact(db); importBridgeArtifact(db);
  graph = JSON.parse((db.prepare("SELECT graph_json FROM bridge_graph").get() as { graph_json: string }).graph_json);
  graph.capabilities = (db.prepare("SELECT capabilities_json FROM card_capability").all() as { capabilities_json: string }[]).map(row => JSON.parse(row.capabilities_json));
});
afterAll(() => db.close());
const plan = (engine: string, format: "advanced" | "genesys" = "advanced") => deriveEngineCore(graph, engine, format);
const core = (engine: string, format: "advanced" | "genesys" = "advanced", deck?: Parameters<typeof projectEngineCore>[1]["deck"], remaining?: number) =>
  projectEngineCore(plan(engine, format), { format, deck, genesysRemaining: remaining });

describe("deterministic engine cores against the pinned catalog", () => {
  it("covers six reviewed coherent plans with grounded Main and Extra roles", () => {
    const expected = { Argostars: [12, 1], Ashtra: [12, 2], Tearlaments: [11, 1], Azamina: [9, 3], Regenesis: [11, 0], "Blue-Eyes": [12, 3] };
    for (const [engine, [copies, extra]] of Object.entries(expected)) {
      const result = core(engine);
      expect(result.gaps, engine).toEqual([]); expect(result.ready, engine).toBe(true);
      expect(result.cards.reduce((n, card) => n + card.copies, 0), engine).toBe(copies);
      expect(result.cards.filter(card => card.section === "extra").length, engine).toBe(extra);
      expect(result.cards.some(card => ["starter", "searcher"].includes(card.role)), engine).toBe(true);
      expect(result.cards.some(card => card.role === "payoff"), engine).toBe(true);
      expect(plan(engine).cards.every(card => card.evidence.length > 0), engine).toBe(true);
    }
    expect(core("Azamina").cards.some(card => card.name === "Deception of the Sinful Spoils")).toBe(true);
    expect(core("Tearlaments").cards.some(card => /Kitkallos|Rulkallos/.test(card.name))).toBe(false);
    expect(core("Blue-Eyes").cards.map(card => card.name)).toEqual(expect.arrayContaining(["Maiden of White", "Roar of the Blue-Eyed Dragons"]));
  });
  it("makes the Link-free Genesys plan and blocks unaffordable exact copy totals", () => {
    const blue = core("Blue-Eyes", "genesys");
    expect(blue.ready).toBe(true); expect(blue.cards.some(card => card.name === "Spirit with Eyes of Blue")).toBe(false);
    expect(blue.cards.reduce((n, card) => n + card.copies, 0)).toBe(11);
    expect(blue.cards.reduce((n, card) => n + card.copies * (card.points ?? 0), 0)).toBe(36);
    const tear = core("Tearlaments", "genesys");
    expect(tear.ready).toBe(false); expect(tear.gaps.join(" ")).toMatch(/300.*100/);
    const ashtra = core("Ashtra", "genesys");
    expect(ashtra.cards.reduce((n, card) => n + card.copies * (card.points ?? 0), 0)).toBe(26);
  });
  it("counts Main and Extra copies, ignores Side and Deck Master ownership, and adapts Domain quantities", () => {
    const ashtra = core("Ashtra"), extra = ashtra.cards.filter(card => card.section === "extra").map(card => card.code);
    const result = core("Ashtra", "advanced", { main: [], extra: [extra[0]!, extra[1]!, extra[1]!], side: [ashtra.cards[0]!.code], deckMaster: ashtra.cards[0]!.code });
    expect(result.cards.reduce((n, card) => n + card.needed, 0)).toBe(10);
    expect(result.cards[0]!.held).toBe(0);
    const singleton = core("Ashtra", "advanced", { main: [], extra: [], mode: "domain" });
    expect(singleton.cards.every(card => card.copies === 1)).toBe(true);
    expect(singleton.ready).toBe(true);
    const full = core("Ashtra", "advanced", { main: Array(60).fill(89631139), extra: [] });
    expect(full.ready).toBe(false); expect(full.gaps.join(" ")).toMatch(/Main.*10.*0/);
  });
  it("fails closed when a required identity or its printed dependency disappears", () => {
    const altered = { ...graph, capabilities: graph.capabilities.filter(row => row.card.name !== "Ashtra Divine Domain") };
    const result = projectEngineCore(deriveEngineCore(altered, "Ashtra", "advanced"), { format: "advanced" });
    expect(result.ready).toBe(false); expect(result.gaps.join(" ")).toMatch(/Ashtra Divine Domain/);
    const broken = { ...graph, capabilities: graph.capabilities.map(row => row.card.name === "Maiden of White" ? { ...row, provides: [], card: { ...row.card, text: "" } } : row) };
    expect(projectEngineCore(deriveEngineCore(broken, "Blue-Eyes", "advanced"), { format: "advanced" }).ready).toBe(false);
  });
  it("reuses shared work while keeping singleton, sections and allowance in actor projections", async () => {
    const queries = new BridgeEngineQueries(db);
    const jobs = new BridgeSearchJobs(db, { version: () => "core-context-test", execute: async () => [],
      project: (_rows, query) => ({ results: [queries.core("Ashtra", query)], inReview: 0 }) });
    const normal = { source: "Ashtra", engines: ["Ashtra"], format: "genesys" as const,
      ...queries.deckContext({ main: [], extra: [], side: [], mode: "normal" }, "genesys", 100) };
    const singleton = { ...normal, ...queries.deckContext({ main: [], extra: [], mode: "domain" }, "genesys", 0) };
    const a = { userId: 991, guildId: "core" }, b = { userId: 992, guildId: "core" };
    try {
      const first = await jobs.start(a, normal), second = await jobs.start(b, singleton);
      expect(second.jobId).toBe(first.jobId);
      await jobs.close();
      const one = await jobs.status(a, first.jobId), two = await jobs.status(b, second.jobId);
      expect(one.state).toBe("done"); expect(two.state).toBe("done");
      // Sampled quantities now replace fixed copies; the larger observed package
      // retains the deck-space gap rather than bypassing its readiness checks.
      expect(one.results[0]).toMatchObject({ ready: false, cards: expect.arrayContaining([expect.objectContaining({ name: "Yoa the Plague Deity Ashtra", copies: 2 })]) });
      expect(two.results[0]).toMatchObject({ ready: false, cards: expect.arrayContaining([expect.objectContaining({ name: "Yoa the Plague Deity Ashtra", copies: 1 })]) });
      const work = JSON.parse((db.prepare("SELECT query_json FROM bridge_deep_job WHERE id=?").get(first.jobId) as { query_json: string }).query_json);
      expect(work).not.toHaveProperty("deck"); expect(work).not.toHaveProperty("deckCards"); expect(work).not.toHaveProperty("genesysRemaining");
    } finally { await jobs.close(); }
  });
  it("clamps Advanced limits and blocks forbidden or missing procedure dependencies", () => {
    const changed = (name: string, banTcg: "Forbidden" | "Limited") => ({ ...graph, capabilities: graph.capabilities.map(row => row.card.name === name ? { ...row, card: { ...row.card, banTcg } } : row) });
    const forbidden = projectEngineCore(deriveEngineCore(changed("Yoa the Plague Deity Ashtra", "Forbidden"), "Ashtra", "advanced"), { format: "advanced" });
    expect(forbidden.ready).toBe(false); expect(forbidden.cards.some(card => card.name === "Yoa the Plague Deity Ashtra")).toBe(false);
    const limited = projectEngineCore(deriveEngineCore(changed("Yoa the Plague Deity Ashtra", "Limited"), "Ashtra", "advanced"), { format: "advanced" });
    expect(limited.cards.find(card => card.name === "Yoa the Plague Deity Ashtra")?.copies).toBe(1);
  });

  it("keeps incomplete fallback procedures unready and rechecks every reviewed role", () => {
    for (const engine of ["Scareclaw", "Synchron"]) {
      const proposal = core(engine);
      expect(proposal.cards.length).toBeGreaterThan(0);
      expect(proposal.ready).toBe(false); expect(proposal.gaps.length).toBeGreaterThan(0);
    }
    const changed = { ...graph, capabilities: graph.capabilities.map(row => row.card.name === "Mikumari the Sealing Deity Ashtra"
      ? { ...row, card: { ...row.card, text: "This card has no printed engine action." }, provides: [], needs: [] } : row) };
    const result = projectEngineCore(deriveEngineCore(changed, "Ashtra", "advanced"), { format: "advanced" });
    expect(result.ready).toBe(false); expect(result.gaps.join(" ")).toMatch(/Mikumari.*role|role.*Mikumari/);
  });
  it("excludes Side from ownership while counting it against the total copy limit", () => {
    const yoa = core("Ashtra").cards.find(card => card.name === "Yoa the Plague Deity Ashtra")!.code;
    const result = core("Ashtra", "advanced", { main: [], extra: [], side: [yoa] });
    expect(result.cards.find(card => card.code === yoa)).toMatchObject({ held: 0, needed: 3 });
    expect(result.ready).toBe(false); expect(result.gaps.join(" ")).toMatch(/Yoa.*4.*3/);
  });

  it("does not infer a fresh allowance when existing deck points are unknown", () => {
    const queries = new BridgeEngineQueries(db);
    const context = queries.deckContext({ main: [123456780], extra: [], pointCap: 0 }, "genesys");
    const result = queries.core("Ashtra", { source: "Odion", format: "genesys", ...context });
    expect(result.ready).toBe(false); expect(result.gaps.join(" ")).toMatch(/allowance is unknown/i);
  });
  it("rechecks reviewed Synchro material headers against the current catalog", () => {
    for (const [engine, name] of [["Ashtra", "Ashtraya Mikumari-no-Mikoto"], ["Blue-Eyes", "Blue-Eyes Spirit Dragon"]]) {
      const changed = { ...graph, capabilities: graph.capabilities.map(row => row.card.name === name
        ? { ...row, card: { ...row.card, text: row.card.text.replace(/^[^\r\n]+/, "3 Tuners + 3 non-Tuners") } } : row) };
      const result = projectEngineCore(deriveEngineCore(changed, engine!, "advanced"), { format: "advanced" });
      expect(result.ready, name).toBe(false); expect(result.gaps.join(" "), name).toMatch(/Unsupported printed dependency/);
    }
  });

  it("blocks a Domain Deck Master identity from being proposed in its deck", () => {
    const yoa = core("Ashtra").cards.find(card => card.name === "Yoa the Plague Deity Ashtra")!.code;
    const result = core("Ashtra", "advanced", { main: [], extra: [], mode: "domain", deckMaster: yoa });
    expect(result.cards.find(card => card.code === yoa)).toMatchObject({ held: 0, needed: 1 });
    expect(result.ready).toBe(false); expect(result.gaps.join(" ")).toMatch(/Deck Master/);
  });

});
