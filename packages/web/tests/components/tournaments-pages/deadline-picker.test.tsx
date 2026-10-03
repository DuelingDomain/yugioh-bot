// @vitest-environment jsdom
import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it.each([
    { control: "Next month", initial: new Date(2026, 9, 9, 23), today: new Date(2026, 9, 1), label: "Sunday, November 1, 2026", month: 10, day: 1 },
    { control: "Previous month", initial: new Date(2026, 10, 9, 23), today: new Date(2026, 9, 1), label: "Thursday, October 1, 2026", month: 9, day: 1 },
    { control: "Previous month", initial: new Date(2026, 10, 9, 23), today: new Date(2026, 9, 15), label: "Thursday, October 15, 2026", month: 9, day: 15 },
  ])("moves focus after activating $control to $label", async ({ control, initial, today, label, month, day }) => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    vi.setSystemTime(today);
    const { container } = render(<Harness initial={initial} onValue={onValue} />);
    fireEvent.click(container.querySelector<HTMLButtonElement>("#dl-date")!);
    screen.getByRole("button", { name: control }).focus();
    await user.keyboard("{Enter}");
    const target = screen.getByRole("button", { name: label });
    expect(document.activeElement).toBe(target);
    expect(target).toHaveAttribute("tabindex", "0");
    expect(target).not.toBeDisabled();
    await user.keyboard("{Enter}");
    const picked = onValue.mock.calls[0][0] as Date;
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate(), picked.getHours()]).toEqual([2026, month, day, 23]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    { initial: new Date(2027, 0, 31), key: "PageDown", label: "February 28, 2027", title: "February 2027" },
    { initial: new Date(2027, 2, 31), key: "PageUp", label: "February 28, 2027", title: "February 2027" },
    { initial: new Date(2028, 0, 31), key: "PageDown", label: "February 29, 2028", title: "February 2028" },
    { initial: new Date(2028, 2, 31), key: "PageUp", label: "February 29, 2028", title: "February 2028" },
    { initial: new Date(2027, 11, 31), key: "PageDown", label: "January 31, 2028", title: "January 2028" },
    { initial: new Date(2027, 0, 31), key: "PageUp", label: "December 31, 2026", title: "December 2026" },
    { initial: new Date(2027, 0, 15), key: "PageDown", label: "February 15, 2027", title: "February 2027" },
    { initial: new Date(2026, 10, 1), key: "PageUp", label: "October 15, 2026", title: "October 2026" },
  ])("moves $key from $initial to $label without overflowing the destination month", ({ initial, key, label, title }) => {
    vi.setSystemTime(new Date(2026, 9, 15));
    const { container } = render(<Harness initial={initial} />);
    fireEvent.click(container.querySelector<HTMLButtonElement>("#dl-date")!);
    fireEvent.keyDown(document.activeElement!, { key });
    expect(screen.getByText(title)).toBeTruthy();
    const target = screen.getByRole("button", { name: new RegExp(label) });
    expect(document.activeElement).toBe(target);
    expect(target).toHaveAttribute("tabindex", "0");
    expect(target).not.toBeDisabled();
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

  it.each(["Enter", "blur"])("accepts a typed time outside the presets on %s", async (commit) => {
    const user = userEvent.setup();
    render(<Harness initial={new Date(2026, 9, 9, 23, 0)} />);
    const trigger = screen.getByRole("button", { name: /11:00 pm/i });
    fireEvent.click(trigger);
    const list = screen.getByRole("listbox", { name: /choose a time/i });
    const input = screen.getByLabelText("Deadline time");
    await user.tab({ shift: true });
    expect(screen.getByRole("listbox")).toBe(list);
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "22:15" } });
    expect(screen.getByRole("button", { name: /10:15 pm/i })).toBe(trigger);
    expect(screen.getByRole("listbox")).toBe(list);
    if (commit === "Enter") fireEvent.keyDown(input, { key: "Enter" });
    else fireEvent.blur(input);
    expect(screen.getByRole("button", { name: /10:15 pm/i })).toBe(trigger);
    expect(screen.getByRole("button", { name: /fri, oct 9, 2026/i })).toBeTruthy();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("keeps an incomplete typed time from changing the deadline", () => {
    render(<Harness initial={new Date(2026, 9, 9, 23, 0)} />);
    const trigger = screen.getByRole("button", { name: /11:00 pm/i });
    fireEvent.click(trigger);
    const input = screen.getByLabelText("Deadline time");
    input.focus();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: /11:00 pm/i })).toBe(trigger);
    expect(document.activeElement).toBe(trigger);
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
