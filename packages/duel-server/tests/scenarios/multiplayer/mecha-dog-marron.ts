import { attack, defineScenario, endTurn, expectBoard, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Format = "ffa3" | "ffa4" | "tag";
const seat = (i: number) => `p${i}` as DuelistId;

function battleDamage(format: Format, actor: 0 | 1): Scenario {
  const n = format === "ffa3" ? 3 : 4;
  const attacker = actor === 0 ? 1 : 0;
  const setup: Scenario["setup"] = { format };
  const board: BoardExpect = {};
  for (let i = 0; i < n; i++) {
    setup[seat(i)] = {
      ...(i === actor ? { monsters: [{ card: "Mecha-Dog Marron", pos: "def" }] } : {}),
      ...(i === attacker ? { monsters: ["Battle Ox"] } : {}),
      ...(format === "tag" && i >= 2 ? { hand: ["Beaver Warrior"] } : {}),
    };
    board[seat(i)] = {
      lp: format === "tag" ? 14000 : 7000,
      hand: { count: (actor === 0 && i === attacker ? 2 : 1) + (format === "tag" && i >= 2 ? 1 : 0) },
      monsters: i === attacker ? ["Battle Ox"] : [], spells: [],
      grave: i === actor ? ["Mecha-Dog Marron"] : [], banished: [],
    };
  }
  const steps: Step[] = Array.from({ length: actor === 0 ? n + 1 : n }, (_, i) => endTurn(seat(i % n)));
  steps.push(attack("Battle Ox", { card: "Mecha-Dog Marron", owner: seat(actor) }, seat(attacker)), expectBoard(board));
  return defineScenario({
    id: `mecha-dog-marron-${format}-p${actor}-battle-damage-every-side`,
    title: "After battle destruction, each living duelist takes 1000 damage; each Tag team takes 2000",
    source: `${SOURCE} [R-COMMON-EACH-PLAYER]`, rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "mecha-dog-marron", format, "card:94667532"], setup, steps,
  });
}

export const MECHA_DOG_MARRON_SCENARIOS = [battleDamage("ffa3", 0), battleDamage("ffa4", 0), battleDamage("tag", 0), battleDamage("tag", 1)];
