// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { PromptCenter } from "@/components/duel/prompt-center";
import { PromptTray, type PromptDraft } from "@/components/duel/prompts";

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

const MZONE = 0x04;

function mount(prompt: DuelPrompt, onSubmit = vi.fn(), currentDraft = draft) {
  render(
    <div>
      <div data-zones="0:4:0" data-kind="mzone" />
      <div data-zones="0:4:1" data-kind="mzone" />
      <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={currentDraft} onSubmit={onSubmit}
        menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={0} />
    </div>,
  );
  return { onSubmit };
}

const place = (sequence: number) => ({ id: `place:${sequence}`, label: `Monster Zone ${sequence + 1}`, controller: 0, location: MZONE, sequence });

afterEach(cleanup);

describe("select bar", () => {
  it("shows a short whole title, the card on the second line and the full engine text in aria and the tooltip", () => {
    const title = "Select a zone for Blue-Eyes White Dragon";
    mount({ id: "p", seat: 0, kind: "places", title, min: 1, max: 1, options: [place(0), place(1)] });
    const bar = document.querySelector("[data-actions]") as HTMLElement;
    expect(bar.getAttribute("role")).toBe("group");
    expect(bar.getAttribute("aria-label")).toBe(title);
    expect(screen.getByText("Choose a zone").tagName).toBe("B");
    expect(screen.getByText("Blue-Eyes White Dragon")).toBeTruthy();
    expect(screen.getByText("Pick 1")).toBeTruthy();
    expect(bar.querySelector("[title]")?.getAttribute("title")).toBe(title);
    expect(bar.getAttribute("data-actions")).toBe("false");
    expect(screen.queryByText(/…|\.\.\./)).toBeNull();
  });

  it("shows the source card as a thumbnail", () => {
    mount({
      id: "p", seat: 0, kind: "places", title: "Select a zone", min: 1, max: 1, options: [place(0)],
      ...({ source: { code: 89631139, name: "Blue-Eyes White Dragon", seat: 0, text: "x" } } as object),
    });
    expect(document.querySelector("img")).not.toBeNull();
    expect(screen.getByText("Blue-Eyes White Dragon")).toBeTruthy();
    expect(screen.getByText("Pick 1")).toBeTruthy();
  });

  it("shows fixed Fusion material bounds and an Undo button", () => {
    const onSubmit = vi.fn();
    mount({
      id: "p", seat: 0, kind: "toggle", title: "Select the card(s) to use as Fusion Material", min: 2, max: 2,
      finishable: false,
      options: [
        { id: "unselect:0", label: "a", controller: 0, location: MZONE, sequence: 0, selected: true },
        { id: "select:1", label: "b", controller: 0, location: MZONE, sequence: 1 },
      ],
    }, onSubmit);
    expect(screen.getByText("Select materials")).toBeTruthy();
    expect(screen.getByText("Fusion material")).toBeTruthy();
    expect(screen.getByText("Pick 2")).toBeTruthy();
    expect(screen.getByText("1/2 selected")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(onSubmit).toHaveBeenCalledWith({ choice: "unselect:0" });
    expect((document.querySelector("[data-actions]") as HTMLElement).getAttribute("data-actions")).toBe("true");
  });

  it("keeps Confirm disabled until the count rules hold", () => {
    const onSubmit = vi.fn();
    mount({
      id: "p", seat: 0, kind: "cards", title: "Select the card(s) to discard", min: 2, max: 2,
      options: [
        { id: "card:0", label: "a", controller: 0, location: MZONE, sequence: 0 },
        { id: "card:1", label: "b", controller: 0, location: MZONE, sequence: 1 },
      ],
    }, onSubmit);
    expect(screen.getByText("Discard 2")).toBeTruthy();
    expect(screen.getByText("Pick 2")).toBeTruthy();
    expect(screen.getByText("0/2 selected")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expect(confirm.title).toBe("Select 2 more");
  });

  it("shows cumulative material choices without using the engine's per-step maximum", () => {
    mount({
      id: "p", seat: 0, kind: "toggle", title: "Select the card(s) to use as Synchro Material", min: 1, max: 1,
      finishable: true,
      options: [
        { id: "unselect:0", label: "a", controller: 0, location: MZONE, sequence: 0, selected: true },
        { id: "unselect:1", label: "b", controller: 0, location: MZONE, sequence: 1, selected: true },
      ],
    });
    expect(screen.getByText("Choose a material")).toBeTruthy();
    expect(screen.getByText("2 selected")).toBeTruthy();
    expect(screen.queryByText(/\/1 selected|Pick 1/)).toBeNull();
    expect(screen.getByRole("button", { name: "Finish" })).toBeTruthy();
  });

  it.each(["toggle", "sum"] as const)("renders Synchro Levels at 0, 1 and 2 picks on the %s path", (kind) => {
    const prompt: DuelPrompt = {
      id: "p", seat: 0, kind, title: "Select the card(s) to use as Synchro Material",
      min: 1, max: kind === "toggle" ? 1 : 2, sumMode: "exact", target: 7,
      options: [
        { id: "card:0", label: "a", controller: 0, location: MZONE, sequence: 0, currentLevel: 3, values: [3] },
        { id: "card:1", label: "b", controller: 0, location: MZONE, sequence: 1, currentLevel: 4, values: [4] },
      ],
    };
    for (const [count, counter, met] of [[0, "Level 0 / 7", false], [1, "Level 3 / 7", false], [2, "Level 7 / 7", true]] as const) {
      const current = { ...prompt, options: prompt.options.map((option, index) => ({ ...option, selected: index < count })) };
      const selectedDraft = { ...draft, selected: prompt.options.slice(0, count).map((option) => option.id) };
      mount(current, vi.fn(), selectedDraft);
      const chip = screen.getByText(counter);
      expect(chip.getAttribute("data-done")).toBe(String(met));
      expect(screen.getByText(kind === "toggle" ? "Choose a material" : "Select materials")).toBeTruthy();
      if (kind === "sum") expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(!met);
      cleanup();
      if (kind === "sum") {
        render(<PromptTray prompt={current} mySeat={0} active slug="s" busy={false} draft={selectedDraft} onSubmit={vi.fn()} />);
        expect(screen.getByText(counter)).toBeTruthy();
        expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(!met);
        cleanup();
      }
    }
  });

  it.each(["exact", "at-least"] as const)("shows an unmet Ritual pill and disabled Confirm until its %s sum is met", (sumMode) => {
    const prompt: DuelPrompt = {
      id: "p", seat: 0, kind: "sum", title: "Select the card(s) to Tribute", min: 0, max: 2, target: 4, sumMode,
      options: [
        { id: "card:0", label: "Mystical Shine Ball", controller: 0, location: MZONE, sequence: 0, values: [2] },
        { id: "card:1", label: "Flame Manipulator", controller: 0, location: MZONE, sequence: 1, values: [3] },
      ],
    };
    const instruction = sumMode === "exact" ? "Total 4" : "Total at least 4";
    for (const [selected, counter, met] of [
      [[], "Level total 0", false],
      [["card:0"], "Level total 2", false],
      [["card:0", "card:1"], "Level total 2 + 3 = 5", sumMode === "at-least"],
    ] as const) {
      const selectedDraft = { ...draft, selected: [...selected] };
      mount(prompt, vi.fn(), selectedDraft);
      expect(screen.getByText(instruction)).toBeTruthy();
      expect(screen.getByText(counter).getAttribute("data-done")).toBe(String(met));
      expect(document.querySelector("[data-ready]")?.getAttribute("data-ready")).toBe(String(met));
      expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(!met);
      cleanup();
      render(<PromptTray prompt={prompt} mySeat={0} active slug="s" busy={false} draft={selectedDraft} onSubmit={vi.fn()} />);
      expect(screen.getByText(`${instruction} · ${counter}`)).toBeTruthy();
      expect((screen.getByRole("button", { name: "Confirm" }) as HTMLButtonElement).disabled).toBe(!met);
      cleanup();
    }
  });
});
