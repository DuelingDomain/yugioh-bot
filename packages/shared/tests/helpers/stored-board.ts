import type { DuelCardInfo, DuelEngineView, DuelFormat } from "../../src/duels/index.js";

/** Synthetic cards and histories; no player, production, or engine data. */
export function storedBoardFixture(format: DuelFormat = "ffa4", ownSeat: number | null = null): DuelEngineView {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const turns = format === "1v1" ? 12 : format === "ffa3" ? 24 : format === "ffa4" ? 40 : 16;
  const cards: DuelCardInfo[] = Array.from({ length: 40 }, (_, index) => ({
    code: 1000 + index, name: `Fixture Warrior ${index + 1}`, type: 33,
    attack: 1000 + index * 100, defense: 800 + index * 50, level: 4, attribute: 1, race: "Warrior",
    description: `Once per turn: You can target 1 face-up monster on the field; it gains ${100 + index * 10} ATK until the end of this turn. If this card is sent to the Graveyard: You can add 1 Warrior monster from your Deck to your hand. You can only use each effect of Fixture Warrior ${index + 1} once per turn.`,
  }));
  const card = (seat: number, location: number, sequence: number, visible = true) => ({
    controller: seat, location, sequence, position: 1,
    ...(visible ? cards[(seat * 7 + sequence) % cards.length] : {}),
  });
  const events: DuelEngineView["events"] = Array.from({ length: turns * 10 }, (_, index) => ({
    id: index + 1, kind: index % 3 === 0 ? "summon" : index % 3 === 1 ? "activate" : "move",
    seat: index % count, card: cards[index % cards.length],
    zone: { controller: index % count, location: 4, sequence: index % 5 },
    text: `Player ${index % count + 1} ${index % 3 === 0 ? "summons" : index % 3 === 1 ? "activates" : "moves"} Fixture Warrior ${index % cards.length + 1}`,
  }));
  return {
    revision: turns * 30, format, turn: turns, turnSeat: 0, phase: "end", prompt: null, prioritySeat: null,
    seats: Array.from({ length: count }, (_, seat) => ({
      seat, lp: seat === 0 ? 4300 : 0, deckCount: 20, extraCount: 5,
      hand: Array.from({ length: 4 }, (_, i) => card(seat, 2, i, seat === ownSeat)),
      extra: Array.from({ length: 5 }, (_, i) => card(seat, 64, i, seat === ownSeat)),
      monsters: Array.from({ length: 7 }, (_, i) => i < 3 ? card(seat, 4, i) : null),
      spells: Array.from({ length: 8 }, (_, i) => i < 2 ? card(seat, 8, i) : null),
      graveyard: Array.from({ length: 10 }, (_, i) => card(seat, 16, i)),
      banished: Array.from({ length: 2 }, (_, i) => card(seat, 32, i)),
    })), chain: [], events,
    log: Array.from({ length: Math.min(400, turns * 25) }, (_, index) => ({ id: index + 1,
      text: index % 4 === 0 ? `Turn ${Math.floor(index / 25) + 1} — Player ${index % count + 1}`
        : index % 4 === 1 ? `Player ${index % count + 1} draws 1 card(s)`
          : `Player ${index % count + 1}'s Fixture Warrior ${index % cards.length + 1} ${index % 4 === 2 ? "is activating" : "was sent to the Graveyard"}` })),
    result: { winnerSeat: 0, reason: "Win" },
  };
}
