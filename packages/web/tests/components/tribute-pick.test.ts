import { describe, expect, it, vi } from "vitest";
import type { DuelCard, DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { LOCATION_MZONE } from "../../src/components/duel/constants";
import { activatePromptFromField, canConfirm, toAnswer, type PromptDraft } from "../../src/components/duel/prompts";
import { tributeClick, tributeState, tributeValue } from "../../src/components/duel/tribute-pick";
import { placeTributeDock } from "../../src/components/duel/tribute-dock-place";

const option = (sequence: number, value = 1): DuelPromptOption => ({
  id: `card:${sequence}`, label: `Monster ${sequence}`, controller: 0, location: LOCATION_MZONE, sequence, values: [value],
});

function tribute(min: number, max: number, values: number[], extra: Partial<DuelPrompt> = {}): DuelPrompt {
  return { id: "t", seat: 0, kind: "tribute", title: "Select tribute(s)", min, max, options: values.map((value, index) => option(index, value)), ...extra };
}

const card = (sequence: number): DuelCard => ({
  controller: 0, location: LOCATION_MZONE, sequence, position: 1, code: 100 + sequence, name: `Monster ${sequence}`,
} as DuelCard);

const keysOf = (sequence: number) => [`0:${LOCATION_MZONE}:${sequence}`];

/** A draft over a real array, so a click's result can be read back like a render would. */
function draftOf(selected: string[] = []) {
  const state = { selected };
  const draft = {
    get selected() { return state.selected; },
    setSelected: vi.fn((next: string[] | ((current: string[]) => string[])) => {
      state.selected = typeof next === "function" ? next(state.selected) : next;
    }),
  } as unknown as PromptDraft;
  return { draft, state };
}

describe("tribute values", () => {
  it("counts a card as what the engine says it is worth, one when it says nothing", () => {
    expect(tributeValue(option(0, 2))).toBe(2);
    expect(tributeValue({ values: undefined })).toBe(1);
    expect(tributeValue(undefined)).toBe(1);
  });
});

describe("tributeState: when the pick sends itself", () => {
  it("1 of 1: one click completes the pick and sends it", () => {
    const prompt = tribute(1, 1, [1, 1, 1]);
    expect(tributeState(prompt, [])).toMatchObject({ met: false, autoSend: false, showSummon: false });
    expect(tributeState(prompt, ["card:1"])).toMatchObject({ need: 1, total: 1, met: true, autoSend: true, showSummon: false });
  });

  it("2 of 2: the first click waits, the second sends", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    expect(tributeState(prompt, ["card:0"])).toMatchObject({ total: 1, met: false, canAdd: true, autoSend: false, showSummon: false });
    expect(tributeState(prompt, ["card:0", "card:2"])).toMatchObject({ total: 2, met: true, canAdd: false, autoSend: true });
  });

  it("a card worth two with room for one more is ambiguous: Summon decides", () => {
    const prompt = tribute(2, 2, [2, 1, 1]);
    expect(tributeState(prompt, ["card:0"])).toMatchObject({ total: 2, met: true, canAdd: true, autoSend: false, showSummon: true });
  });

  it("a card worth two sends itself when nothing else could join it", () => {
    expect(tributeState(tribute(2, 2, [2]), ["card:0"])).toMatchObject({ met: true, canAdd: false, autoSend: true });
    expect(tributeState(tribute(2, 1, [2, 1]), ["card:0"])).toMatchObject({ met: true, canAdd: false, autoSend: true });
  });

  it("more than the minimum allowed (cap above need) stays open until Summon", () => {
    const prompt = tribute(1, 2, [1, 1, 1]);
    expect(tributeState(prompt, ["card:0"])).toMatchObject({ met: true, canAdd: true, autoSend: false, showSummon: true });
    expect(tributeState(prompt, ["card:0", "card:1"])).toMatchObject({ canAdd: false, autoSend: true });
  });

  it("a forced pick alone never sends itself", () => {
    const prompt = tribute(1, 1, [1, 1], { mandatory: ["card:0"] });
    expect(tributeState(prompt, ["card:0"])).toMatchObject({ met: true, userPicked: false, autoSend: false, showSummon: true });
  });
});

