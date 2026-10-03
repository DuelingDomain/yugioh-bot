import { describe, expect, it } from "vitest";
import { seatCountFor } from "@yugidraft/shared/duels";
import { outcomeAsserts } from "../../../scripts/rule-coverage.js";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { ATTACK_FLAG_SCENARIOS } from "./attack-flag-cards.js";
import { DEMISE_LORD_SCENARIOS } from "./demise-lord.js";
import { domainVariant } from "./domain-variants.js";
import { EVENT_BINDING_SCENARIOS } from "./event-binding-staples.js";
import { FLAG_ATK_SCENARIOS } from "./flag-atk-cards.js";
import { FOOLISH_TRAP_HOLE_SCENARIOS } from "./foolish-trap-hole.js";
import { LP_PAIR_SCENARIOS } from "./lp-pair-cards.js";
import { MEMENTO_FLAG_SCENARIOS } from "./memento-flags.js";
import { REBIRTH_EMPERORS_SCENARIOS, rebirthEmperorsDomainVariant } from "./rebirth-emperors.js";
import { TRUE_DRACO_SCENARIOS } from "./true-draco-heritage.js";
import { UTOPIA_SCENARIOS } from "./utopia-envoy.js";

// The cross-seat card proofs (Rebirth of the Seventh Emperors, the LP pair cards, Foolish Trap Hole, the flag and ATK cards, the Mementotlan cards,
// Invincible Demise Lord, the attack count cards, True Draco Heritage, Utopia the Envoy of Light, and the event-binding staples) in a real Domain duel: each scenario runs
// again with mode "domain" and a Deck Master for each seat, on the Domain multi core, with the same steps and the same end state of every seat.
const SOURCES = [
  ...DEMISE_LORD_SCENARIOS, ...REBIRTH_EMPERORS_SCENARIOS, ...LP_PAIR_SCENARIOS, ...FOOLISH_TRAP_HOLE_SCENARIOS, ...FLAG_ATK_SCENARIOS, ...MEMENTO_FLAG_SCENARIOS,
  ...ATTACK_FLAG_SCENARIOS, ...TRUE_DRACO_SCENARIOS, ...UTOPIA_SCENARIOS, ...EVENT_BINDING_SCENARIOS,
];
const variants = SOURCES.map((scenario) => REBIRTH_EMPERORS_SCENARIOS.includes(scenario)
  ? rebirthEmperorsDomainVariant(scenario)
  : domainVariant(scenario));

describeWithCores("live Domain duel cross-seat card scenarios (a Deck Master for each seat)", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/cross-fixes-domain", variants);
});

describe("Domain cross-seat card scenario list", () => {
  it("includes every Demise Lord scenario in the Domain runs", () => {
    expect(variants.map((s) => s.id)).toEqual(expect.arrayContaining(DEMISE_LORD_SCENARIOS.map((s) => `${s.id}-domain`)));
  });
  it("has one Domain variant for each scenario, with unique ids, a Deck Master for each seat, a rule, an outcome after an action and a card tag", () => {
    expect(variants.length).toBe(SOURCES.length);
    expect(new Set(variants.map((s) => s.id)).size).toBe(variants.length);
    for (const s of variants) {
      const format = s.setup.format ?? "1v1";
      expect(s.setup.mode, s.id).toBe("domain");
      expect(seatCountFor(format), s.id).toBeGreaterThan(2);
      for (const seat of (["p0", "p1", "p2", "p3"] as const).slice(0, seatCountFor(format))) expect(s.setup[seat]?.deckMaster, `${s.id} ${seat}`).toBeTruthy();
      expect(s.rules?.length, s.id).toBeGreaterThan(0);
      expect(outcomeAsserts(s.steps), s.id).toBe(true);
      expect(s.tags.some((tag) => /^card:\d+$/.test(tag)), s.id).toBe(true);
    }
  });
});
