// @vitest-environment jsdom
import { useRef } from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measureTab, paneDirection, useTabDirection, useTabMarker } from "../../src/lib/tab-motion";

const ORDER = ["a", "b", "c"] as const;

describe("paneDirection", () => {
  it("is next going right along the order and prev going left", () => {
    expect(paneDirection(ORDER, "a", "c")).toBe("next");
    expect(paneDirection(ORDER, "c", "b")).toBe("prev");
  });
  it("has no direction for the same tab or a tab outside the order", () => {
    expect(paneDirection(ORDER, "b", "b")).toBeUndefined();
    expect(paneDirection(ORDER, "a", "z" as never)).toBeUndefined();
  });
});

function Panel({ value }: { value: (typeof ORDER)[number] }) {
  const dir = useTabDirection(value, ORDER);
  return <div data-testid="pane" data-pane-dir={dir} />;
}

describe("useTabDirection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not animate first paint, then names the direction of a pointer switch", () => {
    const { getByTestId, rerender } = render(<Panel value="a" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBeNull();
    fireEvent.pointerDown(document.body);
    rerender(<Panel value="c" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBe("next");
    rerender(<Panel value="b" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBe("prev");
  });

  it("clears the direction once the arrival has played, so later mounts do not slide", () => {
    const { getByTestId, rerender } = render(<Panel value="a" />);
    fireEvent.pointerDown(document.body);
    rerender(<Panel value="b" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBe("next");
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBeNull();
  });

  it("skips a switch made from the keyboard", () => {
    const { getByTestId, rerender } = render(<Panel value="a" />);
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    rerender(<Panel value="b" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBeNull();
  });

  it("skips everything under reduced motion", () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
    const { getByTestId, rerender } = render(<Panel value="a" />);
    fireEvent.pointerDown(document.body);
    rerender(<Panel value="b" />);
    expect(getByTestId("pane").getAttribute("data-pane-dir")).toBeNull();
  });
});

function Row({ selected }: { selected: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useTabMarker(ref, selected);
  return (
    <div ref={ref} role="tablist" data-testid="row">
      {["x", "y"].map((id) => (
        <button key={id} role="tab" aria-selected={id === selected} />
      ))}
      <span data-tab-marker />
    </div>
  );
}

describe("useTabMarker", () => {
  const offsetLeft = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetLeft");
  const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
  afterEach(() => {
    if (offsetLeft) Object.defineProperty(HTMLElement.prototype, "offsetLeft", offsetLeft);
    if (offsetWidth) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetWidth);
  });

  function layout() {
    // x is 10..70 and y is 80..200 inside the row.
    Object.defineProperty(HTMLElement.prototype, "offsetLeft", { configurable: true, get() { return this.getAttribute("aria-selected") === "true" && this.previousElementSibling ? 80 : 10; } });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get() { return this.getAttribute("aria-selected") === "true" && this.previousElementSibling ? 120 : 60; } });
  }

  it("measures the selected tab and moves the marker when the selection changes", () => {
    layout();
    const { getByTestId, rerender } = render(<Row selected="x" />);
    const row = getByTestId("row");
    expect(row.hasAttribute("data-marker")).toBe(true);
    expect(row.style.getPropertyValue("--tab-x")).toBe("10px");
    expect(row.style.getPropertyValue("--tab-w")).toBe("60");
    rerender(<Row selected="y" />);
    expect(row.style.getPropertyValue("--tab-x")).toBe("80px");
    expect(row.style.getPropertyValue("--tab-w")).toBe("120");
  });

  it("measures a pressed button too, for the segmented rows", () => {
    const list = document.createElement("div");
    list.innerHTML = '<button aria-pressed="false"></button><button aria-pressed="true"></button>';
    document.body.append(list);
    expect(measureTab(list)).toEqual({ x: 0, w: 0 });
    list.remove();
  });

  it("measureTab is null with nothing selected", () => {
    const list = document.createElement("div");
    expect(measureTab(list)).toBeNull();
  });
});