describe("tributeClick", () => {
  it("adds a card and says whether to send", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    expect(tributeClick(prompt, [], "card:0")).toEqual({ next: ["card:0"], send: false });
    expect(tributeClick(prompt, ["card:0"], "card:1")).toEqual({ next: ["card:0", "card:1"], send: true });
  });

  it("takes a picked card back with a click on it", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    expect(tributeClick(prompt, ["card:0"], "card:0")).toEqual({ next: [], send: false });
  });

  it("changes nothing when the pick is already full (too many)", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    const current = ["card:0", "card:1"];
    const click = tributeClick(prompt, current, "card:2");
    expect(click.next).toBe(current);
    expect(click.send).toBe(false);
  });

  it("swaps a one-card pick to the clicked card", () => {
    const prompt = tribute(1, 1, [1, 1]);
    expect(tributeClick(prompt, ["card:0"], "card:1")).toEqual({ next: ["card:1"], send: true });
  });

  it("keeps a forced card picked", () => {
    const prompt = tribute(2, 2, [1, 1, 1], { mandatory: ["card:0"] });
    const current = ["card:0"];
    expect(tributeClick(prompt, current, "card:0").next).toBe(current);
  });
});

describe("canConfirm for tributes counts value", () => {
  it("needs the picked cards to be worth the minimum", () => {
    const prompt = tribute(2, 2, [2, 1, 1]);
    const at = (...selected: string[]) => canConfirm(prompt, { ...draftOf(selected).draft, selected } as PromptDraft);
    expect(at()).toBe(false);
    expect(at("card:1")).toBe(false);
    expect(at("card:0")).toBe(true);
    expect(at("card:1", "card:2")).toBe(true);
  });

  it("rejects more cards than the maximum and a missing forced card", () => {
    const prompt = tribute(1, 1, [1, 1], { mandatory: ["card:0"] });
    expect(canConfirm(prompt, { selected: ["card:1"] } as PromptDraft)).toBe(false);
    expect(canConfirm(prompt, { selected: ["card:0", "card:1"] } as PromptDraft)).toBe(false);
    expect(canConfirm(prompt, { selected: ["card:0"] } as PromptDraft)).toBe(true);
  });

  it("answers with the picked cards", () => {
    expect(toAnswer(tribute(2, 2, [1, 1]), { selected: ["card:0", "card:1"] } as PromptDraft)).toEqual({ selected: ["card:0", "card:1"] });
  });
});

