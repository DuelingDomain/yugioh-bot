// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DraftRow, TournamentRow } from "@/components/dashboard/dashboard-rows";

afterEach(cleanup);

function expectMetaItems(row: HTMLElement, contents: string[]) {
  const meta = row.querySelector(".mt");
  expect(meta?.tagName).toBe("P");
  expect(meta?.children).toHaveLength(1);
  const run = meta?.firstElementChild;
  expect(run?.tagName).toBe("SPAN");
  const items = Array.from(run?.children ?? []);
  expect(items.map((item) => item.textContent)).toEqual(contents);
  expect(meta?.querySelectorAll(".dot")).toHaveLength(contents.length);
  for (const item of items) {
    expect(item.tagName).toBe("SPAN");
    expect(item.querySelectorAll(".dot")).toHaveLength(1);
    expect(item.firstElementChild).toHaveClass("dot");
    expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
  }
  return items;
}

describe("dashboard row metadata", () => {
  it.each([
    { status: "active", contents: ["In progress", "Round robin", "8 players"], statusClass: ".live-pill" },
    { status: "pending", contents: ["Open to join", "Round robin", "8 joined"], statusClass: ".status" },
  ])("keeps each $status tournament fact with its dot, status first", ({ status, contents, statusClass }) => {
    render(<TournamentRow tournament={{
      id: 1,
      name: "Weekend Championship",
      format: "round_robin",
      status,
      webSlug: "weekend-championship",
      participantCount: 8,
    }} />);

    const row = screen.getByRole("link");
    const items = expectMetaItems(row, contents);
    expect(items[0].querySelector(statusClass)).toBeInTheDocument();
    expect(row).toHaveAttribute("href", "/tournament/weekend-championship");
    expect(row.querySelector(".trk")).toHaveClass("sm");
  });

  it.each([
    { status: "active", contents: ["Drafting", "Pack 1, pick 1", "8 players"], statusClass: ".live-pill" },
    { status: "pending", contents: ["In the lobby", "8 players"], statusClass: ".status" },
  ])("keeps each $status draft fact with its dot and omits absent progress", ({ status, contents, statusClass }) => {
    render(<DraftRow draft={{
      id: 1,
      name: "Friday Night Draft",
      status,
      webSlug: "friday-night-draft",
      currentPackRound: 1,
      currentPickStep: 1,
      playerCount: 8,
    }} />);

    const row = screen.getByRole("link");
    const items = expectMetaItems(row, contents);
    expect(items[0].querySelector(statusClass)).toBeInTheDocument();
    expect(row).toHaveAttribute("href", "/draft/friday-night-draft");
  });
});
