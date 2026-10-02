// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { deriveChainState } from "@/components/duel/chain-state";
import { ChainFx } from "@/components/duel/chain-fx";
import { PromptCenter } from "@/components/duel/prompt-center";
import type { PromptDraft } from "@/components/duel/prompts";

afterEach(cleanup);
const target = { controller: 1, location: 8, sequence: 0 };
// Local proposed contract isolates the UI bug from the server's missing target projection.
const chain: Array<DuelChainLink & { targets: DuelZoneRef[] }> = [
  { index: 1, seat: 0, code: 5318639, name: "Mystical Space Typhoon", targets: [target] },
];
const events: Array<DuelEvent & { targets: DuelZoneRef[] }> = [{
  id: 1, kind: "activate", seat: 0, chainIndex: 1,
  card: { code: 5318639, name: "Mystical Space Typhoon", type: 65538, description: "Target 1 Spell/Trap on the field; destroy that target.",
    attack: 0, defense: 0, level: 0, attribute: 0, race: "" },
  text: "Mystical Space Typhoon is activating", zone: { controller: 0, location: 8, sequence: 0 }, targets: [target],
}];

describe("pending effect targets in the web chain", () => {
  it.each(["event window", "snapshot on reconnect"])("preserves provided targets from the %s", (source) => {
    const state = deriveChainState(source === "event window" ? events : [], chain);
    expect((state.links[0] as typeof state.links[0] & { targets?: DuelZoneRef[] }).targets,
      "UI chain state must retain target zones supplied by the server").toEqual([target]);
  });

  it("identifies the targeted zone while the opponent's real response panel is open", () => {
    const noop = () => undefined;
    const draft: PromptDraft = {
      selected: [], setSelected: noop, counts: {}, setCounts: noop, value: 0, setValue: noop,
      cardCode: null, setCardCode: noop, highlight: 0, setHighlight: noop,
    };
    render(<div style={{ position: "relative" }}>
      <ChainFx events={events} chain={chain} duelKey="target-response" reducedMotion mySeat={1}
        playerName={(seat) => seat === 1 ? "You" : "Opponent"} />
      <PromptCenter prompt={{ id: "response", seat: 1, kind: "choice", title: "Select a chain link or pass",
        options: [{ id: "card:0", label: "Mystical Space Typhoon" }], cancelable: true,
        context: { type: "chain", forced: false } }}
        mySeat={1} active slug="target-response" busy={false} draft={draft} onSubmit={noop}
        menuOpen={false} chain={chain} aimLocked={false} reducedMotion revision={1} />
    </div>);
    expect(screen.getByRole("group", { name: "Activate its effect? Mystical Space Typhoon" })).toBeInTheDocument();
    // Accessible target text must survive the response panel too; the target's identity may be hidden.
    expect(screen.getByRole("list", { name: "Current chain" }).textContent,
      "the pending chain must identify the targeted Spell & Trap zone").toMatch(/target.*(?:Spell.*Trap|1:8:0)/i);
  });
});
