import {
  activate, defineScenario, endTurn, expectBoard, expectPrompt, zone,
  type BoardExpect, type DuelistId, type Scenario,
} from "../../support/dsl.js";
import { domainVariant } from "./domain-variants.js";

export const DROLL = "Droll & Lock Bird";
export const ROTA = "Reinforcement of the Army";
export const ELF = "Mystical Elf";
export const AXE = "Axe Raider";
export const DROLL_SOURCE = "https://www.db.yugioh-card.com/yugiohdb/card_search.action?ope=2&cid=9279&request_locale=en; docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER] [R-COMMON-SEAT-STATE] [R-TAG-PARTNER]";
export const DROLL_FORMATS = ["ffa3", "ffa4", "tag"] as const;
export type DrollFormat = typeof DROLL_FORMATS[number];
export const drollSeats = (format: DrollFormat): DuelistId[] => format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
export const drollOpponent = (format: DrollFormat, a: DuelistId, b: DuelistId): boolean =>
  format === "tag" ? Number(a[1]) % 2 !== Number(b[1]) % 2 : a !== b;

// Exact Main Phase boards omit only the opening draw. Later seats take their real Draw Phases.
// Every holder/searcher pair includes own searches and both Tag partners as negative controls.
const searches: Scenario[] = DROLL_FORMATS.flatMap(format => drollSeats(format).flatMap(actor => drollSeats(format).map(holder => {
  const seats = drollSeats(format);
  const allowed = drollOpponent(format, actor, holder);
  const before = seats.slice(0, seats.indexOf(actor));
  const board: BoardExpect = {};
  for (const seat of seats) {
    const hand: string[] = [];
    if (seat === holder && !allowed) hand.push(DROLL);
    if (seat !== "p0" && seats.indexOf(seat) <= seats.indexOf(actor)) hand.push(ELF);
    if (seat === actor) hand.push(AXE);
    board[seat] = {
      lp: format === "tag" ? 16000 : 8000, hand, monsters: [], spells: [], banished: [],
      grave: [...(seat === actor ? [ROTA] : []), ...(seat === holder && allowed ? [DROLL] : [])],
      deckCount: 20 - (seat !== "p0" && seats.indexOf(seat) <= seats.indexOf(actor) ? 1 : 0) - (seat === actor ? 1 : 0),
    };
  }
  return defineScenario({
    id: `droll-${format}-search-${actor}-holder-${holder}`,
    title: `${format}: ${holder} ${allowed ? "answers" : "cannot answer"} ${actor}'s Deck search`,
    source: DROLL_SOURCE,
    rules: ["R-COMMON-SEAT-STATE", "R-COMMON-EACH-PLAYER", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", format, "card:94145021"],
    setup: {
      format, skipOpeningDraw: true,
      [holder]: { hand: [DROLL] },
      [actor]: { hand: [...(actor === holder ? [DROLL] : []), ROTA], deck: [ELF, AXE] },
    },
    steps: [
      ...before.map(seat => endTurn(seat)),
      activate(ROTA, actor), zone(actor, "s0", actor),
      ...(allowed ? [activate(DROLL, holder)] : [expectPrompt({ by: actor, context: "action" }), { op: "expectSeatNotOffered" as const, action: "activate" as const, sel: DROLL, by: holder }]),
      expectBoard(board),
    ],
  });
})));

export const DROLL_LOCK_BIRD_SCENARIOS: Scenario[] = [...searches, ...searches.map(domainVariant)];
