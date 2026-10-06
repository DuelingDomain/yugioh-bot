import { seatCountFor, opponentSeatsOf, type DuelFormat, type DuelMode } from "@yugidraft/shared/duels";
import {
  activate, attack, defineScenario, endTurn, expectBoard, expectEvents, expectNoEvent, expectPrompt, yes,
  type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";

export const JET = "Blue-Eyes Jet Dragon";
export const JET_CODE = 30576089;
export const WHITE = "Blue-Eyes White Dragon";
export const VICTIM = "Zombino";
export const JET_SOURCE = "https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=16809&request_locale=en";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];

export interface JetCase {
  scenario: Scenario;
  owner: number;
  from: "hand" | "grave";
  trigger: "battle" | "effect";
  role: "attacker" | "defender" | "observer";
}

export function jetCase(format: DuelFormat, mode: DuelMode, owner: number, from: JetCase["from"], trigger: JetCase["trigger"], role: JetCase["role"]): JetCase {
  const count = seatCountFor(format);
  const others = Array.from({ length: count }, (_, i) => i).filter((i) => i !== owner);
  const attacker = role === "attacker" ? owner : role === "defender" ? opponentSeatsOf(format, owner)[0]! : others[0]!;
  const opponents = opponentSeatsOf(format, attacker);
  const defender = role === "defender" ? owner : opponents.find((i) => i !== owner)!;
  const holder = SEATS[owner]!;
  const acting = SEATS[attacker]!;
  const target = SEATS[defender]!;
  const setup: Scenario["setup"] = { format, mode, skipOpeningDraw: true, attackFirstTurn: true };
  for (let seat = 0; seat < count; seat++) setup[SEATS[seat]!] = mode === "domain" ? { deckMaster: "Mystical Elf" } : {};
  setup[holder] = { ...setup[holder], hand: from === "hand" ? [JET] : [], grave: [WHITE, ...(from === "grave" ? [JET] : [])] };
  setup[acting] = { ...setup[acting], monsters: [WHITE], ...(trigger === "effect" ? { hand: [...(setup[acting]!.hand ?? []), "Dark Hole"] } : {}) };
  setup[target] = { ...setup[target], monsters: [VICTIM] };
  // Use a full round before the battle: FFA and Tag have separate first-round battle rules.
  const steps: Step[] = [];
  const turns = trigger === "battle" ? count + attacker : attacker;
  for (let turn = 0; turn < turns; turn++) steps.push(endTurn(SEATS[turn % count]!));
  steps.push(trigger === "battle" ? attack(WHITE, { card: VICTIM, owner: target }, acting) : activate("Dark Hole", acting));
  steps.push(
    expectEvents({ kind: "destroy", card: VICTIM, by: target, cause: trigger }),
    expectPrompt({ by: holder }),
    from === "hand" ? activate(JET, holder) : yes(holder),
    expectBoard({ [target]: { grave: { include: [VICTIM] } }, [holder]: { monsters: { include: [JET] }, hand: { exclude: [JET] }, grave: { exclude: [JET], ...(holder === target ? { include: [VICTIM] } : {}) } } }),
    expectEvents({ kind: "activate", card: JET, by: holder }, { kind: "summon", card: JET, by: holder }),
  );
  const scenario = defineScenario({
    id: `jet-${mode}-${format}-p${owner}-${role}-${trigger}-${from}`,
    title: `${format} ${mode}: p${owner} summons Jet from ${from} after ${trigger} destruction (${role})`,
    source: JET_SOURCE,
    tags: ["hand-effects", "jet-dragon", "multiplayer", `card:${JET_CODE}`, format, mode],
    setup, steps,
  });
  return { scenario, owner, from, trigger, role };
}

export const JET_CASES: JetCase[] = (["normal", "domain"] as const).flatMap((mode) =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap((format) =>
    Array.from({ length: seatCountFor(format) }, (_, owner) =>
      (["hand", "grave"] as const).flatMap((from) =>
        (["battle", "effect"] as const).flatMap((trigger) =>
          (format === "1v1" ? ["attacker", "defender"] as const : ["attacker", "defender", "observer"] as const)
            .map((role) => jetCase(format, mode, owner, from, trigger, role))))).flat()));

export const JET_SCENARIOS = JET_CASES.map((entry) => entry.scenario);

/** The reported local duel had White Dragon only in the hand: a destruction is insufficient. */
export const JET_NEGATIVE_SCENARIOS: Scenario[] = (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    Array.from({ length: seatCountFor(format) }, (_, owner) =>
      (["hand", "grave"] as const).flatMap(from => (["battle", "effect"] as const).map(trigger => {
        const entry = jetCase(format, mode, owner, from, trigger, "defender");
        const scenario = entry.scenario;
        const holder = SEATS[owner]!;
        const setup = { ...scenario.setup, [holder]: { ...scenario.setup[holder],
          hand: [WHITE, ...(from === "hand" ? [JET] : [])], grave: from === "grave" ? [JET] : [] } };
        return defineScenario({ ...scenario, id: `${scenario.id}-white-only-in-hand-negative`,
          title: `${format} ${mode}: p${owner} cannot summon Jet with White Dragon only in hand`, setup,
          steps: [...scenario.steps.slice(0, scenario.steps.findIndex(s => s.op === "expectPrompt")),
            expectNoEvent({ kind: "activate", card: JET, by: holder }),
            expectBoard({ [holder]: { monsters: { exclude: [JET] }, hand: { include: [WHITE, ...(from === "hand" ? [JET] : [])] },
              grave: { include: [VICTIM, ...(from === "grave" ? [JET] : [])] } } })] });
      }))).flat()));

export const JET_NO_DESTRUCTION_SCENARIOS: Scenario[] = (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
    Array.from({ length: seatCountFor(format) }, (_, owner) => {
      const entry = jetCase(format, mode, owner, "hand", "battle", "defender");
      const holder = SEATS[owner]!;
      const attacker = SEATS[opponentSeatsOf(format, owner)[0]!]!;
      const setup = { ...entry.scenario.setup, [attacker]: { ...entry.scenario.setup[attacker], monsters: ["Axe Raider"] },
        [holder]: { ...entry.scenario.setup[holder], monsters: [{ card: WHITE, pos: "def" as const }] } };
      return defineScenario({ ...entry.scenario, id: `${entry.scenario.id}-no-destruction-negative`,
        title: `${format} ${mode}: an attack without destruction does not trigger Jet`, setup,
        steps: [...entry.scenario.steps.filter(s => s.op === "phase"),
          attack("Axe Raider", { card: WHITE, owner: holder }, attacker),
          expectNoEvent({ kind: "destroy" }), expectNoEvent({ kind: "activate", card: JET, by: holder }),
          expectBoard({ [holder]: { monsters: [WHITE], hand: { include: [JET] } } })] });
    })));
