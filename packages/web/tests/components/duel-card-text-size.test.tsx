// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { CARD_TEXT_SIZE_KEY, cardTextStyle, loadCardTextSize, normalizeCardTextSize, saveCardTextSize, setCardTextSize, multiTableTextStyle, tableTextScale, tableTextStyle, useTableTextScale } from "@/components/duel/card-text-size";
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
  it("never lets the card text fall under 14px", () => {
    for (const size of ["small", "medium", "large", "xlarge"] as const) {
      expect(String((cardTextStyle(size) as Record<string, string>)["--ct"])).toMatch(/^max\(14px, calc\(/);
    }
  });
  it("keeps the table text at its minimum sizes for small and medium and grows it for large and extra large", () => {
    expect([tableTextScale("small"), tableTextScale("medium")]).toEqual([1, 1]);
    expect(tableTextScale("large")).toBeGreaterThan(1);
    expect(tableTextScale("xlarge")).toBeGreaterThan(tableTextScale("large"));
  });
  it("puts the table text multiplier (--tt) on the page root and removes it with the table", () => {
    function Probe() { useTableTextScale(); return null; }
    const { unmount } = render(<Probe />);
    expect(document.documentElement.style.getPropertyValue("--tt")).toBe("1");
    act(() => { setCardTextSize("xlarge"); });
    expect(Number(document.documentElement.style.getPropertyValue("--tt"))).toBe(tableTextScale("xlarge"));
    unmount();
    expect(document.documentElement.style.getPropertyValue("--tt")).toBe("");
  });
});

describe("the table text multiplier on a table root", () => {
  it("is an inline style, so the first paint has the saved size", () => {
    expect(tableTextStyle("xlarge")).toEqual({ "--tt": "1.3" });
    expect(tableTextStyle("medium")).toEqual({ "--tt": "1" });
    // Only the multi tables lift the small-text minimums; the 1v1 root keeps its old ones.
    expect(multiTableTextStyle("large")).toEqual({ "--tt": "1.15", "--ft": "1" });
    expect(tableTextStyle("large")).not.toHaveProperty("--ft");
  });
});

describe("card text size control and panels", () => {
  it("shows four options, marks the saved one and saves a click", () => {
    render(<DuelCardTextSizeControl />);
    const group = screen.getByRole("group", { name: "Text size" });
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
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(preview).toHaveAttribute("data-card-text", "large");
    expect(inspector).toHaveAttribute("data-card-text", "large");
    expect(preview.style.getPropertyValue("--ct")).toContain("1.2");
    expect(preview.style.getPropertyValue("--seat-main")).toBe("#4cc9f0");
  });
  it("never cuts the effect text: a text that does not fit scrolls in the panel, with no hint", () => {
    const sizes = vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(720);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(340);
    const { unmount } = render(<GridHoverPreview card={card} owner={owner} reducedMotion />);
    expect(screen.getByText(card.description!)).toHaveAttribute("data-overflow", "true");
    expect(screen.queryByText("Click the card for the full text.")).toBeNull();
    unmount();
    sizes.mockReturnValue(340);
    render(<GridHoverPreview card={card} owner={owner} reducedMotion />);
    expect(screen.getByText(card.description!)).not.toHaveAttribute("data-overflow");
    expect(screen.queryByText("Click the card for the full text.")).toBeNull();
  });
  it("keeps the panel open while the pointer reads a scrolling text", () => {
    vi.useFakeTimers();
    try {
      const view = render(<GridHoverPreview card={card} owner={owner} reducedMotion />);
      const preview = screen.getByTestId("hover-preview");
      expect(preview).toHaveAttribute("data-open", "true");
      fireEvent.pointerEnter(screen.getByText(card.description!));
      view.rerender(<GridHoverPreview card={null} owner={null} reducedMotion />);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByTestId("hover-preview")).toHaveAttribute("data-open", "true");
      fireEvent.pointerLeave(screen.getByText(card.description!));
      act(() => { vi.advanceTimersByTime(1000); });
      expect(screen.getByTestId("hover-preview")).toHaveAttribute("data-open", "false");
    } finally { vi.useRealTimers(); }
  });
});

describe("card text size first read and hydration", () => {
  beforeEach(() => { vi.resetModules(); });
  it("reads a saved value on the first read", async () => {
    window.localStorage.setItem(CARD_TEXT_SIZE_KEY, JSON.stringify("xlarge"));
    const fresh = await import("@/components/duel/card-text-size");
    expect(fresh.getCardTextSize()).toBe("xlarge");
  });
  it("renders the default on the server and switches to the saved value after hydration, with no mismatch", async () => {
    window.localStorage.setItem(CARD_TEXT_SIZE_KEY, JSON.stringify("xlarge"));
    const { DuelCardTextSizeControl: Control } = await import("@/components/duel/card-text-size-control");
    const html = renderToString(<Control />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Medium</);
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.appendChild(host);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await act(async () => { hydrateRoot(host, <Control />); });
    expect(errors).not.toHaveBeenCalled();
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Extra large");
    host.remove();
  });
});
