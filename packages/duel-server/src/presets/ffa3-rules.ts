import { activate, chainWith, target } from "../scripted-bot.js";
import { onChain, type Preset } from "./types.js";

/** Small real-core boards for the opponent/trigger browser spec. No rule overrides. */
export const presets: Preset[] = [
  {
    id: "ffa3-rules-opponent-lp",
    title: "Hinotama picks one of two rivals for LP damage",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-COMMON-OPP-PICK"],
    board: { format: "ffa3", p0: { hand: ["Hinotama"] } },
    bots: { 1: [], 2: [] },
    checklist: [
      "Activate Hinotama from the human hand menu.",
      "The prompt and table offer both rivals; choose seat 2.",
      "Only seat 2 loses 500 LP; all Graveyards except the spent spell stay empty.",
    ],
  },
  {
    id: "ffa3-rules-opponent-field",
    title: "Three seats: Raigeki declares one opponent (pending)",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-OPP-ONE"],
    board: {
      format: "ffa3",
      p0: { hand: ["Raigeki"], monsters: ["Mystical Elf"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Silver Fang"] },
    },
    bots: { 1: [], 2: [] },
    checklist: [
      "Activate Raigeki through the hand menu.",
      "ADR: declare one opponent before resolving; only that field clears.",
      "Current engine control: both opponents lose their monsters; your Elf stays.",
    ],
  },
  {
    id: "ffa3-rules-direct-response",
    title: "Only the attacked seat receives Battle Fader",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-OPP-RESPONSE"],
    board: {
      format: "ffa3",
      p0: { monsters: ["Blue-Eyes White Dragon"], spells: [{ card: "Mystical Space Typhoon", pos: "set" }] },
      p1: { hand: ["Battle Fader"] },
      p2: { hand: ["Battle Fader"], spells: [{ card: "Dark Hole", pos: "set" }] },
    },
    bots: { 1: [chainWith("Battle Fader")], 2: [chainWith("Battle Fader")] },
    checklist: [
      "Pass to turn 4, then declare and confirm a direct attack on seat 1.",
      "Both rivals hold Battle Fader; the prompt log must offer it only to seat 1.",
      "Decline MST, then seat 1 summons Fader and stops the attack; all LP stay 8000.",
    ],
  },
  {
    id: "ffa3-rules-triggers",
    title: "Three simultaneous Graveyard triggers go clockwise",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-TRIGGERS"],
    board: {
      format: "ffa3",
      p0: { hand: ["Dark Hole"], monsters: ["Sangan"], deck: ["Giant Rat"], spells: [{ card: "Mystical Space Typhoon", pos: "set" }] },
      p1: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"], spells: [{ card: "Dark Hole", pos: "set" }] },
      p2: { monsters: ["Sangan"], deck: ["Giant Rat"] },
    },
    bots: { 1: [target("Silver Fang")], 2: [target("Giant Rat")] },
    checklist: [
      "Dark Hole sends all three trigger monsters to their own Graveyards together.",
      "Observe the new chain [0,1,2] and the turn player's response chip.",
      "Decline MST and choose Giant Rat through the human prompt; the triggers resolve [2,1,0].",
    ],
  },
  {
    id: "ffa3-rules-triggers-rotated",
    title: "Simultaneous triggers start at seat 1's turn, not seat 0",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-TRIGGERS"],
    board: {
      format: "ffa3",
      p0: { monsters: ["Sangan"], deck: ["Giant Rat"], spells: [{ card: "Mystical Space Typhoon", pos: "set" }] },
      p1: { hand: ["Dark Hole"], monsters: ["Witch of the Black Forest"], deck: ["Mystical Elf", "Silver Fang"], spells: [{ card: "Dark Hole", pos: "set" }] },
      p2: { monsters: ["Sangan"], deck: ["Giant Rat"] },
    },
    bots: { 1: [activate("Dark Hole"), target("Silver Fang")], 2: [target("Giant Rat")] },
    checklist: [
      "End the human turn; seat 1 activates Dark Hole on turn 2.",
      "The three triggers form [1,2,0], clockwise from the actual turn player.",
      "Decline MST and choose Giant Rat; resolution is [0,2,1].",
    ],
  },
  {
    id: "ffa3-rules-negate",
    title: "Seat 2 negates seat 0's activation with Solemn Judgment",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-NEGATE"],
    board: {
      format: "ffa3",
      p0: { hand: ["Raigeki"], spells: [{ card: "Solemn Judgment", pos: "set" }] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Axe Raider"], spells: [{ card: "Solemn Judgment", pos: "set" }] },
    },
    bots: { 1: [], 2: [chainWith("Solemn Judgment", { if: onChain })] },
    checklist: [
      "Activate Raigeki; seat 1 passes and seat 2 chains Solemn Judgment.",
      "The human's own Solemn holds a response window; inspect links and priority then decline.",
      "Both rival monsters survive, Raigeki and the third seat's Solemn go to GY, seat 2 pays 4000 LP.",
    ],
  },
  {
    id: "ffa3-rules-activated-lock",
    title: "Abyss Dweller locks one declared opponent (pending)",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-ACTIVATED-LOCK"],
    board: {
      format: "ffa3",
      p0: { hand: ["Dark Hole"], monsters: [{ card: "Abyss Dweller", materials: ["Mystical Elf"] }] },
      p1: { monsters: ["Sangan"], deck: ["Giant Rat"] },
      p2: { monsters: ["Witch of the Black Forest"], deck: ["Silver Fang"] },
    },
    bots: { 1: [target("Giant Rat")], 2: [target("Silver Fang")] },
    checklist: [
      "Activate Dweller, paying its detach cost. ADR: choose one opponent at activation.",
      "Resolve Dweller, then activate Dark Hole to create simultaneous GY triggers.",
      "ADR: only the declared seat is locked. Current engine: neither rival's GY trigger is offered.",
    ],
  },
  {
    id: "ffa3-rules-resource-rotation",
    title: "Creature Swap rotates every seat's monster (pending)",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-FFA-RESOURCE-ROTATION"],
    board: {
      format: "ffa3",
      p0: { hand: ["Creature Swap"], monsters: ["Mystical Elf"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Silver Fang"] },
    },
    bots: { 1: [target({ card: "Battle Ox", owner: 1 })], 2: [target({ card: "Silver Fang", owner: 2 })] },
    checklist: [
      "Activate Creature Swap and choose your Elf when asked.",
      "ADR: all three seats choose, then the monsters rotate 0 to 1 to 2 to 0.",
      "Current engine control records the actual pair swap; no preset changes the rules.",
    ],
  },
  {
    id: "ffa3-rules-extra-zones",
    title: "Real Link summons use independent EMZ and local arrows",
    format: "ffa3", humanSeat: 0, needs: "multi-core",
    rules: ["R-COMMON-EMZ"],
    board: {
      format: "ffa3",
      p0: { monsters: ["Mystical Elf", "Battle Ox"], extra: ["Link Spider", "Imduk the World Chalice Dragon"] },
      p1: { monsters: [null, null, null, null, null, "Link Spider"] },
      p2: { monsters: [null, null, null, null, null, "Link Spider"] },
    },
    bots: { 1: [], 2: [] },
    checklist: [
      "With both rivals' left EMZ occupied, Link Summon Spider using your Elf into your left EMZ.",
      "Link Summon Imduk using Battle Ox: Spider's down arrow permits only your main zone 1.",
      "Your second EMZ remains empty, and both rival Spiders keep their own zones.",
    ],
  },
];
