// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClassicPreview } from "../../app/dev/table-preview/classic/preview";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));
  class RO { observe() {} disconnect() {} }
  vi.stubGlobal("ResizeObserver", RO);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [width, height] = this.hasAttribute("data-chain-strip-wrap") ? [178, 44] : [378, 650];
    return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} };
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it("mounts the live room's phone chain strip and opens its readable panel alongside the response", async () => {
  const { container } = render(<ClassicPreview stateId="chain-2" chain={null} reduced />);
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  const strip = container.querySelector<HTMLButtonElement>("[data-chain-strip]");
  expect(strip).not.toBeNull();
  // The classic alias has two response options, but one active chain link.
  expect(strip!.getAttribute("aria-label")).toContain("Chain Link 1 of 1: Book of Moon");
  expect(container.querySelector("[data-chain-front]")?.getAttribute("data-size")).toBe("strip");
  fireEvent.click(strip!);
  expect(container.querySelector("[data-chain-sheet]")?.textContent).toContain("Book of Moon");
  expect(container.querySelector("[data-prompt-panel]")?.textContent).toContain("Activate an effect?");
});
