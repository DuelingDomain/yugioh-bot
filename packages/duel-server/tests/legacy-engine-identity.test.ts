import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";

// The legacy 1v1 engine must run the same cores as main: the npm package core for Standard, main's own Domain build for Domain.
// The checks compare the core a legacy duel reports with the npm file, the manifest and the legacy files in the bundle.

const MANIFEST = JSON.parse(readFileSync(join(DATA, "manifest.json"), "utf8")) as { integrity: Record<string, string> };
const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

const settings = {
  visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240,
  startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true,
};

function decks(domain: boolean): DuelDeck[] {
  const db = new Database(join(DATA, "cards.cdb"), { readonly: true });
  try {
    const ids = (sql: string) => (db.prepare(sql).all() as { id: number }[]).map((row) => row.id);
    const monsters = ids("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id");
    const spells = ids("SELECT id FROM datas WHERE type = 2 AND alias = 0 AND (ot & 3) != 0 ORDER BY id");
    return [0, 1].map((seat) => ({
      main: spells.slice(seat * 40, seat * 40 + 40), extra: [], side: [], ...(domain ? { deckMaster: monsters[seat] } : {}),
    }));
  } finally {
    db.close();
  }
}

function npmCoreFile(): string {
  const wrapper = fileURLToPath(import.meta.resolve("ocgcore-wasm"));
  return join(dirname(wrapper), "..", "lib", "ocgcore.sync.wasm");
}

describe("legacy 1v1 engine core identity", () => {
  it("Standard runs the npm package core, byte for byte", async () => {
    const game = await createLegacyEngineGame({ mode: "normal", format: "1v1", decks: decks(false), seed: ["1", "2", "3", "4"], dataDirectory: DATA, settings });
    try {
      const info = game.coreInfo();
      expect(info.wasmSha).toBe(sha256(npmCoreFile()));
      expect(info.wasmSha).toMatch(/^[0-9a-f]{64}$/);
      expect(game.view(null).seats).toHaveLength(2);
    } finally {
      game.close();
    }
  });

  it("Domain runs main's Domain build, the file the manifest lists as domainLegacyWasm", async () => {
    const game = await createLegacyEngineGame({ mode: "domain", format: "1v1", decks: decks(true), seed: ["1", "2", "3", "4"], dataDirectory: DATA, settings });
    try {
      const info = game.coreInfo();
      expect(info.wasmFile).toBe("ocgcore.domain.legacy.wasm");
      expect(info.wasmSha).toBe(MANIFEST.integrity.domainLegacyWasm);
      expect(info.wasmSha).toBe(sha256(join(DATA, "ocgcore.domain.legacy.wasm")));
      for (const seat of game.view(null).seats) expect(seat.deckMaster).toBeDefined();
    } finally {
      game.close();
    }
  });

  it("the legacy Domain core is not the merged Domain core", () => {
    expect(MANIFEST.integrity.domainLegacyWasm).not.toBe(MANIFEST.integrity.domainWasm);
  });

  it("the pinned engine reports the standard core of the bundle, not the npm core", async () => {
    const game = await createEngineGame({ mode: "normal", format: "1v1", decks: decks(false), seed: ["1", "2", "3", "4"], dataDirectory: DATA, settings });
    try {
      expect(game.coreInfo().wasmSha).toBe(MANIFEST.integrity.standardWasm);
    } finally {
      game.close();
    }
  });

  it("the legacy engine refuses what only the merged engine can do", async () => {
    await expect(createLegacyEngineGame({ mode: "normal", format: "ffa3", decks: decks(false), seed: ["1", "2", "3", "4"], dataDirectory: DATA, settings })).rejects.toThrow(/1v1/);
    await expect(createLegacyEngineGame({ mode: "normal", format: "1v1", decks: decks(false), seed: ["1", "2", "3", "4"], dataDirectory: DATA, settings, startupScripts: ["x"] } as never)).rejects.toThrow(/startup/);
  });
});
