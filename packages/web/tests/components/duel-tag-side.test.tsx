// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { useFixtureController } from "@/components/duel/table/fixtures/use-fixture-controller";
import type { TableFixtureState } from "@/components/duel/table/fixtures/common";
import { useTableUi } from "@/components/duel/table/use-table-ui";
import { TAG_FIXTURES } from "@/components/duel/tag/fixtures";
import { TagPileViewer, TagSide } from "@/components/duel/tag/tag-side";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const media = (narrow: boolean) =>
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: narrow && query.includes("max-width"), media: query, addEventListener() {}, removeEventListener() {} }));

function stateWith(mode: "normal" | "domain", viewerSeat: number | null = 0): TableFixtureState {
  const base = TAG_FIXTURES.states.main;
  return { ...base, room: { ...base.room, viewerSeat, session: { ...base.room.session, mode } } } as TableFixtureState;
}

/** Cards of a seat from any zone, to fill a pile. */
function cardsOf(seat: number, state: TableFixtureState): DuelCard[] {
  const view = state.room.engine!.seats.find((entry) => entry.seat === seat)!;
  return [...view.hand, ...view.monsters.filter((card): card is DuelCard => card != null)].slice(0, 2);
}

function Harness({ state, pileSeat, settingsTools }: { state: TableFixtureState; pileSeat?: number; settingsTools?: React.ReactNode }) {
  const base = useFixtureController(state, { reducedMotion: true });
  const ui = useTableUi(base);
  return (
    <div>
      <TagSide controller={ui.controller} ui={ui} settingsTools={settingsTools} />
      {pileSeat != null ? (
        <button type="button" onClick={() => ui.inspectCard({ type: "pile", title: "Graveyard", cards: cardsOf(pileSeat, state) })}>open pile</button>
      ) : null}
      <TagPileViewer controller={ui.controller} ui={ui} />
    </div>
  );
}

describe("TagSide Deck Master rail", () => {
  it("shows on a wide Domain table, with your master and your partner's", () => {
    media(false);
    render(<Harness state={stateWith("domain")} />);
    const rail = screen.getByRole("complementary", { name: "Deck Masters" });
    expect(within(rail).getByText("Your Master")).toBeTruthy();
    expect(within(rail).getByText("Corvin Hale's Master")).toBeTruthy();
  });

  it("is absent on a Standard table", () => {
    media(false);
    render(<Harness state={stateWith("normal")} />);
    expect(screen.queryByRole("complementary", { name: "Deck Masters" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Duel panels" })).toBeTruthy();
  });
});

describe("TagSide wide layout", () => {
  it("has the history strip and the Card, Log and Settings tabs", () => {
    media(false);
    render(<Harness state={stateWith("normal")} />);
    expect(screen.getByTestId("history-strip")).toBeTruthy();
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+\+?$/, ""))).toEqual(["Card", "Log", "Settings"]);
    expect(screen.queryByLabelText("Mobile duel panels")).toBeNull();
  });

  it("renders the settings tools slot in the Settings tab", () => {
    media(false);
    render(<Harness state={stateWith("normal")} settingsTools={<button type="button">Surrender</button>} />);
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(screen.getByRole("button", { name: "Surrender" })).toBeTruthy();
  });
});

describe("TagSide narrow layout", () => {
  it("renders the phone bar instead of the left column", () => {
    media(true);
    render(<Harness state={stateWith("normal")} />);
    const bar = screen.getByLabelText("Mobile duel panels");
    expect(within(bar).getAllByRole("button").map((node) => node.textContent)).toEqual(["Card", "Log", "Settings"]);
    expect(screen.queryByRole("complementary", { name: "Duel panels" })).toBeNull();
    expect(screen.queryByTestId("history-strip")).toBeNull();
  });

  it("offers Masters on a Domain table and opens them in the sheet", () => {
    media(true);
    render(<Harness state={stateWith("domain")} />);
    fireEvent.click(within(screen.getByLabelText("Mobile duel panels")).getByRole("button", { name: "Masters" }));
    expect(within(screen.getByRole("dialog", { name: "Deck Masters" })).getByText("Your Master")).toBeTruthy();
  });

  it("puts the settings tools in the Settings sheet", () => {
    media(true);
    render(<Harness state={stateWith("normal")} settingsTools={<button type="button">Surrender</button>} />);
    fireEvent.click(within(screen.getByLabelText("Mobile duel panels")).getByRole("button", { name: "Settings" }));
    expect(within(screen.getByRole("dialog", { name: "Settings" })).getByRole("button", { name: "Surrender" })).toBeTruthy();
  });

  it("reports the sheet open state to the shell", () => {
    media(true);
    const onSheetOpenChange = vi.fn();
    function Controlled() {
      const base = useFixtureController(stateWith("normal"), { reducedMotion: true });
      const ui = useTableUi(base);
      return <TagSide controller={ui.controller} ui={ui} onSheetOpenChange={onSheetOpenChange} />;
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("button", { name: "Card" }));
    expect(onSheetOpenChange).toHaveBeenLastCalledWith(true);
  });
});

describe("TagPileViewer owner side", () => {
  it("reads your partner's pile as your side", () => {
    media(false);
    render(<Harness state={stateWith("normal", 0)} pileSeat={2} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "open pile" })); });
    expect(document.querySelector("[data-owner]")?.getAttribute("data-owner")).toBe("you");
  });

  it("reads a rival's pile as the opposing side", () => {
    media(false);
    render(<Harness state={stateWith("normal", 0)} pileSeat={1} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "open pile" })); });
    expect(document.querySelector("[data-owner]")?.getAttribute("data-owner")).toBe("opp");
  });

  it("reads team 0 as your side for a spectator", () => {
    media(false);
    render(<Harness state={stateWith("normal", null)} pileSeat={2} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "open pile" })); });
    expect(document.querySelector("[data-owner]")?.getAttribute("data-owner")).toBe("you");
  });
});
