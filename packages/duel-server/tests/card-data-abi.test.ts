import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import createCore, { OcgDuelMode, OcgLocation, OcgPosition, OcgQueryFlags } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { engineDataDirectory } from "./engine-data-dir.js";

describe("native card data ABI", () => {
  it("returns an exact passcode match first", () => {
    const cards = loadCardDatabase(engineDataDirectory);
    expect(cards.search("46986414")[0]?.name).toBe("Dark Magician");
  });

  it("preserves every setcode from the card database", () => {
    const sqlite = new Database(join(engineDataDirectory, "cards.cdb"), { readonly: true, fileMustExist: true });
    try {
      const cards = loadCardDatabase(engineDataDirectory);
      const rows = sqlite.prepare("SELECT id, setcode FROM datas").safeIntegers().all() as Array<{ id: bigint; setcode: bigint }>;
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const expected = [0n, 16n, 32n, 48n]
          .map((shift) => Number((row.setcode >> shift) & 0xffffn))
          .filter((code) => code !== 0);
        const card = cards.cardData(Number(row.id));
        assert(card, `Card ${row.id} is missing from the loaded database`);
        expect(card.setcodes, `Card ${row.id}`).toEqual(expected);
      }
    } finally {
      sqlite.close();
    }
  });

  it.each(["normal", "domain"] as const)("preserves Pendulum scales and Link arrows in the %s core", async (mode) => {
    const cards = loadCardDatabase(engineDataDirectory);
    const imduk = cards.search("Imduk the World Chalice Dragon").find((card) => card.name === "Imduk the World Chalice Dragon");
    assert(imduk);
    const bytes = mode === "domain" ? readFileSync(join(engineDataDirectory, "ocgcore.domain.wasm")) : undefined;
    const core = await createCore({ sync: true, ...(bytes ? { wasmBinary: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer } : {}) });
    const errors: string[] = [];
    const handle = core.createDuel({
      flags: OcgDuelMode.MODE_MR5,
      seed: [1n, 2n, 3n, 4n],
      team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
      cardReader: cards.cardData,
      scriptReader: cards.readScript,
      errorHandler: (_type, text) => errors.push(text),
    });
    assert(handle);
    try {
      for (const name of ["constant.lua", "utility.lua"]) {
        const script = cards.readScript(name);
        assert(script);
        assert(core.loadScript(handle, name, script));
      }
      core.duelNewCard(handle, { team: 0, duelist: 0, code: 17857780, controller: 0, location: OcgLocation.HAND, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
      core.duelNewCard(handle, { team: 0, duelist: 0, code: imduk.code, controller: 0, location: OcgLocation.MZONE, sequence: 0, position: OcgPosition.FACEUP_ATTACK });
      const pendulum = core.duelQuery(handle, { controller: 0, location: OcgLocation.HAND, sequence: 0, overlaySequence: 0, flags: (OcgQueryFlags.LSCALE | OcgQueryFlags.RSCALE) as OcgQueryFlags });
      const link = core.duelQuery(handle, { controller: 0, location: OcgLocation.MZONE, sequence: 0, overlaySequence: 0, flags: OcgQueryFlags.LINK });
      expect(pendulum).toMatchObject({ leftScale: 5, rightScale: 5 });
      expect(link?.link).toEqual({ rating: 1, marker: 128 });
      expect(errors).toEqual([]);
    } finally {
      core.destroyDuel(handle);
    }
  });
});
