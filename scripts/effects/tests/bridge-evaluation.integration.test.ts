import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { evaluateBridges } from "../evaluate-bridges.js";

describe("bridge golden evaluation", () => {
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
