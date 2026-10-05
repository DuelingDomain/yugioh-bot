// R-FFA-ACTIVATED-LOCK: Red Reboot saves the trap activator as its opponent for the rest of the turn; Tag keeps the opposing-team lock.
import {
  activate, defineScenario, expectBoard, expectOffered, expectPrompt, faceDown, pass,
  type BoardExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";
const REBOOT = "Red Reboot";
const WABOKU = "Waboku";
const ROAR = "Threatening Roar";
const POT = "Pot of Greed";
const CURE = "Dian Keto the Cure Master";
const ELF = "Mystical Elf";

function lastingTrap(format: Format): Scenario {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const setup: Record<string, unknown> = { format };
  const board: BoardExpect = {};
  for (const seat of seats) {
    const draws = seat === "p0" ? 2 : 0;
    const usedWaboku = seat === "p2" || (format === "ffa4" && seat === "p3");
    setup[seat] = {
      deck: Array.from({ length: 20 }, () => ELF),
      ...(seat === "p0" ? { hand: [POT, CURE], spells: [faceDown(REBOOT)] } : {
        spells: seat === "p1" ? [faceDown(WABOKU), faceDown(ROAR)] : [faceDown(WABOKU)],
      }),
    };
    board[seat] = {
      lp: format === "tag" ? (seat === "p0" || seat === "p2" ? 17000 : 16000) : seat === "p0" ? 9000 : 8000,
      monsters: [],
      spells: seat === "p1" ? [WABOKU, ROAR] : format === "tag" && seat === "p3" ? [WABOKU] : [],
      grave: seat === "p0" ? [POT, REBOOT, CURE] : usedWaboku ? [WABOKU] : [],
      banished: [],
      hand: Array.from({ length: draws }, () => ELF),
      deckCount: 20 - draws,
    };
  }
  const steps: Step[] = [
    activate(POT, "p0"),
    activate(WABOKU, "p1"),
    // Pass the seats between p1 and p0 before p0 counters the Trap activation.
    pass("p2"),
    ...(format === "ffa4" ? [pass("p3")] : []),
    activate(REBOOT, "p0"),
    // These real response prompts are after Red Reboot resolves. Its lasting lock must spare the other FFA seats and the Tag partner.
    pass("p2"),
    ...(format === "ffa4" ? [pass("p3")] : []),
    activate(CURE, "p0"),
    // p1 still has two traps that could respond. Reaching p2 directly proves that the saved p1 lock remains in the next chain.
    expectOffered("activate", WABOKU, "p2"),
    activate(WABOKU, "p2"),
    ...(format === "ffa4" ? [expectOffered("activate", WABOKU, "p3"), activate(WABOKU, "p3")] : []),
    expectPrompt({ by: "p0", context: "action", offers: ["to_ep"] }),
    expectBoard(board),
  ];
  return defineScenario({
    id: `lasting-trap-proof-${format}-red-reboot-locks-p1-and-spares-other-seats`,
    title: `${format.toUpperCase()}: Red Reboot locks the trap activator p1 for the turn and permits the other ${format === "tag" ? "team's partner" : "opponents"} to activate Waboku`,
    source: `${SOURCE} [R-FFA-ACTIVATED-LOCK], owner decision 2026-10-02`,
    rules: ["R-FFA-ACTIVATED-LOCK", "R-FFA-OPP-ONE", ...(format === "tag" ? ["R-TAG-PARTNER", "R-TAG-LP"] : [])],
    tags: ["multiplayer", "lasting-trap", format, "card:23002292"],
    setup: setup as Scenario["setup"],
    steps,
  });
}

export const LASTING_TRAP_PROOF_SCENARIOS: Scenario[] = [lastingTrap("ffa3"), lastingTrap("ffa4"), lastingTrap("tag")];
