import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRows, collect, loadPending, loadScenarioLists, loadScenarios, outcomeAsserts, parseAdrRules, parseRuleDeclarations,
  partialListPath, pendingListPath, renderTable, runnerSources, scenarioRefs, staleEntries, stalePartial, uniqueScenarios, unknownRules, unrunLists, type RuleRef,
} from "../scripts/rule-coverage.js";
import { GRASS_DECK_COUNTS_SCENARIOS } from "./scenarios/multiplayer/grass-deck-counts.js";
import { OPPONENT_COUNT_GATES_SCENARIOS } from "./scenarios/multiplayer/opponent-count-gates.js";

describe("opponent count coverage", () => {
  it("does not mark unchanged negative controls as rule outcomes", () => {
    const controls = OPPONENT_COUNT_GATES_SCENARIOS.filter((scenario) => scenario.tags.includes("negative-count"));
    expect(controls).toHaveLength(12);
    expect(scenarioRefs(controls)).toEqual([]);
  });

  it("registers the count-gate list with the scenario runner", () => {
    const lists = [{ file: "tests/scenarios/multiplayer/opponent-count-gates.ts", name: "OPPONENT_COUNT_GATES_SCENARIOS", scenarios: OPPONENT_COUNT_GATES_SCENARIOS }];
    const source = readFileSync(new URL("./scenarios/multiplayer/opponent-count-gates.test.ts", import.meta.url), "utf8");
    expect(unrunLists(lists, [source])).toEqual([]);
  });
});

it("counts the real host start proof for the forbidden list", async () => {
  const { refs } = await collect();
  const proof = refs.find((entry) => entry.rule === "R-COMMON-FL-LIST" && entry.ref.kind === "host-outcome");
  expect(proof?.ref.test).toBe("tests/host-rule-forbidden.test.ts");
  expect(buildRows([{ id: "R-COMMON-FL-LIST", title: "Forbidden list" }], refs)[0]?.status).toBe("covered");
});

const adr = [
  "## Common",
  "",
  "- `[R-COMMON-A]` **Alpha.** First rule.",
  "- Bullet with no id.",
  "- `[R-TAG-B-2]` Second rule | with a pipe.",
  "  - `[R-FFA-NESTED]` not a top-level bullet.",
  "- `[R-FFA-C]` Third rule.",
].join("\n");

const ref = (test: string, kind: RuleRef["kind"]) => ({ test, kind });

describe("rule coverage parser", () => {
  it("reads the ids and the text of the rule bullets", () => {
    const rules = parseAdrRules(adr);
    expect(rules.map((r) => r.id)).toEqual(["R-COMMON-A", "R-TAG-B-2", "R-FFA-C"]);
    expect(rules[0]!.title).toBe("Alpha. First rule.");
  });

  it("reads the real ADR and finds every id once", () => {
    const real = parseAdrRules(
      readFileSync(new URL("../../../docs/adr/0002-multiplayer-duel-rules.md", import.meta.url), "utf8"),
    );
    expect(real.length).toBeGreaterThanOrEqual(25);
    expect(new Set(real.map((r) => r.id)).size).toBe(real.length);
  });

  it("finds the ids in rules arrays only", () => {
    const source = `const a = { rules: ["R-COMMON-A", 'R-TAG-B-2'], x: 1 };\nconst b = "R-FFA-C";\nrules:[\`R-FFA-C\`]`;
    expect(parseRuleDeclarations(source).sort()).toEqual(["R-COMMON-A", "R-FFA-C", "R-TAG-B-2"]);
  });

  it("reports unknown ids", () => {
    expect(unknownRules(["R-COMMON-A"], [{ rule: "R-COMMON-A" }, { rule: "R-FFA-X" }, { rule: "R-FFA-X" }])).toEqual(["R-FFA-X"]);
  });
});

