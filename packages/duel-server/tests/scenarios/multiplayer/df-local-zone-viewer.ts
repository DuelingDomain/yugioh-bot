import { activate, defineScenario, expectPrompt, type Scenario } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { EXTRA_MONSTER_ZONE_SCENARIOS } from "./extra-monster-zones.js";
import { everySeat, SEATS } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

function opponentCost(format: "ffa3" | "ffa4"): Scenario {
  const READER = format === "ffa3" ? 95200109 : 95200110;
  const setup: Scenario["setup"] = { format, p0: { hand: [READER], deck: ["Mystical Elf"] } };
  for (const seat of SEATS[format].slice(1)) setup[seat] = { monsters: [null, "Imduk the World Chalice Dragon", null, null, null, "Saryuja Skull Dread"] };
  return defineScenario({
    id: `df-local-zone-viewer-${format}-opponent-cost`,
    title: `${format}: opponent Card zone reads keep all masks and ask for no opponent`,
    source: `${SOURCE} [R-COMMON-EMZ]`, rules: ["R-COMMON-EMZ"], tags: ["multiplayer", format, "link"], setup,
    steps: [activate(READER, "p0"), expectPrompt({ by: "p0", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, seat === "p0"
        ? { lp: 7500, hand: ["Mystical Elf"], monsters: [], spells: [], grave: [READER], banished: [], extra: [], deckCount: 19 }
        : { lp: 8000, hand: [], monsters: ["Imduk the World Chalice Dragon", "Saryuja Skull Dread"], spells: [], grave: [], banished: [], extra: [], deckCount: 20,
          zones: { m1: "Imduk the World Chalice Dragon", emz0: "Saryuja Skull Dread", emz1: null } }])) )],
  });
}
const tag = EXTRA_MONSTER_ZONE_SCENARIOS.find((s) => s.id === "emz-tag-columns-stay-on-each-seat")!;
const standard = [opponentCost("ffa3"), opponentCost("ffa4"),
  { ...tag, id: "df-local-zone-viewer-tag-mekk-knight", title: "Tag: each Mekk-Knight column belongs to its own seat" }];
export const DF_LOCAL_ZONE_VIEWER_SCENARIOS: Scenario[] = [...standard, ...standard.map(domainVariant)];
