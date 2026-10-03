import { expect, it } from "vitest";
import { describeWithCores, itEachWithCores, itWithCores, needs } from "../cores.js";

// Run by tests/support/cores.test.ts in a child process, with DUEL_DATA_DIR pointing to an empty folder.
const missing = [needs.standard(), needs.cards()];

describeWithCores("fixture suite", missing, () => {
  it("never runs", () => {
    expect(true).toBe(true);
  });
});

itWithCores("fixture single test", needs.multi("/nonexistent/ocgcore.multi.wasm"), () => {
  expect(true).toBe(true);
});

itEachWithCores<[number]>(needs.domainMulti(undefined, "/nonexistent/ocgcore.multi-domain.wasm"), [[1], [2]], "fixture each %s", (n) => {
  expect(n).toBeGreaterThan(0);
});

describeWithCores("fixture suite with cores present", [], () => {
  it("runs", () => {
    expect(true).toBe(true);
  });
});

itEachWithCores<[number]>([], [[1], [2]], "fixture each present %s", (n) => {
  expect(n).toBeGreaterThan(0);
});
