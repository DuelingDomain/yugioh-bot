// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SheetRoot } from "@/components/sheet";
import { RulesPanel } from "@/components/tournament/sheet/rules-panel";
import type { TournamentDetail } from "@/components/tournament/types";
import { sheetTournament } from "../fixtures/tournament-sheet";

describe("RulesPanel timing editor", () => {
  it("preserves edits for unchanged server settings and resets to a changed server confirm window", () => {
    const onChanged = vi.fn();
    const panel = (tournament: TournamentDetail) => (
      <SheetRoot>
        <RulesPanel tournament={tournament} tournamentSlug="friday-night-12" isHost onChanged={onChanged} />
      </SheetRoot>
    );
    const { rerender } = render(panel(sheetTournament));
    fireEvent.click(screen.getByRole("button", { name: "Edit confirm window" }));
    expect(screen.getByLabelText(/Confirm window/)).toHaveValue(24);
    fireEvent.change(screen.getByLabelText(/Confirm window/), { target: { value: "12" } });
    expect(screen.getByLabelText(/Confirm window/)).toHaveValue(12);

    rerender(panel({ ...sheetTournament }));
    expect(screen.getByLabelText(/Confirm window/)).toHaveValue(12);

    rerender(panel({ ...sheetTournament, reportConfirmWindowHours: 48 }));
    expect(screen.getByLabelText(/Confirm window/)).toHaveValue(48);
  });
});
