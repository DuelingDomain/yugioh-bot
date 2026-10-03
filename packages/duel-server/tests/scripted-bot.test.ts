import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { activate, chainWith, choose, chooseScripted, defaultAnswer, pass, pickOpponent, ScriptedBotError, surrender, target } from "../src/scripted-bot.js";

const DUST = 60082869;
const JINZO = 77585513;

const view = (chain: number[] = []) => ({ chain: chain.map((seat, index) => ({ index, seat })), phase: "main1" }) as unknown as DuelEngineView;
const card = (code: number, name: string): DuelPromptOption["card"] => ({ code, name, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "x" });
const option = (id: string, code?: number, extra: Partial<DuelPromptOption> = {}): DuelPromptOption => ({
  id, label: id, ...(code ? { card: card(code, `Card ${code}`) } : {}), ...extra,
});
const choicePrompt = (options: DuelPromptOption[], context: DuelPrompt["context"], cancelable = false): DuelPrompt =>
  ({ id: "p1", seat: 1, kind: "choice", title: "t", options, context, ...(cancelable ? { cancelable: true, min: 0 } : {}) }) as DuelPrompt;

const ctx = { seat: 1 };

describe("default answers", () => {
  it("declines a yes/no prompt", () => {
    expect(defaultAnswer(choicePrompt([option("yes"), option("no")], undefined)).answer).toEqual({ choice: "no" });
  });
  it("passes a cancelable chain window", () => {
    const prompt = choicePrompt([option("card:0", DUST)], { type: "chain", forced: false }, true);
    expect(defaultAnswer(prompt)).toEqual({ answer: { cancel: true }, note: "default: pass" });
  });
  it("ends the phase in an idle prompt, never random", () => {
    const prompt = choicePrompt([option("summon:0", 1), option("to_bp"), option("to_ep")], { type: "action", phase: "main" } as DuelPrompt["context"]);
    expect(defaultAnswer(prompt).answer).toEqual({ choice: "to_ep" });
  });
  it("takes the first option when a pass is not legal", () => {
    const prompt = choicePrompt([option("card:3", 1), option("card:4", 2)], { type: "chain", forced: true });
    expect(defaultAnswer(prompt)).toEqual({ answer: { choice: "card:3" }, note: "default: first legal option" });
  });
});

describe("rules", () => {
  const chainPrompt = choicePrompt([option("card:0", DUST, { controller: 1 }), option("card:1", JINZO, { controller: 1 })], { type: "chain", forced: false }, true);

  it("chainWith picks the named card in a chain window and notes the reason", () => {
    const chosen = chooseScripted([chainWith(DUST, { note: "because" })], chainPrompt, view(), ctx);
    expect(chosen).toMatchObject({ answer: { choice: "card:0" }, note: "because", rule: 0 });
  });
  it("chainWith ignores an idle prompt", () => {
    const idle = choicePrompt([option("activate:2", DUST), option("to_ep")], { type: "action", phase: "main" } as DuelPrompt["context"]);
    expect(chooseScripted([chainWith(DUST)], idle, view(), ctx).rule).toBe(-1);
    expect(chooseScripted([activate(DUST)], idle, view(), ctx).answer).toEqual({ choice: "activate:2" });
  });
  it("the first matching rule wins and the condition `if` is honored", () => {
    const rules = [chainWith(DUST, { note: "first", if: (_p, v) => v.chain.length > 0 }), chainWith(JINZO, { note: "second" })];
    expect(chooseScripted(rules, chainPrompt, view(), ctx).note).toBe("second");
    expect(chooseScripted(rules, chainPrompt, view([0]), ctx).note).toBe("first");
  });
  it("an unmatched prompt gets the default pass", () => {
    expect(chooseScripted([chainWith(12580477)], chainPrompt, view(), ctx)).toMatchObject({ answer: { cancel: true }, note: "default: pass", rule: -1 });
  });
  it("target chooses a card in a selection prompt", () => {
    const prompt = { id: "p2", seat: 1, kind: "cards", title: "t", min: 1, max: 1, options: [option("card:0", 12580477, { controller: 0 }), option("card:1", 53129443, { controller: 0 })] } as DuelPrompt;
    expect(chooseScripted([target(53129443)], prompt, view(), ctx).answer).toEqual({ selected: ["card:1"] });
  });
  it("pickOpponent chooses the option of that seat", () => {
    const prompt = choicePrompt([option("opt:0", undefined, { controller: 0 }), option("opt:1", undefined, { controller: 2 })], undefined);
    expect(chooseScripted([pickOpponent(2)], prompt, view(), ctx).answer).toEqual({ choice: "opt:1" });
  });
  it("surrender answers with the surrender flag", () => {
    expect(chooseScripted([surrender({ note: "give up" })], chainPrompt, view(), ctx)).toMatchObject({ answer: { surrender: true }, note: "give up" });
  });
  it("pass and choose work on idle prompts", () => {
    const idle = choicePrompt([option("to_bp"), option("to_ep")], { type: "action", phase: "main" } as DuelPrompt["context"]);
    expect(chooseScripted([choose("to_bp")], idle, view(), ctx).answer).toEqual({ choice: "to_bp" });
    expect(chooseScripted([pass()], idle, view(), ctx).answer).toEqual({ choice: "to_ep" });
  });
  it("a rule that cannot find its card throws a clear error", () => {
    const prompt = { id: "p2", seat: 1, kind: "cards", title: "t", min: 1, max: 1, options: [option("card:0", 12580477, { controller: 0 }), option("card:1", 53129443, { controller: 0 })] } as DuelPrompt;
    const bad = { note: "bad", when: () => true, do: () => { throw new Error("boom"); } };
    expect(() => chooseScripted([bad], prompt, view(), ctx)).toThrow(ScriptedBotError);
  });
});
