// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DraftRow, TournamentRow } from "@/components/dashboard/dashboard-rows";

afterEach(cleanup);

describe("dashboard row metadata", () => {
  it.each([
    { status: "active", contents: ["In progress", "Round robin", "8 players"] },
    { status: "pending", contents: ["Open to join", "Round robin", "8 joined"] },
  ])("keeps each $status tournament fact as plain text, status first", ({ status, contents }) => {
    render(
      <ul>
        <TournamentRow tournament={{
          id: 1,
          name: "Weekend Championship",
          format: "round_robin",
          status,
          webSlug: "weekend-championship",
          participantCount: 8,
        }} />
      </ul>,
    );

    const row = screen.getByRole("listitem");
    expect(row).toHaveAttribute("data-you", "true");
    const name = screen.getByRole("link", { name: "Weekend Championship" });
    expect(name).toHaveAttribute("href", "/tournament/weekend-championship");
    const meta = name.parentElement!.querySelector("p")!;
    expect(Array.from(meta.children).map((item) => item.textContent)).toEqual(contents);
    expect(meta.textContent).not.toContain("·");
    if (status === "active") expect(meta.querySelector(".sv-ldot")).toBeInTheDocument();
  });

  it.each([
    { status: "active", contents: ["Drafting", "Pack 1, pick 1", "8 players"], live: true },
    { status: "pending", contents: ["In the lobby", "8 players"], live: false },
  ])("keeps each $status draft fact as plain text and omits absent progress", ({ status, contents, live }) => {
    render(
      <ul>
        <DraftRow draft={{
          id: 1,
          name: "Friday Night Draft",
          status,
          webSlug: "friday-night-draft",
          currentPackRound: 1,
          currentPickStep: 1,
          playerCount: 8,
        }} />
      </ul>,
    );

    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/draft/friday-night-draft");
    expect(screen.getByRole("listitem")).toHaveAttribute("data-you", "true");
    const meta = row.querySelector("p:nth-of-type(2)")!;
    expect(Array.from(meta.children).map((item) => item.textContent)).toEqual(contents);
    expect(meta.textContent).not.toContain("·");
    expect(Boolean(meta.querySelector(".sv-ldot"))).toBe(live);
    expect(Boolean(screen.queryByText("Back to draft"))).toBe(live);
  });
});
