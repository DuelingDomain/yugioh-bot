import type { DuelCardInfo, DuelEngineView, DuelRoom } from "@yugidraft/shared/duels";
import { BANISHED, cardAt, GY, HAND, MZ, newBoard, SZ } from "@/components/duel/fx-lab/board";
import { LOCATION_MZONE, POS_FACEDOWN_DEFENSE } from "@/components/duel/constants";
import { makeSeriesRoom } from "./duel-series";

const info = (code: number, name: string, attack: number, defense: number, level = 4): DuelCardInfo => ({
  code, name, description: `${name} text`, type: 0x1, attack, defense, level, attribute: 0x20, race: "Warrior",
});

export const GUARDIAN = info(91152256, "Celtic Guardian", 1400, 1200);
export const BEAVER = info(94675535, "Beaver Warrior", 1200, 1500);
export const SILVER = info(43500484, "Silver Fang", 1200, 800);
export const OX = info(5053103, "Battle Ox", 1700, 1000);
export const MAGICIAN = info(46986414, "Dark Magician", 2500, 2100, 7);
export const DRAGON = info(89631139, "Blue-Eyes White Dragon", 3000, 2500, 8);
const FISSURE = info(66788016, "Fissure", 0, 0, 0);

/** A mid-duel 1v1 board: monsters on both sides (one in the left EMZ), a set card, piles and Deck Masters. */
export function solidEngine(options: { domain?: boolean; masterRule?: 3 | 4 | 5; prompt?: DuelEngineView["prompt"]; turnSeat?: number } = {}): DuelEngineView {
  const board = newBoard(
    { hand: [GUARDIAN, BEAVER, FISSURE], deck: 31, extra: [DRAGON, null] },
    { hand: [null, null, null, null], deck: 30, extra: [null, null, null] },
    "main1", options.turnSeat ?? 0);
  const [me, opp] = board.seats;
  me.monsters[0] = cardAt(GUARDIAN, MZ(0, 0));
  me.monsters[5] = cardAt(SILVER, MZ(0, 5));
  me.spells[1] = { ...cardAt(FISSURE, SZ(0, 1)), position: POS_FACEDOWN_DEFENSE };
  me.graveyard = [cardAt(OX, GY(0, 0))];
  me.banished = [cardAt(BEAVER, BANISHED(0, 0))];
  opp.monsters[2] = { ...cardAt(OX, MZ(1, 2)), location: LOCATION_MZONE };
  opp.spells[0] = { controller: 1, location: 0x8, sequence: 0, position: POS_FACEDOWN_DEFENSE };
  if (options.domain) {
    me.deckMaster = { card: MAGICIAN, inZone: true, returns: 0, nextCost: 500 };
    opp.deckMaster = { card: DRAGON, inZone: true, returns: 1, nextCost: 1000 };
  }
  void HAND;
  return {
    revision: 3, turn: 3, turnSeat: board.turnSeat, phase: "main1", seats: board.seats,
    prompt: options.prompt ?? null, chain: [], events: [], log: [], result: null,
  } as DuelEngineView;
}

/** An active 1v1 room around `solidEngine`, viewed from seat 0 (or a spectator with `mySeat: null`). */
export function solidRoom(options: { domain?: boolean; mySeat?: number | null; prompt?: DuelEngineView["prompt"]; turnSeat?: number } = {}): DuelRoom {
  const room = makeSeriesRoom({ series: null, status: "active", mySeat: options.mySeat });
  room.session.mode = options.domain ? "domain" : "normal";
  room.engine = solidEngine(options);
  return room;
}
