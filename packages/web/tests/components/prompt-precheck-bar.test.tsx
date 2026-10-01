// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrecheckBar } from "@/components/duel/prompt-precheck";

const card = { code: 100, name: "Blue-Eyes Spirit Dragon" } as never;

function bar(overrides: Partial<Parameters<typeof PrecheckBar>[0]> = {}) {
  const onYes = vi.fn();
  const onNo = vi.fn();
  const onInspectCard = vi.fn();
  render(
    <PrecheckBar name="Blue-Eyes Spirit Dragon" ask="You can activate an effect. Activate?" context="Battle Step"
      cards={[{ code: 100, card }]} tone="chain" busy={false} reducedMotion={false}
      onYes={onYes} onNo={onNo} onInspectCard={onInspectCard} {...overrides} />,
  );
  return { onYes, onNo, onInspectCard };
}

describe("PrecheckBar", () => {
  it("shows the card, the question and the step, and focuses Yes", () => {
    bar();
    expect(screen.getByText("Blue-Eyes Spirit Dragon")).toBeTruthy();
    expect(screen.getByText("You can activate an effect. Activate?")).toBeTruthy();
    expect(screen.getByText("Battle Step")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Yes" }));
  });

  it("answers with the Yes and No buttons", () => {
    const { onYes, onNo } = bar();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "No" }));
    expect(onYes).toHaveBeenCalledTimes(1);
    expect(onNo).toHaveBeenCalledTimes(1);
  });

  it("shows the card in the inspector on hover", () => {
    const { onInspectCard } = bar();
    fireEvent.mouseEnter(document.querySelector("img")!.parentElement!);
    expect(onInspectCard).toHaveBeenCalledWith(card);
  });

  it("disables both buttons while an answer is sent", () => {
    bar({ busy: true });
    expect((screen.getByRole("button", { name: "Yes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "No" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
