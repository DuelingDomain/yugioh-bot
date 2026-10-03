import { describe, expect, it } from "vitest";
import { teamOfSeat } from "@yugidraft/shared/duels";
import type { DuelChainLink, DuelEngineView } from "@yugidraft/shared/duels";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import {
  TAG_DOM,
  defaultTeamNames,
  pileSideForSeat,
  tagCameraYields,
  tagInputSuspended,
  resolveTagExtras,
  tagResponseOrder,
  tagTurnText,
  type TagShellLiveProps,
} from "@/components/duel/tag/live-tag";
import type { TableShellProps } from "@/components/duel/table/table-shell";

const teamOf = (seat: number) => teamOfSeat("tag", seat);

describe("pileSideForSeat", () => {
  it("is your side for your own pile", () => expect(pileSideForSeat(0, 0, teamOf)).toBe("you"));
  it("is your side for your partner's pile", () => expect(pileSideForSeat(0, 2, teamOf)).toBe("you"));
  it("is the rival side for either rival pile", () => {
    expect(pileSideForSeat(0, 1, teamOf)).toBe("rival");
    expect(pileSideForSeat(0, 3, teamOf)).toBe("rival");
  });
  it("keeps the same split for a viewer on team 1", () => {
    expect(pileSideForSeat(3, 1, teamOf)).toBe("you");
    expect(pileSideForSeat(3, 0, teamOf)).toBe("rival");
  });
  it("shows a spectator the table from team 0", () => {
    expect(pileSideForSeat(null, 0, teamOf)).toBe("you");
    expect(pileSideForSeat(null, 2, teamOf)).toBe("you");
    expect(pileSideForSeat(null, 1, teamOf)).toBe("rival");
    expect(pileSideForSeat(null, 3, teamOf)).toBe("rival");
  });
});

describe("tagInputSuspended", () => {
  it("runs the keys when nothing is open", () => {
    expect(tagInputSuspended({})).toBe(false);
    expect(tagInputSuspended({ menu: null, pile: null, dialog: false, inputSuspended: false, narrow: false, sheetOpen: true })).toBe(false);
  });
  it.each([
    ["menu", { open: true }],
    ["pile", { open: true }],
    ["dialog", true],
    ["inputSuspended", true],
  ] as const)("suspends the input for %s", (key, value) => {
    expect(tagInputSuspended({ [key]: value })).toBe(true);
  });
  it("suspends for an open sheet only on a narrow screen", () => {
    expect(tagInputSuspended({ narrow: true, sheetOpen: true })).toBe(true);
    expect(tagInputSuspended({ narrow: true, sheetOpen: false })).toBe(false);
  });
  it("does not suspend for a closed pile", () => expect(tagInputSuspended({ pile: { open: false } })).toBe(false));
  it("does not take a seat pick or an aim: the aim flow needs its digits and Esc", () => {
    expect(tagInputSuspended({ seatPick: {}, aim: {} } as never)).toBe(false);
  });
});

describe("tagCameraYields", () => {
  it("does not yield when idle", () => expect(tagCameraYields({})).toBe(false));
  it.each(["aiming", "seatKeys", "centeredUnrevealed"] as const)("yields for %s", (key) => {
    expect(tagCameraYields({ [key]: true })).toBe(true);
  });
});

describe("defaultTeamNames", () => {
  it("names the teams Team 1 and Team 2", () => expect(defaultTeamNames()).toEqual(["Team 1", "Team 2"]));
  it("gives a new array each time", () => expect(defaultTeamNames()).not.toBe(defaultTeamNames()));
});

