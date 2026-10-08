// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo } from "@yugidraft/shared/duels";

import { CardStrip, stripCardsPerRow, type StripCard } from "@/components/duel/card-strip";

const card = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior",
});
const items = (selected: number[] = []): StripCard[] =>
  [1, 2, 3].map((code) => ({ id: `c${code}`, card: card(code), label: `Card ${code}`, selected: selected.includes(code), order: null }));

afterEach(cleanup);

/** jsdom has no layout: give every element a fixed scroll box, and record scrollTo calls. */
function mockLayout(box: { clientWidth: number; scrollWidth: number }) {
  const scrollTo = vi.fn();
  const saved = {
    clientWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"),
    scrollWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollWidth"),
    scrollTo: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo"),
  };
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => box.clientWidth });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => box.scrollWidth });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  const restore = () => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
    }
  };
  return { scrollTo, restore };
}

describe("CardStrip", () => {
  it("gives the full name as a tooltip, and marks a strip with notes so the notes line up", () => {
    const withNote = items().map((item, index) => (index === 0 ? { ...item, detail: "Under your Duo Drive" } : item));
    const { container, rerender } = render(<CardStrip items={withNote} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
    expect(container.querySelector("ul")?.hasAttribute("data-notes")).toBe(true);
    expect(container.querySelector("button span[title='Card 2']")).not.toBeNull();
    rerender(<CardStrip items={items()} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
    expect(container.querySelector("ul")?.hasAttribute("data-notes")).toBe(false);
  });

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

  it("says it is reconnecting, not syncing, when the duel server is down", () => {
    const onPick = vi.fn();
    render(<CardStrip items={items()} highlight={0} busy offline multi={false} label="Pick" onPick={onPick} />);
    expect(screen.getByRole("status").textContent).toBe("Reconnecting…");
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

  describe("arrow buttons", () => {
    it("shows no arrows when every card fits", () => {
      const layout = mockLayout({ clientWidth: 900, scrollWidth: 900 });
      try {
        render(<CardStrip items={items()} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        expect(screen.queryByRole("button", { name: "Show more cards" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Show earlier cards" })).toBeNull();
        expect(screen.getAllByRole("button")).toHaveLength(3);
      } finally {
        layout.restore();
      }
    });

    it("shows an arrow only on the side that has more cards, and pages by most of a view", () => {
      const layout = mockLayout({ clientWidth: 500, scrollWidth: 1200 });
      try {
        render(<CardStrip items={items()} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        const list = screen.getByRole("list");
        const frame = list.parentElement as HTMLElement;
        expect(screen.queryByRole("button", { name: "Show earlier cards" })).toBeNull();
        expect(frame.getAttribute("data-next")).toBe("true");
        expect(frame.getAttribute("data-prev")).toBe("false");

        fireEvent.click(screen.getByRole("button", { name: "Show more cards" }));
        expect(layout.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ left: 400 }));

        Object.defineProperty(list, "scrollLeft", { configurable: true, value: 300 });
        fireEvent.scroll(list);
        expect(screen.getByRole("button", { name: "Show earlier cards" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Show more cards" })).toBeTruthy();

        Object.defineProperty(list, "scrollLeft", { configurable: true, value: 700 });
        fireEvent.scroll(list);
        expect(screen.getByRole("button", { name: "Show earlier cards" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Show more cards" })).toBeNull();
        expect(frame.getAttribute("data-next")).toBe("false");
      } finally {
        layout.restore();
      }
    });

    it("keeps picking behaviour when the arrows show", () => {
      const layout = mockLayout({ clientWidth: 500, scrollWidth: 1200 });
      try {
        const onPick = vi.fn();
        render(<CardStrip items={items()} highlight={0} busy={false} multi label="Pick" onPick={onPick} />);
        fireEvent.click(screen.getByRole("button", { name: "2. Card 2" }));
        expect(onPick).toHaveBeenCalledWith(1);
      } finally {
        layout.restore();
      }
    });
  });

  describe("wrapping list (a dense host: rows that scroll up and down)", () => {
    const many = (count: number): StripCard[] =>
      Array.from({ length: count }, (_, i) => ({ id: `c${i}`, card: card(i + 1), label: `Card ${i + 1}`, selected: false, order: null }));

    /** jsdom has no layout: 3 cards per row, each row 200px apart, a 300px view over 800px of rows. */
    function mockRows(box: { clientHeight: number; scrollHeight: number }) {
      const scrollTo = vi.fn();
      const keys = ["clientHeight", "scrollHeight", "offsetTop", "offsetHeight", "scrollTo"] as const;
      const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)] as const);
      const define = (key: string, descriptor: PropertyDescriptor) => Object.defineProperty(HTMLElement.prototype, key, { configurable: true, ...descriptor });
      define("clientHeight", { get: () => box.clientHeight });
      define("scrollHeight", { get: () => box.scrollHeight });
      define("offsetHeight", { get: () => 180 });
      define("offsetTop", { get(this: HTMLElement) { return Math.floor(Array.from(this.parentElement?.children ?? []).indexOf(this) / 3) * 200; } });
      define("scrollTo", { value: scrollTo });
      const style = document.createElement("style");
      style.textContent = "ul[data-card-strip] { flex-wrap: wrap; scroll-padding-top: 14px; }";
      document.head.appendChild(style);
      return {
        scrollTo,
        restore() {
          style.remove();
          for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(HTMLElement.prototype, key, descriptor);
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
          }
        },
      };
    }

    it("shows a down button and the down fade when more rows wait below, and none of the sideways arrows", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        const list = screen.getByRole("list");
        const frame = list.parentElement as HTMLElement;
        expect(frame.getAttribute("data-down")).toBe("true");
        expect(frame.getAttribute("data-up")).toBe("false");
        expect(frame.getAttribute("data-next")).toBe("false");
        expect(frame.getAttribute("data-prev")).toBe("false");
        expect((screen.getByRole("button", { name: "Show earlier cards" }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole("button", { name: "Show more cards" }) as HTMLButtonElement).disabled).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "Show more cards" }));
        expect(layout.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 240 }));
      } finally {
        layout.restore();
      }
    });

    it("shows an up button after a scroll, and no down button at the last row", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        const list = screen.getByRole("list");
        Object.defineProperty(list, "scrollTop", { configurable: true, value: 500 });
        fireEvent.scroll(list);
        const frame = list.parentElement as HTMLElement;
        expect(frame.getAttribute("data-up")).toBe("true");
        expect(frame.getAttribute("data-down")).toBe("false");
        expect((screen.getByRole("button", { name: "Show more cards" }) as HTMLButtonElement).disabled).toBe(true);
        fireEvent.click(screen.getByRole("button", { name: "Show earlier cards" }));
        expect(layout.scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 260 }));
      } finally {
        layout.restore();
      }
    });

    it("keeps the highlighted card in view by its top, not its left", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        const { rerender } = render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        layout.scrollTo.mockClear();
        // Card 10 is in row 4 (top 600, 180 tall): scroll so that its bottom edge plus 14px is the view bottom.
        rerender(<CardStrip items={many(12)} highlight={9} busy={false} multi label="Pick" onPick={() => {}} />);
        expect(layout.scrollTo).toHaveBeenCalledTimes(1);
        const call = layout.scrollTo.mock.calls[0][0];
        expect(call.top).toBe(600 + 180 + 14 - 300);
        expect(call).not.toHaveProperty("left");
      } finally {
        layout.restore();
      }
    });

    it("counts the cards in a row for the Up and Down keys, and one card in a single sideways row", () => {
      const inPanel = (
        <div data-prompt-panel>
          <CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />
        </div>
      );
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(inPanel);
        expect(stripCardsPerRow()).toBe(3);
      } finally {
        layout.restore();
      }
      cleanup();
      render(inPanel);
      expect(stripCardsPerRow()).toBe(1);
    });

    it("takes a grid list as a wrapping one too", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      const style = document.createElement("style");
      style.textContent = "ul[data-card-strip] { display: grid; flex-wrap: nowrap; }";
      document.head.appendChild(style);
      try {
        render(
          <div data-prompt-panel>
            <CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />
          </div>,
        );
        expect(stripCardsPerRow()).toBe(3);
      } finally {
        style.remove();
        layout.restore();
      }
    });

    it("looks for the strip in the open prompt panel only", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        expect(stripCardsPerRow()).toBe(1);
      } finally {
        layout.restore();
      }
    });

    it("shows the card count in the caption line when the list wraps and has rows beyond an edge", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(14)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        expect(screen.getByText("14 cards")).toBeTruthy();
      } finally {
        layout.restore();
      }
    });

    it("shows no count when every row fits, or when the list is one sideways row", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 300 });
      try {
        render(<CardStrip items={many(6)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        expect(screen.queryByText(/\d+ cards/)).toBeNull();
        expect(screen.queryByRole("button", { name: "Show more cards" })).toBeNull();
      } finally {
        layout.restore();
      }
      cleanup();
      render(<CardStrip items={many(14)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
      expect(screen.queryByText(/\d+ cards/)).toBeNull();
    });

    it("keeps the focus on the card when a scroll button is pressed with the mouse", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        const button = screen.getByRole("button", { name: "Show more cards" });
        expect(fireEvent.mouseDown(button)).toBe(false);
      } finally {
        layout.restore();
      }
    });

    it("leaves the wheel to the list, which scrolls up and down by itself", () => {
      const layout = mockRows({ clientHeight: 300, scrollHeight: 800 });
      try {
        render(<CardStrip items={many(12)} highlight={0} busy={false} multi label="Pick" onPick={() => {}} />);
        const list = screen.getByRole("list");
        const event = new WheelEvent("wheel", { deltaY: 120, cancelable: true });
        list.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      } finally {
        layout.restore();
      }
    });
  });
});
