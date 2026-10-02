// Review 5b: a partner monster can be attached by an effect even when its control cannot change.
// Cowboy detaches real material. The real EVENT_DETACH_MATERIAL trigger of Gabonga then selects a target.
// Blindly Loyal Goblin and Mataza the Zapper have EFFECT_CANNOT_CHANGE_CONTROL in their official scripts.
import {
  activate, endTurn, expectBoard, expectPickOptions, expectPrompt, select, yes,
  type BoardExpect, type DuelistExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

const GABONGA = "Goblin Biker Big Gabonga";
const COWBOY = "Gagaga Cowboy";
const GOBLIN = "Blindly Loyal Goblin";
const MATAZA = "Mataza the Zapper";
const ELF = "Mystical Elf";
const OX = "Battle Ox";
type Format = "tag" | "ffa3" | "ffa4";

function everySeat(format: Format, states: Partial<Record<DuelistId, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of (["p0", "p1", "p2", "p3"] as DuelistId[]).slice(0, format === "ffa3" ? 3 : 4)) {
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [], monsters: [], spells: [], grave: [], banished: [], extra: [], deckCount: 20, ...states[seat] };
  }
  return expectBoard(board);
}

function attach(format: Format, team: 0 | 1, own: boolean): Scenario {
  const actor: DuelistId = team === 0 ? "p0" : "p1";
  const partner: DuelistId = team === 0 ? "p2" : "p3";
  const other: DuelistId = team === 0 ? "p1" : "p0";
  const otherPartner: DuelistId = team === 0 ? "p3" : "p2";
  const tag = format === "tag";
  const materialSeat = own ? actor : partner;
  const setup: Scenario["setup"] = {
    format,
    [actor]: { monsters: [GABONGA, { card: COWBOY, materials: [ELF] }, ...(own ? [GOBLIN] : [])] },
    [other]: { monsters: [MATAZA] },
    [partner]: { monsters: [tag && own ? OX : GOBLIN] },
  };
  if (format !== "ffa3") setup[otherPartner] = { monsters: [MATAZA] };
  const states: Partial<Record<DuelistId, DuelistExpect>> = {
    [actor]: { monsters: [GABONGA, COWBOY], grave: [ELF], zones: { m0: { card: GABONGA, materials: 1 }, m1: { card: COWBOY, materials: 0 } }, ...(team === 1 ? { hand: [ELF], deckCount: 19 } : {}) },
    [other]: { monsters: [MATAZA] }, [partner]: { monsters: own ? [tag ? OX : GOBLIN] : [] },
  };
  if (format !== "ffa3") states[otherPartner] = { monsters: [MATAZA] };
  return defineScenario({
    id: `tag-xyz-attach-review-${format}-team-${team}-${own ? "own" : "partner"}-cannot-change-control`,
    title: `${format} team ${team}: Gabonga attaches the ${own ? "own" : "partner's"} Blindly Loyal Goblin after Cowboy detaches; opposing immutable monsters are excluded`,
    source: `${SOURCE} [R-TAG-SHARED-CARDS] [R-TAG-PARTNER-COST]`, rules: ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, "xyz", "card:34001672", "card:35215622"], setup,
    steps: [
      ...(team === 1 ? [endTurn("p0")] : []),
      activate(COWBOY, actor), expectPrompt({ kind: "choice", title: GABONGA, by: actor }), yes(actor),
      expectPickOptions({ count: tag && own ? 3 : 2, include: [{ card: COWBOY, seat: actor }, { card: GOBLIN, seat: materialSeat }, ...(tag && own ? [{ card: OX, seat: partner }] : [])], exclude: [{ card: MATAZA }, ...(!tag ? [{ card: GOBLIN, seat: partner }] : [])] }, actor),
      select({ card: GOBLIN, owner: materialSeat }), everySeat(format, states),
    ],
  });
}

export const TAG_XYZ_ATTACH_REVIEW_SCENARIOS: Scenario[] = [
  attach("tag", 0, false), attach("tag", 1, false), attach("tag", 0, true), attach("tag", 1, true),
  attach("ffa3", 0, true), attach("ffa4", 0, true),
  defineScenario({
    id: "tag-xyz-attach-review-ffa4-opponent-can-change-control", title: "FFA4: Gabonga can attach an opposing monster whose control can change",
    source: `${SOURCE} [R-TAG-PARTNER-COST]`, rules: ["R-TAG-PARTNER-COST"], tags: ["multiplayer", "ffa4", "xyz", "card:34001672"],
    setup: { format: "ffa4", p0: { monsters: [GABONGA, { card: COWBOY, materials: [ELF] }] }, p1: { monsters: [MATAZA] }, p2: { monsters: [GOBLIN] }, p3: { monsters: [OX] } },
    steps: [
      activate(COWBOY, "p0"), expectPrompt({ kind: "choice", title: GABONGA, by: "p0" }), yes("p0"),
      expectPickOptions({ count: 2, include: [{ card: COWBOY, seat: "p0" }, { card: OX, seat: "p3" }], exclude: [{ card: MATAZA }, { card: GOBLIN }] }, "p0"),
      select({ card: OX, owner: "p3" }),
      everySeat("ffa4", { p0: { monsters: [GABONGA, COWBOY], grave: [ELF], zones: { m0: { card: GABONGA, materials: 1 }, m1: { card: COWBOY, materials: 0 } } }, p1: { monsters: [MATAZA] }, p2: { monsters: [GOBLIN] } }),
    ],
  }),
];
