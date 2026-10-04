// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { nextEnabledIndex, outSeatOptionIds, PromptCenter } from "@/components/duel/prompt-center";
import { usePromptDraft } from "@/components/duel/prompts";

afterEach(cleanup);

const opponentPrompt: DuelPrompt = {
  id: "opp", seat: 0, kind: "choice", title: "Choose an opponent", context: { type: "opponent" },
  options: [1, 2, 3].map((seat) => ({ id: `opp-${seat}`, controller: seat, label: `Player ${seat + 1}` })),
};
const directPrompt: DuelPrompt = {
  id: "direct", seat: 0, kind: "choice", title: "Select a duelist to attack",
  options: [1, 2, 3].map((seat) => ({ id: `direct-${seat}`, controller: seat, label: `Attack Player ${seat + 1} directly` })),
};

function Panel({ prompt, outSeats, onSubmit = vi.fn() }: { prompt: DuelPrompt; outSeats?: ReadonlySet<number>; onSubmit?: (answer: DuelAnswer) => void }) {
  const draft = usePromptDraft(prompt);
  return (
    <>
      <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={onSubmit}
        menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} seatTones={new Map()}
        nameOf={(seat) => `Duelist ${seat + 1}`} outSeats={outSeats} />
      <output data-testid="highlight">{draft.highlight}</output>
    </>
  );
}
const highlight = () => Number(screen.getByTestId("highlight").textContent);
const rows = () => screen.getAllByRole("button").filter((button) => button.hasAttribute("data-index"));

describe("outSeatOptionIds", () => {
  it("marks out seats while a living row remains, in opponent and direct-attack lists", () => {
    expect([...outSeatOptionIds(opponentPrompt, new Set([2]))]).toEqual(["opp-2"]);
    expect([...outSeatOptionIds(directPrompt, new Set([1, 3]))]).toEqual(["direct-1", "direct-3"]);
  });
  it("keeps every row when none is living, or nobody is out", () => {
    expect(outSeatOptionIds(opponentPrompt, new Set([1, 2, 3])).size).toBe(0);
    expect(outSeatOptionIds(directPrompt, new Set([0, 1, 2, 3])).size).toBe(0);
    expect(outSeatOptionIds(opponentPrompt, new Set()).size).toBe(0);
    expect(outSeatOptionIds(opponentPrompt, undefined).size).toBe(0);
  });
  it("ignores other prompts", () => {
    const other: DuelPrompt = { ...opponentPrompt, context: undefined, options: [{ id: "a", label: "Option", controller: 1 }, { id: "b", label: "Other", controller: 2 }] };
    expect(outSeatOptionIds(other, new Set([1])).size).toBe(0);
  });
  it("finds the next free index in both directions, wrapping", () => {
    const off = new Set(["opp-1", "opp-3"]);
    expect(nextEnabledIndex(opponentPrompt, off, 0, 1)).toBe(1);
    expect(nextEnabledIndex(opponentPrompt, off, 1, 1)).toBe(1);
    expect(nextEnabledIndex(opponentPrompt, new Set(["opp-2"]), 0, -1)).toBe(2);
  });
});

describe("PromptCenter outSeats", () => {
  it("disables an out opponent row, keeps ids and order, and still answers a living one", () => {
    const submit = vi.fn();
    render(<Panel prompt={opponentPrompt} outSeats={new Set([2])} onSubmit={submit} />);
    expect(rows()).toHaveLength(3);
    expect(rows().map((row) => (row as HTMLButtonElement).disabled)).toEqual([false, true, false]);
    expect(screen.getByText("Out")).toBeVisible();
    fireEvent.click(rows()[1]);
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(rows()[2]);
    expect(submit).toHaveBeenCalledWith({ choice: "opp-3" });
  });

  it("disables out direct-attack rows by seat", () => {
    const submit = vi.fn();
    render(<Panel prompt={directPrompt} outSeats={new Set([1])} onSubmit={submit} />);
    expect((screen.getByRole("button", { name: /Attack Duelist 2 directly/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Attack Duelist 3 directly/ }));
    expect(submit).toHaveBeenCalledWith({ choice: "direct-2" });
  });

  it("keeps every row when all offered seats are out", () => {
    render(<Panel prompt={opponentPrompt} outSeats={new Set([1, 2, 3])} />);
    expect(rows().every((row) => !(row as HTMLButtonElement).disabled)).toBe(true);
    expect(screen.queryByText("Out")).toBeNull();
  });

  it("leaves the rows alone without the prop", () => {
    render(<Panel prompt={opponentPrompt} />);
    expect(rows().every((row) => !(row as HTMLButtonElement).disabled)).toBe(true);
  });

  it("starts the highlight on the first living row", async () => {
    render(<Panel prompt={opponentPrompt} outSeats={new Set([1])} />);
    await waitFor(() => expect(highlight()).toBe(1));
    expect(rows()[1]).toHaveAttribute("data-primary");
  });

  it("moves the highlight past disabled rows with the arrow keys", () => {
    render(<Panel prompt={opponentPrompt} outSeats={new Set([2])} />);
    expect(highlight()).toBe(0);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(highlight()).toBe(2);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(highlight()).toBe(0);
    fireEvent.keyDown(window, { key: "ArrowUp" });
    expect(highlight()).toBe(2);
  });

  it("does not answer a disabled row with its number key", () => {
    const submit = vi.fn();
    render(<Panel prompt={opponentPrompt} outSeats={new Set([2])} onSubmit={submit} />);
    fireEvent.keyDown(window, { key: "2" });
    expect(submit).not.toHaveBeenCalled();
    expect(highlight()).toBe(0);
  });
});
