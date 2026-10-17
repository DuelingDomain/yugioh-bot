import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultDuelSettings, type DuelEngineView } from "@yugidraft/shared/duels";
import { afterEach, expect, it } from "vitest";
import { generateDraft, loadNSource, replaySeats } from "../scripts/failure-to-scenario.js";
import { createEngineGame } from "../src/engine.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describeWithCores("scenario draft uses the saved first-turn draw rule", [needs.installedMulti(DATA),
  ...needs.domainMulti(DATA, join(DATA, "ocgcore.multi-domain.wasm"))], () => {
  it.each([
    { mode: "normal", firstTurnDraw: true },
    { mode: "domain", firstTurnDraw: false },
  ] as const)("$mode FFA3 replays a saved $firstTurnDraw flag", async ({ mode, firstTurnDraw }) => {
    const decks = Array.from({ length: 3 }, () => ({ main: Array(40).fill(15025844), extra: [], side: [],
      ...(mode === "domain" ? { deckMaster: 48305365 } : {}) }));
    const seed = ["1", "2", "3", "4"];
    const settings = { ...defaultDuelSettings(mode), shuffleDeck: false };
    const game = await createEngineGame({ mode, format: "ffa3", masterRule: 5, firstTurnDraw, decks, seed, settings, dataDirectory: DATA });
    const history: DuelEngineView[][] = [];
    const commands: Array<{ seat: number; command: { promptId: string; revision: number; answer: { choice: string } } }> = [];
    try {
      for (let actor = 0; actor < 3; actor++) {
        const views = Array.from({ length: 3 }, (_, viewer) => game.view(viewer));
        for (const view of views) for (let seat = 0; seat < 3; seat++) {
          const draws = Number(seat <= actor && (seat > 0 || firstTurnDraw));
          expect(view.seats[seat]!.hand).toHaveLength(5 + draws);
          expect(view.seats[seat]!.deckCount).toBe(35 - draws);
        }
        history.push(views);
        const own = views[actor]!;
        expect(own.turnSeat).toBe(actor);
        expect(own.prompt?.options.some((option) => option.id === "to_ep")).toBe(true);
        const command = { promptId: own.prompt!.id, revision: own.revision, answer: { choice: "to_ep" } };
        game.answer(actor, command.promptId, command.answer);
        commands.push({ seat: actor, command });
      }
      history.push(Array.from({ length: 3 }, (_, viewer) => game.view(viewer)));
    } finally { game.close(); }
    const dir = mkdtempSync(join(tmpdir(), "draft-first-draw-"));
    dirs.push(dir);
    const file = join(dir, "saved-rule.json");
    writeFileSync(file, JSON.stringify({ format: "yugidraft-duel-journal/1", mode, tableFormat: "ffa3",
      masterRule: 5, seed, decks, settings, setup: { firstTurnDraw }, commands }));
    const source = loadNSource(file);
    for (let step = 0; step <= commands.length; step++) {
      const replay = await replaySeats(source, DATA, step);
      expect(replay.seats).toEqual(history[step]);
    }
    const draft = await generateDraft({ file, step: 0, dataDirectory: DATA });
    expect(draft.capture.board.format).toBe("ffa3");
    for (const [seat, id] of ["p0", "p1", "p2"].entries()) {
      const board = draft.capture.board[id as "p0" | "p1" | "p2"]!;
      expect(board.hand).toHaveLength(5 + Number(seat === 0 && firstTurnDraw));
    }
    await expect(replaySeats({ ...source, commands: [{ ...source.commands[0]!, revision: -1 }] }, DATA, 1))
      .rejects.toThrow("Check the saved options and engine resources");
  });
});
