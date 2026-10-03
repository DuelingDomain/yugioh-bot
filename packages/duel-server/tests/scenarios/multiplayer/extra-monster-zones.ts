import {
  activate, endTurn, expectEvents, expectNotOffered, expectOffered, expectPickOptions, expectRetry,
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
const RULE = "R-COMMON-EMZ";
// The Tag column and Link Infra-Flier controls require C1 on installed P68:
// domain-core/.build/phase1/df-zones/out/01-local-zone-viewer.patch. The integration route includes C1.
// FFA4 shared geometry is proved by df-shared-zones.ts after the current C6 export is installed.
const emz = (card: string) => [null, null, null, null, null, card];

function independentZones(format: Format, right: boolean): Scenario {
  const setup: Scenario["setup"] = { format };
  const steps: Step[] = [];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  const extraZone = right ? "emz1" : "emz0";
  const linkedZone = right ? "m3" : "m1";
  for (const seat of SEATS[format]) {
    setup[seat] = { monsters: [ELF, OX], extra: [SPIDER, IMDUK] };
    state[seat] = { monsters: [ELF, OX], extra: [SPIDER, IMDUK], hand: [] };
  }
  for (const [index, seat] of SEATS[format].entries()) {
    if (index) state[seat] = { ...state[seat], hand: [ELF] };
    steps.push(specialSummon(SPIDER, seat), select({ card: ELF, owner: seat }),
      expectPickOptions([{ seat, label: "Extra Monster Zone (left)" }, { seat, label: "Extra Monster Zone (right)" }], seat),
      // A seat cannot answer with a foreign or absent zone. The real host answer validation keeps the prompt and the board.
      expectRetry({ selected: ["place:99"] }, { by: seat, error: "Invalid" }),
      zone(seat, extraZone, seat), expectEvents({ kind: "summon", card: SPIDER, by: seat, summonKind: "link" }));
    state[seat] = { ...state[seat], monsters: [SPIDER, OX], extra: [IMDUK], grave: [ELF],
      zones: { [extraZone]: SPIDER, [right ? "emz0" : "emz1"]: null } };
    steps.push(everySeat(format, state));
    // With one EMZ occupied, the other is not offered. The Spider arrow opens one Main Monster Zone of this seat only.
    // The core places the monster without a place prompt when just one zone is legal. Check that exact zone below.
    steps.push(specialSummon(IMDUK, seat), select({ card: OX, owner: seat }));
    state[seat] = { ...state[seat], monsters: [SPIDER, IMDUK], extra: [], grave: [ELF, OX],
      zones: { [extraZone]: SPIDER, [linkedZone]: IMDUK, [right ? "emz0" : "emz1"]: null } };
    steps.push(everySeat(format, state));
    if (index < SEATS[format].length - 1) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `emz-${format}-every-seat-${right ? "right" : "left"}-and-own-link-arrow`,
    title: `${format}: every seat uses its own ${right ? "right" : "left"} EMZ and its own linked main zone`,
    source: `${SOURCE} [${RULE}]`, rules: [RULE], tags: ["multiplayer", format, "link", "card:98978921", "card:31226177"], setup, steps });
}

function coLinks(format: Format, actor: Seat): Scenario {
  const setup: Scenario["setup"] = { format };
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    setup[seat] = seat === actor ? { monsters: [ELF, SECURITY], extra: [SPIDER] } : { monsters: [ELF, null, null, null, null, SPIDER] };
    state[seat] = { monsters: seat === actor ? [ELF, SECURITY] : [ELF, SPIDER], extra: seat === actor ? [SPIDER] : [],
      hand: SEATS[format].indexOf(seat) > 0 && SEATS[format].indexOf(seat) <= SEATS[format].indexOf(actor) ? [ELF] : [] };
  }
  const target: Seat = actor === "p0" ? "p1" : "p0";
  const targets = SEATS[format].filter((seat) => seat !== actor && (format !== "tag" || Number(seat[1]) % 2 !== Number(actor[1]) % 2));
  const targetSeats: DuelistId[] = format !== "tag" ? [target] : targets;
  const before = everySeat(format, state);
  state[actor] = { ...state[actor], monsters: [SECURITY, SPIDER], extra: [], grave: [ELF], zones: { m1: SECURITY, emz0: SPIDER } };
  const linked = everySeat(format, state);
  state[target] = { ...state[target], monsters: [SPIDER], hand: [...(state[target]!.hand as string[]), ELF] };
  return defineScenario({ id: `emz-${format}-colink-is-local-${actor}`, title: `${format}: ${actor} gets a co-link only from its own EMZ Spider`,
    source: `${SOURCE} [${RULE}]`, rules: [RULE], tags: ["multiplayer", format, "link", "card:98978921", "card:99111753"], setup,
    steps: [...turnsBefore(format, actor), expectNotOffered("activate", SECURITY, actor), before,
      specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }), zone(actor, "emz0", actor), linked,
      expectOffered("activate", SECURITY, actor), activate(SECURITY, actor),
      expectPickOptions({ include: targets.map((seat) => ({ seat, card: ELF })), exclude: [{ seat: actor }] }, actor),
      select({ card: ELF, owner: target }), everySeat(format, state)],
  });
}

