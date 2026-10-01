// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo } from "@yugidraft/shared/duels";

import { CardStrip, type StripCard } from "@/components/duel/card-strip";

const card = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior",
});
const items = (selected: number[] = []): StripCard[] =>
  [1, 2, 3].map((code) => ({ id: `c${code}`, card: card(code), label: `Card ${code}`, selected: selected.includes(code), order: null }));

afterEach(cleanup);

describe("CardStrip", () => {
  it("numbers every card, shows the selected state and keeps the highlighted card as the primary", () => {
    render(<CardStrip items={items([2])} highlight={1} busy={false} multi label="Pick" onPick={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["1. Card 1", "2. Card 2", "3. Card 3"]);
    expect(buttons[1].getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    expect(buttons[1].hasAttribute("data-primary")).toBe(true);
    expect(buttons[0].hasAttribute("data-primary")).toBe(false);
  });

  it("picks on click and shows a hovered or focused card in the inspector", () => {
    const onPick = vi.fn();
    const onInspect = vi.fn();
    const onEnter = vi.fn();
    render(<CardStrip items={items()} highlight={0} busy={false} multi={false} label="Pick" onPick={onPick}
      onEnter={onEnter} onInspect={onInspect} />);
    const buttons = screen.getAllByRole("button");
    fireEvent.mouseEnter(buttons[2]);
    expect(onEnter).toHaveBeenCalledWith(2);
    expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({ code: 3 }));
    fireEvent.focus(buttons[1]);
    expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({ code: 2 }));
    fireEvent.click(buttons[0]);
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it("says it is syncing and answers nothing while busy", () => {
    const onPick = vi.fn();
    render(<CardStrip items={items()} highlight={0} busy multi={false} label="Pick" onPick={onPick} />);
    expect(screen.getByRole("status").textContent).toBe("Syncing…");
    const buttons = screen.getAllByRole("button");
    expect(buttons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(buttons[0]);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("shows a short line under a card only when it has a detail, with the full text as a tooltip", () => {
    const list = items();
    list[0] = { ...list[0], detail: "Special Summon", detailTitle: "Special Summon 1 monster" };
    render(<CardStrip items={list} highlight={0} busy={false} multi={false} label="Pick" onPick={() => {}} />);
    const line = screen.getByText("Special Summon");
    expect(line.getAttribute("title")).toBe("Special Summon 1 monster");
    expect(screen.getAllByRole("button")[0].getAttribute("aria-label")).toBe("1. Card 1 · Special Summon 1 monster");
    expect(screen.getAllByRole("button")[1].getAttribute("aria-label")).toBe("2. Card 2");
  });

  it("takes its own hint and chain tone", () => {
    const { container } = render(<CardStrip items={items()} highlight={0} busy={false} multi={false} label="Pick"
      tone="chain" hint="Click a card to activate it" onPick={() => {}} />);
    expect(screen.getByText("Click a card to activate it")).toBeTruthy();
    expect(container.firstElementChild?.getAttribute("data-tone")).toBe("chain");
  });
});
