import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createEngineGame } from "../../src/engine.js";
import { currentEngineDataDirectory } from "../engine-data-dir.js";
import { compileBoard } from "../support/board.js";
import { currentDomainMultiWasm, currentNseatWasm, describeWithCores, needs } from "../support/cores.js";
import { activate, expectPrompt, pickOpponent, type Scenario } from "../support/dsl.js";
import { liveNseat } from "../support/live-nseat.js";
import { Session } from "../support/session.js";
import { createPrivateTableData } from "./private-table-data.js";

const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
let source: string;
let originalDatabaseHash: string;
let originalScriptExists: boolean;
let fixture: ReturnType<typeof createPrivateTableData>;
vi.mock("../support/card-catalog.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../support/card-catalog.js")>();
  return { ...actual, resolveCard: (...args: Parameters<typeof actual.resolveCard>) =>
    actual.resolveCard(args[0], args[1] ?? fixture.directory) };
});

describeWithCores("private pre-errata Firewall table input", [liveNseat, ...needs.domainMulti()], () => {
  beforeAll(() => {
    source = currentEngineDataDirectory();
    originalDatabaseHash = hash(join(source, "cards.cdb"));
    originalScriptExists = existsSync(join(source, "card-scripts/official/c5043020.lua"));
    fixture = createPrivateTableData(source);
  });
  afterAll(() => fixture?.cleanup());
  it("adds the row and official script only to the private copy", () => {
    const db = new Database(join(fixture.directory, "cards.cdb"), { readonly: true });
    try {
      expect(db.prepare("SELECT id,alias,type,atk,def,level FROM datas WHERE id=5043020").get()).toMatchObject({ id: 5043020, alias: 0, atk: 2500 });
      expect(db.prepare("SELECT name FROM texts WHERE id=5043020").get()).toEqual({ name: "Firewall Dragon (pre-errata)" });
    } finally { db.close(); }
    expect(readFileSync(join(fixture.directory, "card-scripts/official/c5043020.lua"), "utf8"))
      .toBe(readFileSync(join(source, "card-scripts/pre-errata/c5043020.lua"), "utf8"));
    expect(hash(join(source, "cards.cdb"))).toBe(originalDatabaseHash);
    expect(existsSync(join(source, "card-scripts/official/c5043020.lua"))).toBe(originalScriptExists);
  });

  for (const format of ["ffa3", "tag"] as const) for (const mode of ["normal", "domain"] as const) {
    it(`loads the private Firewall input and checks every seat at ${format} ${mode}`, async () => {
      const ids = format === "ffa3" ? ["p0", "p1", "p2"] as const : ["p0", "p1", "p2", "p3"] as const;
      const scenario: Scenario = {
        id: `private-firewall-${format}-${mode}`, title: "Private Firewall table input", source: "C6 private fixture", tags: ["private-fixture"],
        setup: { format, mode, p0: { hand: ["Raigeki"], monsters: [null, null, null, null, null, 5043020] },
          p1: { monsters: ["Mystical Elf"] }, p2: { monsters: ["Mystical Elf"] },
          ...(format === "tag" ? { p3: { monsters: ["Mystical Elf"] } } : {}) },
        steps: [activate("Raigeki", "p0"), ...(format === "ffa3" ? [pickOpponent("p1", "p0")] : []),
          expectPrompt({ by: "p0", context: "action" }), { op: "expectBoard", board: {} }],
      };
      const board = scenario.steps.at(-1)!;
      if (board.op !== "expectBoard") throw new Error("The private table fixture must check the final board.");
      for (const id of ids) {
        const destroyed = id === "p1" || (format === "tag" && id === "p3");
        if (mode === "domain") scenario.setup[id]!.deckMaster = "Blue-Eyes White Dragon";
        board.board[id] = { lp: format === "tag" ? 16000 : 8000, hand: mode === "domain" && id === "p0" ? ["Mystical Elf"] : [],
          deckCount: mode === "domain" && id === "p0" ? 19 : 20, extra: [], spells: [], banished: [],
          monsters: id === "p0" ? [5043020] : destroyed ? [] : ["Mystical Elf"],
          grave: id === "p0" ? ["Raigeki"] : destroyed ? ["Mystical Elf"] : [],
          ...(mode === "domain" ? { deckMaster: { inZone: true, returns: 0, nextCost: 0 } } : {}) };
      }
      const compiled = compileBoard(scenario.setup, fixture.directory);
      const bytes = readFileSync(mode === "domain" ? currentDomainMultiWasm() : currentNseatWasm());
      const game = await createEngineGame({ ...compiled.options, dataDirectory: fixture.directory,
        multiWasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), seed: ["1", "2", "3", "4"] });
      try {
        const session = new Session(scenario, game);
        session.reachMainPhase();
        scenario.steps.forEach((step, index) => session.run(step, index + 1));
      } finally { game.close(); }
      expect(hash(join(source, "cards.cdb"))).toBe(originalDatabaseHash);
    });
  }
});
