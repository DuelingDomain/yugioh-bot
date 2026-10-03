// packages/web/tests/components/card-hover-popup.test.tsx
// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CardHoverPopup } from "../../src/components/draft/card-hover-popup";
import type { CardSummary } from "../../src/lib/card-types";

const card: CardSummary = {
  id: 1, name: "Mirror Force", type: "Trap Card", frameType: "trap",
  effectText: "Destroy all attack position monsters.", imageUrl: "u", imageUrlSmall: "s",
};

describe("CardHoverPopup", () => {
  it("renders the card name and effect", () => {
    render(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} />);
    expect(screen.getByText("Mirror Force")).toBeTruthy();
    expect(screen.getByText(/destroy all attack position monsters/i)).toBeTruthy();
  });

  it("in dismissible mode shows a close button and fires onDismiss on Escape", () => {
    const onDismiss = vi.fn();
    render(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} dismissible onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /close preview/i })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("fires onDismiss when the close button is clicked", () => {
    const onDismiss = vi.fn();
    render(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} dismissible onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /close preview/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("fires onDismiss when the backdrop overlay is clicked", () => {
    const onDismiss = vi.fn();
    render(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} dismissible onDismiss={onDismiss} />);
    const backdrop = screen.getByTestId("card-hover-popup-backdrop");
    fireEvent.click(backdrop);
    expect(onDismiss).toHaveBeenCalled();
  });

  it("shows the chips and ATK/DEF for a monster, and keeps the card text in its own scroll region", () => {
    const monster: CardSummary = {
      id: 2, name: "Sample Tuner", type: "Tuner Monster", frameType: "effect", attribute: "LIGHT", level: 1,
      effectText: "A long effect. ".repeat(80), atk: 100, def: 200, imageUrl: "u", imageUrlSmall: "s",
    };
    render(<CardHoverPopup card={monster} position={{ left: 10, top: 20 }} imageError onImageError={() => {}} />);
    for (const label of ["LIGHT", "Level 1", "Tuner Monster", "effect"]) expect(screen.getByText(label)).toBeTruthy();
    expect(screen.getByText("ATK 100")).toBeTruthy();
    expect(screen.getByText("DEF 200")).toBeTruthy();
    const text = screen.getByText(/A long effect\./);
    expect(text.tagName).toBe("P");
    expect(text.className).toContain("text");
  });

  it("is sized from the shared constants so it fits the viewport it is placed in", () => {
    render(<CardHoverPopup card={card} position={{ left: 10, top: 20 }} imageError onImageError={() => {}} />);
    const box = screen.getByTestId("card-hover-popup");
    expect(box.style.left).toBe("10px");
    expect(box.style.top).toBe("20px");
    expect(box.style.width).toBe("460px");
    expect(box.style.maxWidth).toContain("100vw");
  });

  it("makes the card text focusable only in the pinned (dismissible) mode", () => {
    const { rerender } = render(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} />);
    expect(screen.getByText(/destroy all attack/i).getAttribute("tabindex")).toBeNull();
    rerender(<CardHoverPopup card={card} position={{ left: 0, top: 0 }} imageError onImageError={() => {}} dismissible onDismiss={() => {}} />);
    const text = screen.getByText(/destroy all attack/i);
    expect(text.getAttribute("tabindex")).toBe("0");
    expect(screen.getByRole("region", { name: "Mirror Force card text" })).toBe(text);
  });
});

describe("card-hover-popup.module.css", () => {
  const css = readFileSync(fileURLToPath(new NodeURL("../../src/components/draft/card-hover-popup.module.css", import.meta.url)), "utf8");
  const body = (selector: string) => {
    const start = css.search(new RegExp(`^${selector.replace(/\./g, "\\.")}\\s*\\{`, "m"));
    expect(start, selector).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it("caps the panel height to the window and scrolls the text inside it", () => {
    expect(body(".panel")).toMatch(/max-height:\s*min\(360px,\s*calc\(100vh - 32px\)\)/);
    expect(body(".panel")).toMatch(/max-height:\s*min\(360px,\s*calc\(100dvh - 32px\)\)/);
    expect(body(".text")).toMatch(/overflow-y:\s*auto/);
    expect(body(".text")).toMatch(/min-height:\s*0/);
  });

  it("uses a short plain fade and turns it off for reduced motion", () => {
    expect(body(".panel")).toMatch(/animation:\s*fade 120ms/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.panel\s*\{\s*animation:\s*none/);
    expect(css).not.toMatch(/transform|scale\(|translate/);
  });
});
