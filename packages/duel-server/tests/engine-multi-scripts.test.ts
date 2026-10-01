import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelDeck, DuelFormat } from "@yugidraft/shared/duels";
import { loadCardDatabase } from "../src/cards.js";
import { createEngineGame, type EngineGameOptions } from "../src/engine.js";
import { engineDataDirectory as dataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { REPLACE_MARKER } from "../src/multi-scripts.js";
import { makeOverlay, removeOverlays } from "./support/multi-scripts.js";

// The Lua overlay of duels with more than two seats (F7 section 4), on the real engine.
// Real cards with official scripts: Pot of Greed (replaced by the overlay) and 7852878 (suffix).
const REPLACED_CARD = 55144522;
const SUFFIXED_CARD = 7852878;

const settings = { visibility: "public" as const, banlist: "none" as const, cardPool: "both" as const, turnSeconds: 240, startingLP: 8000, startingHand: 5, drawPerTurn: 1, timeout: "loss" as const, validateDeck: false, shuffleDeck: true };

function vanilla(count: number): number[] {
  const db = new Database(join(dataDirectory, "cards.cdb"), { readonly: true });
  try {
    const rows = db.prepare("SELECT id FROM datas WHERE type = 17 AND alias = 0 AND (ot & 3) != 0 ORDER BY id").all() as { id: number }[];
    return rows.map((row) => row.id).slice(0, count);
  } finally {
    db.close();
  }
}

const deck = (): DuelDeck => ({ main: [REPLACED_CARD, SUFFIXED_CARD, ...vanilla(38)], extra: [], side: [] });
const seats = (format: DuelFormat) => (format === "ffa3" ? 3 : 2);

async function start(format: DuelFormat, extra: Partial<EngineGameOptions> = {}) {
  return createEngineGame({
    mode: "normal",
    format,
    decks: Array.from({ length: seats(format) }, deck),
    seed: ["11", "22", "33", "44"],
    dataDirectory,
    settings,
    ...extra,
  });
}

/** True when the Lua expression holds after the decks exist (a startup script that fails makes createEngineGame throw). */
async function holds(format: DuelFormat, expression: string, extra: Partial<EngineGameOptions> = {}): Promise<boolean> {
  try {
    const game = await start(format, { ...extra, startupScripts: [{ name: "probe.lua", content: `if not (${expression}) then error("PROBE_FALSE") end` }] });
    game.close();
    return true;
  } catch (error) {
    if (error instanceof Error && /Failed to run startup script probe\.lua/.test(error.message)) return false;
    throw error;
  }
}

/** Independent reader of the card scripts: every .lua under card-scripts, by base name. */
function diskScripts(): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory)) {
      const full = join(directory, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (entry.endsWith(".lua")) found.set(entry, full);
    }
  };
  visit(join(dataDirectory, "card-scripts"));
  return found;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const needsAll = [needs.scripts(dataDirectory), needs.cards(dataDirectory), needs.standard(dataDirectory), needs.installedMulti(dataDirectory)];

