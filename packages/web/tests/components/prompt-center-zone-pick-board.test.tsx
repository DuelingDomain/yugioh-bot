// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
import { PromptCenter } from "@/components/duel/prompt-center";
import { usePromptDraft } from "@/components/duel/prompts";
import { RowPreviewBoundary, useRowPreview } from "@/components/duel/table/hud-layer";

afterEach(cleanup);

const SZONE = 8;
// The engine's zone choice for a Spell played from the hand: five free Spell & Trap Zones.
const prompt: DuelPrompt = {
  id: "zone", seat: 0, kind: "places", title: "Select a zone for Pot of Greed", min: 1, max: 1,
  options: [0, 1, 2, 3, 4].map((sequence) => ({ id: `place:${sequence}`, label: `P1 Spell & Trap Zone ${sequence + 1}`, controller: 0, location: SZONE, sequence })),
};

function Panel({ wrap }: { wrap: "none" | "contents" | "hud" }) {
  const draft = usePromptDraft(prompt);
  const row = useRowPreview(prompt.id);
  const center = <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={vi.fn()}
    menuOpen={false} chain={[]} aimLocked={false} reducedMotion revision={1} />;
  return (
    <div data-testid="board">
      {[0, 1, 2, 3, 4].map((sequence) => <div key={sequence} data-zones={`0:${SZONE}:${sequence}`} />)}
      {wrap === "contents" ? <div style={{ display: "contents" }}>{center}</div>
        : wrap === "hud" ? <RowPreviewBoundary row={row} enabled>{center}</RowPreviewBoundary> : center}
    </div>
  );
}

it.each(["none", "contents", "hud"] as const)("answers a zone pick on the board, not in a modal (wrapper: %s)", (wrap) => {
  render(<Panel wrap={wrap} />);
  // The modal lists every free zone as a button; on the board the zones themselves are the buttons.
  expect(screen.queryByTitle(/Spell & Trap Zone 1/)).toBeNull();
  // The pick runs on the board: its instruction bar is shown (not an empty layer).
  expect(screen.getByRole("group", { name: /zone/i })).toBeTruthy();
});
