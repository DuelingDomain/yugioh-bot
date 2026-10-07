// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRoofKeys } from "@/components/duel/tag/use-roof-keys";

afterEach(cleanup);

function Probe({
  suspended,
  yields,
  dispatch,
  pinned = false,
  mode,
  escapeFree,
}: {
  suspended?: boolean;
  yields?: boolean;
  dispatch: (action: unknown) => void;
  pinned?: boolean;
  mode?: "overview" | "home" | "focus" | "look" | "fly";
  escapeFree?: boolean;
}) {
  useRoofKeys({ dispatch, anchorSeat: 0, pinned, suspended, yields, mode, escapeFree });
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

describe("useRoofKeys Esc", () => {
  it("goes back to the overview from a close-up when nothing else owns Esc", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} mode="focus" escapeFree />);
    const event = press("Escape");
    expect(dispatch).toHaveBeenCalledWith({ type: "overview" });
    expect(event.defaultPrevented).toBe(true);
  });

  it("does nothing in the overview", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} mode="overview" escapeFree />);
    const event = press("Escape");
    expect(dispatch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("leaves Esc to a prompt, an aim or a flyout (escapeFree is false)", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} mode="focus" escapeFree={false} />);
    const event = press("Escape");
    expect(dispatch).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("still works while the camera yields its other keys, but never while input is suspended or under a modal", () => {
    const dispatch = vi.fn();
    const view = render(<Probe dispatch={dispatch} mode="focus" escapeFree yields />);
    press("Escape");
    expect(dispatch).toHaveBeenCalledWith({ type: "overview" });
    dispatch.mockClear();
    view.rerender(<Probe dispatch={dispatch} mode="focus" escapeFree suspended />);
    press("Escape");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("is skipped when an earlier handler already took the key", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} mode="focus" escapeFree />);
    const early = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", early, true);
    try {
      press("Escape");
    } finally {
      window.removeEventListener("keydown", early, true);
    }
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("useRoofKeys", () => {
  it("sends a digit to the camera when nothing is open", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    const event = press("3");
    expect(dispatch).toHaveBeenCalledWith({ type: "focus", seat: 2 });
    expect(event.defaultPrevented).toBe(true);
  });

  it.each([
    ["input is suspended", { suspended: true }],
    ["the camera yields to an aim or a seat pick", { yields: true }],
  ] as const)("ignores digits and Tab when %s", (_name, flags) => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} {...flags} />);
    const digit = press("2");
    const tab = press("Tab");
    expect(dispatch).not.toHaveBeenCalled();
    expect(digit.defaultPrevented).toBe(false);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("leaves a key alone when an earlier handler already took it (defaultPrevented)", () => {
    const dispatch = vi.fn();
    render(<Probe dispatch={dispatch} />);
    const early = (event: KeyboardEvent) => event.preventDefault();
    window.addEventListener("keydown", early, true);
    try {
      press("3");
    } finally {
      window.removeEventListener("keydown", early, true);
    }
    expect(dispatch).not.toHaveBeenCalled();
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

  it("follows the yield flag as it changes and keeps the other camera keys", () => {
    const dispatch = vi.fn();
    const { rerender } = render(<Probe dispatch={dispatch} yields />);
    press("4");
    expect(dispatch).not.toHaveBeenCalled();
    rerender(<Probe dispatch={dispatch} yields={false} />);
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
