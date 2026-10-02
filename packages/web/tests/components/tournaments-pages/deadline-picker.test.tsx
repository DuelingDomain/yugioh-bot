// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeadlinePicker } from "../../../src/components/tournament/deadline-picker";

function Harness({ initial = null, onValue }: { initial?: Date | null; onValue?: (d: Date | null) => void }) {
  const [v, setV] = React.useState<Date | null>(initial);
  return (
    <DeadlinePicker
      idPrefix="dl"
      value={v}
      onChange={(d) => {
        setV(d);
        onValue?.(d);
      }}
    />
  );
}

describe("DeadlinePicker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 15, 0));
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens a dialog with focus on today, and Escape closes it and returns focus", () => {
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /no deadline · add one/i });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: /choose a date/i });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toHaveAttribute("aria-current", "date");
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /no deadline · add one/i }));
  });

  it("disables days before today and moves focus with the arrow keys, picks with Enter/click", () => {
    const onValue = vi.fn();
    render(<Harness onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: /no deadline · add one/i }));
    const day = (n: number) => screen.getByRole("button", { name: new RegExp(`october ${n}, 2026`, "i") });
    expect(day(1)).not.toBeDisabled();
    fireEvent.keyDown(day(1), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(day(1)); // clamped at today
    fireEvent.keyDown(day(1), { key: "ArrowRight" });
    expect(document.activeElement).toBe(day(2));
    fireEvent.keyDown(day(2), { key: "ArrowDown" });
    expect(document.activeElement).toBe(day(9));
    fireEvent.click(day(9));
    const d = onValue.mock.calls[0][0] as Date;
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 9, 23, 59]);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: /fri, oct 9, 2026/i })).toBeTruthy();
    expect(screen.getByText(/8 days from today/i)).toBeTruthy();
  });

  it("changes the time from the listbox by keyboard", () => {
    const onValue = vi.fn();
    render(<Harness initial={new Date(2026, 9, 9, 23, 0)} onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: /11:00 pm/i }));
    const list = screen.getByRole("listbox", { name: /choose a time/i });
    expect(document.activeElement).toBe(list);
    expect(screen.getByRole("option", { selected: true }).textContent).toBe("11:00 PM");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    const d = onValue.mock.calls[0][0] as Date;
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 23, 30]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("clears the deadline and offers the empty state again", () => {
    const onValue = vi.fn();
    render(<Harness initial={new Date(2026, 9, 9, 23, 0)} onValue={onValue} />);
    fireEvent.click(screen.getByRole("button", { name: /clear the deadline/i }));
    expect(onValue).toHaveBeenCalledWith(null);
    expect(screen.getByRole("button", { name: /no deadline · add one/i })).toBeTruthy();
    expect(screen.getByText(/runs until every match is decided/i)).toBeTruthy();
  });
});
