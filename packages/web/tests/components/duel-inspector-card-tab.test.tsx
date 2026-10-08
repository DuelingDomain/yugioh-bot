// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { LOCATION_MZONE, POS_FACEUP_ATTACK } from "@/components/duel/constants";
import { CardInspector, cardScrollerProps } from "@/components/duel/inspector";

const card: DuelCard = {
  controller: 0, location: LOCATION_MZONE, sequence: 1, position: POS_FACEUP_ATTACK, code: 11, name: "Blue-Eyes White Dragon",
  description: "This legendary dragon is a powerful engine of destruction. ".repeat(20),
};
const other: DuelCard = { ...card, code: 12, name: "Dark Magician" };

// jsdom does no layout: the scroll sizes come from these values, which a test changes to move the text past or inside the edge.
const size = { scrollHeight: 600, clientHeight: 300 };

beforeEach(() => {
  size.scrollHeight = 600;
  size.clientHeight = 300;
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => size.scrollHeight);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(() => size.clientHeight);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A scroller that holds the Card tab, as each table builds it. */
function Pane({ target, marked = true }: { target: DuelCard; marked?: boolean }) {
  return (
    <div data-testid="scroller" style={{ overflowY: "auto" }} {...cardScrollerProps(marked)}>
      <CardInspector target={{ type: "card", card: target }} />
    </div>
  );
}
const nextFrame = () => new Promise<void>((resolve) => setTimeout(() => requestAnimationFrame(() => resolve()), 0));
const scrollerOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="scroller"]')!;

describe("Card tab", () => {
  it("marks a face-up card for the header-beside-art layout and keeps its whole text", () => {
    const { container } = render(<Pane target={card} />);
    const root = container.querySelector('[data-header="side"]');
    expect(root).not.toBeNull();
    expect(root?.textContent).toContain(card.description?.trim());
  });

  it("has no header layout and no cue for a face-down card", () => {
    const { container } = render(<Pane target={{ ...card, code: null } as unknown as DuelCard} />);
    expect(container.querySelector('[data-header="side"]')).toBeNull();
    expect(scrollerOf(container).dataset.cardMore).toBeUndefined();
  });

  it("flags more text while it runs past the bottom edge, and clears the flag at the end", () => {
    const { container } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    expect(scroller.dataset.cardMore).toBe("true");
    scroller.scrollTop = 300;
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(scroller.dataset.cardMore).toBe("false");
    scroller.scrollTop = 0;
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(scroller.dataset.cardMore).toBe("true");
  });

  it("flags no more text when everything fits", () => {
    size.scrollHeight = 300;
    const { container } = render(<Pane target={card} />);
    expect(scrollerOf(container).dataset.cardMore).toBe("false");
  });

  it("sets the flag again for the next card", () => {
    const { container, rerender } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    scroller.scrollTop = 300;
    act(() => { scroller.dispatchEvent(new Event("scroll")); });
    expect(scroller.dataset.cardMore).toBe("false");
    scroller.scrollTop = 0;
    rerender(<Pane target={other} />);
    expect(scroller.dataset.cardMore).toBe("true");
  });

  it("follows a line that arrives late inside the scroller", async () => {
    size.scrollHeight = 300;
    const { container } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    expect(scroller.dataset.cardMore).toBe("false");
    size.scrollHeight = 450;
    await act(async () => {
      const late = document.createElement("p");
      late.textContent = "Owner Rook";
      scroller.appendChild(late);
      await nextFrame();
    });
    expect(scroller.dataset.cardMore).toBe("true");
  });

  it("leaves a scroller without the mark alone, as the phone sheet is", () => {
    const { container } = render(<Pane target={card} marked={false} />);
    expect(scrollerOf(container).dataset.cardMore).toBeUndefined();
    expect(scrollerOf(container).getAttribute("tabindex")).toBeNull();
  });

  it("makes the scroller a tab stop while a card shows, and not otherwise", () => {
    const { container, rerender } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    expect(scroller.getAttribute("tabindex")).toBe("0");
    // The mark alone (an empty Card tab) adds no tab stop, and no role or label that a screen reader would say again.
    rerender(<div data-testid="scroller" {...cardScrollerProps(true)} />);
    expect(scroller.getAttribute("tabindex")).toBeNull();
    expect(scroller.getAttribute("role")).toBeNull();
    expect(cardScrollerProps(false)).toEqual({});
  });

  it("keeps the tab stop when the card changes", () => {
    const other = { ...card, code: card.code + 1, name: "Other" };
    const { container, rerender } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    const removed = vi.fn();
    const spy = vi.spyOn(scroller, "removeAttribute").mockImplementation(removed);
    rerender(<Pane target={other} />);
    expect(removed).not.toHaveBeenCalledWith("tabindex");
    spy.mockRestore();
    expect(scroller.getAttribute("tabindex")).toBe("0");
  });

  it("keeps a tab index that the scroller already had", () => {
    const { container, rerender } = render(<div data-testid="scroller" tabIndex={-1} {...cardScrollerProps(true)}><CardInspector target={{ type: "card", card }} /></div>);
    const scroller = scrollerOf(container);
    expect(scroller.getAttribute("tabindex")).toBe("-1");
    rerender(<div data-testid="scroller" tabIndex={-1} {...cardScrollerProps(true)} />);
    expect(scroller.getAttribute("tabindex")).toBe("-1");
  });

  it("checks many mutations once per frame", async () => {
    const frames = vi.spyOn(window, "requestAnimationFrame");
    const { container } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    frames.mockClear();
    await act(async () => {
      // Each append is its own microtask, so the observer callback runs once per append.
      for (let i = 0; i < 20; i++) {
        scroller.appendChild(document.createElement("p"));
        await Promise.resolve();
      }
    });
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it("removes its flag and stops listening when the card closes", async () => {
    const { container, rerender } = render(<Pane target={card} />);
    const scroller = scrollerOf(container);
    expect(scroller.dataset.cardMore).toBe("true");
    rerender(<div data-testid="scroller" {...cardScrollerProps(true)} />);
    expect(scroller.dataset.cardMore).toBeUndefined();
    size.scrollHeight = 900;
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
      scroller.appendChild(document.createElement("p"));
      await nextFrame();
    });
    expect(scroller.dataset.cardMore).toBeUndefined();
  });
});
