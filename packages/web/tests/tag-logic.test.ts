import { describe, expect, it } from "vitest";
import type { DuelChainLink, DuelEngineView, DuelPrompt, DuelSeatView } from "@yugidraft/shared/duels";
import {
  batonOrder,
  passSummary,
  chainLinkLabel,
  defaultDirectSeat,
  directAttackSeats,
  responseWindow,
  rivalPickOptions,
  resultBanner,
  teamGlyph,
  teamLoss,
  teamLp,
} from "@/components/duel/tag/tag-logic";

function seat(n: number, lp: number, monsters: boolean, extra: Partial<DuelSeatView> = {}): DuelSeatView {
  return {
    seat: n,
    lp,
    hand: [],
    deckCount: 30,
    extraCount: 0,
    extra: [],
    monsters: [monsters ? ({ code: 1, controller: n, location: 4, sequence: 0 } as never) : null, null, null, null, null],
    spells: [null, null, null, null, null],
    graveyard: [],
    banished: [],
    team: n % 2,
    ...extra,
  };
}

function engine(seats: DuelSeatView[], extra: Partial<DuelEngineView> = {}): DuelEngineView {
  return {
    revision: 1,
    format: "tag",
    turn: 5,
    turnSeat: 0,
    phase: "BP",
    seats,
    prompt: null,
    chain: [],
    events: [],
    log: [],
    result: null,
    ...extra,
  } as DuelEngineView;
}

const NAMES = ["Aster", "Mirelle", "Corvin", "Juniper"];
const nameOf = (s: number) => NAMES[s];

describe("teamLp", () => {
  it("reads the shared LP of a team", () => {
    const e = engine([seat(0, 11800, true), seat(1, 9400, true), seat(2, 11800, true), seat(3, 9400, true)]);
    expect(teamLp(e, 0)).toBe(11800);
    expect(teamLp(e, 1)).toBe(9400);
  });

  it("falls back to the other member when one view is missing", () => {
    const e = engine([seat(0, 5000, true), seat(1, 4000, true)]);
    expect(teamLp(e, 0)).toBe(5000);
    expect(teamLp(e, 1)).toBe(4000);
  });
});

describe("teamLoss", () => {
  const four = (lpA: number, lpB: number, extra: Partial<DuelSeatView> = {}) =>
    engine([seat(0, lpA, true, extra), seat(1, lpB, true), seat(2, lpA, true, extra), seat(3, lpB, true)]);

  it("reports no loss while both teams have LP", () => {
    expect(teamLoss(four(11800, 9400))).toEqual({ lostTeam: null, cracking: false });
  });

  it("a team at 0 LP is lost and the plate cracks", () => {
    expect(teamLoss(four(11800, 0))).toEqual({ lostTeam: 1, cracking: true });
  });

  it("a team with an eliminated member is lost", () => {
    expect(teamLoss(four(0, 3000, { eliminated: true }))).toEqual({ lostTeam: 0, cracking: false });
  });

  it("a pending elimination cracks the plate before the loss is final", () => {
    expect(teamLoss(four(0, 3000, { pendingElimination: true }))).toEqual({ lostTeam: 0, cracking: true });
  });

  it("a result with a winner team makes the other team the lost one", () => {
    const e = four(8000, 6000);
    e.result = { winnerSeat: 0, winnerTeam: 0, reason: "lp" };
    expect(teamLoss(e).lostTeam).toBe(1);
  });

  it("a draw has no lost team", () => {
    const e = four(8000, 6000);
    e.result = { winnerSeat: null, winnerTeam: null, reason: "draw" };
    expect(teamLoss(e).lostTeam).toBeNull();
  });
});

