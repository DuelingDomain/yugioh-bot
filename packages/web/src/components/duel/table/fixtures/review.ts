import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { cardAt, HAND, TABLE_CARDS, TABLE_STATE_IDS, type TableFixtureSet } from "./common";
import { FFA3_FIXTURES } from "./ffa3";
import { FFA4_FIXTURES } from "./ffa4";

/** Review scenes mirror a Standard table with two identically named practice bots. No engine runs here. */
export function reviewFixtures(damage = 0, format: "ffa3" | "ffa4" = "ffa3"): TableFixtureSet {
  const set = structuredClone(format === "ffa4" ? FFA4_FIXTURES : FFA3_FIXTURES);
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
      room.session.seats[0].displayName = "E2E Alice";
      engine.seats[0].hand.push(cardAt(TABLE_CARDS.celtic, HAND(0, 5)));
      engine.turn = 1;
      engine.prompt!.options = engine.prompt!.options.filter((option) => option.id !== "to_bp");
      if (damage) {
        engine.seats[2].lp -= damage;
        engine.events.push({ id: 1, kind: "damage", seat: 2, amount: damage, text: `Player 3 takes ${damage} damage` });
      }
    }
    if (id === "direct-attack") {
      engine.prompt!.options = engine.seats.filter((seat) => seat.seat !== 0).map(({ seat }) => ({
        id: `direct-${seat}`, controller: seat, label: `Attack Player ${seat + 1} directly`,
      }));
      engine.seats.filter((seat) => seat.seat !== 0).forEach((seat) => seat.monsters.fill(null));
    }
    if (id === "chain-2" && engine.prompt!.options.length === 1) {
      engine.prompt!.options.push({ id: "activate-mirror", label: "Activate Mirror Force", card: TABLE_CARDS.mirrorForce });
    }
  }
  return set;
}
