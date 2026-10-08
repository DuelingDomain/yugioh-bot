import { afterAll, afterEach, expect, vi } from "vitest";
import { rmSync } from "node:fs";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { DF_SHARED_ZONE_FIX4_SCENARIOS } from "./df-shared-zone-fix4.js";
import { DF_SHARED_ZONE_SCENARIOS } from "./df-shared-zones.js";

const luaErrors = vi.hoisted(() => [] as string[]);
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return { ...actual, default: async (options: Parameters<typeof actual.default>[0]) => {
    const core = await actual.default(options);
    const createDuel = core.createDuel.bind(core);
    core.createDuel = (options) => createDuel({ ...options, errorHandler: (type, text) => {
      if (type === actual.OcgLogType.ERROR || type === actual.OcgLogType.UNDEFINED) luaErrors.push(text);
      options.errorHandler?.(type, text);
    } });
    return core;
  } };
});
// A Lua assertion error can give the same destroyed state as the p1 proof.
// Check the real core log even if the engine does not throw that error.
afterEach(() => expect(luaErrors.splice(0), "The C6 proof must have no Lua errors").toEqual([]));

const fixture = await vi.hoisted(async () => {
  const { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { default: Database } = await import("better-sqlite3");
  const source = process.env.DUEL_DATA_DIR;
  if (!source || !existsSync(join(source, "cards.cdb"))) return { directory: "", source };
  const directory = mkdtempSync(join(tmpdir(), "df-shared-zones-data-"));
  for (const name of ["cards.cdb", "strings.conf", "card-scripts", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"])
    if (existsSync(join(source, name))) cpSync(join(source, name), join(directory, name), { recursive: true });
  const db = new Database(join(directory, "cards.cdb"));
  try {
    // This old script is loadable when a supplied database contains its passcode.
    db.exec("INSERT OR REPLACE INTO datas SELECT 5043020,ot,0,setcode,type,atk,def,level,race,attribute,category FROM datas WHERE id=5043010");
    db.exec("INSERT OR REPLACE INTO texts SELECT 5043020,'Firewall Dragon (pre-errata)',desc,str1,str2,str3,str4,str5,str6,str7,str8,str9,str10,str11,str12,str13,str14,str15,str16 FROM texts WHERE id=5043010");
    for (const code of [95200120, 95200121, 95200122, 95200123, 95200124, 95200125, 95200126, 95200127, 95200128, 95200129, 95200130, 95200131, 95200132, 95200133, 95200134, 95200135, 95200136, 95200137, 95200138, 95200139, 95200140, 95200141, 95200142, 95200143, 95200144, 95200145, 95200146, 95200147, 95200148, 95200149, 95200150, 95200151, 95200152, 95200153, 95200154, 95200155, 95200156, 95200157]) {
      const foreignColumn = code >= 95200155;
      const secondReview = code >= 95200143;
      const review = code >= 95200134;
      const mask = !review && code >= 95200122 && code !== 95200131 && code !== 95200133;
      db.prepare("INSERT OR REPLACE INTO datas VALUES (?,3,0,0,?,0,0,0,0,0,0)").run(code, mask ? 0x20002 : 2);
      db.prepare(`INSERT OR REPLACE INTO texts VALUES (${Array(19).fill("?").join(",")})`)
        .run(code, `Shared Zone Proof ${code}`, "Test fixture: read geometry in an activation cost.", ...Array(16).fill(""));
      writeFileSync(join(directory, `card-scripts/official/c${code}.lua`), readFileSync(new URL(foreignColumn ? "./fixtures/df-shared-zone-column.lua" : secondReview ? "./fixtures/df-shared-zone-review2.lua" : review ? "./fixtures/df-shared-zone-review.lua" : mask ? "./fixtures/df-shared-zone-mask.lua" : "./fixtures/df-shared-zones.lua", import.meta.url), "utf8"));
    }
    for (const code of [95200158, 95200159, 95200160]) {
      db.prepare("INSERT OR REPLACE INTO datas VALUES (?,3,0,0,2,0,0,0,0,0,0)").run(code);
      db.prepare(`INSERT OR REPLACE INTO texts VALUES (${Array(19).fill("?").join(",")})`)
        .run(code, `Tag Review Proof ${code}`, "Check Tag disabled zones or move a partner Field Spell.", ...Array(16).fill(""));
      writeFileSync(join(directory, `card-scripts/official/c${code}.lua`), readFileSync(new URL("./fixtures/tag-review.lua", import.meta.url), "utf8"));
    }
  } finally { db.close(); }
  // The real immunity value is evaluated in an unbound callback scope. It must
  // use the incoming effect's exact seat, without an MPSeat(1) fallback.
  const paranoia = join(directory, "card-scripts/official/c81965543.lua");
  writeFileSync(paranoia, readFileSync(paranoia, "utf8") + `
local proof_is_column=Card.IsColumn
function Card.IsColumn(c,seq,tp,loc,source)
  if aux.MPGeometryShared() and c:IsCode(81965543) then
    assert(not Duel.MPBound(), "Paranoia proof must enter IsColumn without a bound opponent")
  end
  return proof_is_column(c,seq,tp,loc,source)
end
`);
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
describeWithCores("live FFA4 shared zones", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/df-shared-zones", [...DF_SHARED_ZONE_SCENARIOS, ...DF_SHARED_ZONE_FIX4_SCENARIOS]);
});
