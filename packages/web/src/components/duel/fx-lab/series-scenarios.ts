import { newBoard, type LabScenario, type LabScript, type LabSeries, type SeatOptions } from "./board";
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

export const SERIES_SCENARIOS: LabScenario[] = [
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
  {
    id: "match-spectator-siding",
    category: "Match",
    name: "Spectator: side decking",
    description: "A spectator's screen after game 1 while the players side deck. Shows both players' Ready state and the countdown; the spectator moves to game 2 when it starts.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "ready", secondsLeft: 48, opponentReady: true, viewer: "spectator" }),
  },
  {
    id: "match-spectator-next-live",
    category: "Match",
    name: "Spectator: next game live",
    description: "A spectator who opens game 1 after game 2 has started: the screen points at the live game.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "next-live", viewer: "spectator" }),
  },
  {
    id: "match-spectator-private-siding",
    category: "Match",
    name: "Private spectator: side decking",
    description: "An admitted spectator on a private table watches the players side deck and moves to game 2 automatically when it starts.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "ready", secondsLeft: 48, opponentReady: true, viewer: "spectator", visibility: "private" }),
  },
  {
    id: "match-spectator-private-next-live",
    category: "Match",
    name: "Private spectator: next game live",
    description: "An admitted spectator opens the finished private game 1 after game 2 has started: Watch game 2 opens the live game with admission carried over.",
    build: () => seriesScript({ wins: [1, 0], game: 1, screen: "next-live", viewer: "spectator", visibility: "private" }),
  },
  {
    id: "match-spectator-won",
    category: "Match",
    name: "Spectator: match decided",
    description: "A spectator's screen at the end of a Best of 3, 2–1: the final series result.",
    build: () => seriesScript({ wins: [2, 1], game: 3, screen: "won", viewer: "spectator" }),
  },
];
