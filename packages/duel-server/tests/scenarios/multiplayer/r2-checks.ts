// Live scenarios of cards that the R2 triage lists as working without a change, and that nobody had run yet (Raging Cloudian
// 23639291, Ancient Gear Castle 92001300, War Rock Skyler 72554862). Plain data (scripts/rule-coverage.ts reads it); r2-checks.test.ts runs it on a
// live core (NSEAT_LIVE=1) with the real card scripts and the overlay. Every scenario ends with the state of EVERY seat.

import {
  activate, attack, changePhase, changePosition, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, faceDown, normalSummon, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const TUALATIN = "Tualatin";
const OX = "Battle Ox"; // 1700 ATK
const SKULL = "Summoned Skull"; // 2500 ATK
const SKYLER = "War Rock Skyler"; // 2200 ATK, +100 per monster of the opponents
const ELF = "Mystical Elf"; // 800 ATK
const ALTUS = "Cloudian - Altus"; // destroys itself in face-up Defense Position
const RAGING = "Raging Cloudian";
const CASTLE = "Ancient Gear Castle";
const BEAST = "Ancient Gear Beast"; // Level 6, 2000 ATK

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER]`;

const tualatin = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const attacker: Seat = "p1";
  // FFA3: p1 attacks in turn 5 (every duelist has had a turn). Tag: p1 attacks in its second turn, the field of a team is shared
  const toBattle: Step[] = tag ? [endTurn("p0"), endTurn("p1"), endTurn("p2"), endTurn("p3"), endTurn("p0")] : [endTurn("p0"), endTurn("p1"), endTurn("p2"), endTurn("p0")];
  return defineScenario({
    id: `r2-checks-${format}-tualatin-offered-only-to-the-${tag ? "team" : "seat"}-whose-monsters-were-all-destroyed`,
    title: tag
      ? "Tag: p1 destroys both monsters of the team of p0 in battle: Tualatin of p0 is offered and Special Summoned, the Tualatin of the opposing partner p3 stays in the hand"
      : "FFA3: p1 destroys both monsters of p0 in battle: Tualatin of p0 is offered and Special Summoned, Tualatin of p2 (its monsters stay) stays in the hand",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2-checks", format, "card:27769400"],
    setup: (tag
      ? {
          format,
          p0: { hand: [TUALATIN], monsters: [ELF, ELF], deck: [ELF] },
          p1: { monsters: [OX, OX], deck: [ELF, ELF] },
          p2: { deck: [ELF] },
          p3: { hand: [TUALATIN], deck: [ELF] },
        }
      : {
          format,
          p0: { hand: [TUALATIN], monsters: [ELF, ELF], deck: [ELF] },
          p1: { monsters: [OX, OX], deck: [ELF, ELF] },
          p2: { hand: [TUALATIN], monsters: [ELF, ELF], deck: [ELF] },
        }) as unknown as Scenario["setup"],
    steps: [
      ...toBattle,
      changePhase("battle", attacker),
      attack({ card: OX, nth: 0 }, { card: ELF, owner: "p0", nth: 0 }, attacker),
      attack({ card: OX, nth: 0 }, { card: ELF, owner: "p0", nth: 0 }, attacker),
      expectOffered("activate", TUALATIN, "p0"),
      activate(TUALATIN, "p0"),
      // Tualatin is Special Summoned; its forced trigger asks p0 for an Attribute: EARTH destroys the two Battle Ox of p1 (the LIGHT Elves of p2 stay)
      zone("p0", "m0", "p0"),
      choose("Face-up Attack", "p0"),
      choose("EARTH", "p0"),
      everySeat(format, tag
        ? { p0: { lp: 14200, monsters: [TUALATIN], grave: [ELF, ELF] }, p1: { grave: [OX, OX] }, p2: { lp: 14200 }, p3: { hand: [TUALATIN, ELF] } }
        : { p0: { lp: 6200, monsters: [TUALATIN], grave: [ELF, ELF] }, p1: { grave: [OX, OX] }, p2: { monsters: [ELF, ELF], hand: [TUALATIN, ELF] } }),
    ],
  });
};

/**
 * Raging Cloudian (a global watcher, registered with Duel.RegisterEffect(e,0)): the Cloudian monster of a duelist is destroyed by its own effect
 * (Cloudian - Altus destroys itself in face-up Defense Position). Only the Raging Cloudian of THAT duelist is offered; it Special Summons the
 * monster back. The other two duelists each hold a Raging Cloudian, and none is asked.
 */
const raging = (format: "ffa3" | "ffa4", holder: Seat): Scenario => {
  const seats = seatsOf(format);
  const before: Step[] = seats.slice(0, seats.indexOf(holder)).map((seat) => endTurn(seat));
  const setup: Record<string, unknown> = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    setup[seat] = { monsters: seat === holder ? [ALTUS] : [], spells: [faceDown(RAGING)], deck: [ELF] };
    spec[seat] = seat === holder ? { grave: [RAGING], monsters: [ALTUS] } : { spells: [RAGING] };
  }
  return defineScenario({
    id: `r2-checks-${format}-raging-cloudian-only-the-seat-of-the-destroyed-cloudian-is-offered-${holder}`,
    title: `${format.toUpperCase()}: Cloudian - Altus of ${holder} destroys itself in Defense Position: Raging Cloudian of ${holder} is offered and Special Summons it in Attack Position, the Raging Cloudian of every other seat stays Set and is not asked`,
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2-checks", format, "card:23639291"],
    setup: setup as unknown as Scenario["setup"],
    steps: [
      ...before,
      changePosition(ALTUS, holder),
      // expectOffered also checks that the open prompt is for the holder, so no other seat was asked first
      expectOffered("activate", RAGING, holder),
      activate(RAGING, holder),
      expectPrompt({ by: holder, context: "action" }),
      everySeat(format, spec),
    ],
  });
};

/**
 * War Rock Skyler: +100 ATK per monster the opponents control (value function, c:GetControler() and "0, MZONE"). p0 (2200 ATK) attacks the
 * Summoned Skull (2500 ATK) of p1: the opponents (p1 and p2, in Tag the team p1 and p3) control 4 monsters in all, so the ATK is 2600, the Skull is
 * destroyed and p1 loses 100 LP. With the monsters of ONE opponent only (2) the ATK would be 2400 and Skyler would be destroyed.
 */
const skyler = (format: Format): Scenario => {
  const tag = format === "tag";
  const third: Seat = tag ? "p3" : "p2";
  const setup: Record<string, unknown> = {
    format,
    p0: { monsters: [SKYLER], deck: [ELF] },
    p1: { monsters: [SKULL, ELF], deck: [ELF, ELF] },
    p2: { deck: [ELF] },
  };
  setup[third] = { monsters: [OX, ELF], deck: [ELF] };
  if (format === "ffa4") setup.p3 = { deck: [ELF] };
  const seats = seatsOf(format);
  const toBattle: Step[] = seats.map((seat) => endTurn(seat));
  const spec: Partial<Record<Seat, DuelistExpect>> = {
    p0: { monsters: [SKYLER] },
    p1: { lp: tag ? 15900 : 7900, monsters: [ELF], grave: [SKULL] },
  };
  if (!tag) spec.p2 = { monsters: [OX, ELF] };
  if (tag) {
    spec.p0 = { monsters: [SKYLER] };
    spec.p2 = {};
    spec.p3 = { lp: 15900, monsters: [OX, ELF] };
  }
  return defineScenario({
    id: `r2-checks-${format}-war-rock-skyler-counts-the-monsters-of-every-opponent`,
    title: `${format.toUpperCase()}: War Rock Skyler of p0 gains 100 ATK for every monster of ALL opponents (4: 2600 ATK), attacks the Summoned Skull (2500) of p1: the Skull is destroyed and p1 loses 100 LP, Skyler stays`,
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2-checks", format, "card:72554862"],
    setup: setup as unknown as Scenario["setup"],
    steps: [
      ...toBattle,
      changePhase("battle", "p0"),
      attack({ card: SKYLER }, { card: SKULL, owner: "p1" }, "p0"),
      everySeat(format, spec),
    ],
  });
};

/**
 * Ancient Gear Castle: the Tribute-by-Castle summon procedure is one GLOBAL field effect (range of both hands) that looks only at the Castle in the
 * Spell/Trap Zone of the SUMMONING duelist (c:GetControler(), "LOCATION_SZONE, 0"). p0 plays the Castle and gets a counter from a Normal Summon. The
 * opponents hold an Ancient Gear Beast (Level 6, one Tribute) and no monster: they are NOT offered the Tribute Summon through the Castle of p0 in their
 * turns. p0 itself is offered it, releases the Castle and summons the Beast.
 */
const castle = (format: "ffa3" | "ffa4"): Scenario => {
  const seats = seatsOf(format);
  const opponents = seats.filter((seat) => seat !== "p0");
  const setup: Record<string, unknown> = { format, p0: { hand: [CASTLE, ELF, BEAST], deck: [ELF, ELF] } };
  for (const seat of opponents) setup[seat] = { hand: [BEAST], deck: [ELF, ELF] };
  const steps: Step[] = [activate(CASTLE, "p0"), normalSummon(ELF, "p0"), endTurn("p0")];
  for (const seat of opponents) steps.push(expectNotOffered("tributeSummon", BEAST, seat), endTurn(seat));
  steps.push(expectOffered("tributeSummon", BEAST, "p0"), normalSummon(BEAST, "p0"), choose("Tribute \"Ancient Gear Castle\" to Tribute Summon", "p0"));
  const spec: Partial<Record<Seat, DuelistExpect>> = { p0: { monsters: [ELF, BEAST], grave: [CASTLE] } };
  return defineScenario({
    id: `r2-checks-${format}-ancient-gear-castle-serves-only-its-own-controller`,
    title: `${format.toUpperCase()}: the Ancient Gear Castle of p0 (1 counter) is not used for the Tribute Summon of an Ancient Gear Beast by any opponent; p0 is offered it, releases the Castle and summons the Beast`,
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "r2-checks", format, "card:92001300", "card:10509340"],
    setup: setup as unknown as Scenario["setup"],
    steps: [...steps, everySeat(format, spec)],
  });
};

export const R2_CHECK_SCENARIOS: Scenario[] = [castle("ffa3"), castle("ffa4"), skyler("ffa3"), skyler("tag"), tualatin("ffa3"), tualatin("tag"), raging("ffa3", "p0"), raging("ffa3", "p1"), raging("ffa3", "p2"), raging("ffa4", "p3")];
