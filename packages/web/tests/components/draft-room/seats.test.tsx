// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatStrip, type FriendView } from "../../../src/components/draft/room/seats";

const names = ["Yugi", "Joey", "Tea", "Tristan", "Kaiba", "Mokuba", "Mai", "Bakura", "Marik", "Ishizu", "Odion"];
const friends: FriendView[] = names.map((displayName, i) => ({
  index: i + 1,
  seat: { seatIndex: i + 1, playerId: i + 2, displayName, hasPicked: false, isCurrentPlayer: false },
  packN: 8,
  state: "picking",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SeatStrip", () => {
  it("names the list Seats and renders all eleven friends at a twelve-player table", () => {
    render(<SeatStrip friends={friends} />);
    const list = screen.getByRole("list", { name: "Seats" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(11);
    expect(items.map((item, i) => within(item).getByText(names[i]).textContent)).toEqual(names);
    expect(items.map((item) => item.title)).toEqual(names);
  });

  it("updates the offscreen edges on scroll, resize and changes to the friends list", () => {
    // jsdom has no layout; supply the strip's measured dimensions.
    const box = { scrollWidth: 550, clientWidth: 330 };
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => box.scrollWidth);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => box.clientWidth);
    const resizeCallbacks = new Set<() => void>();
    vi.stubGlobal("ResizeObserver", class {
      constructor(private callback: () => void) {}
      observe() { resizeCallbacks.add(this.callback); }
      unobserve() {}
      disconnect() { resizeCallbacks.delete(this.callback); }
    });

    const { rerender } = render(<SeatStrip friends={friends} />);
    const list = screen.getByRole("list", { name: "Seats" });
    expect(list).toHaveAttribute("data-more", "end");

    list.scrollLeft = 110;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-more", "both");

    list.scrollLeft = 220;
    fireEvent.scroll(list);
    expect(list).toHaveAttribute("data-more", "start");

    list.scrollLeft = 0;
    box.clientWidth = 550;
    act(() => resizeCallbacks.forEach((callback) => callback()));
    expect(list).not.toHaveAttribute("data-more");

    box.clientWidth = 330;
    rerender(<SeatStrip friends={friends.slice()} />);
    expect(list).toHaveAttribute("data-more", "end");

    box.scrollWidth = 300;
    rerender(<SeatStrip friends={friends.slice(0, 3)} />);
    expect(list).not.toHaveAttribute("data-more");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });
});