describe("resultBanner", () => {
  const e = (winnerTeam: number | null) => {
    const eng = engine([seat(0, 1, true), seat(1, 0, true), seat(2, 1, true), seat(3, 0, true)]);
    eng.result = { winnerSeat: winnerTeam == null ? null : winnerTeam, winnerTeam, reason: "lp" };
    return eng;
  };
  it("says YOUR TEAM WINS when the viewer team won", () => {
    expect(resultBanner(e(0), 0)).toEqual({ headline: "YOUR TEAM WINS", outcome: "win" });
  });
  it("says YOUR TEAM LOSES when the other team won", () => {
    expect(resultBanner(e(1), 0)).toEqual({ headline: "YOUR TEAM LOSES", outcome: "lose" });
  });
  it("names the winning team for a spectator", () => {
    expect(resultBanner(e(1), null, ["Starfall", "Thornveil"])).toEqual({ headline: "THORNVEIL WINS", outcome: "spectator" });
    expect(resultBanner(e(0), null)).toEqual({ headline: "TEAM 1 WINS", outcome: "spectator" });
  });
  it("says DRAW for a draw", () => {
    expect(resultBanner(e(null), 0)).toEqual({ headline: "DRAW", outcome: "draw" });
  });
  it("is null while the duel runs", () => {
    const eng = engine([seat(0, 1, true)]);
    expect(resultBanner(eng, 0)).toBeNull();
  });
});

describe("chain labels and glyphs", () => {
  const link = (index: number, s: number): DuelChainLink => ({ index, seat: s, code: 1, name: "X" });
  it("writes C<n> · <name> <glyph> <code>", () => {
    expect(chainLinkLabel(link(2, 2), 0, nameOf)).toBe("C2 · Corvin ◆ 1B");
    expect(chainLinkLabel(link(1, 1), 0, nameOf)).toBe("C1 · Mirelle ● 2A");
  });
  it("flips the glyphs when the viewer is on team 2", () => {
    expect(chainLinkLabel(link(1, 1), 1, nameOf)).toBe("C1 · Mirelle ◆ 2A");
    expect(teamGlyph(1, 0)).toBe("●");
  });
  it("teamGlyph marks your team with a diamond and the other with a dot", () => {
    expect(teamGlyph(0, 0)).toBe("◆");
    expect(teamGlyph(0, 1)).toBe("●");
  });
});

describe("batonOrder", () => {
  it("lists 1A, 2A, 1B, 2B and marks now and next", () => {
    const b = batonOrder(0);
    expect(b.map((x) => x.code)).toEqual(["1A", "2A", "1B", "2B"]);
    expect(b[0]).toMatchObject({ seat: 0, now: true, next: false });
    expect(b[1]).toMatchObject({ seat: 1, now: false, next: true });
    expect(batonOrder(3)[0]).toMatchObject({ next: true });
    expect(batonOrder(3)[3]).toMatchObject({ now: true });
  });
});

describe("directAttackSeats", () => {
  it("lists rival members with no monster", () => {
    const e = engine([seat(0, 1, true), seat(1, 1, true), seat(2, 1, true), seat(3, 1, false)]);
    expect(directAttackSeats(e, 0)).toEqual([3]);
    expect(defaultDirectSeat(e, 0)).toBe(3);
  });
  it("is empty when every rival has a monster", () => {
    const e = engine([seat(0, 1, true), seat(1, 1, true), seat(2, 1, true), seat(3, 1, true)]);
    expect(directAttackSeats(e, 0)).toEqual([]);
    expect(defaultDirectSeat(e, 0)).toBeNull();
  });
  it("skips an eliminated rival and counts the other team from seat 1", () => {
    const e = engine([seat(0, 1, false), seat(1, 1, true), seat(2, 1, false), seat(3, 1, true, { eliminated: true })]);
    expect(directAttackSeats(e, 1)).toEqual([0, 2]);
    expect(directAttackSeats(e, 0)).toEqual([]);
  });
  it("picks the first seat in turn order as the default", () => {
    const e = engine([seat(0, 1, true), seat(1, 1, false), seat(2, 1, true), seat(3, 1, false)]);
    expect(defaultDirectSeat(e, 0)).toBe(1);
  });
});

