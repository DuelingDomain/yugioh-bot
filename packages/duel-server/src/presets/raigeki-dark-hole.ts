import type { Preset } from "./types.js";

const monsters = (card: string) => [{ card, pos: "atk" as const }];

/**
 * Raigeki hits one declared opponent in FFA4 and the opposing team in Tag. Dark Hole hits every monster. The human activates both
 * in Main Phase 1. FFA4: no partner. Tag: the partner (seat 2) keeps its monster under Raigeki and loses it under Dark Hole.
 */
export const presets: Preset[] = [
  {
    id: "raigeki-dark-hole-ffa4",
    title: "Raigeki then Dark Hole, free-for-all (4 seats)",
    format: "ffa4",
    humanSeat: 0,
    needs: "multi-core",
    rules: ["R-FFA-OPP-ONE", "R-COMMON-ALL-BOTH"],
    board: {
      format: "ffa4",
      p0: { hand: ["Raigeki", "Dark Hole"], monsters: monsters("Celtic Guardian") },
      p1: { monsters: monsters("Gemini Elf") },
      p2: { monsters: monsters("Giant Rat") },
      p3: { monsters: monsters("Summoned Skull") },
    },
    bots: { 1: [], 2: [], 3: [] },
    checklist: [
      "You start in Main Phase 1 with Raigeki and Dark Hole. You and the three bots each control one monster.",
      "Activate Raigeki and declare one bot as the opponent. Only that bot's monster is destroyed. Your Celtic Guardian and the other bots' monsters stay.",
      "Activate Dark Hole. Every monster on the field is destroyed, yours included.",
      "No bot is asked to pick a target. The bots only pass.",
    ],
  },
  {
    id: "raigeki-dark-hole-tag",
    title: "Raigeki then Dark Hole, Tag (2v2)",
    format: "tag",
    humanSeat: 0,
    needs: "multi-core",
    rules: ["R-TAG-SHARED-CARDS", "R-COMMON-ALL-BOTH", "R-TAG-PARTNER"],
    board: {
      format: "tag",
      p0: { hand: ["Raigeki", "Dark Hole"], monsters: monsters("Celtic Guardian") },
      p1: { monsters: monsters("Gemini Elf") },
      p2: { monsters: monsters("Giant Rat") },
      p3: { monsters: monsters("Summoned Skull") },
    },
    bots: { 1: [], 2: [], 3: [] },
    checklist: [
      "Seats 0 and 2 are your team. Seats 1 and 3 are the opposing team.",
      "Activate Raigeki. The monsters of seats 1 and 3 are destroyed. Your monster and the Giant Rat of your partner (seat 2) stay.",
      "Activate Dark Hole. Every monster is destroyed, the monster of your partner too.",
    ],
  },
];