describe("outcome marker", () => {
  it("does not count Grass start checks as rule outcomes", () => {
    const controls = GRASS_DECK_COUNTS_SCENARIOS.filter(scenario => scenario.id.includes("no-eligible-opponent"));
    expect(controls).toHaveLength(3);
    expect(scenarioRefs(controls)).toEqual([]);
  });

  it("needs an expect step after an action step", () => {
    expect(outcomeAsserts([{ op: "endTurn" }, { op: "expectLp" }])).toBe(true);
    expect(outcomeAsserts([{ op: "attack" }, { op: "pickOpponent" }, { op: "expectResult" }])).toBe(true);
  });

  it("does not count a check of the start state or of the first prompt", () => {
    expect(outcomeAsserts([])).toBe(false);
    expect(outcomeAsserts([{ op: "expectPrompt" }])).toBe(false);
    expect(outcomeAsserts([{ op: "expectBoard" }, { op: "expectLp" }, { op: "phase" }])).toBe(false);
    expect(outcomeAsserts([{ op: "phase" }, { op: "pass" }])).toBe(false);
  });

  it("makes a scenario an outcome reference only when it declares rules, asserts, and is not a known bug", () => {
    const refs = scenarioRefs([
      { id: "good", rules: ["R-COMMON-A"], steps: [{ op: "phase" }, { op: "expectLp" }] },
      { id: "no-assert", rules: ["R-COMMON-A", "R-TAG-B-2"], steps: [{ op: "expectPrompt" }] },
      { id: "bug", rules: ["R-FFA-C"], knownBug: "wrong", steps: [{ op: "phase" }, { op: "expectLp" }] },
      { id: "no-rules", steps: [{ op: "phase" }, { op: "expectLp" }] },
      { id: "empty-rules", rules: [], steps: [{ op: "phase" }, { op: "expectLp" }] },
    ]);
    expect(refs).toEqual([
      { rule: "R-COMMON-A", ref: ref("good", "outcome") },
      { rule: "R-COMMON-A", ref: ref("no-assert", "weak") },
      { rule: "R-TAG-B-2", ref: ref("no-assert", "weak") },
      { rule: "R-FFA-C", ref: ref("bug", "weak") },
    ]);
  });
});

describe("rule rows", () => {
  const rules = parseAdrRules(adr);

  it("counts only outcome references; presets, sketches and weak scenarios never cover a rule", () => {
    const rows = buildRows(rules, [
      { rule: "R-COMMON-A", ref: ref("t.test.ts", "outcome") },
      { rule: "R-COMMON-A", ref: ref("mp-1", "sketch") },
      { rule: "R-TAG-B-2", ref: ref("src/presets/p.ts", "preset") },
      { rule: "R-TAG-B-2", ref: ref("mp-2", "sketch") },
      { rule: "R-FFA-C", ref: ref("weak-one", "weak") },
    ]);
    expect(rows.map((r) => r.status)).toEqual(["covered", "none", "none"]);
  });

  it("uses the allow-list for rules with no outcome test, with the reason", () => {
    const pending = { "R-TAG-B-2": "waits for F7/live core", "R-FFA-C": "waits for F7/live core" };
    const rows = buildRows(rules, [{ rule: "R-COMMON-A", ref: ref("s", "outcome") }, { rule: "R-FFA-C", ref: ref("mp-3", "sketch") }], pending);
    expect(rows.map((r) => r.status)).toEqual(["covered", "pending", "pending"]);
    expect(rows[1]!.reason).toBe("waits for F7/live core");
    expect(staleEntries(rows, pending)).toEqual([]);
  });

  it("flags allow-list entries that are covered now or are not in the ADR", () => {
    const pending = { "R-COMMON-A": "waits for F7/live core", "R-FFA-GONE": "waits for F7/live core" };
    const rows = buildRows(rules, [{ rule: "R-COMMON-A", ref: ref("s", "outcome") }], pending);
    expect(staleEntries(rows, pending)).toEqual(["R-COMMON-A", "R-FFA-GONE"]);
  });

  it("marks a covered rule with a partial note, and flags partial entries for rules that are not covered", () => {
    const partial = { "R-COMMON-A": "the Deck clause is not proven", "R-TAG-B-2": "x", "R-FFA-GONE": "x" };
    const rows = buildRows(rules, [{ rule: "R-COMMON-A", ref: ref("scn-a", "outcome") }, { rule: "R-FFA-C", ref: ref("mp-3", "sketch") }], {}, partial);
    expect(rows[0]!.partial).toBe("the Deck clause is not proven");
    expect(renderTable(rows, 1)).toContain("| covered (partial: the Deck clause is not proven) | `scn-a` |");
    expect(stalePartial(rows, partial)).toEqual(["R-TAG-B-2", "R-FFA-GONE"]);
  });

  it("renders the summary, the reasons and the not-counted references", () => {
    const rows = buildRows(
      rules,
      [
        { rule: "R-COMMON-A", ref: ref("scn-a", "outcome") },
        { rule: "R-COMMON-A", ref: ref("src/presets/p.ts", "preset") },
        { rule: "R-TAG-B-2", ref: ref("mp-2", "sketch") },
        { rule: "R-TAG-B-2", ref: ref("mp-3", "sketch") },
      ],
      { "R-TAG-B-2": "waits for F7/live core" },
    );
    const table = renderTable(rows, 2);
    expect(table).toContain("3 rules. 1 covered by an outcome scenario, 1 pending (allow-list), 1 with no test and no allow-list entry. 2 catalog sketches");
    expect(table).toContain("with a pipe");
    expect(table).toContain("| covered | `scn-a` | `src/presets/p.ts` (preset) |");
    expect(table).toContain("| pending: waits for F7/live core | - | 2 catalog sketches |");
    expect(table).toContain("| none | - | - |");
  });
});