describe("tagResponseOrder", () => {
  const base = TAG_FIXTURES.states.main.room.engine!;
  const chainOf = (...seats: number[]): DuelEngineView => ({
    ...base,
    chain: seats.map((seat, index) => ({ index: index + 1, seat }) as DuelChainLink),
  });

  it("has no order without a chain", () => expect(tagResponseOrder(chainOf(), 0)).toBeNull());
  it("lets the opposing team answer first, in turn order", () => {
    const order = tagResponseOrder(chainOf(0), 0)!;
    expect(order.team).toBe(1);
    expect(order.seats).toEqual([1, 3]);
    expect(order.promptSeat).toBe(1);
    expect(order.window.team).toBe(1);
    expect(order.window.otherPassed).toBe(false);
  });
  it("starts each team from the turn seat", () => {
    expect(tagResponseOrder(chainOf(0), 2)!.seats).toEqual([3, 1]);
    expect(tagResponseOrder(chainOf(1), 2)!.seats).toEqual([2, 0]);
    expect(tagResponseOrder(chainOf(1), 2)!.promptSeat).toBe(2);
  });
  it("answers the newest link, not the first", () => {
    expect(tagResponseOrder(chainOf(0, 1), 0)!.team).toBe(0);
  });
  it("moves to the second rival after the first one passes", () => {
    const order = tagResponseOrder(chainOf(0), 0, [1])!;
    expect(order.team).toBe(1);
    expect(order.promptSeat).toBe(3);
    expect(order.window.members.map((m) => m.state)).toEqual(["passed", "choosing"]);
  });
  it("returns to the link owner's team when both rivals passed", () => {
    const order = tagResponseOrder(chainOf(0), 0, [1, 3])!;
    expect(order.team).toBe(0);
    expect(order.seats).toEqual([0, 2]);
    expect(order.window.otherPassed).toBe(true);
  });
  it("has no order when both teams passed", () => {
    expect(tagResponseOrder(chainOf(0), 0, [0, 1, 2, 3])).toBeNull();
  });
});

describe("resolveTagExtras", () => {
  const controller = { room: { session: { mode: "domain" as const } } };
  it("defaults the mode from the controller room", () => {
    expect(resolveTagExtras({}, controller)).toEqual({ teamNames: ["Team 1", "Team 2"], mode: "domain" });
  });
  it("prefers the given mode and names", () => {
    expect(resolveTagExtras({ mode: "normal", teamNames: ["A", "B"] }, controller)).toEqual({ teamNames: ["A", "B"], mode: "normal" });
  });
  it("falls back to normal with no controller", () => expect(resolveTagExtras({}).mode).toBe("normal"));
});

describe("DOM hooks", () => {
  it("keeps the names every piece and the e2e helpers rely on", () => {
    expect(TAG_DOM).toEqual({
      shellAttr: "data-table-shell",
      shellValue: "tag",
      canActAttr: "data-can-act",
      fieldLabel: "Duel field",
      stageAttr: "data-table-stage",
      stageValue: "tag",
      extraStageAttr: "data-tag-stage",
      seatFieldAttr: "data-seat-field",
      sideAttr: "data-side",
      sideSelf: "you",
      sidePartner: "partner",
      relationAttr: "data-relation",
      relations: ["self", "partner", "opponent", "other"],
      lpSeatAttr: "data-lp-seat",
      handLabel: "Your hand",
      handSeatAttr: "data-hand-seat",
      chainFxAttr: "data-chain-fx",
      chipsTestId: "priority-chips",
      chipSeatAttr: "data-seat",
      chipNowAttr: "data-now",
    });
    expect(tagTurnText(7)).toBe("Turn 7");
  });
});

describe("TagShellLiveProps", () => {
  it("accepts every live seam of the table shell plus team names and mode", () => {
    const seams: Pick<TableShellProps, "controller" | "fillViewport" | "actions" | "connection" | "pickContinuation" | "inputSuspended" | "boardRef"> = {
      controller: undefined as never,
    };
    const props: TagShellLiveProps = { ...seams, teamNames: ["A", "B"] };
    const withMode: TagShellLiveProps = { ...props, mode: "domain" };
    expect(withMode.mode).toBe("domain");
  });
});
