// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSandboxShare, encodeSandboxShare } from "@yugidraft/shared/duels";
import { SandboxBuilder } from "@/components/sandbox/builder";
import type { BuilderServices } from "@/components/sandbox/api";
import { applyAction, createBuilderState, type SandboxBuilderState } from "@/components/sandbox/board-model";

// U5 owns the real table view. The builder only needs its props contract here.
vi.mock("@/components/sandbox/table-view", () => ({
  SandboxTableView: (props: { state: SandboxBuilderState; activeSeat: string; onSelectSeat: (seat: string) => void }) => (
    <div data-testid="table-view" data-seat={props.activeSeat} data-out={(props.state.board.eliminated ?? []).join(",")}>
      <button type="button" onClick={() => props.onSelectSeat("p2")}>pick p2</button>
    </div>
  ),
}));

const services: BuilderServices = {
  search: async () => [],
  lookup: async () => [],
  start: vi.fn(async () => ({ slug: "abc" })),
};

function setup(initial?: SandboxBuilderState, extra: Partial<React.ComponentProps<typeof SandboxBuilder>> = {}) {
  const changes: SandboxBuilderState[] = [];
  const user = userEvent.setup();
  render(<SandboxBuilder services={services} initial={initial} onChange={(state) => changes.push(state)} {...extra} />);
  return { user, last: () => changes[changes.length - 1] };
}

const stateOf = (format: "ffa3" | "ffa4", ...actions: Parameters<typeof applyAction>[1][]) => {
  let state = createBuilderState(format);
  for (const action of actions) state = applyAction(state, action).state;
  return state;
};

afterEach(() => cleanup());

describe("Start in", () => {
  it("lists the six phases, Draw first, and sets the board", async () => {
    const { user, last } = setup();
    const select = screen.getByRole("combobox", { name: "Start in" });
    expect(select).toHaveValue("draw");
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toEqual(["Draw Phase", "Standby Phase", "Main 1 Phase", "Battle Phase", "Main 2 Phase", "End Phase"]);
    await user.selectOptions(select, "main2");
    expect(last().board.startAt).toBe("main2");
  });

  it("disables Battle on turn 1 with a hint, until Attack on turn 1 is on", async () => {
    const { user, last } = setup();
    const select = screen.getByRole("combobox", { name: "Start in" });
    expect(screen.getByRole("option", { name: "Battle Phase" })).toBeDisabled();
    expect(select).toHaveAccessibleDescription(/Attack on turn 1/);
    await user.click(screen.getByRole("checkbox", { name: /attack on turn 1/i }));
    expect(screen.getByRole("option", { name: "Battle Phase" })).toBeEnabled();
    expect(select).not.toHaveAccessibleDescription();
    await user.selectOptions(select, "battle");
    expect(last().board.startAt).toBe("battle");
  });

  it("opens Battle for a later turn player and says so when it falls back", async () => {
    const { user, last } = setup(stateOf("ffa3", { type: "setTurn", turn: "p1" }));
    expect(screen.getByRole("option", { name: "Battle Phase" })).toBeEnabled();
    await user.selectOptions(screen.getByRole("combobox", { name: "Start in" }), "battle");
    await user.selectOptions(screen.getByRole("combobox", { name: "Turn player" }), "p0");
    expect(last().board.startAt).toBe("main1");
    expect(screen.getAllByRole("status").some((el) => /changed to Main 1/.test(el.textContent ?? ""))).toBe(true);
  });
});