describe("original scenario runners", () => {
  it("registers the card lists with the scenario runner", async () => {
    const names = new Set([
      "ALL_PLAYER_EXTRA_SCENARIOS", "ALL_PLAYER_ZONE_GAPS_SCENARIOS", "BANQUET_RETURN_OWNER_SCENARIOS",
      "GLOBAL_FLAG_MEMORY_SCENARIOS", "GRASS_DECK_COUNTS_SCENARIOS", "GRASS_TAG_DECLARED_DECK_SCENARIOS",
      "GUMBLAR_HAND_BINDING_SCENARIOS", "PAIR_BEAR_BINDING_SCENARIOS", "PAIRED_HIDDEN_ZONES_SCENARIOS",
      "PAIRED_ZONE_TRIGGERS_SCENARIOS", "PLAYER_ALL_LP_PAIR_SCENARIOS", "UNDERWORLD_CIRCLE_STANDBY_SCENARIOS",
    ]);
    const lists = (await loadScenarioLists()).filter(list => names.has(list.name));
    expect(lists).toHaveLength(names.size);
    expect(unrunLists(lists, runnerSources())).toEqual([]);
  });
});

describe("scenario lists", () => {
  const scenario = (id: string) => ({ id, rules: ["R-COMMON-A"], steps: [{ op: "phase" }, { op: "expectLp" }] });
  const list = (name: string, ...ids: string[]) => ({ file: `/x/${name}.ts`, name, scenarios: ids.map(scenario) });

  it("throws when two lists use the same scenario id", () => {
    expect(() => uniqueScenarios([list("A", "one"), list("B", "one")])).toThrow(/Duplicate scenario id "one"/);
    expect(uniqueScenarios([list("A", "one"), list("B", "two")]).map((s) => s.id)).toEqual(["one", "two"]);
  });

  it("finds a list that no test file passes to runScenarios", () => {
    const lists = [list("RUN_ME", "a"), list("FORGOTTEN", "b")];
    const sources = ['runScenarios("x", RUN_ME);', 'const FORGOTTEN_2 = 1; // FORGOTTEN', "runScenarios(\n  \"y\",\n  OTHER,\n);"];
    const unrun = unrunLists(lists, sources);
    expect(unrun).toHaveLength(1);
    expect(unrun[0]).toContain(":FORGOTTEN");
  });
});