describe("clicking a monster on the field", () => {
  it("1 of 1 sends the pick at once", () => {
    const prompt = tribute(1, 1, [1, 1]);
    const { draft } = draftOf();
    const submit = vi.fn();
    expect(activatePromptFromField(prompt, true, keysOf(1), card(1), draft, submit)).toBe(true);
    expect(submit).toHaveBeenCalledExactlyOnceWith({ selected: ["card:1"] });
  });

  it("2 of 2 picks the first and sends on the second", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    const { draft, state } = draftOf();
    const submit = vi.fn();
    activatePromptFromField(prompt, true, keysOf(0), card(0), draft, submit);
    expect(submit).not.toHaveBeenCalled();
    expect(state.selected).toEqual(["card:0"]);
    activatePromptFromField(prompt, true, keysOf(2), card(2), draft, submit);
    expect(submit).toHaveBeenCalledExactlyOnceWith({ selected: ["card:0", "card:2"] });
  });

  it("a card worth two waits for Summon", () => {
    const prompt = tribute(2, 2, [2, 1, 1]);
    const { draft, state } = draftOf();
    const submit = vi.fn();
    activatePromptFromField(prompt, true, keysOf(0), card(0), draft, submit);
    expect(submit).not.toHaveBeenCalled();
    expect(state.selected).toEqual(["card:0"]);
    expect(canConfirm(prompt, { selected: state.selected } as PromptDraft)).toBe(true);
  });

  it("a click on a picked card takes it back and sends nothing", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    const { draft, state } = draftOf(["card:0"]);
    const submit = vi.fn();
    activatePromptFromField(prompt, true, keysOf(0), card(0), draft, submit);
    expect(state.selected).toEqual([]);
    expect(submit).not.toHaveBeenCalled();
  });

  it("says why when the pick is full", () => {
    const prompt = tribute(2, 2, [1, 1, 1]);
    const { draft } = draftOf(["card:0", "card:1"]);
    const submit = vi.fn();
    const refuse = vi.fn();
    expect(activatePromptFromField(prompt, true, keysOf(2), card(2), draft, submit, refuse)).toBe(true);
    expect(refuse).toHaveBeenCalledWith(expect.objectContaining({ reason: "full" }));
    expect(submit).not.toHaveBeenCalled();
  });

  it("ignores a monster that cannot be Tributed", () => {
    const prompt = tribute(1, 1, [1, 1]);
    const { draft } = draftOf();
    const submit = vi.fn();
    expect(activatePromptFromField(prompt, true, keysOf(4), card(4), draft, submit)).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(draft.setSelected).not.toHaveBeenCalled();
  });

  it("does nothing for the opponent's prompt", () => {
    const { draft } = draftOf();
    const submit = vi.fn();
    expect(activatePromptFromField(tribute(1, 1, [1]), false, keysOf(0), card(0), draft, submit)).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not pre-pick when the candidates exactly equal the number required", () => {
    // The draft starts with only the forced picks; the player still clicks each monster.
    const prompt = tribute(2, 2, [1, 1]);
    expect(tributeState(prompt, prompt.mandatory ?? [])).toMatchObject({ count: 0, met: false, autoSend: false });
  });
});

describe("placeTributeDock", () => {
  const rect = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });

  it("sits right of the hand, bottom level with it, against the board edge", () => {
    const board = rect(0, 0, 1440, 900);
    const place = placeTributeDock({ board, hand: rect(300, 760, 900, 880) });
    expect(place.mode).toBe("side");
    expect(place.bottom).toBe(900 - 880);
    expect(place.width).toBe(380);
    expect(place.left! + place.width!).toBe(1440 - 12);
  });

  it("uses the row above the hand, against the right edge, when there is no room beside it", () => {
    const place = placeTributeDock({ board: rect(0, 0, 900, 700), hand: rect(40, 580, 640, 690) });
    expect(place.mode).toBe("above");
    expect(place.bottom).toBe(700 - 580 + 8);
  });

  it("centres on the row above a wide centred hand (the 2v2 Rooftop)", () => {
    const place = placeTributeDock({ board: rect(0, 0, 900, 700), hand: rect(100, 580, 800, 690) });
    expect(place.mode).toBe("center");
    expect(place.bottom).toBe(128);
  });

  it("keeps the 2v2 Rooftop on the centred row above the hand even when there is room beside it", () => {
    const place = placeTributeDock({ board: rect(0, 0, 1440, 900), hand: rect(300, 760, 900, 880), centered: true });
    expect(place.mode).toBe("center");
    expect(place.bottom).toBe(900 - 760 + 8);
  });

  it("takes the full width on a phone", () => {
    const place = placeTributeDock({ board: rect(0, 0, 390, 700), hand: rect(10, 600, 380, 690) });
    expect(place.mode).toBe("full");
    expect(place.bottom).toBe(108);
  });

  it("falls back to a centred dock when the hand cannot be measured", () => {
    expect(placeTributeDock({ board: rect(0, 0, 1000, 700), hand: null })).toMatchObject({ mode: "center", bottom: 12 });
  });
});
