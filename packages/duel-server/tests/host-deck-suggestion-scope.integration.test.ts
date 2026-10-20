import Database from "better-sqlite3";
import { existsSync, readFileSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { createDuelHost, type DuelHost } from "../src/host.js";
import { cardScriptHash } from "../src/card-script-hash.js";
import { loadCardDatabase } from "../src/cards.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { seedIdentity } from "./helpers/identity.js";
import { createHmac } from "node:crypto";

const SECRET = "suggestion-scope-test";
const MASTER = 1001;
const SPELL = 1011;
const cards = [
  { code: MASTER, name: "Ally Master", type: 0x21 },
  { code: 1002, name: "Same attribute" },
  { code: 1003, name: "Same race" },
  { code: 1004, name: "Divine attribute" },
  { code: 1005, name: "Divine race" },
  { code: 1006, name: "Named Friend" },
  { code: 1007, name: "Archetype friend" },
  { code: 1008, name: "Outside" },
  { code: 1009, name: "Mentioned attribute" },
  { code: 1010, name: "Script Friend" },
  { code: SPELL, name: "Spell", type: 0x2 },
  { code: 1012, name: "Token", type: 0x4011 },
  { code: 1013, name: "Custom" },
  { code: 1014, name: "Missing script", type: 0x21 },
  { code: 1015, name: "Script archetype friend" },
  { code: 1020, name: "Same attribute", alias: 1002 },
  { code: 1030, name: "Master Variant", type: 0x21 },
  { code: 1040, name: "Shared one", type: 0x21 },
  { code: 1041, name: "Shared two", type: 0x21 },
  { code: 1050, name: "Link Master", type: 0x4000021 },
  { code: 1051, name: "Pendulum Master", type: 0x1000021 },
  { code: 1060, name: "OCG only" },
  { code: 1061, name: "Anime only" },
  { code: 1062, name: "Rush variant" },
  { code: 1063, name: "Pre-release variant" },
  { code: 1064, name: "TCG only" },
  { code: 55144522, name: "Pot of Greed", type: 0x2 },
  { code: 83764718, name: "Monster Reborn", type: 0x2 },
];

interface Scope {
  allowed: number[];
  limits: Record<number, number>;
  copyGroups?: Record<number, number>;
  version: string;
}

let directory: string;
let db: Database.Database;
let host: DuelHost;
let playerId: number;

beforeAll(() => {
  directory = createHostDataFixture(cards);
  const engine = new Database(join(directory, "cards.cdb"));
  try {
    engine.prepare("update datas set race = 2, attribute = 2 where id != ?").run(MASTER);
    engine.exec(`update datas set attribute = 1 where id in (1002,1020);
      update datas set race = 1 where id = 1003;
      update datas set attribute = 64 where id = 1004;
      update datas set race = 2097152 where id = 1005;
      update datas set setcode = 291 where id = ${MASTER};
      update datas set setcode = 4387 where id = 1007;
      update datas set setcode = 1110 where id = 1015;
      update datas set attribute = 4 where id = 1009;
      update datas set ot = 32 where id = 1013;
      update datas set attribute = 1, ot = 1 where id = 1060;
      update datas set ot = 8 where id = 1061;
      update datas set ot = 515 where id = 1062;
      update datas set ot = 256 where id = 1063;`);
    engine.exec("update datas set ot = 2 where id = 1064");
    engine.prepare("update texts set desc = ? where id = ?").run('Summon 1 "Named Friend". FIRE monsters gain 100 ATK.', MASTER);
    engine.prepare("update texts set desc = ? where id = ?").run('(This card\'s name is always treated as "Ally Master".)', 1030);
    for (const code of [1040, 1041]) engine.prepare("update texts set desc = ? where id = ?")
      .run('(This card\'s name is always treated as "Shared Name".)', code);
  } finally { engine.close(); }
  writeFileSync(join(directory, "strings.conf"), "!setname 0x123 Ally\n!setname 0x456 Script family\n");
  writeFileSync(join(directory, "card-scripts", "archetype_setcode_constants.lua"), "SET_SCRIPT_FAMILY = 0x456\n");
  writeFileSync(join(directory, "card-scripts", `c${MASTER}.lua`), "s.listed_names={1010}\ns.listed_series={SET_SCRIPT_FAMILY}\n");
  unlinkSync(join(directory, "card-scripts", "c1014.lua"));
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));
beforeEach(() => {
  vi.stubEnv("DUEL_STANDARD_1V1_ENGINE", "pinned");
  db = new Database(":memory:");
  migrate(db);
  playerId = seedIdentity(db).playerId;
  host = createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [],
    createWorker: vi.fn(() => { throw new Error("Suggestions must never start an engine"); }) });
});
afterEach(async () => { await host.close(); db.close(); vi.unstubAllEnvs(); });

function signedHeaders(raw: string, secret: string): Record<string, string> {
  return { "x-announce-signature": "sha256=" + createHmac("sha256", secret).update(raw).digest("hex") };
}

