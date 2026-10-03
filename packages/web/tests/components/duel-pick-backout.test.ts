import { describe, expect, it, vi } from "vitest";
import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { backOutAnswer, backOutLabel } from "@/components/duel/pick-backout";
import { optionsForCard } from "@/components/duel/prompts";
import { keepsPickOpen } from "@/components/duel/pick-continuation";
import { dismissAnswer } from "@/components/duel/prompt-center";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const MZONE = 0x04;

function option(id: string, sequence: number, selected = false): DuelPromptOption {
  return { id, label: id, controller: 0, location: MZONE, sequence, selected } as DuelPromptOption;
}

function toggle(overrides: Partial<DuelPrompt> = {}): DuelPrompt {
  return {
    id: "p",
    seat: 0,
    kind: "toggle",
    title: "Select the card(s) to use as Synchro Material",
    options: [option("select:0", 0), option("select:1", 1)],
    min: 2,
    max: 2,
    ...overrides,
  };
}

describe("backOutAnswer", () => {
  it("cancels the summon when nothing is selected and cancel is allowed", () => {
    expect(backOutAnswer(toggle({ cancelable: true }))).toEqual({ cancel: true });
    expect(backOutAnswer(toggle({ cancelable: true }), ["0:4:1"])).toEqual({ cancel: true });
  });

  it("does nothing on a forced pick with nothing selected", () => {
    expect(backOutAnswer(toggle())).toBeNull();
    expect(backOutAnswer(toggle(), ["0:4:0"])).toBeNull();
    expect(backOutAnswer(toggle({ cancelable: false }))).toBeNull();
  });

  it("deselects the selected card under the pointer", () => {
    const prompt = toggle({ options: [option("unselect:0", 0, true), option("unselect:1", 1, true), option("select:2", 2)] });
    expect(backOutAnswer(prompt, ["0:4:1"])).toEqual({ choice: "unselect:1" });
    expect(backOutAnswer(prompt, ["0:4:0"])).toEqual({ choice: "unselect:0" });
  });

  it("deselects the selected card even when cancel is allowed", () => {
    const prompt = toggle({ cancelable: true, options: [option("unselect:0", 0, true), option("select:1", 1)] });
    expect(backOutAnswer(prompt, ["0:4:0"])).toEqual({ choice: "unselect:0" });
  });

  it("steps back one pick when the pointer is elsewhere and the engine offers no cancel", () => {
    // After the first material the engine drops Cancel; the way back is to unselect, one card at a time.
    const prompt = toggle({ options: [option("unselect:0", 0, true), option("unselect:1", 1, true), option("select:2", 2)] });
    expect(backOutAnswer(prompt)).toEqual({ choice: "unselect:1" });
    expect(backOutAnswer(prompt, ["0:4:2"])).toEqual({ choice: "unselect:1" });
    expect(backOutAnswer(prompt, [])).toEqual({ choice: "unselect:1" });
  });

  it("prefers cancel over stepping back when both exist", () => {
    const prompt = toggle({ cancelable: true, options: [option("unselect:0", 0, true), option("select:1", 1)] });
    expect(backOutAnswer(prompt, ["0:4:1"])).toEqual({ cancel: true });
    expect(backOutAnswer(prompt)).toEqual({ cancel: true });
  });

  it("never answers a prompt that is not a one-card-at-a-time pick", () => {
    expect(backOutAnswer({ ...toggle({ cancelable: true }), kind: "cards" })).toBeNull();
    expect(backOutAnswer(null)).toBeNull();
  });
});

describe("backOutLabel", () => {
  it("names the visible button", () => {
    expect(backOutLabel(toggle({ cancelable: true }))).toBe("Cancel");
    expect(backOutLabel(toggle({ options: [option("unselect:0", 0, true), option("select:1", 1)] }))).toBe("Undo");
    expect(backOutLabel(toggle())).toBeNull();
    expect(backOutLabel(null)).toBeNull();
  });
});

describe("clicking a selected material", () => {
  it("resolves to the single unselect option, so the click deselects it", () => {
    const prompt = toggle({ options: [option("unselect:0", 0, true), option("select:1", 1)] });
    const card = { controller: 0, location: MZONE, sequence: 0 } as never;
    expect(optionsForCard(prompt, card, ["0:4:0"]).map((o) => o.id)).toEqual(["unselect:0"]);
  });
});

describe("dismissAnswer (right-click and Esc)", () => {
  it("backs out of a material pick and still declines other prompts", () => {
    const picked = toggle({ options: [option("unselect:0", 0, true), option("select:1", 1)] });
    expect(dismissAnswer(picked, ["0:4:0"])).toEqual({ choice: "unselect:0" });
    expect(dismissAnswer(toggle({ cancelable: true }), ["0:4:0"])).toEqual({ cancel: true });
    expect(dismissAnswer(toggle())).toBeNull();
    expect(dismissAnswer({ ...toggle({ cancelable: true }), kind: "cards" })).toEqual({ cancel: true });
    expect(dismissAnswer({ ...toggle(), kind: "cards" })).toBeNull();
  });
});

describe("pick continuation after a back-out", () => {
  it("keeps the pick open after an unselect and ends it after a cancel", () => {
    const picked = toggle({ options: [option("unselect:0", 0, true), option("select:1", 1)] });
    expect(keepsPickOpen(picked, { choice: "unselect:0" })).toBe(true);
    expect(keepsPickOpen(picked, { cancel: true })).toBe(false);
  });
});
