import { describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import {
  centerKind,
  declineAnswer,
  fillPlaceholders,
  humanizeLabel,
  isBoardTogglePrompt,
  isStripPrompt,
  optionsOnBoard,
  positionOf,
  responseTitle,
  selectionStatus,
} from "@/components/duel/prompt-center";

function prompt(overrides: Partial<DuelPrompt>): DuelPrompt {
  return { id: "p", seat: 0, kind: "choice", title: "t", options: [], ...overrides };
}

const yesNo = [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }];

describe("centerKind", () => {
  it("leaves the action prompt to the field and station track", () => {
    expect(centerKind(prompt({ context: { type: "action", phase: "main" } }))).toBeNull();
  });

  it("centres responses and picks", () => {
    expect(centerKind(prompt({ context: { type: "chain", forced: false } }))).toBe("response");
    expect(centerKind(prompt({ options: yesNo }))).toBe("response");
    expect(centerKind(prompt({ kind: "number" }))).toBe("response");
    expect(centerKind(prompt({ kind: "cards" }))).toBe("select");
    expect(centerKind(prompt({ kind: "tribute" }))).toBe("select");
    expect(centerKind(prompt({ kind: "places" }))).toBe("select");
    expect(centerKind(prompt({ kind: "order" }))).toBe("grid");
    expect(centerKind(prompt({ kind: "counters" }))).toBe("counters");
    expect(centerKind(null)).toBeNull();
  });
});

describe("declineAnswer", () => {
  it("passes an optional chain response", () => {
    expect(declineAnswer(prompt({ cancelable: true, context: { type: "chain", forced: false } }))).toEqual({ cancel: true });
  });

  it("has no decline for a mandatory chain response", () => {
    expect(declineAnswer(prompt({ context: { type: "chain", forced: true } }))).toBeNull();
    expect(declineAnswer(prompt({ cancelable: true, context: { type: "chain", forced: true } }))).toBeNull();
  });

  it("answers No to a yes/no question", () => {
    expect(declineAnswer(prompt({ options: yesNo }))).toEqual({ choice: "no" });
  });

  it("cancels any other cancelable prompt and leaves mandatory ones alone", () => {
    expect(declineAnswer(prompt({ kind: "cards", cancelable: true }))).toEqual({ cancel: true });
    expect(declineAnswer(prompt({ kind: "cards" }))).toBeNull();
    expect(declineAnswer(prompt({ context: { type: "position" } }))).toBeNull();
  });
});

describe("fillPlaceholders", () => {
  it("fills the card name and location placeholders the engine leaves behind", () => {
    expect(fillPlaceholders('Activate the Trigger Effect of "%ls" from [%ls]?', "Mataza the Zapper", "your Graveyard"))
      .toBe('Activate the Trigger Effect of "Mataza the Zapper" from [your Graveyard]?');
  });

  it("drops an unknown location and dashes numbers", () => {
    expect(fillPlaceholders('Activate the Trigger Effect of "%ls" from [%ls]?', "Gigantes")).toBe('Activate the Trigger Effect of "Gigantes"?');
    expect(fillPlaceholders("Pay %d LP?", null)).toBe("Pay — LP?");
    expect(fillPlaceholders("Activate %ls?", undefined)).toBe("Activate —?");
  });

  it("leaves clean text alone", () => {
    expect(fillPlaceholders("Select a chain link or pass")).toBe("Select a chain link or pass");
  });
});

describe("humanizeLabel", () => {
  it("names positions in words", () => {
    expect(humanizeLabel("faceup_attack")).toBe("Face-up Attack");
    expect(humanizeLabel("facedown_defense")).toBe("Face-down Defense");
    expect(humanizeLabel("faceup_defense")).toBe("Face-up Defense");
  });

  it("splits other snake_case ids and passes real labels through", () => {
    expect(humanizeLabel("special_summon")).toBe("Special Summon");
    expect(humanizeLabel("Attack directly")).toBe("Attack directly");
    expect(humanizeLabel("Yes")).toBe("Yes");
  });
});

describe("positionOf", () => {
  it("reads the POS bit from values, the id or the label", () => {
    expect(positionOf({ id: "pos:4", label: "faceup_defense", values: [4] })).toBe(4);
    expect(positionOf({ id: "pos:8", label: "facedown_defense" })).toBe(8);
    expect(positionOf({ id: "x", label: "Face-down Attack" })).toBe(2);
    expect(positionOf({ id: "x", label: "Attack" })).toBe(1);
    expect(positionOf({ id: "x", label: "Whatever" })).toBeNull();
  });
});

