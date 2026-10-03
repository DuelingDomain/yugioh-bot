import { describe, expect, it } from "vitest";
import { teamOfSeat } from "@yugidraft/shared/duels";
import type { DuelChainLink, DuelEngineView } from "@yugidraft/shared/duels";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import {
  TAG_DOM,
  defaultTeamNames,
  pileSideForSeat,
  tagKeysPaused,
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

describe("tagKeysPaused", () => {
  it("runs the keys when nothing is open", () => {
    expect(tagKeysPaused({})).toBe(false);
    expect(tagKeysPaused({ seatPick: null, aim: null, menu: null, pile: null, dialog: false, inputSuspended: false })).toBe(false);
  });
  it.each([
    ["seatPick", { options: new Map() }],
    ["aim", { mode: "aim" }],
    ["menu", { open: true }],
    ["pile", { open: true }],
    ["dialog", true],
    ["inputSuspended", true],
  ] as const)("pauses the keys for %s", (key, value) => {
    expect(tagKeysPaused({ [key]: value })).toBe(true);
  });
  it("does not pause for a closed pile", () => expect(tagKeysPaused({ pile: { open: false } })).toBe(false));
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

  it("has no order without a chain", () => expect(tagResponseOrder(chainOf())).toBeNull());
  it("lets the opposing team answer first, in turn order", () => {
    const order = tagResponseOrder(chainOf(0))!;
    expect(order.team).toBe(1);
    expect(order.seats).toEqual([1, 3]);
    expect(order.promptSeat).toBe(1);
    expect(order.window.team).toBe(1);
    expect(order.window.otherPassed).toBe(false);
  });
  it("answers the newest link, not the first", () => {
    expect(tagResponseOrder(chainOf(0, 1))!.team).toBe(0);
  });
  it("moves to the second rival after the first one passes", () => {
    const order = tagResponseOrder(chainOf(0), [1])!;
    expect(order.team).toBe(1);
    expect(order.promptSeat).toBe(3);
    expect(order.window.members.map((m) => m.state)).toEqual(["passed", "choosing"]);
  });
  it("returns to the link owner's team when both rivals passed", () => {
    const order = tagResponseOrder(chainOf(0), [1, 3])!;
    expect(order.team).toBe(0);
    expect(order.seats).toEqual([0, 2]);
    expect(order.window.otherPassed).toBe(true);
  });
});

describe("DOM hooks", () => {
  it("keeps the names every piece relies on", () => {
    expect(TAG_DOM).toEqual({
      shellAttr: "data-table-shell",
      shellValue: "tag",
      canActAttr: "data-can-act",
      fieldLabel: "Duel field",
      stageAttr: "data-tag-stage",
      relationAttr: "data-relation",
      relations: ["self", "partner", "rival"],
      lpSeatAttr: "data-lp-seat",
      handLabel: "Your hand",
    });
    expect(tagTurnText(7)).toBe("Turn 7");
  });
});

describe("TagShellLiveProps", () => {
  it("accepts every live seam of the table shell plus team names and mode", () => {
    const seams: Pick<TableShellProps, "controller" | "fillViewport" | "actions" | "connection" | "pickContinuation" | "inputSuspended" | "boardRef"> = {
      controller: undefined as never,
    };
    const props: TagShellLiveProps = { ...seams, teamNames: ["A", "B"], mode: "domain" };
    expect(props.mode).toBe("domain");
  });
});
