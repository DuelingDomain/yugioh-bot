import { afterAll, vi } from "vitest";
import { rmSync } from "node:fs";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DF_LOCAL_ZONE_VIEWER_SCENARIOS } from "./df-local-zone-viewer.js";

const fixture = await vi.hoisted(async () => {
  const { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { default: Database } = await import("better-sqlite3");
  const source = process.env.DUEL_DATA_DIR;
  if (!source || !existsSync(join(source, "cards.cdb"))) return { directory: "", source };
  const directory = mkdtempSync(join(tmpdir(), "df-local-zone-viewer-data-"));
  for (const name of ["cards.cdb", "strings.conf", "card-scripts", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
    if (existsSync(join(source, name))) cpSync(join(source, name), join(directory, name), { recursive: true });
  }
  const db = new Database(join(directory, "cards.cdb"));
  const script = readFileSync(new URL("./fixtures/df-local-zone-viewer.lua", import.meta.url), "utf8");
  try {
    for (const [code, count] of [[95200109, 2], [95200110, 3]]) {
      db.prepare("INSERT OR REPLACE INTO datas VALUES (?,3,0,0,2,0,0,0,0,0,0)").run(code);
      db.prepare(`INSERT OR REPLACE INTO texts VALUES (${Array(19).fill("?").join(",")})`)
        .run(code, `Local Zone Viewer Proof FFA${count + 1}`, "Test fixture: read opponent Link and column zones in a cost.", ...Array(16).fill(""));
      writeFileSync(join(directory, `card-scripts/official/c${code}.lua`), `${script}\ns.expected_count=${count}\n`);
    }
  } finally { db.close(); }
  process.env.DUEL_DATA_DIR = directory;
  return { directory, source };
});
vi.mock("../../engine-data-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine-data-dir.js")>();
  return fixture.directory ? { ...actual, engineDataDirectory: fixture.directory } : actual;
});
afterAll(() => {
  if (fixture.source === undefined) delete process.env.DUEL_DATA_DIR;
  else process.env.DUEL_DATA_DIR = fixture.source;
  if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true });
});
describeWithCores("live local Card zone viewer", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/df-local-zone-viewer", DF_LOCAL_ZONE_VIEWER_SCENARIOS);
});
