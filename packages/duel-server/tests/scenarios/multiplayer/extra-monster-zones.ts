import {
  activate, endTurn, expectEvents, expectNotOffered, expectOffered, expectPickOptions, expectPickSeats, expectPrompt, expectRetry, pickOpponent,
  select, setCard, specialSummon, zone, type DuelistExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const SPIDER = "Link Spider";
const IMDUK = "Imduk the World Chalice Dragon";
const SECURITY = "Security Dragon";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
const KNIGHT = "Mekk-Knight Purple Nightfall";
const emzRule = (format: Format) => format === "ffa4" ? "R-FFA-ACROSS-EMZ" : "R-COMMON-EMZ";
// Local Link and column queries follow R-COMMON-EMZ in docs/adr/0002-multiplayer-duel-rules.md.
// Patch 0069 implements the local zone viewer rule. FFA4 shared geometry follows R-FFA-ACROSS-EMZ.
// This file also checks the occupied Extra Link outcome.
const emz = (card: string) => [null, null, null, null, null, card];

function independentZones(format: Format, right: boolean): Scenario {
  const setup: Scenario["setup"] = { format };
  const steps: Step[] = [];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    setup[seat] = { monsters: [ELF, OX], extra: [SPIDER, IMDUK] };
    state[seat] = { monsters: [ELF, OX], extra: [SPIDER, IMDUK], hand: [], deckCount: 20,
      zones: { m0: ELF, m1: OX, m2: null, m3: null, m4: null, emz0: null, emz1: null } };
  }
  for (const [index, seat] of SEATS[format].entries()) {
    const acrossOccupied = format === "ffa4" && index % 2 === 1;
    // The facing partner blocks the mirrored EMZ. Seats 1 and 3 use the same local number as their partners.
    const extraZone = right ? "emz1" : "emz0";
    const blockedZone = right ? "emz0" : "emz1";
    const linkedZone = right ? "m3" : "m1";
    if (index) state[seat] = { ...state[seat], hand: [ELF], deckCount: 19 };
    steps.push(specialSummon(SPIDER, seat), select({ card: ELF, owner: seat }));
    if (!acrossOccupied) steps.push(
      expectPickOptions([{ seat, label: "Extra Monster Zone (left)" }, { seat, label: "Extra Monster Zone (right)" }], seat),
      // An invalid zone answer must keep the prompt and all seats' cards.
      expectRetry({ selected: ["place:99"] }, { by: seat, error: "Invalid" }), zone(seat, extraZone, seat));
    steps.push(expectPrompt({ by: seat, context: "action" }),
      expectEvents({ kind: "summon", card: SPIDER, by: seat, summonKind: "link" }));
    state[seat] = { ...state[seat], monsters: [SPIDER, OX], extra: [IMDUK], grave: [ELF],
      zones: { ...state[seat]!.zones, m0: null, [extraZone]: SPIDER, [blockedZone]: null } };
    steps.push(everySeat(format, state));
    // With one EMZ occupied, the other is not offered. The Spider arrow opens one Main Monster Zone of this seat only.
    // The core places the monster without a place prompt when just one zone is legal. Check that exact zone below.
    steps.push(specialSummon(IMDUK, seat), select({ card: OX, owner: seat }));
    state[seat] = { ...state[seat], monsters: [SPIDER, IMDUK], extra: [], grave: [ELF, OX],
      zones: { ...state[seat]!.zones, m1: null, [linkedZone]: IMDUK, [extraZone]: SPIDER, [blockedZone]: null } };
    steps.push(everySeat(format, state));
    if (index < SEATS[format].length - 1) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `emz-${format}-every-seat-${right ? "right" : "left"}-and-own-link-arrow`,
    title: format === "ffa4" ? `ffa4: across seats share two EMZ and use their own Link arrows (${right ? "right" : "left"})`
      : `${format}: every seat uses its own ${right ? "right" : "left"} EMZ and its own linked main zone`,
    source: `${SOURCE} [${emzRule(format)}]`, rules: [emzRule(format)], tags: ["multiplayer", format, "link", "card:98978921", "card:31226177"], setup, steps });
}

