import { join } from "node:path";
import { createVitest } from "vitest/node";
import { verifyFiles } from "./test-shards.mjs";

function verifyRun(result, expected) {
  if (result.unhandledErrors.length) throw new AggregateError(result.unhandledErrors, "Unhandled Vitest errors");
  verifyFiles(expected, result.testModules.map(module => module.relativeModuleId));
  const failed = result.testModules.filter(module => !module.ok());
  if (failed.length) throw new Error(`Vitest failed: ${failed.map(module => module.relativeModuleId).join(", ")}`);
}

/** Use Vitest's case IDs so even tests with identical titles have distinct assignments. */
export async function runEngineCaseShards(root, assignments, options = {}) {
  const byFile = Map.groupBy(assignments, task => task.file);
  const files = [...byFile.keys()];
  const vitest = await createVitest("test", { root, watch: false, run: true, cache: false, ...options });
  try {
    await vitest.standalone();
    const specs = await vitest.globTestSpecifications(files.map(file => join(root, file)));
    verifyFiles(files, specs.map(spec => spec.moduleId.slice(root.length + 1)));
    const split = files.filter(file => byFile.get(file)[0].count > 1);
    const splitFiles = new Set(split.map(file => join(root, file)));
    const whole = specs.filter(spec => !splitFiles.has(spec.moduleId));
    const filtered = [];
    const expectedIds = new Map();
    if (split.length) {
      const collected = await vitest.collectTests(specs.filter(spec => splitFiles.has(spec.moduleId)));
      verifyRun(collected, split);
      for (const module of collected.testModules) {
        const legs = byFile.get(module.relativeModuleId);
        const { count } = legs[0];
        const indices = new Set(legs.map(leg => leg.index));
        const cases = [...module.children.allTests()].filter(test => test.options.mode === "run");
        const partitions = Array.from({ length: count }, () => []);
        cases.forEach((test, index) => partitions[index % count].push(test));
        verifyFiles(cases.map(test => test.id), partitions.flat().map(test => test.id));
        const testIds = [...indices].flatMap(index => partitions[index].map(test => test.id));
        // A stale file estimate can request more partitions than runnable cases.
        // An explicit empty ID list keeps that partition empty.
        filtered.push(module.project.createSpecification(module.moduleId, { testIds }));
        expectedIds.set(module.relativeModuleId, testIds);
      }
    }
    const result = await vitest.runTestSpecifications([...whole, ...filtered]);
    verifyRun(result, files);
    for (const module of result.testModules) {
      const expected = expectedIds.get(module.relativeModuleId);
      if (expected) verifyFiles(expected, [...module.children.allTests("passed")].map(test => test.id));
    }
    console.log(`Verified ${files.length} engine files and ${[...expectedIds.values()].flat().length} partitioned cases.`);
  } finally {
    await vitest.close();
  }
}
