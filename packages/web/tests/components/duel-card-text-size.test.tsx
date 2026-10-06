// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { CARD_TEXT_SIZE_KEY, cardTextStyle, loadCardTextSize, normalizeCardTextSize, saveCardTextSize, setCardTextSize } from "@/components/duel/card-text-size";
import { DuelCardTextSizeControl } from "@/components/duel/card-text-size-control";
import { LOCATION_MZONE, POS_FACEUP_ATTACK } from "@/components/duel/constants";
import { CardInspector } from "@/components/duel/inspector";
import { GridHoverPreview } from "@/components/duel/table/grid-preview";

const card: DuelCard = {
  controller: 0, location: LOCATION_MZONE, sequence: 1, position: POS_FACEUP_ATTACK, code: 11, name: "Blue-Eyes White Dragon",
  description: "This legendary dragon is a powerful engine of destruction.",
};
const owner = { name: "Rook", main: "#4cc9f0", ink: "#bdeaff" };

beforeEach(() => {
  window.localStorage.clear();
  setCardTextSize("medium");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("card text size preference", () => {
  it("defaults to medium and ignores unknown values", () => {
    expect(loadCardTextSize()).toBe("medium");
    for (const bad of ["huge", 2, null, undefined]) expect(normalizeCardTextSize(bad)).toBe("medium");
    window.localStorage.setItem(CARD_TEXT_SIZE_KEY, "garbage");
    expect(loadCardTextSize()).toBe("medium");
  });
  it("saves per browser and survives blocked storage", () => {
    saveCardTextSize("xlarge");
    expect(loadCardTextSize()).toBe("xlarge");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadCardTextSize()).toBe("medium");
    expect(() => saveCardTextSize("large")).not.toThrow();
  });
  it("grows the text from small to extra large", () => {
    const factor = (size: Parameters<typeof cardTextStyle>[0]) => Number(/calc\(([\d.]+) \*/.exec(String((cardTextStyle(size) as Record<string, string>)["--ct"]))?.[1]);
    expect([factor("small"), factor("medium"), factor("large"), factor("xlarge")]).toEqual([0.85, 1, 1.2, 1.4]);
  });
});

describe("card text size control and panels", () => {
  it("shows four options, marks the saved one and saves a click", () => {
    render(<DuelCardTextSizeControl />);
    const group = screen.getByRole("group", { name: "Card text size" });
    expect(group.querySelectorAll("button")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Extra large" }));
    expect(screen.getByRole("button", { name: "Extra large" })).toHaveAttribute("aria-pressed", "true");
    expect(loadCardTextSize()).toBe("xlarge");
  });
  it("changes the hover preview and the inspector live", () => {
    const { container } = render(
      <>
        <DuelCardTextSizeControl />
        <GridHoverPreview card={card} owner={owner} reducedMotion />
        <CardInspector target={{ type: "card", card }} />
      </>,
    );
    const preview = screen.getByTestId("hover-preview");
    const inspector = container.querySelector("[data-card-text]:not([data-testid])") as HTMLElement;
    expect(preview).toHaveAttribute("data-card-text", "medium");
    expect(inspector).toHaveAttribute("data-card-text", "medium");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Large" })); });
    expect(preview).toHaveAttribute("data-card-text", "large");
    expect(inspector).toHaveAttribute("data-card-text", "large");
    expect(preview.style.getPropertyValue("--ct")).toContain("1.2");
    expect(preview.style.getPropertyValue("--seat-main")).toBe("#4cc9f0");
  });
});
