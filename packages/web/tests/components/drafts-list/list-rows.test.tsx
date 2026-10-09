// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FloorList, SheetRoot } from "@/components/sheet";
import { LiveDraftRow, WaitingDraftRow } from "@/components/draft/list/draft-rows";
import { FinishedLedger } from "@/components/draft/list/finished-ledger";
import { parseDraftConfig, type DraftListItem } from "@/components/draft/list/drafts-list-model";

const draft: DraftListItem = {
  id: 1, name: "Friday cube night", status: "active", webSlug: "friday", playerCount: 3,
  wave: 1, pick: 2, createdAt: "2026-10-02 12:00:00",
  // This is an active draft: preserve its saved deal boundaries.
  config: parseDraftConfig(JSON.stringify({ packsPerPlayer: 3, pickSeconds: 600 }), "active"),
};

const wrap = (node: React.ReactNode) => render(<SheetRoot><FloorList>{node}</FloorList></SheetRoot>);

describe("draft list rows", () => {
  it("live row: one link with the name, separate pieces, the stage line and the room button", () => {
    wrap(<LiveDraftRow draft={draft} />);
    const row = screen.getByRole("link", { name: /Friday cube night/ });
    expect(row.closest("li")).toHaveAttribute("data-you", "true");
    const pieces = row.querySelector("ul")!;
    expect(Array.from(pieces.children, (item) => item.textContent)).toEqual(["Drafting", "Cube draft", "3 players", "10 min a pick"]);
    const stages = within(row).getByRole("list", { name: "Progress of Friday cube night" });
    expect(within(stages).getByText("Draft").closest("li")).toHaveAttribute("aria-current", "step");
    expect(within(stages).getByText("Lobby").closest("li")).toHaveAttribute("data-state", "done");
    expect(row).toHaveTextContent("Pack 1 of 3, pick 2");
    expect(row).toHaveTextContent("Open draft room");
    expect(row.textContent).not.toMatch(/[\u00b7]/);
  });

  it("live row without a web slug is not a link and has no room button", () => {
    wrap(<LiveDraftRow draft={{ ...draft, webSlug: undefined }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText("Open draft room")).toBeNull();
  });

  it.each([1, 3])("waiting row with %i joined: status, kind and created day as separate pieces, the count in words", (count) => {
    wrap(<WaitingDraftRow draft={{ ...draft, status: "pending", playerCount: count }} />);
    const row = screen.getByRole("link");
    expect(Array.from(row.querySelector("ul")!.children, (item) => item.textContent)).toEqual([
      "Waiting to start", "Cube draft", "Created Fri, Oct 2",
    ]);
    expect(row).toHaveTextContent(`${count} joined`);
    expect(row).toHaveAccessibleName(new RegExp(`Waiting to start.*Cube draft.*Created Fri, Oct 2.*${count} joined$`));
  });

  it("omits an unavailable created date and names the theme kind", () => {
    wrap(<WaitingDraftRow draft={{ ...draft, status: "pending", createdAt: undefined, config: parseDraftConfig('{"mode":"theme"}') }} />);
    const row = screen.getByRole("link");
    expect(Array.from(row.querySelector("ul")!.children, (item) => item.textContent)).toEqual(["Waiting to start", "Theme draft"]);
  });

  it("finished rows: cancelled reads as quiet text in the ended cell, the kind and count stay beside it", () => {
    render(<SheetRoot><FinishedLedger items={[
      { ...draft, status: "cancelled" },
      { ...draft, id: 2, name: "Theme night", webSlug: "theme", status: "completed", endedAt: "2026-10-02 12:00:00", config: parseDraftConfig('{"mode":"theme"}') },
    ]} /></SheetRoot>);
    for (const [name, kind, ended] of [["Friday cube night", "Cube draft", "Cancelled"], ["Theme night", "Theme draft", "Oct 2"]]) {
      const row = screen.getByRole("link", { name: new RegExp(name) });
      expect(row).toHaveTextContent(kind);
      expect(row).toHaveTextContent("3 players");
      expect(row).toHaveTextContent(ended);
    }
  });
});