function coLinks(format: Format, actor: Seat): Scenario {
  const setup: Scenario["setup"] = { format };
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    setup[seat] = seat === actor ? { monsters: [ELF, SECURITY], extra: [SPIDER] } : { monsters: [ELF, null, null, null, null, SPIDER] };
    state[seat] = { monsters: seat === actor ? [ELF, SECURITY] : [ELF, SPIDER], extra: seat === actor ? [SPIDER] : [],
      hand: SEATS[format].indexOf(seat) > 0 && SEATS[format].indexOf(seat) <= SEATS[format].indexOf(actor) ? [ELF] : [],
      zones: seat === actor ? { m0: ELF, m1: SECURITY, emz0: null, emz1: null }
        : { m0: ELF, m1: null, emz0: SPIDER, emz1: null } };
  }
  const target: Seat = actor === "p0" ? "p1" : "p0";
  const targets = SEATS[format].filter((seat) => seat !== actor && (format !== "tag" || Number(seat[1]) % 2 !== Number(actor[1]) % 2));
  const targetSeats: DuelistId[] = format !== "tag" ? [target] : targets;
  const before = everySeat(format, state);
  state[actor] = { ...state[actor], monsters: [SECURITY, SPIDER], extra: [], grave: [ELF],
    zones: { m0: null, m1: SECURITY, emz0: SPIDER, emz1: null } };
  const linked = everySeat(format, state);
  state[target] = { ...state[target], monsters: [SPIDER], hand: [...(state[target]!.hand as string[]), ELF],
    zones: { ...state[target]!.zones, m0: null } };
  return defineScenario({ id: `emz-${format}-colink-is-local-${actor}`, title: `${format}: ${actor} gets a co-link only from its own EMZ Spider`,
    source: `${SOURCE} [${emzRule(format)}]`, rules: [emzRule(format)], tags: ["multiplayer", format, "link", "card:98978921", "card:99111753"], setup,
    steps: [...turnsBefore(format, actor), expectNotOffered("activate", SECURITY, actor), before,
      specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
      // In FFA4 the across seat's EMZ 0 blocks this seat's EMZ 1. The host answers the one-place prompt.
      ...(format === "ffa4" ? [] : [zone(actor, "emz0", actor)]), linked,
      expectOffered("activate", SECURITY, actor), activate(SECURITY, actor),
      // R-FFA-OPP-ONE: declare the opponent before seeing only its legal target cards.
      ...(format !== "tag" ? [expectPickSeats(targets, actor), pickOpponent(target, actor)] : []),
      expectPickOptions({ include: targetSeats.map((seat) => ({ seat, card: ELF })), exclude: [{ seat: actor }] }, actor),
      select({ card: ELF, owner: target }), everySeat(format, state)],
  });
}

