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
const RESTRICTIONS = {
  rivalry: { card: "Rivalry of Warlords", code: 90846359, property: "Type" },
  gozen: { card: "Gozen Match", code: 53334471, property: "Attribute" },
} as const;
type Restriction = keyof typeof RESTRICTIONS;
const OX = "Battle Ox";
const KAIJU = "Gameciel, the Sea Turtle Kaiju";

function restrictedReceiver(format: "ffa3" | "ffa4", kaiju: boolean, thirdOwner: boolean, restriction: Restriction): Scenario {
  const { card: trap, code, property } = RESTRICTIONS[restriction];
  const seats = SEATS[format];
  const trapOwner = thirdOwner ? "p1" : "p0";
  // Bastion is LIGHT/Fairy; Gameciel is WATER/Aqua. The unrelated Battle Ox is EARTH/Beast-Warrior.
  // A Kaiju needs a tribute on its receiving field, so p2 starts with an Aqua monster.
  const water = "Amphibious Bugroth";
  return defineScenario({
    id: `unban-angelechy-${format}-${restriction}-${kaiju ? "kaiju-receiver" : "empty-receiver-offered"}${thirdOwner ? "-third-owner" : ""}`,
    title: `${format}: ${trapOwner}'s ${trap} reads the receiving field for ${kaiju ? "a Kaiju summon" : "Angelechy Opposition"}`,
    source: `${SOURCE}; ${trap} limits the receiving field's monster ${property}`,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "unban", "value-limits", "opponent-field", format, `card:${code}`, kaiju ? "card:55063751" : "card:101402094"],
    setup: { ...baseSetup(format, { p1: { monsters: [OX], spells: thirdOwner ? [trap] : [] }, p2: { monsters: kaiju ? [water] : [] } }),
      skipOpeningDraw: true,
      p0: { hand: kaiju ? [KAIJU] : [], monsters: thirdOwner ? [OX] : [], extra: kaiju ? [] : [BASTION, DESTRIER],
        spells: [...(!thirdOwner ? [trap] : []), ...(!kaiju ? [{ card: OPPOSITION, pos: "set" as const }] : [])] } },
    steps: kaiju ? [
      expectOffered("specialSummon", KAIJU, "p0"), specialSummon(KAIJU, "p0"),
      select({ card: water, owner: "p2" }),
      expectBoard(Object.fromEntries(seats.map(seat => [seat, { monsters: seat === "p1" || (thirdOwner && seat === "p0") ? [OX] : seat === "p2" ? [KAIJU] : [],
        spells: seat === trapOwner ? [trap] : [], grave: seat === "p2" ? [water] : [], hand: [], extra: [], banished: [] }]))),
    ] : [
      expectOffered("activate", OPPOSITION, "p0"), activate(OPPOSITION, "p0"),
      ...(format === "ffa4" ? [expectPickSeats(["p2", "p3"], "p0"), pickOpponent("p2", "p0")] : []),
      select(BASTION, DESTRIER), select(BASTION),
      expectBoard(Object.fromEntries(seats.map(seat => [seat, { monsters: seat === "p1" || (thirdOwner && seat === "p0") ? [OX] : seat === "p2" ? [BASTION] : [],
        spells: [...(seat === trapOwner ? [trap] : []), ...(seat === "p0" ? [DESTRIER] : [])], grave: seat === "p0" ? [OPPOSITION] : [], hand: [], extra: [], banished: [] }]))),
    ],
  });
}

