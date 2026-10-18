import {
  activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickSeats, normalSummon,
  pickOpponent, select, specialSummon, type DuelistId, type Scenario,
} from "../../support/dsl.js";
import { domainProof } from "./proof-domain.js";
import { domainVariant } from "./domain-variants.js";
import { baseSetup, SEATS, type Format } from "./seat-kit.js";

const OPPOSITION = "Angelechy Opposition";
const BASTION = "Angelechy Bastion";
const DESTRIER = "Angelechy Destrier";
const ELF = "Mystical Elf";
const FULL = Array<string>(5).fill(ELF);
const SOURCE = "Owner decision 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md: summon to the field of one eligible opponent";
const RIVALRY = "Rivalry of Warlords";
const OX = "Battle Ox";
const KAIJU = "Gameciel, the Sea Turtle Kaiju";

function rivalryReceiver(format: "ffa3" | "ffa4", kaiju: boolean, thirdOwner = false): Scenario {
  const seats = SEATS[format];
  const trapOwner = thirdOwner ? "p1" : "p0";
  // Bastion is Fairy; Gameciel is Aqua. The unrelated Battle Ox is Beast-Warrior.
  // A Kaiju needs a tribute on its receiving field, so p2 starts with an Aqua monster.
  const water = "Amphibious Bugroth";
  return defineScenario({
    id: `unban-angelechy-${format}-rivalry-${kaiju ? "kaiju-receiver" : "empty-receiver-offered"}${thirdOwner ? "-third-owner" : ""}`,
    title: `${format}: ${trapOwner}'s Rivalry reads the receiving field for ${kaiju ? "a Kaiju summon" : "Angelechy Opposition"}`,
    source: `${SOURCE}; Rivalry limits the receiving field's monster Type`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "unban", "value-limits", "opponent-field", format, "card:90846359", kaiju ? "card:55063751" : "card:101402094"],
    setup: { ...baseSetup(format, { p1: { monsters: [OX], spells: thirdOwner ? [RIVALRY] : [] }, p2: { monsters: kaiju ? [water] : [] } }),
      skipOpeningDraw: true,
      p0: { hand: kaiju ? [KAIJU] : [], monsters: thirdOwner ? [OX] : [], extra: kaiju ? [] : [BASTION, DESTRIER],
        spells: [...(!thirdOwner ? [RIVALRY] : []), ...(!kaiju ? [{ card: OPPOSITION, pos: "set" as const }] : [])] } },
    steps: kaiju ? [
      expectOffered("specialSummon", KAIJU, "p0"), specialSummon(KAIJU, "p0"),
      select({ card: water, owner: "p2" }),
      expectBoard(Object.fromEntries(seats.map(seat => [seat, { monsters: seat === "p1" || (thirdOwner && seat === "p0") ? [OX] : seat === "p2" ? [KAIJU] : [],
        spells: seat === trapOwner ? [RIVALRY] : [], grave: seat === "p2" ? [water] : [], hand: [], extra: [], banished: [] }]))),
    ] : [
      expectOffered("activate", OPPOSITION, "p0"), activate(OPPOSITION, "p0"),
      ...(format === "ffa4" ? [expectPickSeats(["p2", "p3"], "p0"), pickOpponent("p2", "p0")] : []),
      select(BASTION, DESTRIER), select(BASTION),
      expectBoard(Object.fromEntries(seats.map(seat => [seat, { monsters: seat === "p1" || (thirdOwner && seat === "p0") ? [OX] : seat === "p2" ? [BASTION] : [],
        spells: [...(seat === trapOwner ? [RIVALRY] : []), ...(seat === "p0" ? [DESTRIER] : [])], grave: seat === "p0" ? [OPPOSITION] : [], hand: [], extra: [], banished: [] }]))),
    ],
  });
}

function rivalryTagReceiver(kaiju: boolean, thirdOwner: boolean): Scenario {
  const water = "Amphibious Bugroth";
  const fairy = "Dunames Dark Witch";
  const trapOwner = thirdOwner ? "p1" : "p0";
  return defineScenario({
    id: `unban-angelechy-tag-rivalry-${kaiju ? "kaiju-receiver" : "empty-receiver-offered"}${thirdOwner ? "-third-owner" : ""}`,
    title: `Tag: ${trapOwner}'s Rivalry reads the receiving team for ${kaiju ? "a Kaiju summon" : "Angelechy Opposition"}`,
    source: `${SOURCE}; Rivalry checks the receiving team's monster Type`,
    rules: ["R-COMMON-OPP-PICK", "R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", "unban", "value-limits", "opponent-field", "tag", "card:90846359", kaiju ? "card:55063751" : "card:101402094"],
    setup: { ...baseSetup("tag", {}), skipOpeningDraw: true,
      p0: { hand: kaiju ? [KAIJU] : [], monsters: [OX], extra: kaiju ? [] : [BASTION, DESTRIER],
        spells: [...(!thirdOwner ? [RIVALRY] : []), ...(!kaiju ? [{ card: OPPOSITION, pos: "set" as const }] : [])] },
      p1: { monsters: [kaiju ? water : fairy], spells: thirdOwner ? [RIVALRY] : [] },
      p2: { monsters: [OX] }, p3: { monsters: kaiju ? [water] : [] } },
    steps: [
      ...(kaiju ? [expectOffered("specialSummon", KAIJU, "p0"), specialSummon(KAIJU, "p0")]
        : [expectOffered("activate", OPPOSITION, "p0"), activate(OPPOSITION, "p0")]),
      expectPickSeats(["p1", "p3"], "p0"), pickOpponent("p3", "p0"),
      ...(kaiju ? [select({ card: water, owner: "p3" })] : [select(BASTION, DESTRIER), select(BASTION)]),
      expectBoard(Object.fromEntries(SEATS.tag.map(seat => [seat, {
        monsters: seat === "p0" || seat === "p2" ? [OX] : seat === "p1" ? [kaiju ? water : fairy] : [kaiju ? KAIJU : BASTION],
        spells: [...(seat === trapOwner ? [RIVALRY] : []), ...(seat === "p0" && !kaiju ? [DESTRIER] : [])],
        grave: seat === "p3" && kaiju ? [water] : seat === "p0" && !kaiju ? [OPPOSITION] : [], hand: [], extra: [], banished: [],
      }]))),
    ],
  });
}

