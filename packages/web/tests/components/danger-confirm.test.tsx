// packages/web/tests/components/danger-confirm.test.tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DangerConfirm } from "../../src/components/draft/danger-confirm";

function renderConfirm() {
  return render(
    <DangerConfirm title="Cancel this draft?" consequence="It ends." confirmLabel="Yes, cancel" busy={false} onBack={vi.fn()} onConfirm={vi.fn()} />,
  );
}

describe("DangerConfirm", () => {
  afterEach(() => vi.restoreAllMocks());

  it("renders both buttons with the same Solid Vision size class and no quiet (30px) variant", () => {
    renderConfirm();
    const back = screen.getByRole("button", { name: "Go back" });
    const confirm = screen.getByRole("button", { name: "Yes, cancel" });
    expect(back.className).toContain("sv-btn");
    expect(confirm.className).toContain("sv-btn");
    expect(back.className).toContain("ghost");
    expect(confirm.className).toContain("danger");
    // Quiet is 30px tall; the pair must share the 40px default height.
    for (const b of [back, confirm]) {
      expect(b.className).not.toContain("quiet");
      expect(b.className).not.toContain("big");
    }
    expect(back.parentElement).toBe(confirm.parentElement);
  });

  it("marks the auto-focused back button as pointer focus after a click, so no ring shows", () => {
    fireEvent.pointerDown(document.body);
    renderConfirm();
    const back = screen.getByRole("button", { name: "Go back" });
    expect(back).toHaveFocus();
    expect(back).toHaveAttribute("data-pointer-focus", "true");
  });

  it("keeps the ring when the confirm opened from the keyboard", () => {
    fireEvent.keyDown(document.body, { key: "Enter" });
    renderConfirm();
    expect(screen.getByRole("button", { name: "Go back" })).not.toHaveAttribute("data-pointer-focus");
  });

  it("brings the ring back once a key is pressed on the back button", () => {
    fireEvent.pointerDown(document.body);
    renderConfirm();
    const back = screen.getByRole("button", { name: "Go back" });
    fireEvent.keyDown(back, { key: "Tab" });
    expect(back).not.toHaveAttribute("data-pointer-focus");
  });
});
