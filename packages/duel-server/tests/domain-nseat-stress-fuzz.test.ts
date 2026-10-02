import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { playDuel } from "./fuzz-n/driver.js";
import { currentDomainMultiWasm, describeWithCores, needs } from "./support/cores.js";
import { liveNseat } from "./support/live-nseat.js";
import { engineDataDirectory } from "./engine-data-dir.js";

describeWithCores("Domain fuzz proves real Deck Master play", [liveNseat, ...needs.domainMulti()], () => {
  for (const format of ["ffa3", "ffa4", "tag"] as const) {
    it(`${format}: counts real leaves from the zone`, async () => {
      const bytes = readFileSync(currentDomainMultiWasm());
      const result = await playDuel({ format, seed: 1, mode: "domain", masterRule: 5, maxSteps: 1000, eliminateRate: 0.5 }, {
        dataDirectory: engineDataDirectory,
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      });
      expect(result.failure).toBeNull();
      expect(result.decks.every((deck) => !!deck.deckMaster)).toBe(true);
      expect(result.stats["domain-masters"]).toBe(result.decks.length);
      expect(Object.entries(result.stats).filter(([key]) => key.startsWith("domain-leaves-seat-")).reduce((sum, [, n]) => sum + n, 0)).toBeGreaterThan(0);
    }, 30_000);
  }
});
