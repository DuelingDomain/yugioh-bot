// Monster Rebirth (54564198): a battle destruction enables the Trap at every seat.
// The holder sends its own Monster Reborn to the GY and revives the destroyed
// monster on its own field. Check every seat, including both Tag LP entries.
import { activate, attack, defineScenario, endTurn, expectOffered, expectPrompt, expectTurn, faceDown, pass, select, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, PARTNER, SEATS, type Format, type Seat } from "./seat-kit.js";

const CARD = "Monster Rebirth";
const REBORN = "Monster Reborn";
const DRAGON = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";

function rebirth(format: Format, holder: Seat): Scenario {
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [], deckCount: seat === holder ? 19 : 20 };
  spec.p0 = { ...spec.p0, monsters: [DRAGON], grave: ["Battle Ox"] };
  spec[holder] = { ...spec[holder], monsters: [...(holder === "p0" ? [DRAGON] : []), ELF], grave: [CARD, REBORN] };
  spec.p1 = { ...spec.p1, lp: baseLp(format) - 2200 };
  if (format === "tag") spec[PARTNER.p1] = { ...spec[PARTNER.p1], lp: baseLp(format) - 2200 };
  return defineScenario({
    id: `monster-rebirth-${format}-${holder}-revives-after-p1-battle-destruction`,
    title: `${label(format)}: ${holder} uses Monster Rebirth after p1 loses a monster by battle`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] a global battle flag reaches every seat and each Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:54564198"],
    setup: baseSetup(format, {
      p0: { monsters: [DRAGON], grave: ["Battle Ox"] }, p1: { monsters: [ELF] },
      [holder]: { ...(holder === "p0" ? { monsters: [DRAGON] } : holder === "p1" ? { monsters: [ELF] } : {}), spells: [faceDown(CARD)], deck: [REBORN] },
    }),
    steps: [
      attack(DRAGON, { card: ELF, owner: "p1" }, "p0"),
      endTurn("p0"),
      activate(CARD, holder),
      select({ card: ELF, owner: "p1", from: "grave" }),
      everySeat(format, spec),
    ],
  });
}

function noBattle(format: Format, holder: Seat): Scenario {
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p1" ? [ELF] : [], deckCount: seat === "p1" ? 19 : 20 };
  spec[holder] = { ...spec[holder], spells: [CARD], grave: [ELF] };
  return defineScenario({
    id: `monster-rebirth-${format}-${holder}-no-battle-destruction-stays-set`,
    title: `${label(format)}: Monster Rebirth stays Set when no monster was destroyed by battle`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the battle flag is absent until a real battle destruction`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:54564198"],
    setup: baseSetup(format, { [holder]: { spells: [faceDown(CARD)], grave: [ELF], deck: [REBORN] } }),
    steps: [endTurn("p0"), expectTurn("p1", 2), expectPrompt({ by: "p1", context: "action" }), everySeat(format, spec)],
  });
}

function reset(): Scenario {
  const first = rebirth("ffa3", "p2");
  return defineScenario({
    ...first,
    id: "monster-rebirth-ffa3-p2-battle-flag-clears-next-turn",
    title: "FFA3: Monster Rebirth is offered after battle and cannot activate in the next turn",
    steps: [
      attack(DRAGON, { card: ELF, owner: "p1" }, "p0"), endTurn("p0"),
      expectOffered("activate", CARD, "p2"), pass("p2"), pass("p2"), pass("p2"), pass("p2"),
      expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", {
        p0: { hand: [], deckCount: 20, monsters: [DRAGON], grave: ["Battle Ox"] },
        p1: { hand: [ELF], deckCount: 19, grave: [ELF], lp: 5800 },
        p2: { hand: [], deckCount: 20, spells: [CARD] },
      }),
    ],
  });
}

export const MONSTER_REBIRTH_SCENARIOS: Scenario[] = [
  rebirth("ffa3", "p1"), rebirth("ffa3", "p2"),
  rebirth("ffa4", "p2"), rebirth("ffa4", "p3"),
  rebirth("tag", "p2"), rebirth("tag", "p3"),
  noBattle("ffa3", "p2"), noBattle("ffa4", "p3"), noBattle("tag", "p3"), reset(),
];
