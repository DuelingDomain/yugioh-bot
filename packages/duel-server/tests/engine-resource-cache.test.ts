import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { EngineResourceCache } from "../src/engine-resource-cache.js";
import { verifyWorkerEngineIdentity } from "../src/engine-resource-resolver.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { itWithCores, needs } from "./support/cores.js";

const dirs: string[] = [], caches: EngineResourceCache[] = [];
afterEach(async () => { for (const cache of caches.splice(0)) await cache.close(); vi.restoreAllMocks(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function bundle() {
  const dir = mkdtempSync(join(tmpdir(), "resource-cache-")); dirs.push(dir);
  mkdirSync(join(dir, "card-scripts/official"), { recursive: true });
  for (const [file, content] of Object.entries({ "manifest.json": JSON.stringify({ bundleVersion: "one" }),
    "cards.cdb": "cards", "ocgcore.standard.wasm": "core", "card-scripts/official/c1.lua": "script" })) writeFileSync(join(dir, file), content);
  return dir;
}
it("shares one hash per resource change, including nested script edits and bundle updates", async () => {
  const dir = bundle();
  const cache = new EngineResourceCache(); caches.push(cache);
  const options = { mode: "normal" as const, engine: "pinned" as const };
  const first = await cache.get(dir, options);
  const concurrent = await Promise.all(Array.from({ length: 10 }, () => cache.get(dir, options)));
  expect(concurrent.every(value => value === first)).toBe(true); expect(cache.hashCount).toBe(1);
  writeFileSync(join(dir, "card-scripts/official/c1.lua"), "edited script");
  const second = await cache.get(dir, options);
  expect(second.identity.cardScriptsHash).not.toBe(first.identity.cardScriptsHash); expect(cache.hashCount).toBe(2);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ bundleVersion: "two" }));
  expect((await cache.get(dir, options)).bundleVersion).toBe("two"); expect(cache.hashCount).toBe(3);
  writeFileSync(join(dir, "ocgcore.standard.wasm"), "changed core");
  expect(() => verifyWorkerEngineIdentity(dir, options, second.identity)).toThrowError(expect.objectContaining({ code: "ENGINE_UNAVAILABLE_FOR_SOURCE" }));
});
itWithCores("hashes a cold full bundle away from the host event loop for parallel replay/start lookups",
  [needs.cards(DATA), needs.scripts(DATA), needs.standard(DATA), needs.file("engine manifest", join(DATA, "manifest.json")),
    needs.file("legacy Domain core", join(DATA, "ocgcore.domain.legacy.wasm")), needs.scripts(DATA, "domain.legacy.lua")], async () => {
  const cache = new EngineResourceCache(); caches.push(cache);
  const delay = monitorEventLoopDelay({ resolution: 1 }); delay.enable();
  try {
    await new Promise(resolve => setTimeout(resolve, 20));
    const results = await Promise.all([...Array.from({ length: 10 }, () => cache.get(DATA, { mode: "normal", engine: "pinned" })),
      cache.get(DATA, { mode: "domain", engine: "legacy" })]);
    expect(results.slice(0, 10).every(value => value === results[0])).toBe(true);
    console.info(`Resource hash host lag p99: ${(delay.percentile(99) / 1e6).toFixed(2)} ms; max: ${(delay.max / 1e6).toFixed(2)} ms`);
    expect(delay.percentile(99) / 1e6).toBeLessThan(20);
  } finally { delay.disable(); }
});
