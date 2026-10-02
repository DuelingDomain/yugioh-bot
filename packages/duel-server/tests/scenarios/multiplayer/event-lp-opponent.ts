import { activate, choose, defineScenario, expectPrompt, normalSummon, yes, type DuelistExpect, type Scenario, type Step } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

export function eventLpOpponentProofs(code: 6909330 | 83819309): Scenario[] {
  return (["ffa3", "ffa4", "tag"] as Format[]).map(format => {
    const late: Seat = format === "ffa3" ? "p2" : "p3";
    const card = code === 6909330 ? "Soul Binding Gate" : "Cooling Embers";
    const setup = baseSetup(format, code === 6909330
      ? { p0: { field: card, grave: ["Z-ONE"] }, [late]: { hand: ["Beaver Warrior"] } }
      : { p0: { monsters: [card] }, [late]: { hand: ["Dian Keto the Cure Master"] } });
    const board: Partial<Record<Seat, DuelistExpect>> = {};
    for (const seat of SEATS[format]) board[seat] = { hand: seat === "p0" ? [] : ["Mystical Elf"], extra: [], deckCount: seat === "p0" ? 20 : 19 };
    const steps: Step[] = turnsBefore(format, late);
    if (code === 6909330) {
      steps.push(normalSummon("Beaver Warrior", late), expectPrompt({ by: late, context: "action" }));
      board.p0 = { ...board.p0, spells: [card], grave: ["Z-ONE"], lp: format === "tag" ? 15200 : 7200 };
      board[late] = { ...board[late], grave: ["Beaver Warrior"], lp: format === "tag" ? 15200 : 7200 };
    } else {
      steps.push(activate("Dian Keto the Cure Master", late), yes("p0"),
        expectPrompt({ by: "p0", kind: "choice", title: "Select an option" }),
        choose("Your opponent gains 1000 LP", "p0"), expectPrompt({ by: late, context: "action" }));
      board.p0 = { ...board.p0, monsters: [card] };
      board[late] = { ...board[late], grave: ["Dian Keto the Cure Master"], lp: format === "tag" ? 18000 : 10000 };
    }
    // Tag LP are shared; every other FFA LP total stays at 8000.
    if (format === "tag") for (const seat of SEATS[format]) board[seat]!.lp = code === 6909330 ? 15200 : Number(seat[1]) % 2 === 1 ? 18000 : 16000;
    steps.push(everySeat(format, board));
    return defineScenario({ id: `event-lp-opponent-${code}-${format}-${late}`, title: `${card}: the later event opponent binds without a free pick`,
      source: "docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-RESPONSE]", rules: ["R-FFA-OPP-RESPONSE"],
      tags: ["multiplayer", format, `card:${code}`], setup, steps });
  });
}
