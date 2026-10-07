import Database from "better-sqlite3";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { validateRuntimeBoard } from "../src/presets/runtime-board.js";
import { resolveCard } from "../src/presets/catalog.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

const UNKNOWN = 0xffffffff;
const ELF = 15025844;

describe("validateRuntimeBoard", () => {
  it("returns the parsed board and compiled options without starting an engine", () => {
    const input = { format: "ffa3", turn: "p2", p2: { hand: [ELF] } };
    const result = validateRuntimeBoard(input, DATA);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(input).not.toHaveProperty("startAt");
    expect(result.board).toMatchObject({ startAt: "draw", turn: "p2", deckSize: 20 });
    expect(result.compiled.options.firstTurnDraw).toBe(true);
    expect(result.compiled.options.decks).toHaveLength(3);
    expect(result.codes).toEqual([ELF]);
    expect(result.errors).toEqual([]);
  });

  it("returns the shared parser's path and message", () => {
    expect(validateRuntimeBoard({ p0: { hand: ["Mystical Elf"] } }, DATA)).toMatchObject({
      ok: false, codes: [], errors: [{ path: "p0.hand[0]", message: expect.stringContaining("integer") }],
    });
    expect(validateRuntimeBoard({ withoutCoreFunctions: ["Draw"] }, DATA)).toMatchObject({
      ok: false, errors: [{ path: "withoutCoreFunctions", message: "Unsupported field." }],
    });
  });

  it.each([
    ["hand", [UNKNOWN], "p0.hand[0]"],
    ["hand", [{ card: UNKNOWN }], "p0.hand[0].card"],
    ["monsters", [null, UNKNOWN], "p0.monsters[1]"],
    ["monsters", [{ card: ELF, materials: [UNKNOWN] }], "p0.monsters[0].materials[0]"],
    ["spells", [UNKNOWN], "p0.spells[0]"],
    ["field", UNKNOWN, "p0.field"],
    ["pendulum", [null, UNKNOWN], "p0.pendulum[1]"],
    ["grave", [UNKNOWN], "p0.grave[0]"],
    ["banished", [UNKNOWN], "p0.banished[0]"],
    ["deck", [UNKNOWN], "p0.deck[0]"],
    ["extra", [UNKNOWN], "p0.extra[0]"],
    // The parser accepts materials on CardSpec outside MZONE, so those refs also need a catalog check.
    ["hand", [{ card: ELF, materials: [UNKNOWN] }], "p0.hand[0].materials[0]"],
  ])("checks numeric refs in %s", (field, value, path) => {
    expect(validateRuntimeBoard({ p0: { [field as string]: value } }, DATA)).toMatchObject({
      ok: false, errors: [{ path, message: expect.stringContaining(`Unknown card code ${UNKNOWN}`) }],
    });
  });

  it("checks every Domain Deck Master", () => {
    expect(validateRuntimeBoard({ mode: "domain", p0: { deckMaster: ELF }, p1: { deckMaster: UNKNOWN } }, DATA))
      .toMatchObject({ ok: false, errors: [{ path: "p1.deckMaster", message: expect.stringContaining("Unknown card code") }] });
  });

  it("reports all invalid card locations", () => {
    expect(validateRuntimeBoard({ p0: { hand: [UNKNOWN] }, p1: { deck: [UNKNOWN] } }, DATA))
      .toMatchObject({ ok: false, errors: [{ path: "p0.hand[0]" }, { path: "p1.deck[0]" }] });
  });

  it("rejects alias and non-OCG/TCG codes from the actual catalog", () => {
    const db = new Database(join(DATA, "cards.cdb"), { readonly: true, fileMustExist: true });
    try {
      for (const filter of ["alias != 0", "(ot & 3) = 0"]) {
        const row = db.prepare(`SELECT id FROM datas WHERE ${filter} LIMIT 1`).get() as { id: number };
        expect(row).toBeTruthy();
        expect(validateRuntimeBoard({ p0: { hand: [row.id] } }, DATA))
          .toMatchObject({ ok: false, errors: [{ path: "p0.hand[0]", message: expect.stringContaining("not a main passcode") }] });
      }
    } finally { db.close(); }
  });

  it("returns all distinct compiled codes, including filler and Xyz materials", () => {
    const xyz = resolveCard("Number 39: Utopia", DATA);
    const material = resolveCard("Celtic Guardian", DATA);
    const result = validateRuntimeBoard({ p0: { monsters: [{ card: xyz, materials: [material, material] }] } }, DATA);
    expect(result).toMatchObject({ ok: true, errors: [] });
    expect(new Set(result.codes)).toEqual(new Set([ELF, xyz, material]));
    expect(result.codes).toHaveLength(3);
  });

  it("reports compiler resource errors without starting an engine", () => {
    expect(validateRuntimeBoard({}, join(DATA, "missing-sandbox-directory")))
      .toMatchObject({ ok: false, codes: [], errors: [{ path: "$", message: expect.stringContaining("cards.cdb not found") }] });
  });
});