describe("share code", () => {
  it("copies a code that decodes to the board, run and name", async () => {
    const state = stateOf("ffa4", { type: "add", seat: "p0", card: 46986414 }, { type: "toggleEliminated", seat: "p3" }, { type: "setStartAt", phase: "main2" });
    const { user } = setup(state, { name: "  Column test ", onNameChange: () => undefined });
    await user.click(screen.getByRole("button", { name: /copy share code/i }));
    const code = await navigator.clipboard.readText();
    expect(code.startsWith("DKSB1:")).toBe(true);
    expect(decodeSandboxShare(code)).toEqual({ name: "Column test", board: state.board, run: state.run });
    expect(screen.getAllByRole("status").some((el) => /Share code copied/.test(el.textContent ?? ""))).toBe(true);
  });

  it("leaves the name out when there is none", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /copy share code/i }));
    expect(decodeSandboxShare(await navigator.clipboard.readText()).name).toBeUndefined();
  });

  it("shows the code in a dialog when the browser refuses to copy", async () => {
    const { user } = setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    await user.click(screen.getByRole("button", { name: /copy share code/i }));
    const box = await screen.findByRole("textbox", { name: /share code/i });
    expect(String((box as HTMLTextAreaElement).value).startsWith("DKSB1:")).toBe(true);
  });

  it("keeps Copy link when the page gives it", () => {
    setup(undefined, { onShare: () => undefined });
    expect(screen.getByRole("button", { name: /copy link/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /import code/i })).toBeInTheDocument();
  });

  it("imports a code into the builder, sets the name, and undo brings the old board back", async () => {
    const shared = stateOf("ffa4", { type: "add", seat: "p1", card: 46986414 }, { type: "toggleEliminated", seat: "p2" }, { type: "setStartAt", phase: "standby" });
    const code = encodeSandboxShare({ name: "From a friend", board: shared.board, run: shared.run });
    const onNameChange = vi.fn();
    const { user, last } = setup(undefined, { name: "", onNameChange });
    await user.click(screen.getByRole("button", { name: /import code/i }));
    await user.click(screen.getByRole("textbox", { name: /share code/i }));
    await user.paste(code);
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(last()).toEqual(shared));
    expect(onNameChange).toHaveBeenCalledWith("From a friend");
    expect(screen.queryByRole("textbox", { name: /share code/i })).toBeNull();
    expect(screen.getByTestId("table-view")).toHaveAttribute("data-out", "p2");
    await user.click(screen.getByRole("button", { name: /^undo/i }));
    // Undo returns the first board object, which the builder does not report as a change. Check the page.
    await waitFor(() => expect(screen.queryByTestId("table-view")).toBeNull());
    expect(screen.getByRole("combobox", { name: "Start in" })).toHaveValue("draw");
  });

  it("does not rename a board that has a name", async () => {
    const shared = stateOf("ffa3");
    const onNameChange = vi.fn();
    const { user } = setup(undefined, { name: "Mine", onNameChange });
    await user.click(screen.getByRole("button", { name: /import code/i }));
    await user.click(screen.getByRole("textbox", { name: /share code/i }));
    await user.paste(encodeSandboxShare({ name: "Theirs", board: shared.board, run: shared.run }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: /share code/i })).toBeNull());
    expect(onNameChange).not.toHaveBeenCalled();
  });

  it("refuses an imported table this host cannot run, and shows why", async () => {
    const shared = stateOf("ffa3");
    const { user, last } = setup(undefined, { capabilities: { multiplayerTables: false, multiCoreReady: false, multiDomainCoreReady: false } as never });
    await user.click(screen.getByRole("button", { name: /import code/i }));
    await user.click(screen.getByRole("textbox", { name: /share code/i }));
    await user.paste(encodeSandboxShare({ board: shared.board, run: shared.run }));
    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(last()).toBeUndefined();
  });
});

describe("table seats", () => {
  it("mounts the table view for 3-way and 4-way, and the single seat board otherwise", async () => {
    setup(stateOf("ffa4"));
    expect(screen.getByTestId("table-view")).toHaveAttribute("data-seat", "p0");
    cleanup();
    setup();
    expect(screen.queryByTestId("table-view")).toBeNull();
    expect(screen.getByRole("group", { name: /Field of P0/ })).toBeInTheDocument();
  });

  it("takes a seat out and puts it back, and a click in the table view selects a seat", async () => {
    const { user, last } = setup(stateOf("ffa4", { type: "add", seat: "p1", card: 46986414 }));
    await user.click(screen.getByRole("button", { name: "Take P1 out" }));
    expect(last().board.eliminated).toEqual(["p1"]);
    expect(last().board.p1).toBeUndefined();
    expect(screen.getByRole("tab", { name: /P1 \(out\)/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Put P1 back in" }));
    expect(last().board.eliminated).toBeUndefined();
    await user.click(screen.getByRole("button", { name: "pick p2" }));
    expect(screen.getByTestId("table-view")).toHaveAttribute("data-seat", "p2");
  });

  it("blocks Take out for the turn player and when only two players are left", async () => {
    const { user } = setup(stateOf("ffa3"));
    expect(screen.getByRole("button", { name: "Take P0 out" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Take P1 out" }));
    expect(screen.getByRole("button", { name: "Take P2 out" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Take P2 out" })).toHaveAttribute("title", "Two players must stay in.");
  });

  it("shows no take-out buttons on a 1v1 board", () => {
    setup();
    expect(screen.queryByRole("button", { name: /take p\d out/i })).toBeNull();
  });
});
