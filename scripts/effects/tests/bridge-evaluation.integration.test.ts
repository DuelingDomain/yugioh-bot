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
      expect(result.advanced).toMatchObject({ positive_labels: 0, recall_at_4: null, recall_at_10: null, deep_positive_labels: 2, deep_hits_at_10: 2, deep_recall_at_10: 1, access_path_labels: 5, access_path_hits: 5, access_path_recall: 1, known_false_bridges: 0 });
      expect(result.genesys).toMatchObject({ positive_labels: 0, deep_positive_labels: 1, deep_hits_at_10: 1, deep_recall_at_10: 1, access_path_labels: 5, access_path_hits: 5, access_path_recall: 1, known_false_bridges: 0 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
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
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

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