function columns(format: Format): Scenario {
  const setup: Scenario["setup"] = { format };
  const steps: Step[] = [];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    setup[seat] = { monsters: emz(SPIDER), hand: [KNIGHT, "Dark Hole"] };
    state[seat] = { monsters: [SPIDER], hand: [KNIGHT, "Dark Hole"], extra: [], deckCount: 20,
      zones: { m0: null, m1: null, m2: null, m3: null, m4: null, emz0: SPIDER, emz1: null,
        s0: null, s1: null, s2: null, s3: null, s4: null } };
  }
  // FFA4 shares columns with the across seat. FFA3 and Tag keep columns on each seat.
  for (const [index, seat] of SEATS[format].entries()) {
    const acrossColumn = format === "ffa4" && index % 2 === 1;
    if (index) state[seat] = { ...state[seat], hand: [KNIGHT, "Dark Hole", ELF], deckCount: 19 };
    if (!acrossColumn) {
      // One own Spider is not enough. The cards of the other pair do not count.
      steps.push(expectNotOffered("specialSummon", KNIGHT, seat), setCard("Dark Hole", seat), zone(seat, "s1", seat));
      state[seat] = { ...state[seat], spells: ["Dark Hole"], hand: index ? [KNIGHT, ELF] : [KNIGHT],
        zones: { ...state[seat]!.zones, s1: { card: "Dark Hole", pos: "set" } } };
    }
    // For p1 and p3, two partner cards permit the summon before this seat sets a Spell.
    steps.push(expectOffered("specialSummon", KNIGHT, seat), specialSummon(KNIGHT, seat));
    state[seat] = { ...state[seat], monsters: [SPIDER, KNIGHT],
      hand: acrossColumn ? ["Dark Hole", ELF] : index ? [ELF] : [],
      zones: { ...state[seat]!.zones, [acrossColumn ? "m3" : "m1"]: KNIGHT } };
    steps.push(everySeat(format, state));
    if (acrossColumn) {
      steps.push(setCard("Dark Hole", seat), zone(seat, "s1", seat));
      state[seat] = { ...state[seat], spells: ["Dark Hole"], hand: [ELF],
        zones: { ...state[seat]!.zones, s1: { card: "Dark Hole", pos: "set" } } };
      steps.push(everySeat(format, state));
    }
    if (index < SEATS[format].length - 1) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `emz-${format}-columns-stay-on-each-seat`,
    title: format === "ffa4" ? "ffa4: column summons count the across field and exclude the other pair"
      : `${format}: column summons use two cards of the same seat`,
    source: `${SOURCE} [${emzRule(format)}]`, rules: [emzRule(format)], tags: ["multiplayer", format, "column", "card:28692962"], setup, steps });
}

function arrowViewer(format: Format, actor: Seat): Scenario {
  const setup: Scenario["setup"] = { format };
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  const FLIER = "Link Infra-Flier";
  for (const seat of SEATS[format]) {
    setup[seat] = seat === actor ? { monsters: [ELF], extra: [SPIDER], hand: [FLIER] } : { monsters: emz(SPIDER) };
    state[seat] = { monsters: seat === actor ? [ELF] : [SPIDER], extra: seat === actor ? [SPIDER] : [],
      hand: [...(seat === actor ? [FLIER] : []), ...(seat !== "p0" && SEATS[format].indexOf(seat) <= SEATS[format].indexOf(actor) ? [ELF] : [])] };
  }
  const before = everySeat(format, state);
  state[actor] = { ...state[actor], monsters: [SPIDER], grave: [ELF], extra: [],
    zones: { m0: null, m1: null, emz0: SPIDER, emz1: null } };
  const linked = everySeat(format, state);
  state[actor] = { ...state[actor], monsters: [SPIDER, FLIER], grave: [ELF], extra: [],
    hand: actor === "p0" ? [] : [ELF], zones: { emz0: SPIDER, m1: FLIER, emz1: null } };
  return defineScenario({ id: `emz-${format}-arrow-viewer-${actor}`, title: `${format}: ${actor} cannot use another seat's Link arrow`,
    source: `${SOURCE} [${emzRule(format)}]`, rules: [emzRule(format)], tags: ["multiplayer", format, "link", "card:65100616"], setup,
    steps: [...turnsBefore(format, actor), expectNotOffered("specialSummon", FLIER, actor), before,
      specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
      // FFA4 has one free EMZ. The host answers that zone prompt automatically.
      ...(format === "ffa4" ? [] : [zone(actor, "emz0", actor)]), linked,
      expectOffered("specialSummon", FLIER, actor), specialSummon(FLIER, actor), everySeat(format, state)],
  });
}

