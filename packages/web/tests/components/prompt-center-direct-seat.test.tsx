// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { PromptCenter } from "@/components/duel/prompt-center";
import { usePromptDraft } from "@/components/duel/prompts";

afterEach(cleanup);
const prompt: DuelPrompt = { id: "direct", seat: 0, kind: "choice", title: "Select a duelist to attack",
  options: [1, 2].map((seat) => ({ id: `direct-${seat}`, controller: seat, label: `Attack Player ${seat + 1} directly` })),
};
function Panel({ onSubmit = vi.fn(), nameOf, table = true }: { onSubmit?: (answer: DuelAnswer) => void; nameOf?: (seat: number) => string; table?: boolean }) {
  const draft = usePromptDraft(prompt);
  return <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={onSubmit}
    menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} nameOf={nameOf} seatTones={table ? new Map() : undefined} />;
}
it("names direct attack seats consistently with the table and preserves the selected engine option", () => {
  const submit = vi.fn();
  render(<Panel onSubmit={submit} nameOf={(seat) => `Practice Bot (seat ${seat + 1})`} />);
  expect(screen.getByRole("button", { name: "Attack Practice Bot (seat 2) directly" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Attack Practice Bot (seat 3) directly" }));
  expect(submit).toHaveBeenCalledWith({ choice: "direct-2" });
});
it("keeps engine labels when no table name lookup is supplied", () => {
  render(<Panel />);
  expect(screen.getByRole("button", { name: /Attack Player 2 directly/ })).toBeVisible();
});
it("preserves duel labels when a 1v1 name lookup is supplied", () => {
  render(<Panel table={false} nameOf={() => "Bob"} />);
  expect(screen.getByRole("button", { name: /Attack Player 2 directly/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Attack Bob directly/ })).toBeNull();
});
