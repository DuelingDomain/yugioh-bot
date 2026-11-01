import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluateBridges } from "../evaluate-bridges.js";

describe("bridge golden evaluation", () => {
  it("counts deep positives separately from strict Suggestions recall", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const directory = mkdtempSync(join(status, "bridge-evaluation-")), path = join(directory, "golden.json");
    const golden = JSON.parse(readFileSync(join(root, "packages/shared/data/effects/bridges-golden.json"), "utf8"));
    try {
      const deep = golden.pairs.filter((pair: { tier?: string }) => pair.tier === "deep");
      writeFileSync(path, JSON.stringify({ core_sources: ["Odion"], pairs: deep }));
      const result = evaluateBridges(path);
      expect(result.advanced).toMatchObject({ positive_labels: 0, recall_at_4: null, recall_at_10: null, deep_positive_labels: 2, deep_hits_at_10: 2, deep_recall_at_10: 1, access_path_labels: 1, access_path_hits: 1, access_path_recall: 1, synergy_labels: 1, synergy_hits: 1, synergy_recall: 1, known_false_bridges: 0 });
      expect(result.genesys).toMatchObject({ positive_labels: 0, deep_positive_labels: 1, deep_hits_at_10: 1, deep_recall_at_10: 1, access_path_labels: 1, access_path_hits: 1, access_path_recall: 1, synergy_labels: 1, synergy_hits: 1, synergy_recall: 1, known_false_bridges: 0 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);
  it("checks resource synergy evidence without counting it as bridge recall or precision", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const directory = mkdtempSync(join(status, "bridge-evaluation-")), path = join(directory, "golden.json");
    const golden = JSON.parse(readFileSync(join(root, "packages/shared/data/effects/bridges-golden.json"), "utf8"));
    try {
      writeFileSync(path, JSON.stringify({ core_sources: ["Toy"], pairs: golden.pairs.filter((pair: { expected: string }) => pair.expected === "synergy") }));
      const result = evaluateBridges(path);
      for (const format of ["advanced", "genesys"] as const) {
        expect(result[format]).toMatchObject({ positive_labels: 0, recall_at_4: null, recall_at_10: null,
          deep_positive_labels: 0, deep_recall_at_10: null, access_path_labels: 0, access_path_recall: null,
          labelled_top_5: 0, judged_precision_at_5: null, synergy_labels: 1, synergy_hits: 1, synergy_recall: 1, known_false_bridges: 0 });
        expect(result[format].outcomes).toEqual([expect.objectContaining({ source: "Toy", target: "Ashtra", expected: "synergy",
          rank: null, synergy_ok: true, grade: "Niche", grade_ok: true, false_bridge: false,
          matched_evidence_cards: [24878656, 58132856, 65504487, 1710647] })]);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);
  it("rejects nonexistent engine labels and excluded labels that still exist", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const directory = mkdtempSync(join(status, "bridge-evaluation-")), path = join(directory, "golden.json");
    const golden = JSON.parse(readFileSync(join(root, "packages/shared/data/effects/bridges-golden.json"), "utf8"));
    try {
      writeFileSync(path, JSON.stringify({ ...golden, pairs: [{ ...golden.pairs[0], target: "Missing engine fixture" }] }));
      expect(() => evaluateBridges(path)).toThrow("Golden target group does not exist");
      writeFileSync(path, JSON.stringify({ ...golden, pairs: [{ ...golden.pairs[0], target: "Argostars", expected: "not_bridge", excluded_group: true }] }));
      expect(() => evaluateBridges(path)).toThrow("Excluded label group is still an engine");
      writeFileSync(path, JSON.stringify({ ...golden, pairs: [{ ...golden.pairs[0], source: "Toy", target: "Ashtra", expected: "synergy", tier: "deep", access_path: true }] }));
      expect(() => evaluateBridges(path)).toThrow("Invalid or empty bridge golden set");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 20_000);

  it("fails the CLI gate when labelled synergy lacks checked resource evidence", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const directory = mkdtempSync(join(status, "bridge-evaluation-")), path = join(directory, "golden.json");
    const golden = JSON.parse(readFileSync(join(root, "packages/shared/data/effects/bridges-golden.json"), "utf8"));
    try {
      writeFileSync(path, JSON.stringify({ ...golden, pairs: [...golden.pairs, { source: "Toy", target: "Argostars", format: "advanced",
        expected: "synergy", tier: "deep", why: "Regression fixture: no checked resource consumer exists.", source_url: "https://db.ygoprodeck.com/api/v7/cardinfo.php?name=Toy%20Box" }] }));
      const result = spawnSync(process.execPath, ["--conditions=source", "--import", "tsx", join(root, "scripts/effects/evaluate-bridges.ts"), path, "--check"], { cwd: root, encoding: "utf8", timeout: 20_000 });
      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.advanced).toMatchObject({ precision_at_5: 1, judgement_coverage_at_5: 1, deep_recall_at_10: 1,
        access_path_recall: 1, known_false_bridges: 0, synergy_labels: 2, synergy_hits: 1, synergy_recall: 0.5 });
      expect(report.advanced.outcomes).toContainEqual(expect.objectContaining({ target: "Argostars", expected: "synergy", synergy_ok: false, grade: null, matched_evidence_cards: [] }));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 25_000);

  it("fails the CLI gate when top-five judgements are missing", () => {
    const root = resolve(import.meta.dirname, "../../.."), status = join(root, ".status");
    mkdirSync(status, { recursive: true });
    const directory = mkdtempSync(join(status, "bridge-evaluation-")), path = join(directory, "golden.json");
    const golden = JSON.parse(readFileSync(join(root, "packages/shared/data/effects/bridges-golden.json"), "utf8"));
    try {
      writeFileSync(path, JSON.stringify({ ...golden, pairs: golden.pairs.filter((pair: { source: string }) => !golden.core_sources.includes(pair.source)) }));
      for (const gate of ["--check", "--strict-precision"]) {
        const result = spawnSync(process.execPath, ["--conditions=source", "--import", "tsx", join(root, "scripts/effects/evaluate-bridges.ts"), path, gate], { cwd: root, encoding: "utf8", timeout: 20_000 });
        expect(result.status).toBe(1);
        const report = JSON.parse(result.stdout);
        expect(report.advanced.judgement_coverage_at_5).toBe(0);
        expect(report.advanced.precision_at_5).toBe(0);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }, 25_000);
});
