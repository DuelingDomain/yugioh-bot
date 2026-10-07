import { newBoard, type LabDiceOpening, type LabScenario, type LabScript, type SeatOptions } from "./board";
import { CARDS as C } from "./cards";

/**
 * Dice opening scenarios of the FX lab: the real 3-way and 4-way opening screen over a plain board. The rolls are
 * scripted by lobby seat; the screen plays each round for the server's 3 seconds, then shows the duel start.
 * Nothing here touches React or the DOM.
 */

const myHand: SeatOptions = { hand: [C.sangan, C.kuriboh, C.potOfGreed, C.monsterReborn], deck: 28, extra: [C.darkPaladin, C.stardust, C.utopia] };
const oppHand: SeatOptions = { hand: [null, null, null, null, null], deck: 29, extra: [null, null] };

function diceScript(diceOpening: LabDiceOpening): LabScript {
  return { initial: newBoard(myHand, oppHand, "main1", 0), steps: [], tailMs: 1800, diceOpening };
}

export const DICE_OPENING_SPECS: Readonly<Record<string, LabDiceOpening>> = {
  "dice-3way": { rounds: [[4, 6, 2]], order: [1, 0, 2], mySeat: 0 },
  "dice-4way-tie": { rounds: [[4, 6, 4, 4], [1, null, 3, 5]], order: [1, 3, 2, 0], mySeat: 3 },
  "dice-4way-double-tie": { rounds: [[5, 2, 5, 2], [3, 4, 6, 1]], order: [2, 0, 1, 3], mySeat: 0 },
  "dice-spectator": { rounds: [[3, 6, 3, 5], [4, null, 1, null]], order: [1, 3, 0, 2], mySeat: null },
  "dice-random-break": { rounds: Array.from({ length: 10 }, () => [4, 4, 4, 2]), order: [2, 0, 1, 3], mySeat: 1, startPhase: true },
};

export const DICE_OPENING_SCENARIOS: LabScenario[] = [
  {
    id: "dice-3way",
    category: "Match",
    name: "Dice opening: 3-way",
    description: "Three players roll one die each and the best roll goes first. One round, then the seats follow the turn order. The Dice picker at the bottom switches the die skin.",
    build: () => diceScript(DICE_OPENING_SPECS["dice-3way"]!),
  },
  {
    id: "dice-4way-tie",
    category: "Match",
    name: "Dice opening: 4-way, 3-player tie",
    description: "Three players tie on 4 and roll again; Dax keeps 6. The next round shows only the tied dice rolling. The seats then pair up: rank 1 faces 2, rank 3 faces 4, with You face on the screen.",
    build: () => diceScript(DICE_OPENING_SPECS["dice-4way-tie"]!),
  },
  {
    id: "dice-4way-double-tie",
    category: "Match",
    name: "Dice opening: 4-way, double tie",
    description: "Two pairs tie, on 5 and on 2. Both pairs roll again in the same round.",
    build: () => diceScript(DICE_OPENING_SPECS["dice-4way-double-tie"]!),
  },
  {
    id: "dice-spectator",
    category: "Match",
    name: "Dice opening: spectator",
    description: "You watch a 4-way table. No You tag; the seat line names both facing pairs.",
    build: () => diceScript(DICE_OPENING_SPECS["dice-spectator"]!),
  },
  {
    id: "dice-random-break",
    category: "Match",
    name: "Dice opening: tie broken at random",
    description: "After 10 tied rounds the server breaks the tie with a random shuffle: tied rolls next to a final order, with the short line Tie broken at random. The duel is about to start.",
    build: () => diceScript(DICE_OPENING_SPECS["dice-random-break"]!),
  },
];
