import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, rmSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { emptyCardQuery } from "@yugidraft/shared/duels";
import { initializeServerCardEffects } from "../src/card-effect-startup.js";
import { queryCards } from "../src/card-search.js";
import { loadCardDatabase } from "../src/cards.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";

it.each(["0", undefined])("boots effect search without bridge artifacts when BRIDGES_ENABLED=%s", async flag => {
  const directory = createHostDataFixture([{ code: 4929256, name: "Mobius the Frost Monarch", type: 33 }]);
  const temporary = mkdtempSync(join(tmpdir(), "bridge-disabled-startup-"));
  const cards = loadCardDatabase(directory), db = new Database(":memory:");
  migrate(db);
  const spools = new Set<string>();
  const watcher = watch(temporary, (_event, name) => { if (name?.startsWith("effect-artifact-stream-")) spools.add(name); });
  vi.stubEnv("EFFECT_SEARCH", "1");
  vi.stubEnv("BRIDGES_ENABLED", flag);
  vi.stubEnv("TMPDIR", temporary);
  try {
    const started = performance.now();
    await initializeServerCardEffects(db, cards, directory);
    await new Promise(resolve => setTimeout(resolve, 25));
    console.info("BRIDGES_DISABLED_STARTUP_MS", Math.round(performance.now() - started));
    // Only the five effect-tag/profile/release files are spooled. No bridge files are opened.
    expect(spools.size).toBe(5);
    expect(readdirSync(temporary)).toEqual([]);
    for (const table of ["card_capability", "archetype_bridge", "bridge_artifact_import", "bridge_judgement", "bridge_graph"]) {
      expect(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
    const result = queryCards(cards, { ...emptyCardQuery(), text: "Monarch synergy" });
    expect(result.effectHits?.map(card => card.code)).toContain(4929256);
  } finally {
    watcher.close(); vi.unstubAllEnvs(); cards.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
    rmSync(temporary, { recursive: true, force: true });
  }
}, 30_000);
