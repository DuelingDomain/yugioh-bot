import { zoneKey, LOCATION_MZONE } from "../constants";
import { edit, link, newBoard, type LabScenario } from "./board";
import { CARDS } from "./cards";

function scenario(id: string, name: string, description: string, turnSeat: number, prioritySeat: number | null): LabScenario {
  return {
    id: `state-priority-${id}`, name, description, category: "Board states",
    build: () => {
      const initial = newBoard({ hand: [CARDS.sangan, CARDS.kuriboh] }, { hand: [null, null, null] }, "main1", turnSeat);
      initial.prioritySeat = prioritySeat;
      edit.monster(0, 2, CARDS.blueEyes)(initial);
      edit.monster(1, 2, CARDS.summonedSkull)(initial);
      edit.setSpell(0, 1, CARDS.mirrorForce)(initial);
      edit.hiddenSpell(1, 1)(initial);
      if (prioritySeat != null && prioritySeat !== turnSeat) initial.chain = [link(1, turnSeat, CARDS.potOfGreed)];
      return {
        initial, steps: [], tailMs: 8000,
        legalKeys: prioritySeat === 0 ? [zoneKey(0, LOCATION_MZONE, 2)] : [],
      };
    },
  };
}

export const PRIORITY_SCENARIOS: LabScenario[] = [
  scenario("your-turn-you", "Your turn, you have priority", "Gold and purple share your field. The card's usable glow remains visible inside the edges.", 0, 0),
  scenario("your-turn-opponent", "Your turn, opponent has priority (chain response)", "Your field keeps gold while the opponent's private response window moves purple to their field.", 0, 1),
  scenario("opponent-turn-opponent", "Opponent's turn, opponent has priority", "The opponent's field carries both the steady gold turn edge and the breathing purple priority edge.", 1, 1),
  scenario("opponent-turn-you", "Opponent's turn, you have priority", "The opponent keeps the gold turn edge while your response window lights your field in purple.", 1, 0),
  scenario("nobody", "Nobody to act", "The turn stays marked in gold, with no purple priority edge while the engine is not waiting on either player.", 0, null),
];
