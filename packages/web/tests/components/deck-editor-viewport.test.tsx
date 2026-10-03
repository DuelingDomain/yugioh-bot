// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorViewport } from "../../src/components/decks/editor-viewport";

function EditorViewport({ pool = true }: { pool?: boolean }) {
  const { editorRef } = useEditorViewport(pool);
  return <div data-pool={pool ? "" : undefined}><div ref={editorRef} /></div>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("draft editor viewport", () => {
  it.each([0, 56, 64])("measures a %ipx shell on mount and updates after viewport resize without ResizeObserver", (shellTop) => {
    vi.stubGlobal("ResizeObserver", undefined);
    vi.stubGlobal("scrollY", 24);
    let viewportTop = shellTop - 24;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-pool") ? viewportTop : viewportTop + 62, 1204, 836);
    });
    const { container } = render(<EditorViewport />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--de-top")).toBe(`${shellTop}px`);

    viewportTop = 32;
    fireEvent.resize(window);
    expect(host.style.getPropertyValue("--de-top")).toBe("56px");
  });

  it("remeasures the host when the editor's ResizeObserver fires and disconnects on unmount", () => {
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal("ResizeObserver", class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
    let top = 64;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return new DOMRect(0, this.hasAttribute("data-pool") ? top : top + 62, 1204, 836);
    });
    const { container, unmount } = render(<EditorViewport />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--de-top")).toBe("64px");

    top = 0;
    act(() => resize!([{ contentRect: { width: 1204 } } as ResizeObserverEntry], {} as ResizeObserver));
    expect(host.style.getPropertyValue("--de-top")).toBe("0px");
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    top = 56;
    fireEvent.resize(window);
    expect(host.style.getPropertyValue("--de-top")).toBe("");
  });

  it("leaves full-screen saved decks without a shell offset", () => {
    const { container } = render(<EditorViewport pool={false} />);
    const host = container.firstElementChild as HTMLElement;
    expect(host.style.getPropertyValue("--de-top")).toBe("");
    fireEvent.resize(window);
    expect(host.style.getPropertyValue("--de-top")).toBe("");
  });
});
