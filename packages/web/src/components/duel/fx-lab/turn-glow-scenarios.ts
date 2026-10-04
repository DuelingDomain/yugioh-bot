import { zoneKey, LOCATION_MZONE } from "../constants";
import { edit, newBoard, type Edit, type LabScenario, type LabScript } from "./board";
import { CARDS } from "./cards";

/** A mid-game board with cards on both fields, so the glow is judged behind real cards and a usable glow. */
function board(turnSeat: number) {
  const initial = newBoard({ hand: [CARDS.sangan, CARDS.kuriboh] }, { hand: [null, null, null] }, "main1", turnSeat);
  edit.monster(0, 2, CARDS.blueEyes)(initial);
  edit.monster(1, 2, CARDS.summonedSkull)(initial);
  edit.setSpell(0, 1, CARDS.mirrorForce)(initial);
  edit.hiddenSpell(1, 1)(initial);
  return initial;
}

function still(id: string, name: string, description: string, turnSeat: number): LabScenario {
  return {
    id: `turn-glow-${id}`, name, description, category: "Board states",
    build: (): LabScript => ({ initial: board(turnSeat), steps: [], tailMs: 6000, legalKeys: turnSeat === 0 ? [zoneKey(0, LOCATION_MZONE, 2)] : [] }),
  };
}

const toSeat = (seat: number): Edit => (next) => { next.turnSeat = seat; };

export const TURN_GLOW_SCENARIOS: LabScenario[] = [
  still("you", "Turn glow: your turn",
    "A faint blue-violet light rises from your edge of the screen behind your half of the board. No outline. The usable glow on your monster stays on top.", 0),
  still("opponent", "Turn glow: opponent's turn",
    "A faint amber-red light comes down from the top edge behind the opponent's half. Each side has its own colour.", 1),
  {
    id: "turn-glow-switch", name: "Turn glow: the turn changes sides",
    description: "The light cross-fades from your side to the opponent's side in about 0.35 s, then back. With Reduced motion on, it switches at once.",
    category: "Board states",
    build: (): LabScript => ({
      initial: board(0),
      steps: [
        { at: 2200, edits: [toSeat(1)] },
        { at: 5200, edits: [toSeat(0)] },
        { at: 8200, edits: [toSeat(1)] },
      ],
      tailMs: 3000,
    }),
  },
  {
    id: "turn-glow-deck-menu", name: "Deck menu: Surrender on your own deck",
    description: "Click, right click or long press your own Main Deck: a small menu offers Surrender. The opponent's deck has no menu. Escape closes it and focus returns to the deck.",
    category: "Board states",
    build: (): LabScript => ({ initial: board(0), steps: [], tailMs: 6000, deckMenu: "menu" }),
  },
  {
    id: "turn-glow-deck-confirm", name: "Deck menu: Are you sure?",
    description: "Surrender from the deck menu opens the confirm. Surrender calls the existing surrender action (the lab sends nothing). Cancel closes it.",
    category: "Board states",
    build: (): LabScript => ({ initial: board(0), steps: [], tailMs: 6000, deckMenu: "confirm" }),
  },
];
