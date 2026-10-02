import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDuelSettings, seatCountFor } from "@yugidraft/shared/duels";
import { afterEach, expect, it } from "vitest";
import { generate, generateDraft } from "../scripts/failure-to-scenario.js";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describeWithCores("scenario generator FFA guard", [needs.installedMulti(DATA),
  ...needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm"))], () => {
  it.each((["normal", "domain"] as const).flatMap((mode) =>
    (["ffa3", "ffa4"] as const).map((format) => ({ mode, format }))))
  ("$mode $format uses the preset draft generator", async ({ mode, format }) => {
    const count = seatCountFor(format);
    const decks = Array.from({ length: count }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
      ...(mode === "domain" ? { deckMaster: 48305365 } : {}) }));
    const settings = { ...defaultDuelSettings(mode), shuffleDeck: false };
    const seed = ["1", "2", "3", "4"];
    const firstTurnDraw = mode === "domain";
    const game = await createEngineGame({ mode, format, settings, decks, seed, firstTurnDraw, dataDirectory: DATA });
    const commands = [];
    try {
      for (let actor = 0; actor < count; actor++) {
        const own = game.view(actor);
        expect(own.turnSeat).toBe(actor);
        expect(own.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        const command = { promptId: own.prompt!.id, revision: own.revision, answer: { choice: "to_ep" } };
        game.answer(actor, command.promptId, command.answer);
        commands.push({ seat: actor, command });
      }
      for (let viewer = 0; viewer < count; viewer++) for (let seat = 0; seat < count; seat++) {
        const view = game.view(viewer).seats[seat]!;
        expect(view.hand).toHaveLength(seat === 0 ? 6 + Number(firstTurnDraw) : 6);
        expect(view.deckCount).toBe(seat === 0 ? 34 - Number(firstTurnDraw) : 34);
      }
    } finally { game.close(); }
    const dir = mkdtempSync(join(tmpdir(), "scenario-ffa-guard-"));
    dirs.push(dir);
    const file = join(dir, "journal.json");
    writeFileSync(file, JSON.stringify({ format: "yugidraft-duel-journal/1", mode, tableFormat: format,
      masterRule: 5, decks, settings, seed, setup: { firstTurnDraw }, commands }));
    await expect(generate({ file, step: commands.length, dataDirectory: DATA })).rejects.toThrow("Use generateDraft() for FFA3 or FFA4");
    const draft = await generateDraft({ file, step: commands.length, dataDirectory: DATA });
    expect(draft.capture.board.format).toBe(format);
    for (let seat = 0; seat < count; seat++) {
      const id = `p${seat}` as "p0" | "p1" | "p2" | "p3";
      expect(draft.capture.board[id]!.hand).toHaveLength(seat === 0 ? 6 + Number(firstTurnDraw) : 6);
      expect(draft.text).toContain(`"${id}": {`);
    }
  });
});
