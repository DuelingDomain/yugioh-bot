import { activate, defineScenario, expectBoard, select, specialSummon, type BoardExpect, type DuelistId, type Scenario } from "../../support/dsl.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
export const CHAOS_EMPEROR_TAG_SCENARIOS: Scenario[] = (["1v1", "tag"] as const).map((format) => {
  const count = format === "tag" ? 4 : 2;
  const setup: Scenario["setup"] = { format, deckSize: 2 };
  const board: BoardExpect = {};
  for (let i = 0; i < count; i++) {
    const seat = SEATS[i];
    setup[seat] = { hand: [HANDS[i]], monsters: ["Mystical Elf"], deck: ["Mystical Elf", "Mystical Elf"] };
    board[seat] = {
      lp: i % 2 === 0 ? (format === "tag" ? 15000 : 7000) : (format === "tag" ? 14800 : 7400),
      hand: [], monsters: [], spells: [], grave: ["Mystical Elf", HANDS[i]], banished: [], extra: [], deckCount: 2,
    };
  }
  setup.p0!.hand!.push("Chaos Emperor Dragon - Envoy of the End");
  setup.p0!.grave = ["Mystical Elf", "Destiny HERO - Defender"];
  board.p0!.grave = ["Mystical Elf", HANDS[0], "Chaos Emperor Dragon - Envoy of the End"];
  board.p0!.banished = ["Mystical Elf", "Destiny HERO - Defender"];
  return defineScenario({
    id: `chaos-emperor-all-hands-${format}`, title: `${format}: Chaos Emperor Dragon sends all hands and fields`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "all-player-zones", "card:82301904", format], setup,
    steps: [
      specialSummon("Chaos Emperor Dragon - Envoy of the End", "p0"), select("Mystical Elf", "Destiny HERO - Defender"),
      activate("Chaos Emperor Dragon - Envoy of the End", "p0"), expectBoard(board),
    ],
  });
});
