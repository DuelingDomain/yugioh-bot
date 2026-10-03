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
import type { PromptDraft } from "@/components/duel/prompts";

const draft: PromptDraft = {
  selected: [], setSelected: vi.fn(), counts: {}, setCounts: vi.fn(), value: 0, setValue: vi.fn(),
  cardCode: null, setCardCode: vi.fn(), highlight: 0, setHighlight: vi.fn(),
};

const MZONE = 0x04;

function mount(prompt: DuelPrompt, onSubmit = vi.fn()) {
  render(
    <div>
      <div data-zones="0:4:0" data-kind="mzone" />
      <div data-zones="0:4:1" data-kind="mzone" />
      <PromptCenter prompt={prompt} mySeat={0} active slug="s" busy={false} draft={draft} onSubmit={onSubmit}
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

  it("shows Select materials with a progress line and Undo / Finish buttons for a one-at-a-time pick", () => {
    const onSubmit = vi.fn();
    mount({
      id: "p", seat: 0, kind: "toggle", title: "Select the card(s) to use as Synchro Material", min: 2, max: 2,
      finishable: false,
      options: [
        { id: "unselect:0", label: "a", controller: 0, location: MZONE, sequence: 0, selected: true },
        { id: "select:1", label: "b", controller: 0, location: MZONE, sequence: 1 },
      ],
    }, onSubmit);
    expect(screen.getByText("Select materials")).toBeTruthy();
    expect(screen.getByText("Synchro material")).toBeTruthy();
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
});