function opponents(format: Format, actor: DuelistId): DuelistId[] {
  return SEATS[format].filter(seat => format === "tag" ? Number(seat[1]) % 2 !== Number(actor[1]) % 2 : seat !== actor);
}

function summon(format: Format, actor: "p0" | "p1", fullRecipient = false): Scenario {
  const recipients = opponents(format, actor);
  const blocked = recipients[0];
  const eligible = fullRecipient ? recipients.slice(1) : recipients;
  const picked = eligible.at(-1)!;
  const initial = Object.fromEntries(SEATS[format].map(seat => [seat, { monsters: [] as string[] }]));
  // A full own field must not block a summon to the chosen opponent's field.
  initial[actor].monsters = FULL;
  if (fullRecipient) initial[blocked].monsters = FULL;
  const suffix = fullRecipient ? "full-recipient-excluded" : `${actor}-chooses-recipient`;
  return defineScenario({
    id: `unban-angelechy-${format}-${suffix}`,
    title: `${format}: ${actor} chooses an eligible receiving field for Angelechy Opposition${fullRecipient ? "; a full MMZ field is excluded" : " while its own MMZ are full"}`,
    source: SOURCE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : ["R-FFA-OPP-ONE"])],
    tags: ["multiplayer", "unban", "opponent-pick", "opponent-field", format, "card:101402094"],
    setup: {
      ...baseSetup(format, initial), skipOpeningDraw: true,
      [actor]: { ...initial[actor], extra: [BASTION, DESTRIER], spells: [{ card: OPPOSITION, pos: "set" }] },
    },
    steps: [
      ...(actor === "p1" ? [endTurn("p0")] : []),
      activate(OPPOSITION, actor),
      ...(eligible.length > 1 ? [expectPickSeats(eligible, actor), pickOpponent(picked, actor)] : []),
      select(BASTION, DESTRIER), select(BASTION),
      expectBoard(Object.fromEntries(SEATS[format].map(seat => [seat, {
        monsters: [...initial[seat].monsters, ...(seat === picked ? [BASTION] : [])],
        spells: seat === actor ? [DESTRIER] : [],
        grave: seat === actor ? [OPPOSITION] : [], extra: [], banished: [],
      }]))),
    ],
  });
}

function noRecipient(format: Format): Scenario {
  const fullFields = Object.fromEntries(opponents(format, "p0").map(seat => [seat, { monsters: FULL }]));
  return defineScenario({
    id: `unban-angelechy-${format}-no-eligible-recipient`,
    title: `${format}: Angelechy Opposition cannot activate when every opposing MMZ field is full`,
    source: SOURCE, rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "unban", "opponent-field", format, "card:101402094"],
    setup: { ...baseSetup(format, fullFields), skipOpeningDraw: true,
      p0: { hand: [ELF], extra: [BASTION, DESTRIER], spells: [{ card: OPPOSITION, pos: "set" }] } },
    steps: [
      expectNotOffered("activate", OPPOSITION, "p0"), normalSummon(ELF, "p0"),
      expectBoard(Object.fromEntries(SEATS[format].map(seat => [seat, {
        monsters: seat === "p0" ? [ELF] : fullFields[seat]?.monsters ?? [],
        spells: seat === "p0" ? [OPPOSITION] : [], grave: [], banished: [],
        extra: seat === "p0" ? [BASTION, DESTRIER] : [],
      }]))),
    ],
  });
}

const standard = (["ffa3", "ffa4", "tag"] as const).flatMap(format => [
  summon(format, "p0"), summon(format, "p1"), summon(format, "p0", true), noRecipient(format),
]);
standard.push(...(["ffa3", "ffa4"] as const).flatMap(format => [false, true].flatMap(thirdOwner =>
  [rivalryReceiver(format, false, thirdOwner), rivalryReceiver(format, true, thirdOwner)])));
standard.push(...[false, true].flatMap(thirdOwner => [rivalryTagReceiver(false, thirdOwner), rivalryTagReceiver(true, thirdOwner)]));
export const UNBAN_ANGELECHY_SCENARIOS: Scenario[] = standard.flatMap(scenario => [scenario,
  scenario.id.includes("-rivalry-") ? domainVariant(scenario) : domainProof(scenario)]);
