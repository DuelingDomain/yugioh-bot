// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NewDraftPage from "../app/(app)/drafts/new/page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("draft-type chooser", () => {
  it("offers a cube and a theme draft option", () => {
    render(<NewDraftPage />);
    expect(screen.getByRole("link", { name: /cube draft/i })).toHaveAttribute("href", "/drafts/new/cube");
    expect(screen.getByRole("link", { name: /theme draft/i })).toHaveAttribute("href", "/drafts/new/theme");
  });

  it("uses the forms' four stations with Create current and the chooser caption", () => {
    render(<NewDraftPage />);
    const track = screen.getByRole("list", { name: "Where creating leads" });
    expect(within(track).getAllByRole("listitem").map((station) => station.textContent)).toEqual([
      "NWCreate", "LBLobby", "DRDraft", "DKDecks",
    ]);
    expect(within(track).getByText("Create").parentElement).toHaveAttribute("aria-current", "step");
    expect(track.closest("header")?.querySelector(".trk-cap")).toHaveTextContent("Pick a kind·then set it up");
  });

  it("shows the real defaults above non-interactive Match Sheet actions", () => {
    render(<NewDraftPage />);
    for (const [kind, facts, action] of [
      ["cube", "Starts at 40 cards each, 3 packs of 15, 45 s a pick", "Set up a cube draft"],
      ["theme", "Starts at 40 main and 15 Extra deck picks, 3 choices a pick, 45 s a pick", "Set up a theme draft"],
    ]) {
      const card = screen.getByRole("link", { name: new RegExp(`${kind} draft`, "i") });
      const factRow = within(card).getByText(facts);
      const button = within(card).getByText(action);
      expect(button.tagName).toBe("SPAN");
      expect(button).toHaveClass("btn");
      expect(button).not.toHaveAttribute("tabindex");
      expect(button.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(factRow.nextElementSibling).toBe(button);
      expect(within(card).queryByRole("button")).toBeNull();
      expect(within(card).queryByRole("link")).toBeNull();
    }
  });
});
