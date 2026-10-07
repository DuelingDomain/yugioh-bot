import { afterAll, afterEach, expect, vi } from "vitest";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { FFA3_COLUMN_SCENARIOS } from "./ffa3-columns.js";

const luaErrors = vi.hoisted(() => [] as string[]);
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options), create = core.createDuel.bind(core);
    core.createDuel = options => create({ ...options, errorHandler: (type, text) => {
      if (type === actual.OcgLogType.ERROR || type === actual.OcgLogType.UNDEFINED) luaErrors.push(text);
      options.errorHandler?.(type, text);
    } });
    return core;
  } };
});
afterEach(() => expect(luaErrors.splice(0), "Column scenarios must have no Lua errors").toEqual([]));
const fixture = await vi.hoisted(async () => {
  const { cpSync, existsSync, mkdtempSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { default: Database } = await import("better-sqlite3");
  const source = process.env.DUEL_DATA_DIR;
  if (!source || !existsSync(join(source, "cards.cdb"))) return { directory: "", source };
  const directory = mkdtempSync(join(tmpdir(), "ffa3-columns-"));
  for (const name of ["cards.cdb", "strings.conf", "card-scripts", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm"])
    if (existsSync(join(source, name))) cpSync(join(source, name), join(directory, name), { recursive: true });
  const db = new Database(join(directory, "cards.cdb"));
  try {
    // Pinned scripts include Bingo Card; pinned cards.cdb has no row yet.
    // Normal Trap metadata only. Load its actual stock script and checked overlay.
    db.exec("INSERT OR IGNORE INTO datas SELECT 99505609,ot,0,0,type,atk,def,level,race,attribute,category FROM datas WHERE id=10045474");
    db.exec("INSERT OR IGNORE INTO texts SELECT 99505609,'Bingo Card','Column test fixture',str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 FROM texts WHERE id=10045474");
  } finally { db.close(); }
  process.env.DUEL_DATA_DIR = directory;
  return { directory, source };
});
vi.mock("../../engine-data-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine-data-dir.js")>();
  return fixture.directory ? { ...actual, engineDataDirectory: fixture.directory } : actual;
});
afterAll(async () => {
  if (fixture.source === undefined) delete process.env.DUEL_DATA_DIR;
  else process.env.DUEL_DATA_DIR = fixture.source;
  if (fixture.directory) (await import("node:fs")).rmSync(fixture.directory, { recursive: true, force: true });
});

describeWithCores("live FFA3 column peers", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/ffa3-columns", FFA3_COLUMN_SCENARIOS);
});
