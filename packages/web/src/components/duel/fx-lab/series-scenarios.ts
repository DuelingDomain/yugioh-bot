import { newBoard, type LabOpening, type LabScenario, type LabScript, type LabSeries, type SeatOptions } from "./board";
import { CARDS as C } from "./cards";

/**
 * Best of 3 scenarios of the FX lab: the header label during a game and the screens between games
 * and at the end of the match. The board is a plain mid-duel board; the series part is `LabScript.series`
 * and is drawn by series-view.tsx. Nothing here touches React or the DOM.
 */

const myHand: SeatOptions = { hand: [C.sangan, C.kuriboh, C.potOfGreed, C.monsterReborn], deck: 28, extra: [C.darkPaladin, C.stardust, C.utopia] };
const oppHand: SeatOptions = { hand: [null, null, null, null, null], deck: 29, extra: [null, null] };

function seriesScript(series: LabSeries): LabScript {
  return { initial: newBoard(myHand, oppHand, "main1", 0), steps: [], tailMs: 1800, series };
}

function openingScript(opening: LabOpening): LabScript {
  return { initial: newBoard(myHand, oppHand, "main1", 0), steps: [], tailMs: 1800, opening };
}

export const SERIES_SCENARIOS: LabScenario[] = [
  {
    id: "rps-choosing",
    category: "Match",
    name: "Rock-paper-scissors: choosing",
    description: "Before the duel: pick rock, paper or scissors. The opponent is still choosing and a 30 second countdown runs. Clicks call the real API, which fails in the lab.",
    build: () => openingScript({ stage: "pick" }),
  },
  {
    id: "rps-waiting",
    category: "Match",
    name: "Rock-paper-scissors: waiting",
    description: "You already chose. Your move is locked and you wait for the opponent. The pick stays hidden from both sides until both are in.",
    build: () => openingScript({ stage: "pick-chosen" }),
  },
  {
    id: "rps-opponent-chose",
    category: "Match",
    name: "Rock-paper-scissors: opponent chose",
    description: "The opponent has played and you have not. The chip says Opponent chose, not what.",
    build: () => openingScript({ stage: "pick", opponentChose: true }),
  },
  {
    id: "rps-reveal-win",
    category: "Match",
    name: "Rock-paper-scissors: you win",
    description: "Both moves show for a moment: your paper beats the opponent's rock. You win.",
    build: () => openingScript({ stage: "reveal-win" }),
  },
  {
    id: "rps-reveal-lose",
    category: "Match",
    name: "Rock-paper-scissors: you lose",
    description: "Your rock loses to the opponent's paper. You lose.",
    build: () => openingScript({ stage: "reveal-lose" }),
  },
  {
    id: "rps-reveal-tie",
    category: "Match",
    name: "Rock-paper-scissors: tie",
    description: "Both played scissors. Tie, again: the next round starts at once.",
    build: () => openingScript({ stage: "reveal-tie" }),
  },
  {
    id: "rps-choose-order",
    category: "Match",
    name: "Rock-paper-scissors: go first or second",
    description: "The winner's choice: Go first or Go second. If the 30 seconds run out, the winner goes first.",
    build: () => openingScript({ stage: "choose" }),
  },
  {
    id: "rps-opponent-choosing",
    category: "Match",
    name: "Rock-paper-scissors: opponent chooses order",
    description: "You lost the game. The opponent is choosing to go first or second.",
    build: () => openingScript({ stage: "wait-choose" }),
  },
  {
    id: "rps-start",
    category: "Match",
    name: "Rock-paper-scissors: order settled",
    description: "The order is settled and the duel is about to start.",
    build: () => openingScript({ stage: "start" }),
  },
  {
    id: "match-label-game-2",
    category: "Match",
    name: "Header: game 2 of 3",
    description: "The top right of the duel room header during game 2 of a Best of 3, you lead 1–0. A single game shows nothing here.",
    build: () => seriesScript({ wins: [1, 0], game: 2, screen: "label" }),
  },
  {
    id: "match-label-game-3",
    category: "Match",
    name: "Header: game 3 of 3",
    description: "The header label in the deciding game, 1–1.",
    build: () => seriesScript({ wins: [1, 1], game: 3, screen: "label" }),
  },
  {
    id: "match-side-deck",
    category: "Match",
    name: "Between games: side deck",
    description: "The side deck screen after game 1: swap a Main or Extra card with a Side card, then Ready. Buttons that save or ready call the real API, which fails in the lab.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "side", secondsLeft: 48, opponentReady: false }),
  },
  {
    id: "match-ready",
    category: "Match",
    name: "Between games: ready",
    description: "The screen after game 1 with the score, the next game, who goes first, the countdown and both Ready states. The opponent is still siding.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "ready", secondsLeft: 48, opponentReady: false }),
  },
  {
    id: "match-ready-opponent",
    category: "Match",
    name: "Between games: opponent ready",
    description: "The same screen after you lost game 1 and the opponent clicked Ready. You go first in game 2.",
    build: () => seriesScript({ wins: [0, 1], game: 1, screen: "ready", secondsLeft: 31, opponentReady: true }),
  },
  {
    id: "match-won",
    category: "Match",
    name: "Match won",
    description: "The end of a Best of 3 after game 3, 2–1. The final result shows and no next game is offered.",
    build: () => seriesScript({ wins: [2, 1], game: 3, screen: "won" }),
  },
];
