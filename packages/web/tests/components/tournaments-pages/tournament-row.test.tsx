// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TournamentRow } from "../../../src/components/tournament/tournament-row";

afterEach(cleanup);

describe("TournamentRow", () => {
  it.each([
    ["running", "In progress", ".live-pill"],
    ["open", "Open to join", ".status"],
  ] as const)("keeps the %s status first and each fact with one separator", (variant, statusText, statusSelector) => {
    render(
      <TournamentRow
        tournament={{
          id: 7,
          name: "Friday tournament",
          format: "round_robin",
          status: variant === "running" ? "active" : "pending",
          participantCount: 5,
        }}
        variant={variant}
      />
    );

    const row = screen.getByRole("link");
    const items = Array.from(row.querySelectorAll(".tl-meta > span > span"));
    expect(items.map((item) => item.textContent)).toEqual([statusText, "Round robin", "5 players"]);
    expect(items[0].querySelector(statusSelector)).toHaveTextContent(statusText);
    for (const item of items) {
      expect(item.querySelectorAll(".dot")).toHaveLength(1);
      expect(item.firstElementChild).toHaveClass("dot");
      expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
    if (variant === "open") {
      expect(items[0].querySelector(".lamp")).toHaveAttribute("data-s", "open");
    }
  });
});
