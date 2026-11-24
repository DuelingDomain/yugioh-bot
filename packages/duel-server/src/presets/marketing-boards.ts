import { def, set } from "./board.js";
import type { Preset } from "./types.js";

// Mid-game boards for the marketing site screenshots (scripts/site-screenshots.sh). Like every preset they only
// exist with DUEL_SCENARIOS=1. The title is the table name that the table shows, so it reads like a real table.
// Every bot only passes. A board starts on turn 1, so the screenshot spec (packages/e2e/screenshots/boards.spec.ts)
// passes the turns up to MARKETING_TARGET_TURN with the normal prompts; the cards drawn on the way come from the
// top of each `deck`. Each seat lists its state at the target turn, minus the draws still to come, so the counts in
// the shot are: Deck = deckSize - draws, hand = listed hand + draws.
// The counts must follow the draw math: cards out of the Deck = 5 (opening hand) + draws taken, and cards out = hand + field
// (Set cards and Field Spell included) + Graveyard + banished. So for every seat: listed hand + field + Graveyard = 5 and
// deckSize = Main size - 5. No board uses a draw or search effect. Every Level 5+ monster has its tribute in the Graveyard,
// and each seat has at most one Normal Summon or Set per turn it had.
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
      deckSize: 35,
      // Standard, Master Rule 5. Only the turn-1 duelist skips the first draw (R-FFA-FIRST-DRAW), so every seat has drawn twice by turn 9
      // (seat 0 on turns 5 and 9, seat 1 on 2 and 6, seat 2 on 3 and 7, seat 3 on 4 and 8): 7 cards out of each 40-card Deck, 33 left.
      // Seat 0: turn 1 Normal Summon Celtic Guardian and Set Mirror Force; turn 5 Set Hane-Hane, activate Sogen, use Book of Moon.
      p0: {
        lp: 6500,
        hand: [],
        deck: ["Witch of the Black Forest", "Mystical Space Typhoon"], // drawn on turns 5 and 9
        monsters: ["Celtic Guardian", set("Hane-Hane")],
        spells: [set("Mirror Force")],
        field: "Sogen",
        grave: ["Book of Moon"],
      },
      // Seat 1: turn 2 Normal Summon Feral Imp, Set Trap Hole; turn 6 Normal Summon Witch of the Black Forest, Set Call of the Haunted, use Dian Keto.
      p1: {
        lp: 4800,
        hand: [],
        monsters: ["Feral Imp", "Witch of the Black Forest"],
        spells: [set("Call of the Haunted"), set("Trap Hole")],
        grave: ["Dian Keto the Cure Master"],
      },
      // Seat 2: turn 3 Normal Summon Giant Soldier of Stone (in defense since turn 7), Set Magic Cylinder; turn 7 Set Mystic Tomato and Solemn Judgment, use Book of Moon.
      p2: {
        lp: 8000,
        hand: [],
        monsters: [def("Giant Soldier of Stone"), set("Mystic Tomato")],
        spells: [set("Magic Cylinder"), set("Solemn Judgment")],
        grave: ["Book of Moon"],
      },
      // Seat 3: turn 4 Normal Summon Axe Raider, Set Mirror Force; turn 8 Tribute Summon Summoned Skull (tribute Axe Raider), Set Trap Hole. Sangan is still in hand.
      p3: {
        lp: 5200,
        hand: ["Sangan"],
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
      deckSize: 35,
      // Seats 0 and 2 are team 1 (1A, 1B) and seats 1 and 3 are team 2 (2A, 2B). Each team shares one LP total (R-TAG-LP),
      // so both partners get the same value. Each team has at most one Field Spell (R-TAG-FIELD).
      // Turn order 1A, 2A, 1B, 2B (R-TAG-ORDER). 1A draws on turns 5 and 9, 2A on 2 and 6, 1B on 3 and 7, 2B on 4 and 8: 7 cards out, 33 left.
      // 1A: turn 1 Normal Summon Battle Ox, Set Dust Tornado; turn 5 Set Man-Eater Bug, activate Sogen, use Book of Moon.
      p0: {
        lp: 12300,
        hand: [],
        deck: ["Monster Reborn", "Kuriboh"], // drawn on turns 5 and 9
        monsters: ["Battle Ox", set("Man-Eater Bug")],
        spells: [set("Dust Tornado")],
        field: "Sogen",
        grave: ["Book of Moon"],
      },
      // 2A: turn 2 Normal Summon Feral Imp, Set Trap Hole; turn 6 Tribute Summon Curse of Dragon (tribute Feral Imp), Set Magic Cylinder. Mirror Force was used.
      p1: {
        lp: 9500,
        hand: [],
        monsters: ["Curse of Dragon"],
        spells: [set("Trap Hole"), set("Magic Cylinder")],
        grave: ["Feral Imp", "Mirror Force"],
      },
      // 1B: turn 3 Normal Summon Axe Raider, Set Mirror Force; turn 7 Tribute Summon Summoned Skull (tribute Axe Raider). Sangan and Mystic Tomato are in hand.
      p2: {
        lp: 12300,
        hand: ["Sangan", "Mystic Tomato"],
        deck: ["Hane-Hane", "Giant Rat"], // drawn on turns 3 and 7
        monsters: ["Summoned Skull"],
        spells: [set("Mirror Force")],
        grave: ["Axe Raider"],
      },
      // 2B: turn 4 Normal Summon Giant Soldier of Stone, Set Mirror Force; turn 8 Set Mystic Tomato, activate Yami, use Dian Keto.
      p3: {
        lp: 9500,
        hand: [],
        monsters: [def("Giant Soldier of Stone"), set("Mystic Tomato")],
        spells: [set("Mirror Force")],
        field: "Yami",
        grave: ["Dian Keto the Cure Master"],
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
      // (R-FFA-FIRST-DRAW), so seat 0 draws on turns 3, 5 and 7 and seat 1 on turns 2, 4 and 6: 5 + 3 = 8 cards out, 52 left.
      deckSize: 55,
      // Seat 0: turn 1 Normal Summon Apprentice Magician, Set Mirror Force; turn 3 Tribute Summon Dark Magician Girl (tribute Apprentice Magician);
      // turn 5 Normal Summon Dark Elf, activate Yami.
      p0: {
        lp: 6000,
        hand: [],
        deck: ["Mystical Space Typhoon", "Monster Reborn", "Mystic Tomato"], // drawn on turns 3, 5 and 7
        monsters: ["Dark Elf", "Dark Magician Girl"],
        spells: [set("Mirror Force")],
        field: "Yami",
        grave: ["Apprentice Magician"],
        deckMaster: "Dark Magician",
      },
      // Seat 1: turn 2 Normal Summon Kuriboh; turn 4 Tribute Summon Summoned Skull (tribute Kuriboh), Set Trap Hole; turn 6 Normal Summon Feral Imp, Set Dust Tornado.
      p1: {
        lp: 4400,
        hand: [],
        monsters: ["Feral Imp", "Summoned Skull"],
        spells: [set("Trap Hole"), set("Dust Tornado")],
        grave: ["Kuriboh"],
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
