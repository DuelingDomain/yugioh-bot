// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { DuelFormat, DuelRoom } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { describeDuelResult } from "@/components/duel/duel-result";

const NAMES = ["Ada", "Bo", "Cy", "Di"];

function room(format: DuelFormat, count: number, mySeat: number | null, result: { winnerSeat: number | null; winnerTeam?: number | null }, reason = "LP reached 0"): DuelRoom {
  const seats = Array.from({ length: count }, (_, seat) => ({
    seat, lp: seat === result.winnerSeat ? 1200 : 0, hand: [], deckCount: 10, extraCount: 0, extra: [],
    monsters: [], spells: [], graveyard: [], banished: [], team: format === "tag" ? seat % 2 : seat,
  }));
  return {
    session: {
      id: 1, slug: "x", name: "T", guildId: "g", organizerPlayerId: 1, mode: "normal", format, masterRule: 5,
      status: "completed", settings: {} as DuelRoom["session"]["settings"],
      seats: seats.map((s) => ({ seat: s.seat, playerId: s.seat + 1, displayName: NAMES[s.seat], ready: true, isBot: false })),
      createdAt: "", endedAt: null, archivedAt: null, winnerPlayerId: null, winnerSeat: result.winnerSeat, resultReason: reason,
    },
    role: mySeat == null ? "spectator" : "player", mySeat, myDeck: null, clock: null, metadataOnly: false,
    engine: { revision: 1, format, turn: 5, turnSeat: 0, phase: "end", seats, prompt: null, chain: [], events: [], log: [],
      result: { ...result, reason } },
  } as unknown as DuelRoom;
}

describe("describeDuelResult with 3 and 4 seats", () => {
  it("Tag: both partners win, both opponents lose", () => {
    const result = { winnerSeat: 0, winnerTeam: 0 };
    for (const seat of [0, 2]) {
      const model = describeDuelResult(room("tag", 4, seat, result));
      expect(model.outcome).toBe("win");
      expect(model.headline).toBe("YOU WIN");
      expect(model.scores.filter((s) => s.isWinner).map((s) => s.seat)).toEqual([0, 2]);
    }
    for (const seat of [1, 3]) {
      const model = describeDuelResult(room("tag", 4, seat, result));
      expect(model.outcome).toBe("lose");
      expect(model.headline).toBe("YOU LOSE");
    }
  });

  it("Tag: the spectator sees both winner names", () => {
    const model = describeDuelResult(room("tag", 4, null, { winnerSeat: 1, winnerTeam: 1 }));
    expect(model.outcome).toBe("spectator");
    expect(model.headline).toBe("Bo and Di win");
  });

  it("FFA: only the winning seat wins, in 3 and 4 seat tables", () => {
    expect(describeDuelResult(room("ffa3", 3, 2, { winnerSeat: 2 })).headline).toBe("YOU WIN");
    const lose = describeDuelResult(room("ffa3", 3, 0, { winnerSeat: 2 }));
    expect(lose.headline).toBe("YOU LOSE");
    expect(lose.winnerSeat).toBe(2);
    expect(describeDuelResult(room("ffa4", 4, 3, { winnerSeat: 1 })).outcome).toBe("lose");
    expect(describeDuelResult(room("ffa4", 4, null, { winnerSeat: 1 })).headline).toBe("Bo wins");
  });

  it("FFA: a draw has no winner", () => {
    const model = describeDuelResult(room("ffa3", 3, 0, { winnerSeat: null }));
    expect(model.outcome).toBe("draw");
  });
});
