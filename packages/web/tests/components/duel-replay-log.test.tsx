// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { LogList } from "@/components/duel/replay";
import { MatchSheetLog } from "@/components/duel/log-line";
import replayStyles from "@/components/duel/replay.module.css";

afterEach(cleanup);

const playerName = (seat: number) => ["Sulman", "Kaiba"][seat] ?? `Player ${seat + 1}`;

// Lines as a stored replay carries them: raw engine text, "Player N" seats and phase keys.
const LOG = [
  { id: 1, text: "Turn 2 — Player 2" },
  { id: 2, text: "main1" },
  { id: 3, text: "Junk Synchron was sent to the Graveyard" },
  { id: 4, text: "Player 2 Synchro Summons Stardust Dragon" },
  { id: 5, text: "Mirror Force is activating" },
  { id: 6, text: "Stardust Dragon was destroyed" },
  { id: 7, text: "Mirror Force was sent to the Graveyard" },
  { id: 8, text: "Decode Talker moved" },
  { id: 9, text: "Add 1 Spellcaster monster from your Deck to your hand" },
  { id: 10, text: "Pot of Greed was discarded" },
];

function lines() {
  return screen.getByRole("list", { name: "Duel log" }).querySelectorAll("li");
}

describe("replay Text log", () => {
  it("colours, labels and names lines the way the live match sheet does", () => {
    render(<LogList entries={LOG} freshIds={new Set()} reducedMotion playerName={playerName} />);
    const items = [...lines()];
    expect(items.map((li) => li.textContent)).toEqual([
      "Turn 2 — Kaiba",
      "Main Phase 1",
      "Junk Synchron was sent to the Graveyard",
      "Kaiba Synchro Summons Stardust Dragon",
      "Mirror Force is activating",
      "Stardust Dragon was destroyed",
      "Mirror Force was sent to the Graveyard",
      "Decode Talker moved",
      "Add 1 Spellcaster monster from your Deck to your hand",
      "Pot of Greed was discarded",
    ]);
    expect(items.map((li) => li.dataset.kind)).toEqual(["turn", "phase", "line", "line", "chain", "line", "line", "line", "line", "line"]);
    // The Synchro material is muted; the spell sent after resolving stays a Graveyard send.
    expect(items.map((li) => li.dataset.cat ?? null)).toEqual([null, null, "material", "summon", "chain", "destroy", "graveyard", "system", null, "graveyard"]);
    expect(items[3]!.dataset.summon).toBe("synchro");
    // Every coloured line carries its category icon, so colour is never the only cue.
    for (const li of items) expect(li.querySelector("svg") !== null).toBe(li.dataset.cat !== undefined);
    expect(items.filter((li) => li.dataset.cat === "graveyard" && li.querySelector("svg[aria-hidden]"))).toHaveLength(2);
    expect(items[6]!.querySelector("svg")!.innerHTML).not.toBe(items[5]!.querySelector("svg")!.innerHTML);
  });

  it("keeps the highlight on the lines new at this step, chain lines included", () => {
    render(<LogList entries={LOG} freshIds={new Set([5, 6])} reducedMotion playerName={playerName} />);
    const fresh = [...lines()].filter((li) => li.classList.contains(replayStyles.logNew!));
    expect(fresh.map((li) => li.textContent)).toEqual(["Mirror Force is activating", "Stardust Dragon was destroyed"]);
    expect(fresh[0]!.dataset.cat).toBe("chain");
  });

  it("renders the same lines as the live match sheet", () => {
    const { container: replay } = render(<LogList entries={LOG} freshIds={new Set()} reducedMotion playerName={playerName} />);
    const replayHtml = replay.querySelector("ol")!.innerHTML;
    cleanup();
    const { container: live } = render(<MatchSheetLog entries={LOG} playerName={playerName} players="Sulman vs Kaiba" />);
    expect(live.querySelector("ol")!.innerHTML).toBe(replayHtml);
  });
});
