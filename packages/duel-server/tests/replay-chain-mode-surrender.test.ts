import { seatCountFor } from "@yugidraft/shared/duels";
import { expect, it } from "vitest";
import { replaySeats, type NSource } from "../scripts/failure-to-scenario.js";
import { replaySource } from "../scripts/lib/replay-source.js";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

describeWithCores("chain mode and surrender journal replay", [needs.installedMulti(DATA), ...needs.domainMulti(DATA)], () => {
  it.each((["normal", "domain"] as const).flatMap((mode) =>
    (["ffa3", "ffa4", "tag"] as const).map((format) => ({ mode, format }))))
  ("$mode $format keeps unsaved settings, chain modes and immediate surrender", async ({ mode, format }) => {
    const source: NSource = {
      kind: "fuzz", label: "chain-mode-surrender", mode, format, seatCount: seatCountFor(format), masterRule: 5,
      decks: Array.from({ length: seatCountFor(format) }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
        ...(mode === "domain" ? { deckMaster: 48305365 } : {}) })),
      seed: ["1", "2", "3", "4"], commands: [],
    };
    const game = await createEngineGame({ ...source, dataDirectory: DATA });
    try {
      expect(game.view(1).chainMode).toBe("always");
      for (const mode of ["auto", "off"] as const) {
        source.commands.push({ seat: 1, promptId: `chain-mode:${mode}`, revision: game.view(1).revision, answer: {} });
        expect(game.setChainMode(1, mode)).toBe(false);
      }
      source.commands.push({ seat: 1, promptId: "eliminate:0", revision: game.view(1).revision, answer: {} });
      game.eliminate(1, 0);
      expect(game.view(0).seats[1]!.eliminated).toBe(true);
      const expected = { step: source.commands.length,
        seats: Array.from({ length: source.seatCount }, (_, seat) => game.view(seat)), spectator: game.view(null) };
      expect(await replaySeats(source, DATA, source.commands.length)).toEqual(expected);
      expect(await replaySource(source, DATA, source.commands.length)).toEqual(expected);
    } finally { game.close(); }
  });

  it.each(["normal", "domain"] as const)("%s refuses retired turn-end surrender after a chain mode change", async (mode) => {
    const source: NSource = {
      kind: "fuzz", label: "retired-surrender", mode, format: "ffa3", seatCount: 3, masterRule: 5,
      decks: Array.from({ length: 3 }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
        ...(mode === "domain" ? { deckMaster: 48305365 } : {}) })),
      seed: ["1", "2", "3", "4"], commands: [],
    };
    const opening = await replaySeats(source, DATA, 0);
    source.commands = [
      { seat: 1, promptId: "chain-mode:off", revision: opening.seats[1]!.revision, answer: {} },
      { seat: 1, promptId: "eliminate-eot:0", revision: opening.seats[1]!.revision, answer: {} },
    ];
    await expect(replaySeats(source, DATA, 2)).rejects.toThrow("retired turn-end surrender rule");
    await expect(replaySource(source, DATA, 2)).rejects.toThrow("retired turn-end surrender rule");
  });
});