function columns(format: Format): Scenario {
  const setup: Scenario["setup"] = { format };
  const steps: Step[] = [];
  const state: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) {
    setup[seat] = { monsters: emz(SPIDER), hand: [KNIGHT, "Dark Hole"] };
    state[seat] = { monsters: [SPIDER], hand: [KNIGHT, "Dark Hole"] };
  }
  // All seats have a Spider in EMZ 5 (column 1). Those cards give no column to another seat.
  for (const [index, seat] of SEATS[format].entries()) {
    if (index) state[seat] = { ...state[seat], hand: [KNIGHT, "Dark Hole", ELF] };
    steps.push(expectNotOffered("specialSummon", KNIGHT, seat), setCard("Dark Hole", seat), zone(seat, "s1", seat));
    state[seat] = { ...state[seat], spells: ["Dark Hole"], hand: index ? [KNIGHT, ELF] : [KNIGHT] };
    steps.push(expectOffered("specialSummon", KNIGHT, seat), specialSummon(KNIGHT, seat));
    state[seat] = { ...state[seat], monsters: [SPIDER, KNIGHT], hand: index ? [ELF] : [],
      zones: { emz0: SPIDER, m1: KNIGHT, s1: { card: "Dark Hole", pos: "set" } } };
    steps.push(everySeat(format, state));
    if (index < SEATS[format].length - 1) steps.push(endTurn(seat));
  }
  return defineScenario({ id: `emz-${format}-columns-stay-on-each-seat`, title: `${format}: column summons use two cards of the same seat`,
    source: `${SOURCE} [${RULE}]`, rules: [RULE], tags: ["multiplayer", format, "column", "card:28692962"], setup, steps });
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
    source: `${SOURCE} [${RULE}]`, rules: [RULE], tags: ["multiplayer", format, "link", "card:65100616"], setup,
    steps: [...turnsBefore(format, actor), expectNotOffered("specialSummon", FLIER, actor), before,
      specialSummon(SPIDER, actor), select({ card: ELF, owner: actor }),
      // FFA4 has one free EMZ. The host answers that zone prompt automatically.
      ...(format === "ffa4" ? [] : [zone(actor, "emz0", actor)]), linked,
      expectOffered("specialSummon", FLIER, actor), specialSummon(FLIER, actor), everySeat(format, state)],
  });
}

function extraLink(format: Format): Scenario {
  const TRI = "Tri-Gate Wizard";
  const BINARY = "Binary Sorceress";
  const setup: Scenario["setup"] = { format, p0: { monsters: [ELF, TRI, BINARY, TRI, null, SPIDER], extra: [SPIDER] } };
  for (const seat of SEATS[format].slice(1)) setup[seat] = { monsters: emz(SPIDER) };
  return defineScenario({ id: `emz-${format}-second-zone-by-extra-link`, title: `${format}: an Extra Link permits the second own EMZ`,
    source: `${SOURCE} [${RULE}]`, rules: [RULE], tags: ["multiplayer", format, "link", "card:32617464"], setup,
    steps: [specialSummon(SPIDER, "p0"), select({ card: ELF, owner: "p0" }),
      expectPickOptions({ include: [{ seat: "p0", label: "Extra Monster Zone (right)" }],
        exclude: SEATS[format].slice(1).map((seat) => ({ seat })) }, "p0"), zone("p0", "emz1", "p0"),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, seat === "p0"
        ? { monsters: [TRI, BINARY, TRI, SPIDER, SPIDER], extra: [], grave: [ELF], hand: [],
          zones: { m0: null, m1: TRI, m2: BINARY, m3: TRI, emz0: SPIDER, emz1: SPIDER } }
        : { monsters: [SPIDER], hand: [], zones: { emz0: SPIDER, emz1: null } }])) )],
  });
}

const standard = (["ffa3", "tag"] as Format[]).flatMap((format) => [
  independentZones(format, false), independentZones(format, true), coLinks(format, "p0"),
  coLinks(format, format === "ffa3" ? "p2" : "p3"), columns(format), arrowViewer(format, "p0"),
  arrowViewer(format, format === "ffa3" ? "p2" : "p3"), extraLink(format),
]);
export const EXTRA_MONSTER_ZONE_SCENARIOS: Scenario[] = [...standard, ...standard.map(domainVariant)];