describe("responseTitle", () => {
  const source = { code: 1, name: "Mataza the Zapper", seat: 0, zone: { controller: 0, location: 0x10, sequence: 0 }, text: "Full text." };

  it("asks about the source card by name and says whose effect it is", () => {
    const p = prompt({ title: 'Activate the Trigger Effect of "%ls" from [%ls]?', description: 'Activate the Trigger Effect of "%ls" from [%ls]?', options: yesNo, ...({ source } as object) });
    const out = responseTitle(p, [], 0);
    expect(out.title).toBe("Activate Mataza the Zapper's effect?");
    expect(out.sub).toBe("Mataza the Zapper · Your trigger effect · your Graveyard");
    expect(out.source?.name).toBe("Mataza the Zapper");
  });

  it("marks the opponent's effect and never shows a placeholder without a source", () => {
    const p = prompt({ title: 'Activate the Trigger Effect of "%ls" from [%ls]?', options: yesNo, ...({ source: { ...source, seat: 1 } } as object) });
    expect(responseTitle(p, [], 0).sub).toContain("Opponent's trigger effect");
    const bare = responseTitle(prompt({ title: 'Activate the Quick Effect of "%ls" from [%ls]?', options: yesNo }), [], 0);
    expect(bare.title).not.toContain("%");
    expect(bare.title).toBe('Activate the Quick Effect of "—"?');
  });

  it("keeps the chain wording and drops the generic engine title", () => {
    const p = prompt({ title: "Select a chain link or pass", context: { type: "chain", forced: false } });
    expect(responseTitle(p, [{ index: 1, seat: 1, name: "Raigeki" }], 0)).toMatchObject({ title: "You can respond to Raigeki", sub: undefined });
  });
});

describe("answering a pick on the board or in a strip", () => {
  const field = (sequence: number, extra = {}) => ({
    id: `card:${sequence}`,
    label: "Card",
    controller: 0,
    location: 0x04,
    sequence,
    card: { code: 1 + sequence, name: "Card" } as never,
    ...extra,
  });
  const drawn = new Set(["0:4:0", "0:4:1", "0:2:0"]);
  const hasZone = (key: string) => drawn.has(key);

  it("answers on the board when every option sits in a drawn field or hand zone", () => {
    expect(optionsOnBoard(prompt({ kind: "sum", options: [field(0), field(1)] }), hasZone)).toBe(true);
    expect(optionsOnBoard(prompt({ kind: "cards", options: [field(0), field(0, { location: 0x02 })] }), hasZone)).toBe(true);
  });

  it("falls back to the strip when a card is in the Deck, GY, Extra Deck, banished or an Xyz material", () => {
    for (const location of [0x01, 0x10, 0x20, 0x40, 0x80]) {
      expect(optionsOnBoard(prompt({ kind: "cards", options: [field(0), field(1, { location })] }), hasZone)).toBe(false);
    }
  });

  it("falls back to the strip when an option has no place or the board does not draw its zone", () => {
    expect(optionsOnBoard(prompt({ options: [field(0, { sequence: undefined })] }), hasZone)).toBe(false);
    expect(optionsOnBoard(prompt({ options: [field(3)] }), hasZone)).toBe(false);
  });

  it("treats a one-card-at-a-time material pick as a board pick candidate, not a response panel", () => {
    const materials = prompt({ kind: "toggle", title: "Select the card(s) to use as Synchro Material", options: [field(0), field(1)] });
    expect(centerKind(materials)).toBe("response");
    expect(isBoardTogglePrompt(materials)).toBe(true);
    expect(optionsOnBoard(materials, hasZone)).toBe(true);
    // Off the board, the same prompt keeps its card strip.
    const graveyard = prompt({ kind: "toggle", options: [field(0, { location: 0x10 })] });
    expect(isBoardTogglePrompt(graveyard)).toBe(true);
    expect(optionsOnBoard(graveyard, hasZone)).toBe(false);
    expect(isStripPrompt(graveyard)).toBe(true);
  });

  it("keeps chain, position and yes/no prompts out of the board toggle", () => {
    expect(isBoardTogglePrompt(prompt({ kind: "toggle", options: [field(0)], context: { type: "chain", forced: false } }))).toBe(false);
    expect(isBoardTogglePrompt(prompt({ kind: "toggle", options: [] }))).toBe(false);
    expect(isBoardTogglePrompt(prompt({ kind: "choice", options: [field(0)] }))).toBe(false);
    expect(isBoardTogglePrompt(null)).toBe(false);
  });

  it("counts the chosen cards of a one-at-a-time pick from the options", () => {
    const draft = { selected: [] } as never;
    const base = prompt({ kind: "toggle", min: 2, max: 3, options: [field(0, { selected: true }), field(1)] });
    expect(selectionStatus(base, draft, false)).toBe("Pick 2 to 3 \u00b7 1 selected");
  });
});
