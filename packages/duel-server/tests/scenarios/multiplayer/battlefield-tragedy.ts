// Battlefield Tragedy (42228966): a battle between two monsters disables the
// Main Phase 2 Set effect and makes the turn player mill five at the End Phase.
// With no such battle the holder can discard and Set its second copy instead.
import { activate, attack, changePhase, defineScenario, endTurn, expectNotOffered, expectPrompt, expectTurn, select, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, PARTNER, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const CARD = "Battlefield Tragedy";
const DRAGON = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";

function tragedy(format: Format, holder: Seat, battled: boolean): Scenario {
  const seats = SEATS[format];
  const actorIndex = seats.indexOf(holder);
  const next = seats[(actorIndex + 1) % seats.length]!;
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const draws = Number(seat !== "p0" && seats.indexOf(seat) <= actorIndex) + Number(seat === next);
    spec[seat] = { hand: Array.from({ length: draws }, () => ELF), deckCount: 20 - draws };
  }
  spec.p0 = { ...spec.p0, ...(battled ? { grave: [ELF], lp: baseLp(format) - 2200 } : { monsters: [ELF] }) };
  if (battled && format === "tag") spec[PARTNER.p0] = { ...spec[PARTNER.p0], lp: baseLp(format) - 2200 };
  spec[holder] = {
    ...spec[holder], monsters: [DRAGON], hand: Array.from({ length: battled ? 2 : 1 }, () => ELF),
    spells: battled ? [CARD] : [CARD, CARD],
    grave: Array.from({ length: battled ? 5 : 1 }, () => ELF), deckCount: battled ? 14 : 18,
  };
  const steps: Step[] = [...turnsBefore(format, holder)];
  if (battled) steps.push(attack(DRAGON, { card: ELF, owner: "p0" }, holder));
  else steps.push(changePhase("battle", holder));
  steps.push(changePhase("main2", holder));
  if (battled) steps.push(expectNotOffered("activate", CARD, holder));
  else steps.push(activate(CARD, holder), select({ card: ELF, owner: holder, from: "hand", nth: 0 }));
  steps.push(endTurn(holder), expectTurn(next), everySeat(format, spec));
  return defineScenario({
    id: `battlefield-tragedy-${format}-${holder}-${battled ? "battle-mills-own-deck" : "no-battle-sets-copy-no-mill"}`,
    title: `${label(format)}: ${holder} ${battled ? "battles, cannot Set another copy, and mills five" : "does not battle, Sets a second copy, and does not mill"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global battle flag reaches every seat and each Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:42228966"],
    setup: baseSetup(format, {
      p0: { monsters: [ELF] },
      [holder]: { monsters: [DRAGON], spells: [CARD], hand: [ELF], deck: battled ? [...Array.from({ length: 6 }, () => ELF), CARD] : [ELF, CARD] },
    }),
    steps,
  });
}

function reset(): Scenario {
  const first = tragedy("ffa3", "p2", true);
  const last = first.steps.at(-1)!;
  if (last.op !== "expectBoard") throw new Error("Battlefield Tragedy needs a final board");
  return defineScenario({
    ...first,
    id: "battlefield-tragedy-ffa3-p2-battle-flag-clears-before-next-end-phase",
    title: "FFA3: Battlefield Tragedy mills p2 after the battle and does not mill p0 in the next turn",
    steps: [
      ...first.steps.slice(0, -1), endTurn("p0"), expectPrompt({ by: "p1", context: "action" }),
      everySeat("ffa3", { ...last.board, p1: { ...last.board.p1, hand: [ELF, ELF], deckCount: 18 } }),
    ],
  });
}

export const BATTLEFIELD_TRAGEDY_SCENARIOS: Scenario[] = [
  tragedy("ffa3", "p2", true), tragedy("ffa4", "p3", true), tragedy("tag", "p1", true), tragedy("tag", "p3", true),
  tragedy("ffa3", "p2", false), tragedy("ffa4", "p3", false), tragedy("tag", "p3", false),
  reset(),
];
