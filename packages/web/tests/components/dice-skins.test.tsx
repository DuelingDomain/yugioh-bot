// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DuelDiceSkinControl } from "../../src/components/duel/dice-skin-control";
import { DEFAULT_DICE_SKIN, DICE_SKINS, DICE_SKIN_KEY, getDiceSkin, isSkinUnlocked, loadDiceSkin, normalizeDiceSkin, setDiceSkin } from "../../src/components/duel/dice-skins";

describe("dice skins", () => {
  beforeEach(() => { window.localStorage.clear(); act(() => setDiceSkin(DEFAULT_DICE_SKIN)); window.localStorage.clear(); });
  afterEach(cleanup);

  it("offers Millennium gold, Crest and Card back, all unlocked, with gold as the default", () => {
    expect(DICE_SKINS.map((skin) => skin.label)).toEqual(["Millennium gold", "Crest", "Card back"]);
    expect(DICE_SKINS.every((skin) => skin.state === "unlocked")).toBe(true);
    expect(DEFAULT_DICE_SKIN).toBe("gold");
    expect(isSkinUnlocked("crest")).toBe(true);
  });

  it("falls back to the default for unknown values and for a missing save", () => {
    expect(normalizeDiceSkin("ivory")).toBe("gold");
    expect(normalizeDiceSkin(7)).toBe("gold");
    expect(normalizeDiceSkin("cardback")).toBe("cardback");
    expect(loadDiceSkin()).toBe("gold");
    window.localStorage.setItem(DICE_SKIN_KEY, "{not json");
    expect(loadDiceSkin()).toBe("gold");
  });

  it("saves the choice for this browser", () => {
    act(() => setDiceSkin("crest"));
    expect(getDiceSkin()).toBe("crest");
    expect(window.localStorage.getItem(DICE_SKIN_KEY)).toBe(JSON.stringify("crest"));
    expect(loadDiceSkin()).toBe("crest");
  });

  it("shows a Dice setting that changes the skin", () => {
    render(<DuelDiceSkinControl />);
    const group = screen.getByRole("group", { name: "Dice" });
    expect(group.querySelector("[aria-pressed=true]")?.textContent).toBe("Millennium gold");
    fireEvent.click(screen.getByRole("button", { name: "Card back" }));
    expect(screen.getByRole("button", { name: "Card back" }).getAttribute("aria-pressed")).toBe("true");
    expect(getDiceSkin()).toBe("cardback");
  });
});
