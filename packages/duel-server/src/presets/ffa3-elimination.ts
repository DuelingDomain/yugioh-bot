import { activate, chainWith, surrender, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

// Real-card setups only: no elimination calls, rule overrides or custom Lua.
const base = { format: "ffa3" as const, humanSeat: 0 as const, needs: "multi-core" as const };
const board = { format: "ffa3" as const, skipOpeningDraw: true };
const passBots = { 1: [], 2: [] };

export const presets: Preset[] = [
  {
    ...base,
    id: "ffa3-elimination-owned-elsewhere",
    title: "An eliminated owner's stolen monster leaves the game",
    rules: ["R-FFA-ELIMINATION", "R-FFA-LP", "R-FFA-ORDER"],
    board: {
      ...board,
      p0: { hand: ["Change of Heart", "Hinotama"] },
      p1: { lp: 500, monsters: ["Gemini Elf"] },
      p2: {},
    },
    bots: passBots,
    checklist: [
      "Take seat 1's Gemini Elf with Change of Heart, then eliminate its owner with Hinotama.",
      "The stolen Elf leaves seat 0's field without entering any living seat's Graveyard or banishment.",
      "Seat 1 is out; seats 0 and 2 keep playing clockwise with independent LP.",
    ],
  },
  {
    ...base,
    id: "ffa3-elimination-return-owned",
    title: "Return a survivor's monster from an eliminated controller",
    rules: ["R-FFA-ELIMINATION", "R-FFA-RETURN-OWNED-CARDS"],
    board: {
      ...board,
      p0: { monsters: [{ card: "Gemini Elf", pos: "def" }], spells: [{ card: "Just Desserts", pos: "set" }, { card: "Jar of Greed", pos: "set" }] },
      p1: { lp: 500, hand: ["Change of Heart"] },
      p2: {},
    },
    bots: {
      1: [activate("Change of Heart", { if: (prompt) => prompt.context?.type === "action" }), target({ card: "Gemini Elf", owner: 0 })],
      2: [],
    },
    checklist: [
      "End turn; seat 1 takes your defense-position Gemini Elf with Change of Heart.",
      "Eliminate seat 1 using Just Desserts before the stolen monster returns at End Phase.",
      "R-FFA-RETURN-OWNED-CARDS pending: the Elf should return to your monster zone in defense position; current engine sends it to your Graveyard.",
    ],
  },
  {
    ...base,
    id: "ffa3-elimination-exchanged-hand",
    title: "Exchanged hands after one owner's elimination",
    rules: ["R-FFA-ELIMINATION", "R-FFA-RETURN-OWNED-CARDS"],
    board: {
      ...board,
      p0: { hand: ["Exchange", "Axe Raider", "Hinotama"] },
      p1: { lp: 500, hand: ["Celtic Guardian"] },
      p2: {},
    },
    bots: { 1: [target({ card: "Axe Raider", owner: 0 })], 2: [] },
    checklist: [
      "Use Exchange: the sole rival hand with cards is seat 1, its only Celtic Guardian is auto-selected, and the bot chooses your Axe Raider.",
      "Eliminate seat 1 with Hinotama: its Celtic Guardian must leave your hand.",
      "R-FFA-RETURN-OWNED-CARDS pending: your Axe Raider should return from the loser's hand to your hand; current engine sends it to your Graveyard.",
    ],
  },
  ...[false, true].map((survives): Preset => ({
    ...base,
    id: `ffa3-elimination-ongoing-${survives ? "control" : "loss"}`,
    title: `Swords of Revealing Light ${survives ? "holds while its owner lives" : "ends at its owner's elimination"}`,
    rules: ["R-FFA-ELIMINATION"],
    board: {
      ...board,
      p0: { monsters: ["Gemini Elf"], hand: ["Hinotama"] },
      p1: { lp: survives ? 5000 : 500, spells: ["Swords of Revealing Light"] },
      p2: {},
    },
    bots: passBots,
    checklist: [
      "Pass to turn 4, then use Hinotama on seat 1.",
      survives ? "Seat 1 lives at 4500 LP: its Swords still prevents your Elf from attacking." : "Seat 1 is eliminated: attack seat 2 immediately in the same turn, with no intervening End Phase.",
    ],
  })),
  {
    ...base,
    id: "ffa3-elimination-deck-out",
    title: "An empty Deck loses only on the next required draw",
    rules: ["R-FFA-ELIMINATION", "R-FFA-LP", "R-FFA-ORDER"],
    board: { ...board, deckSize: 3, p0: {}, p1: { hand: ["Pot of Greed"] }, p2: {} },
    bots: { 1: [activate("Pot of Greed", { if: (prompt) => prompt.context?.type === "action" })], 2: [] },
    checklist: [
      "Seat 1 draws once, then empties its remaining two-card Deck using Pot of Greed on turn 2.",
      "An action prompt with deckCount 0 proves an empty Deck alone does not eliminate seat 1.",
      "Its required draw on turn 5 eliminates only seat 1 without changing any seat's LP; seats 2 and 0 continue.",
    ],
  },
  {
    ...base,
    id: "ffa3-elimination-cut-turn",
    title: "A self-lethal turn ends and counts for Nightmare's Steelcage",
    rules: ["R-FFA-ELIMINATION", "R-FFA-ORDER", "R-FFA-LP"],
    board: {
      ...board,
      p0: { hand: ["Nightmare's Steelcage"] },
      p1: {},
      p2: { lp: 1000, monsters: ["Mystical Elf"], spells: [{ card: "Destruction Ring", pos: "set" }] },
    },
    bots: {
      1: [],
      2: [activate("Destruction Ring", { if: (prompt, view) => view.turn === 3 && prompt.context?.type === "action" })],
    },
    checklist: [
      "Activate Nightmare's Steelcage on turn 1; seat 1 completes the first opponent turn.",
      "Seat 2 activates Destruction Ring in its own turn 3, loses its last 1000 LP, and ends the turn immediately.",
      "Turn 4 starts at seat 0; the second opponent turn counted and Steelcage is in your Graveyard.",
    ],
  },
  ...[false, true].map((survives): Preset => ({
    ...base,
    id: `ffa3-elimination-chain-${survives ? "control" : "loss"}`,
    title: `Heavy Storm ${survives ? "resolves for a living seat" : "does nothing after its controller loses mid-chain"}`,
    rules: ["R-FFA-ELIMINATION", "R-FFA-CHAIN"],
    board: {
      ...board,
      p0: { spells: [{ card: "Just Desserts", pos: "set" }, { card: "Jar of Greed", pos: "set" }] },
      p1: { lp: survives ? 8000 : 500, hand: ["Heavy Storm"], monsters: ["Mystical Elf"] },
      p2: { spells: ["Burden of the Mighty"] },
    },
    bots: { 1: [activate("Heavy Storm", { if: (prompt) => prompt.context?.type === "action" })], 2: [] },
    checklist: [
      "End turn and decline optional windows until seat 1 adds Heavy Storm.",
      "Chain your Just Desserts and choose seat 1; decline Jar of Greed to resolve the chain.",
      survives ? "Seat 1 survives at 7500 LP; Heavy Storm destroys seat 2's Burden." : "Seat 1 is eliminated at 0 LP; its open Heavy Storm link has no effect and seat 2's Burden stays.",
    ],
  })),
  ...[false, true].map((survives): Preset => ({
    ...base,
    id: `ffa3-elimination-pending-chain${survives ? "-control" : ""}`,
    title: survives ? "A living Dust Tornado destroys its target" : "A surrendered link has no effect while another link is added",
    rules: ["R-FFA-ELIMINATION", "R-FFA-CHAIN"],
    board: {
      ...board,
      p0: { hand: ["Pot of Greed"], monsters: ["Gemini Elf"], spells: ["Burden of the Mighty", { card: "Jar of Greed", pos: "set" }] },
      p1: { monsters: ["Gemini Elf"], spells: [{ card: "Dust Tornado", pos: "set" }, { card: "Dust Tornado", pos: "set" }, "Burden of the Mighty"] },
      p2: { spells: [{ card: "Jar of Greed", pos: "set" }] },
    },
    bots: {
      1: [
        surrender({ if: (prompt, view) => !survives && prompt.context?.type === "chain" && view.chain.some((link) => link.seat === 1) }),
        chainWith({ card: "Dust Tornado", nth: 0 }, { if: (prompt, view) => onChain(prompt, view) && !view.chain.some((link) => link.seat === 1) }),
        target({ card: "Burden of the Mighty", owner: 0 }),
      ],
      2: [chainWith("Jar of Greed", { if: (_prompt, view) => view.seats[1]!.pendingElimination === true })],
    },
    checklist: [
      "Activate Pot of Greed; seat 1 chains Dust Tornado targeting your Burden.",
      survives ? "Seat 1 stays live and passes its next response window." : "Seat 1 surrenders; seat 2 adds Jar of Greed while the loss is pending.",
      survives ? "Dust Tornado destroys your Burden; Pot of Greed draws two." : "Its Dust Tornado has no effect and your Burden stays. Pending ADR: its own cards and ongoing effects should remain until the chain ends; current engine eliminates it after the new link.",
    ],
  })),
  {
    ...base,
    id: "ffa3-elimination-last-two-draw",
    title: "The last two seats reach zero together: draw without a winner",
    rules: ["R-FFA-ELIMINATION", "R-FFA-WINNER"],
    board: {
      ...board,
      p0: { lp: 1000, hand: ["Hinotama"], monsters: ["Mystical Elf"], spells: [{ card: "Destruction Ring", pos: "set" }] },
      p1: { lp: 1000 },
      p2: { lp: 500 },
    },
    bots: passBots,
    checklist: [
      "Eliminate seat 2 using Hinotama; decline Destruction Ring response windows.",
      "Activate Destruction Ring targeting your Elf: both last seats reach 0 LP in one resolution.",
      "The finished engine and room have winnerSeat null; the result screen says DRAW, including after reload.",
    ],
  },
];
