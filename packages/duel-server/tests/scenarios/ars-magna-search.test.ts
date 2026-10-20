import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import createCore, { OcgDuelMode } from "ocgcore-wasm";
import { createEngineGame } from "../../src/engine.js";
import { createLegacyEngineGame } from "../../src/legacy/index.js";
import { loadCardDatabase } from "../../src/cards.js";
import { engineDataDirectory as DATA } from "../engine-data-dir.js";
import { compileBoard } from "../support/board.js";
import { describeWithCores, needs } from "../support/cores.js";
import { Session } from "../support/session.js";
import { activate, defineScenario, expectBoard, expectOffered, expectPickOptions, select } from "../support/dsl.js";
import type { DuelFormat, DuelMode } from "@yugidraft/shared/duels";

const PURIFICATION = 62368221;
const CITRINITAS = 37279096;
const PHILOSOPHIRUM = 90728287;
const npmWasm = fileURLToPath(import.meta.resolve("ocgcore-wasm/lib/ocgcore.sync.wasm"));
const binary = (file: string): ArrayBuffer => {
  const bytes = readFileSync(file);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const variants: Array<{ name: string; file: string; mode: DuelMode; format: DuelFormat; legacy?: boolean }> = [
  { name: "npm Standard 0.1.2", file: npmWasm, mode: "normal", format: "1v1", legacy: true },
  { name: "bundled Standard", file: join(DATA, "ocgcore.standard.wasm"), mode: "normal", format: "1v1" },
  { name: "legacy Domain", file: join(DATA, "ocgcore.domain.legacy.wasm"), mode: "domain", format: "1v1", legacy: true },
  { name: "Domain", file: join(DATA, "ocgcore.domain.wasm"), mode: "domain", format: "1v1" },
  ...(["1v1", "ffa3", "ffa4"] as const).flatMap(format => [
    { name: `multi ${format}`, file: join(DATA, "ocgcore.multi.wasm"), mode: "normal" as const, format },
    { name: `multi-domain ${format}`, file: join(DATA, "ocgcore.multi-domain.wasm"), mode: "domain" as const, format },
  ]),
];

for (const variant of variants) {
  describeWithCores(`Issue 380: ${variant.name}`, [needs.cards(DATA), needs.file(variant.name, variant.file)], () => {
    // A single target proves activation eligibility. Two targets force a search list.
    it.each([false, true])("adds Citrinitas from Deck (another target: %s)", async anotherTarget => {
      const scenario = defineScenario({
        id: `ars-magna-search-${variant.name.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-${anotherTarget}`,
        title: "Purification searches Citrinitas from the hand in Main Phase 1",
        source: "https://github.com/DuelingDomain/yugioh-bot/issues/380",
        tags: ["regression", "search", "ars-magna"],
        setup: {
          mode: variant.mode, format: variant.format, skipOpeningDraw: true,
          p0: { hand: [PURIFICATION], deck: [CITRINITAS, ...(anotherTarget ? [PHILOSOPHIRUM] : [])],
            ...(variant.mode === "domain" ? { deckMaster: "Axe Raider" } : {}) },
          ...Object.fromEntries(Array.from({ length: variant.format === "ffa4" ? 3 : variant.format === "ffa3" ? 2 : 1 },
            (_, index) => [`p${index + 1}`, variant.mode === "domain" ? { deckMaster: "Axe Raider" } : {}])),
        },
        steps: [
          expectOffered("activate", { card: PURIFICATION, from: "hand" }),
          activate({ card: PURIFICATION, from: "hand" }),
          ...(anotherTarget ? [expectPickOptions([{ card: CITRINITAS }, { card: PHILOSOPHIRUM }]), select(CITRINITAS)] : []),
          expectBoard({ p0: { hand: [CITRINITAS], banished: [PURIFICATION], deckCount: 19 } }),
        ],
      });
      const compiled = compileBoard(scenario.setup);
      // The two-seat Domain route reads ocgcore.domain.wasm. A private directory
      // lets it load the combined core without changing the installed bundle.
      const scratch = variant.name === "multi-domain 1v1" ? mkdtempSync(join(tmpdir(), "ars-magna-core-")) : undefined;
      try {
        if (scratch) for (const file of readdirSync(DATA)) {
          symlinkSync(file === "ocgcore.domain.wasm" ? variant.file : join(DATA, file), join(scratch, file));
        }
        const game = await (variant.legacy ? createLegacyEngineGame : createEngineGame)({
          ...compiled.options, dataDirectory: scratch ?? DATA, seed: ["1", "2", "3", "4"],
          ...(variant.mode === "normal" && !variant.legacy ? { standardWasmBinary: binary(variant.file) } : {}),
          ...(variant.format !== "1v1" ? { multiWasmBinary: binary(variant.file) } : {}),
        });
        try {
          expect(game.coreInfo().wasmSha).toBe(createHash("sha256").update(readFileSync(variant.file)).digest("hex"));
          const session = new Session(scenario, game);
          session.reachMainPhase();
          expect(game.view(0).phase).toBe("main1");
          session.startRecording();
          scenario.steps.forEach((step, index) => session.run(step, index + 1));
          expect(game.view(null).events.filter(event => event.kind === "script-error")).toEqual([]);
        } finally { game.close(); }
      } finally { if (scratch) rmSync(scratch, { recursive: true, force: true }); }
    });
  });
}

describeWithCores("Issue 380: npm core packed setcode positions", [needs.cards(DATA)], () => {
  it.each([0, 1, 2, 3])("recognizes Ars Magna at 16-bit slot %s", async slot => {
    const cards = loadCardDatabase(DATA);
    const original = cards.cardData(CITRINITAS)!;
    // Rotate the actual four codes through every slot of the old core's uint64.
    const setcodes = [...original.setcodes];
    setcodes.push(...setcodes.splice(0, (4 - slot) % 4));
    const errors: string[] = [];
    const core = await createCore({ sync: true });
    const team = { startingLP: 8000, startingDrawCount: 0, drawCountPerTurn: 1 };
    const handle = core.createDuel({ flags: OcgDuelMode.MODE_MR5, seed: [1n, 2n, 3n, 4n], team1: team, team2: team,
      cardReader: code => code === CITRINITAS ? { ...original, setcodes } : cards.cardData(code),
      scriptReader: cards.readScript, errorHandler: (_type, message) => errors.push(message) });
    expect(handle).toBeTruthy();
    try {
      for (const file of ["constant.lua", "utility.lua"]) expect(core.loadScript(handle!, file, cards.readScript(file)!)).toBe(true);
      expect(core.loadScript(handle!, "setcode-proof.lua", `
        local c=Debug.AddCard(${CITRINITAS},0,0,LOCATION_DECK,0,POS_FACEDOWN)
        assert(c:IsSetCard(0x1dd), "Ars Magna setcode lost at slot ${slot}")
        assert(c:IsSetCard(0x1c7) and c:IsSetCard(0x1cb) and c:IsSetCard(0x1d0), "Other setcode lost")
        assert(c:IsSpellTrap() and c:IsAbleToHand(), "Citrinitas must be searchable")
      `), errors.join("\n")).toBe(true);
      expect(errors).toEqual([]);
    } finally { core.destroyDuel(handle!); }
  });
});