async function post(body: Record<string, unknown>) {
  const raw = JSON.stringify({ guildId: "g", playerId, op: "suggestion-scope", ...body });
  const response = await host.handle(new Request("http://local/internal/duel", { method: "POST", body: raw,
    headers: { ...signedHeaders(raw, SECRET) } }));
  return { status: response.status, data: await response.json() as Scope & { error?: string } };
}

describe("authoritative deck suggestion scope", () => {
  it("uses the printed card region of the selected Normal banlist", async () => {
    const tcg = await post({ suggestionFormat: "normal" });
    expect(tcg.data.allowed).toContain(1064);
    expect(tcg.data.allowed).not.toContain(1060);
    for (const banlist of ["ocg-2026-07", "ocg-2026-10"]) {
      const ocg = await post({ suggestionFormat: "normal", banlist });
      expect(ocg.status).toBe(200);
      expect(ocg.data.allowed).toContain(1060);
      expect(ocg.data.allowed).not.toContain(1064);
    }
  });

  it("uses exact default banlist, canonical artworks, playable admission and copy identities", async () => {
    const { status, data } = await post({ suggestionFormat: "normal" });
    expect(status).toBe(200);
    expect(data.allowed).toContain(1002);
    expect(data.allowed).not.toContain(1020);
    for (const code of [1012, 1013, 1014, 1060, 1061, 1062, 1063, 55144522]) expect(data.allowed).not.toContain(code);
    expect(data.allowed).toContain(83764718);
    expect(data.limits[83764718]).toBe(1);
    expect(data.copyGroups?.[1041]).toBe(data.copyGroups?.[1040] ?? 1040);
    expect(data.version).toMatch(/^[a-f0-9]{64}$/);
    expect((await post({ suggestionFormat: "normal" })).data.version).toBe(data.version);
    const unlimited = await post({ suggestionFormat: "normal", banlist: "none" });
    expect(unlimited.status).toBe(200);
    expect(unlimited.data.allowed).toContain(55144522);
    expect(unlimited.data.limits).toEqual({});
    expect(unlimited.data.version).not.toBe(data.version);
  });

  it("shares every validator Domain admission path and excludes the master identity", async () => {
    const { status, data } = await post({ suggestionFormat: "domain", deckMaster: MASTER });
    expect(status).toBe(200);
    for (const code of [1002, 1003, 1004, 1005, 1006, 1007, 1009, 1010, 1015, 1060, SPELL]) expect(data.allowed).toContain(code);
    for (const code of [MASTER, 1030, 1008, 1012, 1013, 1014]) expect(data.allowed).not.toContain(code);
    expect(data.allowed).toContain(55144522);
    expect(data.limits).toEqual({});
  });

  it("fails closed without a Domain master and validates master type", async () => {
    expect((await post({ suggestionFormat: "domain" })).data.allowed).toEqual([]);
    const invalid = await post({ suggestionFormat: "domain", deckMaster: SPELL });
    expect(invalid.status).toBe(400);
    expect(invalid.data.error).toContain("Spell or Trap");
    for (const deckMaster of [1050, 1051]) {
      expect((await post({ suggestionFormat: "domain", deckMaster })).status).toBe(200);
      const genesys = await post({ suggestionFormat: "genesys-domain", deckMaster });
      expect(genesys.status).toBe(400);
      expect(genesys.data.error).toContain("Genesys does not allow Link or Pendulum Monsters");
    }
  });

  it("rejects unknown banlists even for Genesys, and Genesys otherwise ignores competitive lists", async () => {
    for (const suggestionFormat of ["normal", "domain", "genesys", "genesys-domain"]) {
      expect((await post({ suggestionFormat, banlist: "invented", deckMaster: MASTER })).status).toBe(400);
    }
    const genesys = await post({ suggestionFormat: "genesys" });
    expect(genesys.status).toBe(200);
    expect(genesys.data.allowed).toContain(55144522);
    for (const code of [1050, 1051]) expect(genesys.data.allowed).not.toContain(code);
    expect(genesys.data.limits).toEqual({});
  });

  it("rejects malformed format and master values at the host boundary", async () => {
    for (const suggestionFormat of [undefined, "invented", ["normal"], 1, null]) {
      expect((await post({ suggestionFormat })).status).toBe(400);
    }
    for (const deckMaster of [0, -1, "1001", 1.5, 0x1_0000_0000]) {
      expect((await post({ suggestionFormat: "domain", deckMaster })).status).toBe(400);
    }
  });

  it("invalidates scopes when the current script admission policy changes", async () => {
    const before = await post({ suggestionFormat: "normal", banlist: "none" });
    expect(before.data.allowed).toContain(SPELL);
    db.prepare(`insert into card_script_auto_blocks
      (code,reason,blocked_at,distinct_duels,error_count,threshold,window_days,bundle_version,script_hash,engine_kind)
      values (?,'reason',CURRENT_TIMESTAMP,3,3,3,7,'fixture',?,'pinned-normal')`)
      .run(SPELL, cardScriptHash(loadCardDatabase(directory), SPELL, "pinned-normal"));
    const after = await post({ suggestionFormat: "normal", banlist: "none" });
    expect(after.status).toBe(200);
    expect(after.data.allowed).not.toContain(SPELL);
    expect(after.data.version).not.toBe(before.data.version);
  });

  it("invalidates a warm Domain scope when its Deck Master script membership changes", async () => {
    const before = await post({ suggestionFormat: "domain", deckMaster: MASTER });
    expect(before.data.allowed).toContain(1010);
    expect(before.data.allowed).not.toContain(1008);
    const script = join(directory, "card-scripts", `c${MASTER}.lua`);
    try {
      writeFileSync(script, "s.listed_names={1008}\ns.listed_series={SET_SCRIPT_FAMILY}\n");
      const after = await post({ suggestionFormat: "domain", deckMaster: MASTER });
      expect(after.status).toBe(200);
      expect(after.data.allowed).toContain(1008);
      expect(after.data.allowed).not.toContain(1010);
      expect(after.data.version).not.toBe(before.data.version);
    } finally { writeFileSync(script, "s.listed_names={1010}\ns.listed_series={SET_SCRIPT_FAMILY}\n"); }
  });

  it("invalidates a strings-only content change with an unchanged CDB and preserved metadata mtime", async () => {
    const cdb = join(directory, "cards.cdb"), strings = join(directory, "strings.conf");
    const cdbStat = statSync(cdb, { bigint: true }), times = statSync(strings), source = readFileSync(strings, "utf8");
    const before = await post({ suggestionFormat: "domain", deckMaster: MASTER });
    try {
      // A comment leaves parsed mappings equal; the complete metadata fingerprint still changes.
      writeFileSync(strings, `${source}\n# scope fixture revision\n`); utimesSync(strings, times.atime, times.mtime);
      const after = await post({ suggestionFormat: "domain", deckMaster: MASTER });
      expect(after.status).toBe(200); expect(after.data.allowed).toEqual(before.data.allowed);
      expect(after.data.version).not.toBe(before.data.version);
      const cdbAfter = statSync(cdb, { bigint: true });
      for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) expect(cdbAfter[key]).toBe(cdbStat[key]);
    } finally { writeFileSync(strings, source); utimesSync(strings, times.atime, times.mtime); }
  });

  it("reloads either Lua constants file without a CDB change", async () => {
    const cdb = join(directory, "cards.cdb"), cdbStat = statSync(cdb, { bigint: true });
    for (const file of ["card_counter_constants.lua", "archetype_setcode_constants.lua"]) {
      const path = join(directory, "card-scripts", file), present = existsSync(path);
      const source = present ? readFileSync(path, "utf8") : undefined, times = present ? statSync(path) : undefined;
      const before = await post({ suggestionFormat: "domain", deckMaster: MASTER });
      try {
        writeFileSync(path, file === "archetype_setcode_constants.lua" ? "SET_SCRIPT_FAMILY = 0x789\n" : "CARD_SCOPE_FIXTURE = 1015\n");
        if (times) utimesSync(path, times.atime, times.mtime);
        const after = await post({ suggestionFormat: "domain", deckMaster: MASTER });
        expect(after.status).toBe(200); expect(after.data.version).not.toBe(before.data.version);
        if (file === "archetype_setcode_constants.lua") {
          expect(before.data.allowed).toContain(1015); expect(after.data.allowed).not.toContain(1015);
        }
        const cdbAfter = statSync(cdb, { bigint: true });
        for (const key of ["dev", "ino", "size", "mtimeNs", "ctimeNs"] as const) expect(cdbAfter[key]).toBe(cdbStat[key]);
      } finally {
        if (source !== undefined && times) { writeFileSync(path, source); utimesSync(path, times.atime, times.mtime); }
        else unlinkSync(path);
      }
    }
  });

  it("invalidates the version for a level-only CDB change even when its mtime is preserved", async () => {
    const path = join(directory, "cards.cdb");
    const original = statSync(path);
    const unchangedMtime = new Date("2024-01-01T00:00:00.000Z");
    utimesSync(path, unchangedMtime, unchangedMtime);
    const before = await post({ suggestionFormat: "normal", banlist: "none" });
    const beforeMtime = statSync(path, { bigint: true }).mtimeNs;
    const engine = new Database(path);
    try { engine.prepare("update datas set level = 5 where id = 1008").run(); }
    finally { engine.close(); }
    utimesSync(path, unchangedMtime, unchangedMtime);
    try {
      expect(statSync(path, { bigint: true }).mtimeNs).toBe(beforeMtime);
      const after = await post({ suggestionFormat: "normal", banlist: "none" });
      expect(after.status).toBe(200);
      expect(after.data.allowed).toEqual(before.data.allowed);
      expect(after.data.limits).toEqual(before.data.limits);
      expect(after.data.copyGroups).toEqual(before.data.copyGroups);
      expect(after.data.version).not.toBe(before.data.version);
      expect((await post({ suggestionFormat: "normal", banlist: "none" })).data.version).toBe(after.data.version);
    } finally {
      const restored = new Database(path);
      try { restored.prepare("update datas set level = 4 where id = 1008").run(); }
      finally { restored.close(); }
      utimesSync(path, original.atime, original.mtime);
    }
  });
});
