import { def, set } from "./board.js";
import type { Preset } from "./types.js";

// Mid-game boards for the marketing site screenshots (scripts/site-screenshots.sh). Like every preset they only
// exist with DUEL_SCENARIOS=1. The title is the table name that the table shows, so it reads like a real table.
// Every bot only passes, so the boards stay as they are while the screenshot is taken.

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
      deckSize: 30,
      p0: {
        lp: 6400,
        hand: ["Monster Reborn", "Swords of Revealing Light", "Gaia The Fierce Knight", "Mystical Space Typhoon"],
        monsters: ["Blue-Eyes White Dragon", def("Celtic Guardian"), set("Sangan"), "Summoned Skull"],
        spells: [set("Mirror Force"), set("Call of the Haunted"), "Swords of Revealing Light"],
        field: "Sogen",
        grave: ["Dark Magician", "Giant Rat", "Mystic Tomato"],
      },
      p1: {
        lp: 3400,
        hand: ["Raigeki", "Feral Imp", "Curse of Dragon"],
        monsters: ["Red-Eyes Black Dragon", set("Man-Eater Bug"), def("Mystical Elf")],
        spells: [set("Dust Tornado"), set("Solemn Judgment")],
        grave: ["Hane-Hane", "Witch of the Black Forest", "Mystical Space Typhoon"],
      },
      p2: {
        lp: 8000,
        hand: ["Dark Hole", "Sangan", "Kuriboh", "Monster Reborn", "Gaia The Fierce Knight"],
        monsters: [def("Giant Soldier of Stone"), "Gaia The Fierce Knight", null, set("Hane-Hane")],
        spells: [set("Magic Cylinder"), "Swords of Revealing Light"],
        grave: ["Mystic Tomato", "Feral Imp"],
      },
      p3: {
        lp: 5200,
        hand: ["Heavy Storm", "Kuriboh"],
        monsters: ["Buster Blader", def("Witch of the Black Forest"), "Curse of Dragon", set("Sangan"), "Feral Imp"],
        spells: [set("Mirror Force"), set("Call of the Haunted"), set("Trap Hole")],
        grave: ["Man-Eater Bug", "Giant Rat", "Hane-Hane", "Dark Hole"],
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
      deckSize: 30,
      p0: {
        lp: 11200,
        hand: ["Monster Reborn", "Swords of Revealing Light", "Gaia The Fierce Knight"],
        monsters: ["Blue-Eyes White Dragon", def("Celtic Guardian"), set("Sangan")],
        spells: [set("Mirror Force"), "Swords of Revealing Light"],
        field: "Sogen",
        grave: ["Dark Magician", "Giant Rat", "Mystic Tomato"],
      },
      p1: {
        lp: 9400,
        hand: ["Raigeki", "Feral Imp", "Curse of Dragon", "Kuriboh"],
        monsters: ["Red-Eyes Black Dragon", set("Man-Eater Bug"), def("Mystical Elf")],
        spells: [set("Dust Tornado"), set("Solemn Judgment")],
        grave: ["Hane-Hane", "Witch of the Black Forest"],
      },
      p2: {
        lp: 11200,
        hand: ["Dark Hole", "Sangan", "Mystical Space Typhoon"],
        monsters: ["Summoned Skull", def("Giant Soldier of Stone"), "Gaia The Fierce Knight"],
        spells: [set("Call of the Haunted"), set("Magic Cylinder")],
        grave: ["Feral Imp", "Mystic Tomato"],
      },
      p3: {
        lp: 9400,
        hand: ["Heavy Storm", "Monster Reborn"],
        monsters: ["Buster Blader", def("Witch of the Black Forest"), set("Hane-Hane")],
        spells: [set("Mirror Force"), set("Trap Hole")],
        grave: ["Man-Eater Bug", "Giant Rat", "Dark Hole"],
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
      deckSize: 40,
      p0: {
        lp: 5600,
        hand: ["Monster Reborn", "Swords of Revealing Light", "Gaia The Fierce Knight", "Mystical Space Typhoon"],
        monsters: ["Blue-Eyes White Dragon", def("Celtic Guardian"), set("Sangan"), "Summoned Skull"],
        spells: [set("Mirror Force"), set("Call of the Haunted"), "Swords of Revealing Light"],
        field: "Sogen",
        grave: ["Dark Magician", "Giant Rat", "Mystic Tomato", "Feral Imp"],
        deckMaster: "Celtic Guardian",
      },
      p1: {
        lp: 3800,
        hand: ["Raigeki", "Feral Imp", "Curse of Dragon", "Kuriboh"],
        monsters: ["Red-Eyes Black Dragon", set("Man-Eater Bug"), def("Mystical Elf"), "Buster Blader"],
        spells: [set("Dust Tornado"), set("Solemn Judgment")],
        grave: ["Hane-Hane", "Witch of the Black Forest", "Mystical Space Typhoon"],
        deckMaster: "Gaia The Fierce Knight",
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
