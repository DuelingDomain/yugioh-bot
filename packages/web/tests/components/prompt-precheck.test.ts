import { describe, expect, it, vi } from "vitest";
import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { precheckCopy, precheckKeyAction, precheckKind, precheckNo, precheckYes } from "@/components/duel/prompt-center";

function prompt(overrides: Partial<DuelPrompt>): DuelPrompt {
  return { id: "p", seat: 0, kind: "choice", title: "t", options: [], ...overrides };
}

function card(code: number, name: string) {
  return { code, name } as NonNullable<DuelPromptOption["card"]>;
}

function effect(index: number, code: number, name: string): DuelPromptOption {
  return { id: `card:${index}`, label: `${name}: Special Summon`, card: card(code, name) };
}

const source = { code: 100, name: "Blue-Eyes Spirit Dragon", seat: 0, text: "text" };
const yesNo = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];
const optionalChain = { cancelable: true, context: { type: "chain", forced: false } } as const;

describe("precheckKind", () => {
  it("covers an optional chain response and an effect yes/no", () => {
    expect(precheckKind(prompt({ ...optionalChain, options: [effect(0, 100, "A")] }))).toBe("chain");
    expect(precheckKind(prompt({ ...optionalChain, options: [effect(0, 100, "A"), effect(1, 101, "B")] }))).toBe("chain");
    expect(precheckKind(prompt({ options: yesNo, source }))).toBe("effect");
  });

  it("skips mandatory and forced chain links", () => {
    expect(precheckKind(prompt({ context: { type: "chain", forced: true }, options: [effect(0, 100, "A")] }))).toBeNull();
    expect(precheckKind(prompt({ cancelable: true, context: { type: "chain", forced: true }, options: [effect(0, 100, "A")] }))).toBeNull();
    expect(precheckKind(prompt({ context: { type: "chain", forced: false }, options: [effect(0, 100, "A")] }))).toBeNull();
  });

  it("skips prompts that are not activate-or-pass", () => {
    expect(precheckKind(null)).toBeNull();
    expect(precheckKind(prompt({ kind: "cards", cancelable: true, options: [effect(0, 100, "A")] }))).toBeNull();
    expect(precheckKind(prompt({ kind: "places", cancelable: true }))).toBeNull();
    expect(precheckKind(prompt({ kind: "counters" }))).toBeNull();
    expect(precheckKind(prompt({ kind: "number" }))).toBeNull();
    expect(precheckKind(prompt({ kind: "announce-card" }))).toBeNull();
    expect(precheckKind(prompt({ context: { type: "position" }, options: [effect(0, 100, "A")] }))).toBeNull();
    expect(precheckKind(prompt({ context: { type: "action", phase: "main" }, options: [effect(0, 100, "A")] }))).toBeNull();
  });

  it("skips Deck Master recall and yes/no questions that name no card", () => {
    expect(precheckKind(prompt({ options: yesNo }))).toBeNull();
    expect(precheckKind(prompt({ options: yesNo, source, context: { type: "deck-master-recall", card: card(1, "DM"), returns: 0, nextCost: 0 } }))).toBeNull();
  });

  it("skips an option list that only has two options named yes and no without a source", () => {
    expect(precheckKind(prompt({ options: [{ id: "a", label: "A" }, { id: "b", label: "B" }], source }))).toBeNull();
  });
});

describe("precheckYes / precheckNo", () => {
  it("activates the only effect at once", () => {
    expect(precheckYes(prompt({ ...optionalChain, options: [effect(0, 100, "A")] }))).toEqual({ answer: { choice: "card:0" } });
  });

  it("opens the list when more than one effect can be activated", () => {
    expect(precheckYes(prompt({ ...optionalChain, options: [effect(0, 100, "A"), effect(1, 101, "B")] }))).toEqual({ list: true });
  });

  it("answers yes to an effect yes/no", () => {
    expect(precheckYes(prompt({ options: yesNo, source }))).toEqual({ answer: { choice: "yes" } });
  });

  it("has no answer without a pre-check", () => {
    expect(precheckYes(prompt({ kind: "cards" }))).toBeNull();
    expect(precheckNo(prompt({ kind: "cards", cancelable: true }))).toBeNull();
  });

  it("No sends the same answer as Pass and No", () => {
    expect(precheckNo(prompt({ ...optionalChain, options: [effect(0, 100, "A")] }))).toEqual({ cancel: true });
    expect(precheckNo(prompt({ options: yesNo, source }))).toEqual({ choice: "no" });
  });
});

describe("precheckKeyAction", () => {
  it("maps Enter and Y to yes, Esc and N to no", () => {
    expect(precheckKeyAction("Enter", false, false)).toBe("yes");
    expect(precheckKeyAction("y", true, false)).toBe("yes");
    expect(precheckKeyAction("Y", false, false)).toBe("yes");
    expect(precheckKeyAction("Escape", false, false)).toBe("no");
    expect(precheckKeyAction("n", true, false)).toBe("no");
    expect(precheckKeyAction("N", false, false)).toBe("no");
  });

  it("leaves Enter on a focused button to that button", () => {
    expect(precheckKeyAction("Enter", true, false)).toBeNull();
  });

  it("swallows number keys only when a list follows Yes", () => {
    expect(precheckKeyAction("2", false, true)).toBe("swallow");
    expect(precheckKeyAction("Numpad3", false, true)).toBe("swallow");
    expect(precheckKeyAction("2", false, false)).toBeNull();
    expect(precheckKeyAction("0", false, true)).toBeNull();
    expect(precheckKeyAction("a", false, true)).toBeNull();
  });
});

describe("precheckCopy", () => {
  it("names the one card and the step", () => {
    const copy = precheckCopy(
      prompt({ ...optionalChain, options: [effect(0, 100, "Blue-Eyes Spirit Dragon")], source }),
      [{ index: 1, seat: 1, name: "Raigeki" }],
      "Battle Step",
    );
    expect(copy).toEqual({
      name: "Blue-Eyes Spirit Dragon",
      ask: "You can activate an effect. Activate?",
      context: "Battle Step · in response to Raigeki",
      cards: [{ code: 100, card: card(100, "Blue-Eyes Spirit Dragon") }],
    });
  });

  it("says how many effects and shows each card once", () => {
    const copy = precheckCopy(
      prompt({ ...optionalChain, options: [effect(0, 100, "A"), effect(1, 100, "A"), effect(2, 101, "B"), effect(3, 102, "C")] }),
      [],
      null,
    );
    expect(copy?.name).toBe("4 effects");
    expect(copy?.context).toBe("");
    expect(copy?.cards.map((entry) => entry.code)).toEqual([100, 101]);
  });

  it("asks about the source of an engine yes/no", () => {
    const copy = precheckCopy(prompt({ options: yesNo, source }), [], "Damage Step");
    expect(copy).toMatchObject({ name: "Blue-Eyes Spirit Dragon", ask: "Activate its effect?", context: "Damage Step" });
    expect(copy?.cards).toEqual([{ code: 100, card: undefined }]);
  });

  it("is null when the prompt has no pre-check", () => {
    expect(precheckCopy(prompt({ kind: "cards" }), [], null)).toBeNull();
  });
});