function restrictedTagReceiver(kaiju: boolean, thirdOwner: boolean, restriction: Restriction): Scenario {
  const { card: trap, code, property } = RESTRICTIONS[restriction];
  const water = "Amphibious Bugroth";
  const fairy = "Dunames Dark Witch";
  const trapOwner = thirdOwner ? "p1" : "p0";
  return defineScenario({
    id: `unban-angelechy-tag-${restriction}-${kaiju ? "kaiju-receiver" : "empty-receiver-offered"}${thirdOwner ? "-third-owner" : ""}`,
    title: `Tag: ${trapOwner}'s ${trap} reads the receiving team for ${kaiju ? "a Kaiju summon" : "Angelechy Opposition"}`,
    source: `${SOURCE}; ${trap} checks the receiving team's monster ${property}`,
    rules: ["R-COMMON-OPP-PICK", "R-TAG-SHARED-CARDS"],
    tags: ["multiplayer", "unban", "value-limits", "opponent-field", "tag", `card:${code}`, kaiju ? "card:55063751" : "card:101402094"],
    setup: { ...baseSetup("tag", {}), skipOpeningDraw: true,
      p0: { hand: kaiju ? [KAIJU] : [], monsters: [OX], extra: kaiju ? [] : [BASTION, DESTRIER],
        spells: [...(!thirdOwner ? [trap] : []), ...(!kaiju ? [{ card: OPPOSITION, pos: "set" as const }] : [])] },
      p1: { monsters: [kaiju ? water : fairy], spells: thirdOwner ? [trap] : [] },
      p2: { monsters: [OX] }, p3: { monsters: kaiju ? [water] : [] } },
    steps: [
      ...(kaiju ? [expectOffered("specialSummon", KAIJU, "p0"), specialSummon(KAIJU, "p0")]
        : [expectOffered("activate", OPPOSITION, "p0"), activate(OPPOSITION, "p0")]),
      expectPickSeats(["p1", "p3"], "p0"), pickOpponent("p3", "p0"),
      ...(kaiju ? [select({ card: water, owner: "p3" })] : [select(BASTION, DESTRIER), select(BASTION)]),
      expectBoard(Object.fromEntries(SEATS.tag.map(seat => [seat, {
        monsters: seat === "p0" || seat === "p2" ? [OX] : seat === "p1" ? [kaiju ? water : fairy] : [kaiju ? KAIJU : BASTION],
        spells: [...(seat === trapOwner ? [trap] : []), ...(seat === "p0" && !kaiju ? [DESTRIER] : [])],
        grave: seat === "p3" && kaiju ? [water] : seat === "p0" && !kaiju ? [OPPOSITION] : [], hand: [], extra: [], banished: [],
      }]))),
    ],
  });
}

function blockedKaijuReceiver(format: Format, thirdOwner: boolean, restriction: Restriction): Scenario {
  const { card: trap, code, property } = RESTRICTIONS[restriction];
  const trapOwner = thirdOwner ? "p1" : "p0";
  const water = "Amphibious Bugroth";
  const knight = "Mermaid Knight";
  // Either Ox can be Tributed, but the other still conflicts with Gameciel.
  // The summoner is compatible, so a third player's Trap must read the receiver.
  const monsters = Object.fromEntries(SEATS[format].map(seat => [seat,
    seat === "p0" || (format === "tag" && seat === "p2") ? [water]
      : seat === "p2" || (format === "tag" && seat === "p3") ? [OX, OX]
      : format === "tag" && seat === "p1" ? [OX] : [],
  ]));
  return defineScenario({
    id: `unban-angelechy-${format}-${restriction}-kaiju-receiver-blocked${thirdOwner ? "-third-owner" : ""}`,
    title: `${format}: ${trapOwner}'s ${trap} refuses a Kaiju while the receiver keeps a different ${property}`,
    source: `${SOURCE}; ${trap} checks the receiving field's monster ${property} before the Tribute`,
    rules: ["R-COMMON-OPP-PICK", format === "tag" ? "R-TAG-SHARED-CARDS" : "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "unban", "value-limits", "opponent-field", format, `card:${code}`, "card:55063751"],
    setup: { ...baseSetup(format, Object.fromEntries(SEATS[format].map(seat => [seat, {
      monsters: monsters[seat], spells: seat === trapOwner ? [trap] : [],
      hand: seat === "p0" ? [KAIJU, knight] : [],
    }]))), skipOpeningDraw: true },
    steps: [
      expectNotOffered("specialSummon", KAIJU, "p0"), normalSummon(knight, "p0"),
      expectBoard(Object.fromEntries(SEATS[format].map(seat => [seat, {
        monsters: [...monsters[seat], ...(seat === "p0" ? [knight] : [])],
        spells: seat === trapOwner ? [trap] : [], hand: seat === "p0" ? [KAIJU] : [],
        grave: [], extra: [], banished: [],
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
for (const restriction of ["rivalry", "gozen"] as const) {
  for (const thirdOwner of [false, true]) {
    standard.push(...(["ffa3", "ffa4"] as const).flatMap(format => [
      restrictedReceiver(format, false, thirdOwner, restriction), restrictedReceiver(format, true, thirdOwner, restriction),
    ]));
    standard.push(restrictedTagReceiver(false, thirdOwner, restriction), restrictedTagReceiver(true, thirdOwner, restriction));
    standard.push(...(["ffa3", "ffa4", "tag"] as const).map(format => blockedKaijuReceiver(format, thirdOwner, restriction)));
  }
}
export const UNBAN_ANGELECHY_SCENARIOS: Scenario[] = standard.flatMap(scenario => [scenario,
  scenario.tags.includes("value-limits") ? domainVariant(scenario) : domainProof(scenario)]);
