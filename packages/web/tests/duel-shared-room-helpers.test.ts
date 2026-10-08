import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";
import { phaseTitle } from "@/components/duel/constants";
import { targetName } from "@/components/duel/card-interactions";
import { livePileCards, type PileView } from "@/components/duel/pile-focus";
import { hasNoLegalMoves } from "@/components/duel/station-track";
import { logKind, logText } from "@/components/duel/text-log";

const engine = FFA3_FIXTURES.states.main.room.engine!;

describe("helpers the room and the table shell share", () => {
  it("reads a pile from the seat the view names, or from the local seat", () => {
    const named: PileView = { title: "Graveyard", owner: "opp", cards: [], open: true, seat: 2 };
    expect(livePileCards(named, engine, 0)).toBe(engine.seats[2].graveyard);
    const mine: PileView = { title: "Extra Deck", owner: "you", cards: [], open: true };
    expect(livePileCards(mine, engine, 0)).toBe(engine.seats[0].extra);
    expect(livePileCards(mine, null, 0)).toBe(mine.cards);
  });

  it("knows a prompt with only phase moves has no legal play", () => {
    expect(hasNoLegalMoves([{ id: "to_bp", label: "Battle" }, { id: "to_ep", label: "End" }])).toBe(true);
    expect(hasNoLegalMoves([{ id: "to_bp", label: "Battle" }, { id: "summon-1", label: "Summon" }])).toBe(false);
    expect(hasNoLegalMoves([])).toBe(false);
  });

  it("names a face-down target", () => {
    expect(targetName({ label: "Card 4" })).toBe("face-down monster");
    expect(targetName({ label: "x", card: { name: "Gaia" } })).toBe("Gaia");
  });

  it("sorts log lines and names up to four players", () => {
    expect(logKind("Turn 3")).toBe("turn");
    expect(logKind("main1")).toBe("phase");
    expect(logKind("A chain link was negated")).toBe("chain");
    expect(logKind("Player 3's chain link was negated")).toBe("chain");
    expect(logKind("Player 2's Raigeki is activating")).toBe("chain");
    expect(logText("Player 3 takes 800 damage", "loss", (seat) => `P${seat}`)).toBe("P2 takes 800 damage");
    expect(logText("main1", "phase", () => "")).toBe(phaseTitle("main1"));
  });
});
