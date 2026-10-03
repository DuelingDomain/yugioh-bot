// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoofKeys } from "@/components/duel/tag/use-roof-keys";
import type { TagKeyState } from "@/components/duel/tag/live-tag";

afterEach(cleanup);

function Probe({ paused, dispatch, pinned = false }: { paused?: TagKeyState; dispatch: (action: unknown) => void; pinned?: boolean }) {
  useRoofKeys({ dispatch, anchorSeat: 0, pinned, paused });
  return (
    <div>
      <input aria-label="chat" />
      <textarea aria-label="note" />
      <select aria-label="pick"><option>a</option></select>
      <div aria-label="rich" contentEditable suppressContentEditableWarning />
      <div role="dialog" aria-modal="false"><button type="button">inside</button></div>
    </div>
  );
}

function press(key: string, init: KeyboardEventInit = {}, target: Element | Window = window) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  (target as EventTarget).dispatchEvent(event);
  return event;
}

describe("useRoofKeys", () => {
  it("sends a digit to the camera when nothing is open", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    const event = press("3");
    expect(dispatch).toHaveBeenCalledWith({ type: "focus", seat: 2 });
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["a seat pick", { seatPick: { seats: [1, 3] } }],
    ["an aim", { aim: { from: 0 } }],
    ["a card menu", { menu: { card: 1 } }],
    ["the pile viewer", { pile: { open: true } }],
    ["a dialog", { dialog: true }],
    ["suspended input", { inputSuspended: true }],
  ] as const)("ignores digits and Tab while %s is open", (_name, paused) => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} paused={paused} />);
    const digit = press("2");
    const tab = press("Tab");
    expect(dispatch).not.toHaveBeenCalled();
    expect(digit.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("treats a closed pile as not open", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} paused={{ pile: { open: false } }} />);
    press("1");
    expect(dispatch).toHaveBeenCalledWith({ type: "focus", seat: 0 });
  });

  it("takes Tab and Shift+Tab as focus steps when nothing is open", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    const event = press("Tab");
    press("Tab", { shiftKey: true });
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "focusStep", dir: 1 });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "focusStep", dir: -1 });
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Tab alone inside a dialog or prompt", () => {
    const dispatch = vi.fn();
    const { getByText } = render(<Probe dispatch={dispatch} />);
    press("Tab", {}, getByText("inside"));
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not take keys typed in input, textarea, select or contenteditable", () => {
    const dispatch = vi.fn();
    const { getByLabelText } = render(<Probe dispatch={dispatch} />);
    for (const label of ["chat", "note", "pick", "rich"]) {
      const node = getByLabelText(label);
      // jsdom does not implement isContentEditable, so mirror what a browser reports.
      if (label === "rich") Object.defineProperty(node, "isContentEditable", { value: true });
      press("1", {}, node);
      press("Tab", {}, node);
      press("h", {}, node);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not take keys with Ctrl, Meta or Alt", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    press("1", { ctrlKey: true });
    press("2", { metaKey: true });
    press("3", { altKey: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does not take keys while a modal dialog is in the page", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    const modal = document.body.appendChild(document.createElement("div"));
    modal.setAttribute("aria-modal", "true");
    press("1");
    modal.remove();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("follows the paused flag as it changes and keeps the other camera keys", () => {
    const dispatch = vi.fn();
    const { rerender } = render(<Probe dispatch={dispatch} paused={{ seatPick: {} }} />);
    press("4");
    expect(dispatch).not.toHaveBeenCalled();
    rerender(<Probe dispatch={dispatch} paused={{}} />);
    press("4");
    press("k");
    expect(dispatch).toHaveBeenNthCalledWith(1, { type: "focus", seat: 3 });
    expect(dispatch).toHaveBeenNthCalledWith(2, { type: "pin", on: true });
  });

  it("stops listening on unmount", () => {
    const dispatch = vi.fn();
    const { unmount } = render(<Probe dispatch={dispatch} />);
    unmount();
    press("1");
    expect(dispatch).not.toHaveBeenCalled();
  });
});
