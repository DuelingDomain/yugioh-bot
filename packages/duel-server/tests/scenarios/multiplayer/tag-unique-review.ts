// Review 5a: one unique card per Tag team. All actions and prompts run on the real core.
// Gagaga Magician tests the Monster Zone. Field Barrier tests the Spell and Trap Zone.
// Each outcome checks all seats. A face-down copy does not prevent a face-up copy.
import {
  activate, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, faceDown,
  normalSummon, setCard,
  type BoardExpect, type DuelistExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const MAGICIAN = "Gagaga Magician";
const BARRIER = "Field Barrier";
const POT = "Pot of Greed";
const ELF = "Mystical Elf";
const HOLE = "Dark Hole";
const BEAVER = "Beaver Warrior";
const OX = "Battle Ox";
type Format = "tag" | "ffa3" | "ffa4";

function everySeat(format: Format, states: Partial<Record<DuelistId, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, format === "ffa3" ? 3 : 4)) {
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [], monsters: [], spells: [], grave: [], banished: [], extra: [], deckCount: 20, ...states[seat] };
  }
  return expectBoard(board);
}

function scenario(id: string, title: string, format: Format, card: number, setup: Scenario["setup"], steps: Step[]): Scenario {
  return defineScenario({
    id: `tag-unique-review-${id}`, title, source: `${SOURCE} [R-TAG-UNIQUE]`, rules: ["R-TAG-UNIQUE"],
    tags: ["multiplayer", format, "unique", `card:${card}`], setup: { format, ...setup }, steps,
  });
}

function blocked(team: 0 | 1, spell: boolean): Scenario {
  const actor: DuelistId = team === 0 ? "p0" : "p1";
  const partner: DuelistId = team === 0 ? "p2" : "p3";
  const other: DuelistId = team === 0 ? "p1" : "p0";
  const otherPartner: DuelistId = team === 0 ? "p3" : "p2";
  const unique = spell ? BARRIER : MAGICIAN;
  return scenario(
    `team-${team}-${spell ? "spell-activation" : "normal-summon"}-blocked-by-partner`,
    `Tag team ${team}: the face-up ${unique} of the partner prevents a second face-up copy; a Set copy is legal`,
    "tag", spell ? 7153114 : 26082117,
    { [actor]: { hand: [unique, POT] }, [partner]: spell ? { spells: [unique] } : { monsters: [unique] }, [other]: { monsters: [BEAVER] }, [otherPartner]: { monsters: [OX] } },
    [
      ...(team === 1 ? [endTurn("p0")] : []),
      activate(POT, actor),
      expectNotOffered(spell ? "activate" : "normalSummon", unique, actor),
      expectOffered("set", unique, actor),
      setCard(unique, actor),
      everySeat("tag", {
        [actor]: { hand: team === 1 ? [ELF, ELF, ELF] : [ELF, ELF], grave: [POT], deckCount: team === 1 ? 17 : 18, ...(spell ? { spells: [unique], zones: { s0: { card: unique, pos: "set" } } } : { monsters: [unique], zones: { m0: { card: unique, pos: "set" } } }) },
        [partner]: spell ? { spells: [unique] } : { monsters: [unique] }, [other]: { monsters: [BEAVER] }, [otherPartner]: { monsters: [OX] },
      }),
    ],
  );
}

function removeRestriction(team: 0 | 1): Scenario {
  const actor: DuelistId = team === 0 ? "p0" : "p1";
  const partner: DuelistId = team === 0 ? "p2" : "p3";
  const other: DuelistId = team === 0 ? "p1" : "p0";
  const otherPartner: DuelistId = team === 0 ? "p3" : "p2";
  return scenario(
    `team-${team}-remove-partner-restriction`, `Tag team ${team}: destroy the unique card of the partner, then Normal Summon the own copy`, "tag", 26082117,
    { [actor]: { hand: [MAGICIAN, HOLE] }, [partner]: { monsters: [MAGICIAN] }, [other]: { monsters: [BEAVER] }, [otherPartner]: { monsters: [OX] } },
    [
      ...(team === 1 ? [endTurn("p0")] : []),
      activate(HOLE, actor),
      expectOffered("normalSummon", MAGICIAN, actor), normalSummon(MAGICIAN, actor),
      everySeat("tag", { [actor]: { monsters: [MAGICIAN], grave: [HOLE], ...(team === 1 ? { hand: [ELF], deckCount: 19 } : {}) }, [partner]: { grave: [MAGICIAN] }, [other]: { grave: [BEAVER] }, [otherPartner]: { grave: [OX] } }),
    ],
  );
}

function opponentCopy(format: Format, team: 0 | 1 = 0): Scenario {
  const actor: DuelistId = team === 0 ? "p0" : "p1";
  const other: DuelistId = team === 0 ? "p1" : "p0";
  const setup: Scenario["setup"] = { [actor]: { hand: [MAGICIAN] }, [other]: { monsters: [MAGICIAN] }, p2: { monsters: [OX] } };
  if (format !== "ffa3") setup.p3 = { monsters: [BEAVER] };
  return scenario(
    `${format}-team-${team}-opponent-copy-allows-normal-summon`, `${format}: an opposing copy does not prevent Gagaga Magician from being Normal Summoned`, format, 26082117, setup,
    [
      ...(team === 1 ? [endTurn("p0")] : []),
      expectOffered("normalSummon", MAGICIAN, actor), normalSummon(MAGICIAN, actor),
      everySeat(format, { [actor]: { monsters: [MAGICIAN], ...(team === 1 ? { hand: [ELF], deckCount: 19 } : {}) }, [other]: { monsters: [MAGICIAN] }, p2: { monsters: [OX] }, ...(format !== "ffa3" ? { p3: { monsters: [BEAVER] } } : {}) }),
    ],
  );
}

export const TAG_UNIQUE_REVIEW_SCENARIOS: Scenario[] = [
  blocked(0, false), blocked(1, false), blocked(0, true), blocked(1, true),
  removeRestriction(0), removeRestriction(1),
  opponentCopy("tag", 0), opponentCopy("tag", 1), opponentCopy("ffa3"), opponentCopy("ffa4"),
  scenario(
    "face-down-partner-copy-allows-normal-summon", "Tag: the Set copy of the partner does not prevent a face-up copy", "tag", 26082117,
    { p0: { hand: [MAGICIAN] }, p1: { monsters: [BEAVER] }, p2: { monsters: [faceDown(MAGICIAN)] }, p3: { monsters: [OX] } },
    [normalSummon(MAGICIAN, "p0"), everySeat("tag", { p0: { monsters: [MAGICIAN] }, p1: { monsters: [BEAVER] }, p2: { monsters: [MAGICIAN], zones: { m0: { card: MAGICIAN, pos: "set" } } }, p3: { monsters: [OX] } })],
  ),
  scenario(
    "team-0-flip-partner-copy-destroys-duplicate", "Tag: Book of Taiyou flips the partner's duplicate face-up; the rule destroys the new copy and keeps the original", "tag", 26082117,
    { p0: { hand: ["Book of Taiyou"], monsters: [MAGICIAN] }, p1: { monsters: [BEAVER] }, p2: { monsters: [faceDown(MAGICIAN)] }, p3: { monsters: [OX] } },
    [
      expectOffered("activate", "Book of Taiyou", "p0"), activate("Book of Taiyou", "p0"),
      everySeat("tag", { p0: { monsters: [MAGICIAN], grave: ["Book of Taiyou"] }, p1: { monsters: [BEAVER] }, p2: { grave: [MAGICIAN] }, p3: { monsters: [OX] } }),
    ],
  ),
];
