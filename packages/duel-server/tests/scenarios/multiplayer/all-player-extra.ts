import {
  activate, expectBoard, expectLog, normalSummon, select, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";

type Format = "1v1" | "ffa3" | "ffa4" | "tag";
type Kind = "cappello" | "dark-angel" | "alba-system";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
const SPELLS = ["Dark Hole", "Raigeki", "Monster Reborn", "Upstart Goblin"];
const FUSIONS = ["Albion the Branded Dragon", "Lubellion the Searing Dragon", "Titaniklad the Ash Dragon", "Brigrand the Glory Dragon", "Sprind the Irondash Dragon", "Mirrorjade the Iceblade Dragon"];
const CODES: Record<Kind, number> = { cappello: 19491080, "dark-angel": 26964762, "alba-system": 93053159 };

function allExtra(kind: Kind, format: Format): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, deckSize: 2 };
  const board: BoardExpect = {};
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    const seat = SEATS[i];
    setup[seat] = { hand: [HANDS[i]], monsters: ["Mystical Elf"], deck: ["Mystical Elf", "Mystical Elf"] };
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [HANDS[i]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [], deckCount: 2 };
  }
  if (kind === "cappello") {
    // The test runner adds one face-up Timegazer Magician to each Extra Deck.
    setup.p0!.monsters = ["Clown Crew Cappello", "Mystical Elf"];
    setup.p0!.hand!.push("Mobius the Frost Monarch");
    board.p0!.monsters = ["Mobius the Frost Monarch", "Mystical Elf"];
    for (let i = 0; i < count; i++) board[SEATS[i]]!.deckCount = i === 0 ? 4 : 3;
    steps.push(normalSummon("Mobius the Frost Monarch", "p0"), select("Clown Crew Cappello"), yes("p0"));
  } else if (kind === "dark-angel") {
    setup.p0!.grave = ["Destiny HERO - Dark Angel", "Destiny HERO - Defender"];
    board.p0!.banished = ["Destiny HERO - Dark Angel", "Destiny HERO - Defender"];
    for (let i = 0; i < count; i++) setup[SEATS[i]]!.deck = i === 0 && (format === "ffa3" || format === "ffa4") ? ["Mystical Elf", SPELLS[i]] : [SPELLS[i], "Mystical Elf"];
    steps.push(yes("p0"));
  } else {
    const materials = ["Fallen of Albaz", ...HANDS, "Mystical Elf", "Blue-Eyes White Dragon"];
    setup.p0!.spells = [{ card: "Necro Fusion", pos: "set" }];
    setup.p0!.grave = materials;
    setup.p0!.extra = ["Alba System Dogmatikalamity", ...FUSIONS, "Number 39: Utopia"];
    setup.p0!.monsters = ["Gale Dogra", "Mystical Elf"];
    setup.p0!.lp = 32000;
    board.p0!.lp = 14000;
    if (format === "tag") { setup.p2!.lp = 32000; board.p2!.lp = 14000; }
    for (let i = 1; i < count; i++) {
      setup[SEATS[i]]!.extra = ["Number 39: Utopia"];
      board[SEATS[i]]!.grave = ["Number 39: Utopia"];
    }
    board.p0!.monsters = ["Gale Dogra", "Mystical Elf", "Alba System Dogmatikalamity"];
    board.p0!.grave = [...FUSIONS, "Necro Fusion", "Number 39: Utopia"];
    board.p0!.banished = materials;
    steps.push(activate("Necro Fusion", "p0"), select("Alba System Dogmatikalamity"), select(...materials));
    for (const fusion of FUSIONS) steps.push(activate("Gale Dogra", "p0"), select(fusion));
    steps.push(activate("Alba System Dogmatikalamity", "p0"));
  }
  steps.push(expectBoard(board));
  if (kind === "dark-angel") steps.push(...SPELLS.slice(0, count).map((card) => expectLog(`Excavated ${card}`)));
  return defineScenario({
    id: `all-player-extra-${kind}-${format}`, title: `${format}: ${kind} reaches every living duelist`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "all-player-extra", `card:${CODES[kind]}`, format], setup, steps,
  });
}
export const ALL_PLAYER_EXTRA_SCENARIOS: Scenario[] = (["cappello", "dark-angel", "alba-system"] as const).flatMap((kind) =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => allExtra(kind, format)));
