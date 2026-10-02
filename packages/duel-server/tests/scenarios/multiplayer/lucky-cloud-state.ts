// Real Trap activations summon two Cloudians. The draw belongs to the side that summoned them.
import { activate, defineScenario, endTurn, faceDown, normalSummon, pass, type Scenario } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const LUCK = "Lucky Cloud";
const CALL = "Call of the Haunted";
const CLOUD = "Cloudian - Smoke Ball";
const ELF = "Mystical Elf";

function cloud(format: Format, summoner: Seat): Scenario {
  const draws = summoner === "p0" || format === "tag" && summoner === "p2";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: draws ? [ELF, ELF] : [], monsters: [ELF], grave: [LUCK] };
  spec.p1 = { hand: [ELF] };
  spec[summoner] = { ...spec[summoner], monsters: [CLOUD, CLOUD, ...(summoner === "p0" ? [ELF] : [])], spells: [CALL, CALL] };
  const setup: Partial<Record<Seat, object>> = { p0: { hand: [LUCK, ELF] } };
  setup[summoner] = { ...setup[summoner], spells: [faceDown(CALL), faceDown(CALL)], grave: [CLOUD, CLOUD] };
  return defineScenario({
    id: `lucky-cloud-state-${format}-${summoner}-${draws ? "own-side-draws" : "opponent-no-draw"}`,
    title: `${format}: ${summoner} revives two Smoke Balls; p0's Lucky Cloud ${draws ? "draws two cards for its own side" : "does not draw for an opponent's summons"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the summon record has one slot per FFA seat or Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "summon", format, "card:82760689"],
    setup: baseSetup(format, setup),
    steps: [
      activate(LUCK, "p0"),
      activate({ card: CALL, seq: 0 }, summoner),
      { op: "select", sels: [{ card: CLOUD, nth: 0 }], by: summoner },
      pass(summoner),
      pass(summoner),
      normalSummon(ELF, "p0"),
      activate({ card: CALL, seq: 1 }, summoner),
      endTurn("p0"),
      everySeat(format, spec),
    ],
  });
}

export const LUCKY_CLOUD_STATE_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [
  cloud(format, format === "ffa3" ? "p2" : "p3"), cloud(format, "p0"),
  ...(format === "tag" ? [cloud(format, "p2")] : []),
]);
