import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { playDuel } from "./fuzz-n/driver.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { engineDataDirectory } from "./engine-data-dir.js";

// Tag seed 60: Borreload Liberator Dragon targets the partner's Metaion, which
// cannot be destroyed. Its chain count resets after each chain. The action is
// legal and has no result. Repeating it is a driver loop; two passes advance
// the phase. NChecker reads every seat and spectator after every real answer.
describeWithCores("Domain fuzz can leave an optional chain loop", [liveNseat, ...needs.domainMulti()], () => {
  it("Tag seed 60 reaches a result after repeated effects with no result", async () => {
    const bytes = readFileSync(currentDomainMultiWasm());
    const previousNow = Date.now;
    Date.now = () => Date.UTC(2026, 0, 1);
    try {
      const result = await playDuel({ format: "tag", seed: 60, mode: "domain", masterRule: 5, maxSteps: 1000, eliminateRate: 0.5 }, {
        dataDirectory: engineDataDirectory,
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      expect(result.failure).toBeNull();
      expect(result.status).toBe("ended");
      expect(result.result).not.toBeNull();
      expect(result.stats["chain-stall-passes"]).toBeGreaterThan(0);
    } finally { Date.now = previousNow; }
  }, 30_000);
});
