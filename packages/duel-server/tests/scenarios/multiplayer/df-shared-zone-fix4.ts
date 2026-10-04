import { activate, defineScenario, endTurn, expectNotOffered, expectPickOptions, expectPrompt, pickOpponent, pass, position, select, yes, zone, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";
import { everySeat, SEATS, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const ELF = "Mystical Elf", CROWN = "Magical Musket - Crooked Crown", MUSKET = "Magical Musketeer Calamity";
const SCUFFLE = "Small Scuffle", LOW = "Watapon", PARANOIA = "Distrust Paranoia";
function cases(mode: "standard" | "domain"): Scenario[] {
  const opening = mode === "domain" ? [ELF] : [];
  function state(actor: Seat = "p0"): Record<Seat, DuelistExpect> {
    const result = {} as Record<Seat, DuelistExpect>;
    for (const [i, seat] of SEATS.ffa4.entries()) {
      const drawn = i <= Number(actor[1]) && (i > 0 || mode === "domain");
      result[seat] = { hand: drawn ? [ELF] : [], deckCount: drawn ? 19 : 20, extra: [], monsters: [], spells: [], grave: [], banished: [] };
    }
    return result;
  }
  function scenario(id: string, setup: Scenario["setup"], steps: Step[]): Scenario {
    const s = defineScenario({ id: `df-shared-zones-ffa4-review4-${id}`, title: id.replaceAll("-", " "), source: SOURCE,
      // A starting legality check has no action outcome. Keep it as a negative control.
      rules: id === "small-scuffle-side-zones-cannot-supply-column" ? [] : ["R-FFA-ACROSS-EMZ"], tags: ["multiplayer", "ffa4", "column", "ffa-first-draw-included"], setup: { ...setup, format: "ffa4", mode: mode === "domain" ? "domain" : "normal" }, steps });
    return mode === "domain" ? domainVariant(s) : s;
  }
  function crown(caller: "p1" | "p2"): Scenario {
    const haunted = "Call of the Haunted", board = state();
    board.p0 = { ...board.p0, lp: 8000, monsters: [MUSKET], spells: [CROWN], hand: opening, grave: [], zones: { m1: MUSKET, s1: CROWN } };
    board[caller] = { ...board[caller], monsters: [ELF], spells: [haunted], zones: { m0: ELF, s0: haunted } };
    return scenario(`crooked-crown-${caller}-summon-zone`, { p0: { spells: [null, CROWN], hand: [MUSKET] }, [caller]: { spells: [{ card: haunted, pos: "set" }], grave: [ELF] } }, [
      activate(CROWN, "p0"), pass(caller), zone("p0", "m1", "p0"), pickOpponent(caller, "p0"), activate(haunted, caller),
      expectPickOptions([0, 1, 2, 3, 4].filter(i => caller !== "p2" || i !== 3).map(i => ({ seat: caller, label: `Monster Zone ${i + 1}` })), caller),
      zone(caller, "m0", caller), expectPrompt({ by: "p0", context: "action" }), everySeat("ffa4", board),
    ]);
  }
  function scuffle(side: boolean, removed = false, fromHand = false): Scenario {
    const board = state();
    if (side) {
      board.p0 = { ...board.p0, hand: [LOW, ...opening], spells: [SCUFFLE] };
      board.p1 = { ...board.p1, hand: [LOW] };
      board.p2 = { ...board.p2, monsters: Array(5).fill(ELF), hand: [LOW] };
      return scenario("small-scuffle-side-zones-cannot-supply-column", { p0: { spells: [{ card: SCUFFLE, pos: "set" }], hand: [LOW] }, p1: { hand: [LOW] }, p2: { monsters: Array(5).fill(ELF), hand: [LOW] } }, [expectNotOffered("activate", SCUFFLE, "p0"), everySeat("ffa4", board)]);
    }
    board.p0 = { ...board.p0, hand: opening, monsters: [LOW], spells: [], grave: fromHand ? [SCUFFLE, "Dark Hole", "Makyura the Destructor"] : [SCUFFLE], zones: { m1: LOW } };
    board.p1 = { ...board.p1, hand: [LOW] };
    board.p2 = { ...board.p2, monsters: [LOW], zones: { m3: LOW } };
    board.p3 = { ...board.p3, hand: [LOW] };
    if (removed) board.p1 = { ...board.p1, grave: ["Mystical Space Typhoon"] };
    return scenario(`small-scuffle-across-${removed ? "removed-trap-" : fromHand ? "hand-trap-" : ""}summon-column`, { p0: fromHand ? { monsters: ["Makyura the Destructor"], hand: ["Dark Hole", SCUFFLE, LOW] } : { spells: [{ card: SCUFFLE, pos: "set" }], hand: [LOW] }, p1: { hand: [LOW], ...(removed ? { spells: [{ card: "Mystical Space Typhoon", pos: "set" as const }] } : {}) }, p2: { hand: [LOW] }, p3: { hand: [LOW] } }, [
      ...(fromHand ? [activate("Dark Hole", "p0"), zone("p0", "s0", "p0"), yes("p0")] : []), activate(SCUFFLE, "p0"), ...(fromHand ? [zone("p0", "s0", "p0")] : []), zone("p0", "m1", "p0"), ...(removed ? [activate("Mystical Space Typhoon", "p1")] : []), position("atk", "p0"), yes("p2"), position("atk", "p2"),
      expectPrompt({ by: "p0", context: "action" }), everySeat("ffa4", board),
    ]);
  }
  function paranoia(caller: "p1" | "p2"): Scenario {
    const twisters = "Twin Twisters", raigeki = "Raigeki", board = state(caller);
    board.p0 = { ...board.p0, monsters: caller === "p2" ? [PARANOIA] : [], grave: caller === "p1" ? [PARANOIA] : [], zones: { m1: caller === "p2" ? { card: PARANOIA, attack: 4000 } : null } };
    board.p1 = { ...board.p1, hand: [], grave: [twisters, ELF, ...(caller === "p1" ? [raigeki] : [])] };
    board[caller] = { ...board[caller], hand: caller === "p1" ? [] : [ELF], grave: caller === "p1" ? [twisters, ELF, raigeki] : [raigeki] };
    return scenario(`distrust-paranoia-${caller}-immune-value`, { p0: { spells: [null, { card: PARANOIA, pos: "set" }] }, p1: { hand: [twisters, ...(caller === "p1" ? [raigeki] : [])] }, ...(caller === "p2" ? { p2: { hand: [raigeki] } } : {}) }, [
      endTurn("p0"), activate(twisters, "p1"), ...(caller === "p1" ? [select({ card: ELF, owner: "p1", from: "hand" })] : []), yes("p0"), zone("p0", "m1", "p0"),
      ...(caller === "p2" ? [endTurn("p1")] : []), activate(raigeki, caller), zone(caller, "s3", caller),
      expectPrompt({ by: caller, context: "action" }), everySeat("ffa4", board),
    ]);
  }
  return [crown("p1"), crown("p2"), scuffle(true), scuffle(false), scuffle(false, true), scuffle(false, false, true), paranoia("p1"), paranoia("p2")];
}
export const DF_SHARED_ZONE_FIX4_SCENARIOS = [...cases("standard"), ...cases("domain")];
