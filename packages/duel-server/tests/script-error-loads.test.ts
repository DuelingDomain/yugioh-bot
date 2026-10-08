import { expect, it, vi } from "vitest";
import { createEngineGame } from "../src/engine.js";
import { createLegacyEngineGame } from "../src/legacy/index.js";
import { engineDataDirectory as DATA } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";

const fixture = vi.hoisted(() => ({ cardScript: "" }));
vi.mock("../src/cards.js", async (original) => {
  const cards = await original<typeof import("../src/cards.js")>();
  return { ...cards, loadCardDatabase: (directory: string) => {
    const db = cards.loadCardDatabase(directory);
    return { ...db, readScript: (name: string, overlay?: Parameters<typeof db.readScript>[1]) => name === "c3743515.lua" ? fixture.cardScript : db.readScript(name, overlay) };
  } };
});

// Synthetic chunks exercise load failures without modifying the installed stock card scripts.
const options = { mode: "normal" as const, decks: Array.from({ length: 2 }, () => ({ main: Array(20).fill(15025844), extra: [], side: [] })), seed: ["1", "2", "3", "4"], dataDirectory: DATA,
  startupScripts: [{ name: "dynamic-loader.lua", content: `local e=Effect.GlobalEffect()
    e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS) e:SetCode(EVENT_STARTUP)
    e:SetOperation(function() Duel.CreateToken(0,3743515) end) Duel.RegisterEffect(e,0)` }],
};

describeWithCores("script loading remains fatal during processing", [needs.standard(DATA)], () => {
  it.each(["legacy", "pinned"] as const)("%s: refuses top-level runtime failure in a dynamically loaded card", async (engine) => {
    fixture.cardScript = "local s,id=GetID() function s.initial_effect(c) end dependency.failure()";
    await expect((engine === "legacy" ? createLegacyEngineGame : createEngineGame)(options).then((game) => { game.close(); return game; })).rejects.toThrow(/Engine script error/);
  });
  it.each(["legacy", "pinned"] as const)("%s: tolerates a runtime coroutine without a traceback", async (engine) => {
    const reported = vi.fn();
    const game = await (engine === "legacy" ? createLegacyEngineGame : createEngineGame)({ ...options, onScriptError: reported,
      startupScripts: [{ name: "c3743515.lua", content: `local e=Effect.GlobalEffect()
        e:SetType(EFFECT_TYPE_FIELD|EFFECT_TYPE_CONTINUOUS) e:SetCode(EVENT_STARTUP)
        e:SetOperation(function() dependency.failure() end) Duel.RegisterEffect(e,0)` }],
    });
    try {
      expect(reported).toHaveBeenCalledWith(expect.objectContaining({ code: 3743515, line: 3 }));
      expect(game.view(null).events.some((event) => event.kind === "script-error")).toBe(true);
      expect(game.view(null).result).toBeNull();
    } finally { game.close(); }
  });
  it.each(["legacy", "pinned"] as const)("%s: refuses a syntax failure in a dynamically loaded card", async (engine) => {
    const fatal = vi.fn();
    const reported = vi.fn();
    fixture.cardScript = "local s,id=GetID() function s.initial_effect(c) if true then return end";
    await expect((engine === "legacy" ? createLegacyEngineGame : createEngineGame)({ ...options, onFatalScriptError: fatal, onScriptError: reported }).then((game) => { game.close(); return game; })).rejects.toThrow(/Engine script error/);
    expect(fatal).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/c3743515\.lua.*expected.*near/) }));
    expect(reported).not.toHaveBeenCalled();
  });
});