describe("allow-list file", () => {
  it("has no pending entry for a rule with an outcome scenario", async () => {
    const rules = parseAdrRules(readFileSync(new URL("../../../docs/adr/0002-multiplayer-duel-rules.md", import.meta.url), "utf8"));
    const refs = scenarioRefs((await loadScenarioLists()).flatMap(list => list.scenarios));
    const pending = loadPending(pendingListPath);
    expect(staleEntries(buildRows(rules, refs, pending), pending)).toEqual([]);
  });

  const withFile = (text: string, check: (path: string) => void) => {
    const directory = mkdtempSync(join(tmpdir(), "rule-coverage-"));
    try {
      const path = join(directory, "pending.json");
      writeFileSync(path, text);
      check(path);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };

  it("reads rule ids with reasons and treats a missing file as empty", () => {
    withFile('{"R-COMMON-A": "waits for F7/live core"}', (path) => expect(loadPending(path)).toEqual({ "R-COMMON-A": "waits for F7/live core" }));
    expect(loadPending(join(tmpdir(), "no-such-rule-coverage-file.json"))).toEqual({});
  });

  it("rejects an entry with no reason and a file that is not an object", () => {
    withFile('{"R-COMMON-A": " "}', (path) => expect(() => loadPending(path)).toThrow(/needs a reason/));
    withFile('["R-COMMON-A"]', (path) => expect(() => loadPending(path)).toThrow(/expected an object/));
  });
});

describe("the real repository", () => {
  it("passes --strict: every rule is covered by an outcome scenario or is in the allow-list, and the allow-list has no stale entry", async () => {
    const rules = parseAdrRules(readFileSync(new URL("../../../docs/adr/0002-multiplayer-duel-rules.md", import.meta.url), "utf8"));
    const pending = loadPending(pendingListPath);
    const { refs } = await collect();
    const partial = loadPending(partialListPath);
    const rows = buildRows(rules, refs, pending, partial);
    expect(stalePartial(rows, partial)).toEqual([]);
    expect(unknownRules(rules.map((r) => r.id), refs)).toEqual([]);
    expect(rows.filter((row) => row.status === "none").map((row) => row.id)).toEqual([]);
    expect(staleEntries(rows, pending)).toEqual([]);
    expect(refs.filter((r) => r.ref.kind === "weak").map((r) => r.ref.test)).toEqual([]);
    for (const reason of Object.values(pending)) expect(reason.trim()).not.toBe("");
  });

  it("has a doc that is the table this script makes", async () => {
    const rules = parseAdrRules(readFileSync(new URL("../../../docs/adr/0002-multiplayer-duel-rules.md", import.meta.url), "utf8"));
    const { refs, sketchEntries } = await collect();
    const table = renderTable(buildRows(rules, refs, loadPending(pendingListPath), loadPending(partialListPath)), sketchEntries);
    expect(readFileSync(new URL("../../../docs/specs/multiplayer-rule-coverage.md", import.meta.url), "utf8")).toBe(table);
  });

  it("runs every scenario list that declares rules: a test file passes it to runScenarios", async () => {
    expect(unrunLists(await loadScenarioLists(), runnerSources())).toEqual([]);
  });

  it("counts a rule only through scenarios that exist and assert an outcome", async () => {
    const scenarios = await loadScenarios();
    const { refs } = await collect();
    const outcome = refs.filter((r) => r.ref.kind === "outcome");
    expect(outcome.length).toBeGreaterThan(0);
    for (const { ref: found } of outcome) {
      const scenario = scenarios.find((s) => s.id === found.test);
      expect(scenario, found.test).toBeDefined();
      expect(outcomeAsserts(scenario!.steps), found.test).toBe(true);
      expect(scenario!.knownBug, found.test).toBeUndefined();
    }
  });

  it("does not count the presets or the catalog", async () => {
    const { refs } = await collect();
    expect(refs.some((r) => r.ref.kind === "preset")).toBe(true);
    expect(refs.some((r) => r.ref.kind === "sketch")).toBe(true);
    expect(refs.filter((r) => r.ref.kind === "outcome").every((r) => !r.ref.test.startsWith("src/presets/") && !r.ref.test.startsWith("mp-"))).toBe(true);
  });
});

it("counts the real host immediate surrender proof", async () => {
  const { refs } = await collect();
  const proof = refs.find((entry) => entry.rule === "R-COMMON-SURRENDER-EOT" && entry.ref.kind === "host-outcome");
  expect(proof?.ref.test).toBe("tests/host-surrender-eot.test.ts");
  expect(buildRows([{ id: "R-COMMON-SURRENDER-EOT", title: "Immediate surrender" }], refs)[0]?.status).toBe("covered");
});
