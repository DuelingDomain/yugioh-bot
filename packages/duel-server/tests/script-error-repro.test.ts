import { afterEach, expect, it, vi } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { chooseSurrenderedAnswer } from "../src/practice-bot.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

import { reproOptions, reachScriptError, waiting } from "./helpers/script-error-repro.js";

const SABERSAURUS = 3743515;
const cases = [
  ["legacy", "1v1", "normal"], ["legacy", "1v1", "domain"],
  ["pinned", "1v1", "normal"], ["pinned", "1v1", "domain"],
  ["pinned", "ffa4", "normal"], ["pinned", "ffa4", "domain"],
] as const;

afterEach(() => vi.unstubAllEnvs());

describeWithCores("synthetic card runtime recovery", [needs.standard(DATA), needs.domain(DATA), needs.installedMulti(DATA)], () => {
  it.each(cases)("%s %s %s: reports and continues with a test-only card callback", async (engine, format, mode) => {
    const errors: Array<{ code: number; scriptFile: string; line: number }> = [];
    const create = engine === "legacy" ? createLegacyEngineGame : createEngineGame;
    const options = reproOptions(format, mode);
    const game = await create({ ...options, onScriptError: (error) => errors.push(error) });
    try {
      reachScriptError(game);
      const view = game.view(null);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ code: SABERSAURUS, scriptFile: "c3743515.lua", line: 8 });
      const event = view.events.find((entry) => entry.kind === "script-error")!;
      expect(event.text).toMatch(/^Card script error:.*effect may not have resolved correctly/);
      expect(event).not.toHaveProperty("card");
      expect(JSON.stringify(event)).not.toMatch(/3743515|Sabersaurus|nil value/);
      expect(view.log.some((entry) => entry.eventId === event.id && entry.text === event.text)).toBe(true);
      expect(view.result).toBeNull();
      const next = waiting(game);
      game.answer(next.seat, next.prompt.id, chooseSurrenderedAnswer(next.prompt));
      expect(game.view(null).result).toBeNull();
      for (const seat of [null, 0, 1]) expect(game.view(seat).events.find((entry) => entry.id === event.id)).toEqual(event);
    } finally { game.close(); }
  });
  it.each(cases)("%s %s %s: strict mode still throws the synthetic error", async (engine, format, mode) => {
    vi.stubEnv("DUEL_SCRIPT_ERRORS", "strict");
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)(reproOptions(format, mode));
    try { expect(() => reachScriptError(game)).toThrow(/Card script error \(strict mode\)/); }
    finally { game.close(); }
  });
});