describe("responseWindow", () => {
  const prompt = { kind: "choice", title: "Chain", options: [], context: "chain" } as unknown as DuelPrompt;
  const base = (chain: DuelChainLink[]) => engine([seat(0, 1, true), seat(1, 1, true), seat(2, 1, true), seat(3, 1, true)], { chain });

  it("is null without a chain", () => {
    expect(responseWindow(base([]), prompt, 0)).toBeNull();
  });
  it("is null without a prompt seat", () => {
    expect(responseWindow(base([{ index: 1, seat: 1 }]), prompt, null)).toBeNull();
  });

  it("the prompted seat is choosing and the partner waits", () => {
    const w = responseWindow(base([{ index: 1, seat: 1 }]), prompt, 0);
    expect(w).toMatchObject({ team: 0, otherPassed: false });
    expect(w?.members).toEqual([
      { seat: 0, state: "choosing" },
      { seat: 2, state: "waiting" },
    ]);
  });

  it("when the last link is of the responding team, the rivals passed already", () => {
    const w = responseWindow(base([{ index: 1, seat: 1 }, { index: 2, seat: 2 }]), prompt, 0);
    expect(w?.otherPassed).toBe(true);
    expect(w?.passedSeats).toEqual([1, 3]);
  });

  it("marks passed members from a pass list", () => {
    const w = responseWindow(base([{ index: 1, seat: 1 }]), prompt, 2, [0]);
    expect(w?.members).toEqual([
      { seat: 0, state: "passed" },
      { seat: 2, state: "choosing" },
    ]);
    expect(w?.bothPassed).toBe(false);
  });

  it("both passed means the chain resolves", () => {
    const w = responseWindow(base([{ index: 1, seat: 1 }]), null, 0, [0, 2]);
    expect(w?.bothPassed).toBe(true);
  });
});

describe("rivalPickOptions", () => {
  const four = () => engine([seat(0, 1, true), seat(1, 1, true), seat(2, 1, true), seat(3, 1, false)]);
  const choice = (options: Array<{ id: string; label: string; controller?: number }>, context?: unknown) =>
    ({ id: "p", seat: 0, kind: "choice", title: "t", options, context }) as unknown as DuelPrompt;

  it("is empty without a prompt", () => {
    expect(rivalPickOptions(four(), null).size).toBe(0);
  });
  it("reads an opponent pick", () => {
    const p = choice([{ id: "o1", label: "a", controller: 1 }, { id: "o3", label: "b", controller: 3 }], { type: "opponent" });
    expect([...rivalPickOptions(four(), p)]).toEqual([[1, "o1"], [3, "o3"]]);
  });
  it("reads a direct attack whose options name rivals", () => {
    const p = choice([{ id: "direct-3", label: "x", controller: 3 }]);
    expect([...rivalPickOptions(four(), p)]).toEqual([[3, "direct-3"]]);
  });
  it("ignores a chain or action prompt and options of the own team", () => {
    expect(rivalPickOptions(four(), choice([{ id: "a", label: "a", controller: 1 }], { type: "chain" })).size).toBe(0);
    expect(rivalPickOptions(four(), choice([{ id: "a", label: "a", controller: 2 }])).size).toBe(0);
    expect(rivalPickOptions(four(), choice([{ id: "a", label: "a" }])).size).toBe(0);
  });
  it("leaves out an eliminated rival", () => {
    const e = engine([seat(0, 1, true), seat(1, 1, true), seat(2, 1, true), seat(3, 1, true, { eliminated: true })]);
    const p = choice([{ id: "o1", label: "a", controller: 1 }, { id: "o3", label: "b", controller: 3 }], { type: "opponent" });
    expect([...rivalPickOptions(e, p)]).toEqual([[1, "o1"]]);
  });
});

describe("passSummary", () => {
  const nameOf = (seat: number) => ["Aster", "Mirelle", "Corvin", "Juniper"][seat];
  it("names the choosing and waiting members of your team", () => {
    const window = { team: 0, members: [{ seat: 0, state: "choosing" as const }, { seat: 2, state: "waiting" as const }], otherPassed: false, passedSeats: [], bothPassed: false };
    expect(passSummary(window, nameOf, 0)).toBe("Your team: Aster is choosing, Corvin is waiting.");
  });
  it("says when the other team passed, and calls the answering team rival for the other side", () => {
    const window = { team: 1, members: [{ seat: 1, state: "passed" as const }, { seat: 3, state: "choosing" as const }], otherPassed: true, passedSeats: [0, 2], bothPassed: false };
    expect(passSummary(window, nameOf, 0)).toBe("Rival team: Mirelle passed, Juniper is choosing. The other team passed.");
  });
});
