// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetRoot } from "@/components/sheet";
import { LiveDraftRow, WaitingDraftRow } from "@/components/draft/list/draft-rows";
import { FinishedLedger } from "@/components/draft/list/finished-ledger";
import { parseDraftConfig, type DraftListItem } from "@/components/draft/list/drafts-list-model";
import styles from "@/components/draft/list/drafts-list.module.css";

const draft: DraftListItem = {
  id: 1, name: "Friday cube night", status: "active", webSlug: "friday", playerCount: 3,
  wave: 1, pick: 2, createdAt: "2026-10-02 12:00:00",
  config: parseDraftConfig(JSON.stringify({ packsPerPlayer: 3, pickSeconds: 600 })),
};

describe("draft list rows", () => {
  it("keeps the name first, followed by sibling track and room chip for responsive placement", () => {
    render(<SheetRoot><LiveDraftRow draft={draft} /></SheetRoot>);
    const row = screen.getByRole("link", { name: /Friday cube night/ });
    const track = within(row).getByRole("list", { name: "Progress of Friday cube night" });
    expect(row.children[0]).toHaveClass(styles.details);
    expect(row.children[1]).toContainElement(track);
    expect(row.children[2]).toHaveClass(styles.side);
    expect(row.children[2]).toHaveTextContent("Open draft room");
    expect(row.children[2].querySelector("svg")).toHaveClass(styles.chevron);
    expect(row).toHaveTextContent("10 min a pick");
    expect(within(track).getByText("Draft").parentElement).toHaveAttribute("aria-current", "step");
    expect(row.querySelector(".trk-cap")).toHaveTextContent("Pack 1 of 3·pick 2");
  });

  it.each([1, 3])("puts %i joined after the created date and hides the duplicate from assistive technology", (count) => {
    render(<SheetRoot><WaitingDraftRow draft={{ ...draft, status: "pending", playerCount: count }} /></SheetRoot>);
    const row = screen.getByRole("link");
    const meta = row.querySelector(".tl-meta")!;
    const joined = within(meta as HTMLElement).getByLabelText(`${count} ${count === 1 ? "player" : "players"} joined`);
    expect(joined).toHaveTextContent(`${count} joined`);
    expect(joined.parentElement).toHaveClass(styles.joined);
    expect(meta.textContent).toContain(`Created Fri, Oct 2${count} joined`);
    expect(joined.previousElementSibling).toHaveClass("dot");
    expect(joined.previousElementSibling).toHaveAttribute("aria-hidden", "true");
    const bigCount = row.querySelector(".seats-mini")!;
    expect(bigCount).toHaveAttribute("aria-hidden", "true");
    expect(bigCount).toHaveTextContent(`${count}joined`);
    expect(row).toHaveAccessibleName(new RegExp(`${count} ${count === 1 ? "player" : "players"} joined$`));
  });

  it("keeps cancelled status in Ended and adds a responsive kind line under the name", () => {
    render(<SheetRoot><FinishedLedger items={[
      { ...draft, status: "cancelled" },
      { ...draft, id: 2, name: "Theme night", webSlug: "theme", status: "completed", endedAt: "2026-10-02 12:00:00", config: parseDraftConfig('{"mode":"theme"}') },
    ]} /></SheetRoot>);
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Draft", "Kind", "Players", "Ended"]);
    for (const [name, kind, ended] of [["Friday cube night", "Cube draft", "Cancelled"], ["Theme night", "Theme draft", "Oct 2"]]) {
      const row = screen.getByRole("link", { name }).closest("tr")!;
      const cells = within(row).getAllByRole("cell");
      expect(within(cells[0]).getByText(kind)).toHaveClass(styles.mobileKind);
      expect(cells[1]).toHaveClass(styles.kindColumn);
      expect(cells[3]).toHaveTextContent(ended);
    }
  });
});
