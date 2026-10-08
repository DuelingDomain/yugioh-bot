// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
const perRow = vi.hoisted(() => ({ value: 1 }));
vi.mock("@/components/duel/card-strip", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/duel/card-strip")>()),
  stripCardsPerRow: () => perRow.value,
}));
import { PromptTray, usePromptDraft } from "@/components/duel/prompts";

afterEach(() => {
  cleanup();
  perRow.value = 1;
});

const prompt: DuelPrompt = {
  id: "cards", seat: 0, kind: "choice", title: "Select a card",
  options: Array.from({ length: 14 }, (_, i) => ({ id: `c${i}`, label: `Card ${i + 1}` })),
};

function Tray() {
  const draft = usePromptDraft(prompt);
  return (
    <>
      <PromptTray prompt={prompt} mySeat={0} slug="t" busy={false} draft={draft} onSubmit={vi.fn()} headless />
      <output data-testid="highlight">{draft.highlight}</output>
    </>
  );
}
const highlight = () => Number(screen.getByTestId("highlight").textContent);
const press = (key: string) => fireEvent.keyDown(window, { key });

describe("PromptTray keys in a wrapping card list", () => {
  it("moves one row on Down and Up, and one card on Left and Right", () => {
    perRow.value = 6;
    render(<Tray />);
    press("ArrowDown");
    expect(highlight()).toBe(6);
    press("ArrowRight");
    expect(highlight()).toBe(7);
    press("ArrowDown");
    expect(highlight()).toBe(13);
    press("ArrowUp");
    expect(highlight()).toBe(7);
    press("ArrowLeft");
    expect(highlight()).toBe(6);
  });

  it("stays at the last row on Down, and at the first row on Up", () => {
    perRow.value = 6;
    render(<Tray />);
    press("ArrowUp");
    expect(highlight()).toBe(0);
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    expect(highlight()).toBe(12);
  });

  it("moves one card on Down in a single row", () => {
    render(<Tray />);
    press("ArrowDown");
    expect(highlight()).toBe(1);
  });
});