function extraLink(format: Format, blocked = false): Scenario {
  const TRI = "Tri-Gate Wizard";
  const BINARY = "Binary Sorceress";
  const setup: Scenario["setup"] = { format, p0: { monsters: [ELF, TRI, BINARY, TRI, null, SPIDER], extra: [SPIDER] } };
  // A free second EMZ is required even with an Extra Link. Other pairs' EMZ do not block this pair.
  for (const seat of SEATS[format].slice(1)) setup[seat] = {
    monsters: format === "ffa4" && seat === "p1" && !blocked ? [] : emz(SPIDER),
  };
  return defineScenario({ id: `emz-${format}-${blocked ? "second-zone-blocked-by-across" : "second-zone-by-extra-link"}`,
    title: blocked ? "ffa4: an across monster blocks the second EMZ even with an Extra Link"
      : `${format}: an Extra Link permits the free second EMZ`,
    source: `${SOURCE} [${emzRule(format)}]`, rules: [emzRule(format)], tags: ["multiplayer", format, "link", "card:32617464"], setup,
    steps: [specialSummon(SPIDER, "p0"), select({ card: ELF, owner: "p0" }),
      ...(blocked ? [expectPickOptions([{ seat: "p0", label: "Monster Zone 1" }, { seat: "p0", label: "Monster Zone 5" }], "p0"),
        zone("p0", "m0", "p0")]
        : [expectPickOptions(format === "ffa4"
          ? [{ seat: "p0", label: "Monster Zone 1" }, { seat: "p0", label: "Monster Zone 5" },
            { seat: "p0", label: "Extra Monster Zone (right)" }]
          : { include: [{ seat: "p0", label: "Extra Monster Zone (right)" }],
            exclude: SEATS[format].slice(1).map((seat) => ({ seat })) }, "p0"), zone("p0", "emz1", "p0")]),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, seat === "p0"
        ? { monsters: [TRI, BINARY, TRI, SPIDER, SPIDER], extra: [], grave: [ELF], hand: [], deckCount: 20,
          zones: { m0: blocked ? SPIDER : null, m1: TRI, m2: BINARY, m3: TRI, m4: null,
            emz0: SPIDER, emz1: blocked ? null : SPIDER } }
        : { monsters: format === "ffa4" && seat === "p1" && !blocked ? [] : [SPIDER], hand: [], extra: [], deckCount: 20,
          zones: { m0: null, m1: null, m2: null, m3: null, m4: null,
            emz0: format === "ffa4" && seat === "p1" && !blocked ? null : SPIDER, emz1: null } }])) )],
  });
}

function oldAcrossDoesNotBlock(): Scenario {
  const setup: Scenario["setup"] = { format: "ffa4", p0: { monsters: [ELF], extra: [SPIDER] },
    p2: { monsters: [null, null, null, null, null, null, SPIDER] } };
  return defineScenario({ id: "emz-ffa4-old-across-0-2-do-not-block", title: "FFA4: seat 2's right EMZ leaves both seat 0 EMZ available",
    source: `${SOURCE} [R-FFA-ACROSS-EMZ]`, rules: ["R-FFA-ACROSS-EMZ"], tags: ["multiplayer", "ffa4", "link"], setup,
    steps: [specialSummon(SPIDER, "p0"), select({ card: ELF, owner: "p0" }),
      expectPickOptions([{ seat: "p0", label: "Extra Monster Zone (left)" }, { seat: "p0", label: "Extra Monster Zone (right)" }], "p0"), zone("p0", "emz0", "p0"),
      everySeat("ffa4", { p0: { monsters: [SPIDER], grave: [ELF], extra: [], hand: [], deckCount: 20, zones: { emz0: SPIDER, emz1: null } },
        p1: { monsters: [], extra: [], hand: [], deckCount: 20 }, p2: { monsters: [SPIDER], extra: [], hand: [], deckCount: 20, zones: { emz0: null, emz1: SPIDER } },
        p3: { monsters: [], extra: [], hand: [], deckCount: 20 } })],
  });
}

const standard = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [
  independentZones(format, false), independentZones(format, true), coLinks(format, "p0"),
  coLinks(format, format === "ffa3" ? "p2" : "p3"), columns(format), arrowViewer(format, "p0"),
  arrowViewer(format, format === "ffa3" ? "p2" : "p3"), extraLink(format),
  ...(format === "ffa4" ? [extraLink(format, true)] : []),
]).concat(oldAcrossDoesNotBlock());
export const EXTRA_MONSTER_ZONE_SCENARIOS: Scenario[] = [...standard, ...standard.map(domainVariant)];
