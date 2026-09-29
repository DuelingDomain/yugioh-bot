// @vitest-environment jsdom
import React, { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Modal } from "../../src/components/ui/modal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("keeps an opening dialog mounted when its first animation frame is delayed", () => {
  vi.useFakeTimers();
  let openingFrame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    openingFrame = callback;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  function Dialog() {
    const [open, setOpen] = useState(false);
    return <>
      <button onClick={() => setOpen(true)}>Open confirmation</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Confirm surrender">
        <button onClick={() => setOpen(false)}>Keep playing</button>
      </Modal>
    </>;
  }
  render(<Dialog />);
  fireEvent.click(screen.getByRole("button", { name: "Open confirmation" }));
  act(() => vi.advanceTimersByTime(500));
  act(() => openingFrame?.(500));
  expect(screen.getByRole("dialog", { name: "Confirm surrender" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
