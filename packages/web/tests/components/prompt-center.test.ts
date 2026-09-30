import { describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { centerKind, declineAnswer, fillPlaceholders, humanizeLabel, positionOf, responseTitle } from "@/components/duel/prompt-center";

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
