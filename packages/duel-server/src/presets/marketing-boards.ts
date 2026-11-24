import { def, set } from "./board.js";
import type { Preset } from "./types.js";

// Mid-game boards for the marketing site screenshots (scripts/site-screenshots.sh). Like every preset they only
// exist with DUEL_SCENARIOS=1. The title is the table name that the table shows, so it reads like a real table.
// Every bot only passes. A board starts on turn 1, so the screenshot spec (packages/e2e/screenshots/boards.spec.ts)
// passes the turns up to MARKETING_TARGET_TURN with the normal prompts; the cards drawn on the way come from the
// top of each `deck`. Each seat lists its state at the target turn, minus the draws still to come, so the counts in
// the shot are: Deck = deckSize - draws, hand = listed hand + draws.
// Every card is legal on the pinned TCG list (no forbidden card; at most one Limited card per deck).
// The rules and counts behind every board are in packages/e2e/screenshots/README.md (board ledgers).

/** The turn the spec plays to, for each preset. It is the Main Phase 1 of seat 0. */
export const MARKETING_TARGET_TURN: Record<string, number> = {
  "marketing-ffa4": 9, // seat 0's third turn (turns 1, 5, 9)
  "marketing-tag": 9, // 1A's third turn
  "marketing-domain": 7, // 1v1: seat 0's fourth turn (turns 1, 3, 5, 7)
};

export const presets: Preset[] = [
  {
    id: "marketing-ffa4",
    title: "Friday night free-for-all",
    format: "ffa4",
    humanSeat: 0,
    needs: "multi-core",
    rules: [],
    board: {
      format: "ffa4",
      deckSize: 40,
      // Standard, Master Rule 5. Only the turn-1 duelist skips the first draw (R-FFA-FIRST-DRAW), so every seat draws twice by turn 9.
      p0: {
        lp: 6500,
        hand: [],
        deck: ["Witch of the Black Forest", "Mystical Space Typhoon"], // drawn on turns 5 and 9
        deckSize: 32,
        monsters: ["Celtic Guardian", "Dark Magician", set("Hane-Hane")],
        spells: [set("Mirror Force")],
        field: "Sogen",
        grave: ["Offerings to the Doomed", "Monster Reborn", "Giant Rat"],
      },
      p1: {
        lp: 4800,
        hand: ["Kuriboh", "Sangan", "Mystical Elf"],
        deckSize: 32,
        monsters: ["Feral Imp", "Witch of the Black Forest"],
        spells: [set("Call of the Haunted"), set("Trap Hole")],
        grave: ["Book of Moon"],
      },
      p2: {
        lp: 8000,
        hand: ["Hane-Hane"],
        deckSize: 35,
        monsters: [def("Giant Soldier of Stone"), set("Mystic Tomato")],
        spells: [set("Magic Cylinder"), set("Solemn Judgment")],
      },
      p3: {
        lp: 5200,
        hand: ["Sangan"],
        deckSize: 35,
        monsters: ["Summoned Skull"],
        spells: [set("Mirror Force"), set("Trap Hole")],
        grave: ["Axe Raider"],
      },
    },
    bots: { 1: [], 2: [], 3: [] },
    checklist: [
      "Four duelists share the table, each with their own field.",
      "Life Points differ between the seats.",
      "Pass the turn and watch the next duelist play.",
    ],
  },
  {
    id: "marketing-tag",
    title: "Saturday tag duel",
    format: "tag",
    humanSeat: 0,
    needs: "multi-core",
    rules: [],
    board: {
      format: "tag",
      deckSize: 40,
      // Seats 0 and 2 are team 1 (1A, 1B) and seats 1 and 3 are team 2 (2A, 2B). Each team shares one LP total (R-TAG-LP),
      // so both partners get the same value. Each team has at most one Field Spell (R-TAG-FIELD).
      p0: {
        lp: 12300,
        hand: ["Gaia The Fierce Knight"],
        deck: ["Monster Reborn", "Kuriboh"], // drawn on turns 5 and 9
        deckSize: 33,
        monsters: ["Battle Ox", set("Man-Eater Bug")],
        spells: [set("Dust Tornado")],
        field: "Sogen",
        grave: ["Book of Moon", "Mystical Space Typhoon"],
      },
      p1: {
        lp: 9500,
        hand: [],
        deckSize: 35,
        monsters: ["Curse of Dragon"],
        spells: [set("Trap Hole"), set("Magic Cylinder")],
        grave: ["Feral Imp", "Mirror Force"],
      },
      p2: {
        lp: 12300,
        hand: ["Sangan", "Mystic Tomato"],
        deck: ["Hane-Hane", "Giant Rat"], // drawn on turns 3 and 7
        deckSize: 35,
        monsters: ["Summoned Skull"],
        spells: [set("Mirror Force")],
        grave: ["Axe Raider"],
      },
      p3: {
        lp: 9500,
        hand: ["Kuriboh", "Feral Imp"],
        deckSize: 33,
        monsters: [def("Giant Soldier of Stone"), set("Mystic Tomato")],
        spells: [set("Mirror Force")],
        field: "Yami",
        grave: ["Offerings to the Doomed"],
      },
    },
    bots: { 1: [], 2: [], 3: [] },
    checklist: [
      "Seats 0 and 2 are one team and seats 1 and 3 are the other.",
      "Each team has one shared Life Point total.",
      "Pass the turn and watch the opposing team play.",
    ],
  },
  {
    id: "marketing-domain",
    title: "Domain Format duel",
    format: "1v1",
    humanSeat: 0,
    rules: [],
    board: {
      mode: "domain",
      // Domain: 60 Main Deck cards, singleton, Deck Master apart from the decks. In 1v1 Domain the turn-1 duelist skips the first draw
      // (R-FFA-FIRST-DRAW), so seat 0 draws on turns 3, 5 and 7 and seat 1 on turns 2, 4 and 6.
      deckSize: 60,
      p0: {
        lp: 6000,
        hand: ["Apprentice Magician"],
        deck: ["Mystical Space Typhoon", "Monster Reborn", "Mystic Tomato"], // drawn on turns 3, 5 and 7
        deckSize: 52,
        monsters: ["Dark Elf", "Dark Magician Girl"],
        spells: [set("Mirror Force"), set("Dust Tornado")],
        field: "Yami",
        grave: ["Witch of the Black Forest", "Book of Moon"],
        deckMaster: "Dark Magician",
      },
      p1: {
        lp: 4400,
        hand: ["Kuriboh"],
        deckSize: 54,
        monsters: ["Feral Imp", "Summoned Skull"],
        spells: [set("Trap Hole"), set("Dust Tornado")],
        grave: ["Sangan"],
        deckMaster: "Red-Eyes Black Dragon",
      },
    },
    bots: { 1: [] },
    checklist: [
      "Your Deck Master waits in its own zone.",
      "Life Points differ between the duelists.",
      "Pass the turn and watch the bot play.",
    ],
  },
];