afterEach(() => {
  removeOverlays();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describeWithCores("Lua overlay on a real engine", needsAll, () => {
  it("has control probes that work: a true expression starts, a false one is seen", async () => {
    expect(await holds("1v1", "true")).toBe(true);
    expect(await holds("1v1", "false")).toBe(false);
    expect(await holds("ffa3", "true")).toBe(true);
    expect(await holds("ffa3", "false")).toBe(false);
  });

  it("loads mp-utility.lua at 3 seats (MP_OVERLAY_ACTIVE is true) and not at 2 (it is nil)", async () => {
    expect(await holds("ffa3", "MP_OVERLAY_ACTIVE == true")).toBe(true);
    expect(await holds("1v1", "MP_OVERLAY_ACTIVE == nil")).toBe(true);
  });

  it("sets MP_OVERLAY_ACTIVE with the stub alone: the core has no MPBindOpponent to guard on", async () => {
    const overlay = makeOverlay([]);
    expect(await holds("ffa3", "MP_OVERLAY_ACTIVE == true", { multiScriptsDirectory: overlay })).toBe(true);
    expect(await holds("ffa3", "Duel.MPBindOpponent == nil", { multiScriptsDirectory: overlay })).toBe(true);
  });

  it("loads mp-utility.lua before any card exists", async () => {
    const overlay = makeOverlay([{ code: SUFFIXED_CARD, text: `\nMP_SAW_FLAG_AT_CREATE = MP_OVERLAY_ACTIVE\n` }]);
    expect(await holds("ffa3", "MP_SAW_FLAG_AT_CREATE == true", { multiScriptsDirectory: overlay })).toBe(true);
  });

  it("an overlay script replaces the official one at 3 seats and not at 2", async () => {
    const replacement = `${REPLACE_MARKER}\nlocal s,id=GetID()\nfunction s.initial_effect(c) MP_REPLACED_RAN = true end\n`;
    const overlay = makeOverlay([{ code: REPLACED_CARD, kind: "whole", text: replacement }]);
    expect(await holds("ffa3", "MP_REPLACED_RAN == true", { multiScriptsDirectory: overlay })).toBe(true);
    expect(await holds("1v1", "MP_REPLACED_RAN == nil", { multiScriptsDirectory: overlay })).toBe(true);
    // Without the overlay card the official script runs and sets nothing.
    expect(await holds("ffa3", "MP_REPLACED_RAN == nil", { multiScriptsDirectory: makeOverlay([]) })).toBe(true);
  });

  it("a suffix runs after the original script at 3 seats and not at 2", async () => {
    const suffix = [
      "",
      `local mp_orig = c${SUFFIXED_CARD}.initial_effect`,
      `MP_SUFFIX_SAW_ORIGINAL = (mp_orig ~= nil)`,
      `c${SUFFIXED_CARD}.initial_effect = function(c) mp_orig(c) MP_SUFFIX_RAN = true end`,
      "",
    ].join("\n");
    const overlay = makeOverlay([{ code: SUFFIXED_CARD, kind: "expr", text: suffix }]);
    expect(await holds("ffa3", "MP_SUFFIX_SAW_ORIGINAL == true and MP_SUFFIX_RAN == true", { multiScriptsDirectory: overlay })).toBe(true);
    expect(await holds("1v1", "MP_SUFFIX_SAW_ORIGINAL == nil and MP_SUFFIX_RAN == nil", { multiScriptsDirectory: overlay })).toBe(true);
  });

  it("reads the overlay folder from DUEL_MULTI_SCRIPTS_DIR", async () => {
    const replacement = `${REPLACE_MARKER}\nlocal s,id=GetID()\nfunction s.initial_effect(c) MP_ENV_RAN = true end\n`;
    vi.stubEnv("DUEL_MULTI_SCRIPTS_DIR", makeOverlay([{ code: REPLACED_CARD, text: replacement }]));
    expect(await holds("ffa3", "MP_ENV_RAN == true")).toBe(true);
    expect(await holds("1v1", "MP_ENV_RAN == nil")).toBe(true);
  });

  it("refuses a broken overlay folder at 3 seats, and never reads it at 2", async () => {
    const broken = makeOverlay([], { utility: null });
    await expect(start("ffa3", { multiScriptsDirectory: broken })).rejects.toThrow(/has no mp-utility\.lua/);
    const game = await start("1v1", { multiScriptsDirectory: broken });
    game.close();
    const missing = join(tmpdir(), "no-such-multi-scripts-folder");
    const duel = await start("1v1", { multiScriptsDirectory: missing });
    duel.close();
  });

  it("a duel of two seats loads exactly the scripts it loaded before the overlay existed", async () => {
    const database = loadCardDatabase(dataDirectory);
    const poisoned = makeOverlay([
      { code: REPLACED_CARD, kind: "whole", text: `${REPLACE_MARKER}\nlocal s,id=GetID()\nfunction s.initial_effect(c) MP_REPLACED_RAN = true end\n` },
      { code: SUFFIXED_CARD, kind: "expr", text: "\nMP_SUFFIX_RAN = true\n" },
    ]);
    vi.stubEnv("DUEL_MULTI_SCRIPTS_DIR", poisoned);
    const spy = vi.spyOn(database, "readScript");
    const game = await start("1v1", { multiScriptsDirectory: poisoned, startupScripts: [{ name: "probe.lua", content: 'if MP_REPLACED_RAN or MP_SUFFIX_RAN or MP_OVERLAY_ACTIVE then error("overlay leaked") end' }] });
    game.close();

    // Every read has no overlay argument ...
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    expect(spy.mock.calls.every((call) => call[1] === undefined)).toBe(true);
    // ... and the list of (script name, text hash) equals the one read straight from the files on disk.
    const onDisk = diskScripts();
    const fromEngine = new Set<string>();
    const expected = new Set<string>();
    spy.mock.calls.forEach(([name], index) => {
      const text = spy.mock.results[index]!.value as string | null;
      if (text == null) return;
      fromEngine.add(`${name}\0${sha(text)}`);
      const base = name.replaceAll("\\", "/").split("/").pop()!;
      expected.add(`${name}\0${sha(readFileSync(onDisk.get(base)!, "utf8"))}`);
    });
    const listHash = (lines: Set<string>) => sha([...lines].sort().join("\n"));
    expect(fromEngine.size).toBeGreaterThan(2);
    expect(listHash(fromEngine)).toBe(listHash(expected));
    // The two cards of the overlay are in the list with their ORIGINAL text.
    expect([...fromEngine].some((line) => line.startsWith(`c${REPLACED_CARD}.lua\0`))).toBe(true);
  });
});
