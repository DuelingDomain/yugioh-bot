import { describe, expect, it } from "vitest";
import { expectKnownFailure, type KnownGap } from "./support/expected-failure.js";

const GAP: KnownGap = { patch: "test.patch", spec: "spec.md:1", failsWith: ["step 3 expectBoard", "p0.hand"] };

describe("expectKnownFailure", () => {
  it("accepts the known failure", async () => {
    await expectKnownFailure(GAP, () => { throw new Error("[x] step 3 expectBoard({})\nBoard differs:\n  p0.hand: expected 2"); });
  });
  it("keeps any other failure red and names the cause", async () => {
    await expect(expectKnownFailure(GAP, () => { throw new TypeError("Cannot read properties of undefined"); }))
      .rejects.toThrow(/not the known gap \(test\.patch, spec\.md:1\)/);
    await expect(expectKnownFailure(GAP, () => { throw new Error("[x] step 4 expectBoard({}) p0.hand"); }))
      .rejects.toThrow(/does not contain: "step 3 expectBoard"/);
  });
  it("fails with a clear message when the gap is fixed", async () => {
    await expect(expectKnownFailure(GAP, async () => undefined))
      .rejects.toThrow("known gap fixed: remove the expected-failure mark");
  });
});
