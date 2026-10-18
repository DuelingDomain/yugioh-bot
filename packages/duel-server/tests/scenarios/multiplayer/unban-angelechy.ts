import {
  activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectPickSeats, normalSummon,
  pickOpponent, select, type DuelistId, type Scenario,
} from "../../support/dsl.js";
import { domainProof } from "./proof-domain.js";
import { baseSetup, SEATS, type Format } from "./seat-kit.js";

const OPPOSITION = "Angelechy Opposition";
const BASTION = "Angelechy Bastion";
const DESTRIER = "Angelechy Destrier";
const ELF = "Mystical Elf";
const FULL = Array<string>(5).fill(ELF);
const SOURCE = "Owner decision 2026-10-18; docs/adr/0002-multiplayer-duel-rules.md: summon to the field of one eligible opponent";

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
export const UNBAN_ANGELECHY_SCENARIOS: Scenario[] = standard.flatMap(scenario => [scenario, domainProof(scenario)]);
