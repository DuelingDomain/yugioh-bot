import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { TABLE_STATE_IDS, type TableFixtureSet } from "./common";
import { FFA3_FIXTURES } from "./ffa3";

/** Review scenes mirror a Standard table with two identically named practice bots. No engine runs here. */
export function reviewFixtures(damage = 0): TableFixtureSet {
  const set = structuredClone(FFA3_FIXTURES);
  for (const id of TABLE_STATE_IDS) {
    const { room } = set.states[id];
    room.session.mode = "normal";
    room.session.settings = defaultDuelSettings("normal");
    room.session.seats.forEach((seat) => {
      seat.displayName = seat.seat === 0 ? "Alice" : "Practice Bot";
    });
    const engine = room.engine!;
    engine.events = [];
    engine.seats.forEach((seat) => {
      seat.deckMaster = undefined;
      if (!seat.eliminated) seat.lp = 8000;
    });
    if (id === "main") {
      engine.turn = 1;
      engine.prompt!.options = engine.prompt!.options.filter((option) => option.id !== "to_bp");
      if (damage) {
        engine.seats[2].lp -= damage;
        engine.events.push({ id: 1, kind: "damage", seat: 2, amount: damage, text: `Player 3 takes ${damage} damage` });
      }
    }
    if (id === "direct-attack") {
      engine.prompt!.options = [1, 2].map((seat) => ({
        id: `direct-${seat}`, controller: seat, label: `Attack Player ${seat + 1} directly`,
      }));
      engine.seats[2].monsters.fill(null);
    }
  }
  return set;
}
