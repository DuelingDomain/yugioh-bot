// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TournamentRow } from "../../../src/components/tournament/tournament-row";

afterEach(cleanup);

const tournament = (variant: "running" | "open") => ({
  id: 7,
  name: "Friday tournament",
  format: "round_robin",
  status: variant === "running" ? "active" : "pending",
  participantCount: 5,
});

describe("TournamentRow", () => {
  it.each([
    ["running", ["In progress", "Round robin", "5 players"]],
    ["open", ["Open to join", "Round robin", "5 joined"]],
  ] as const)("keeps the %s status first and each fact as plain text", (variant, contents) => {
    render(<ul><TournamentRow tournament={tournament(variant)} variant={variant} /></ul>);

    const name = screen.getByRole("link", { name: "Friday tournament" });
    expect(name).toHaveAttribute("href", "/tournament/7");
    const meta = name.parentElement!.querySelector("p")!;
    expect(Array.from(meta.children).map((item) => item.textContent)).toEqual(contents);
    expect(meta.textContent).not.toContain("·");
    expect(Boolean(meta.querySelector(".sv-ldot"))).toBe(variant === "running");
  });

  it("is a single link with no strip or action when it has no pairings to read", () => {
    render(<ul><TournamentRow tournament={tournament("running")} variant="running" /></ul>);
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("list", { name: /rounds/i })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("starts with the name, with no initials ring in front of it, unless the dashboard asks for one", () => {
    const { container, rerender } = render(<ul><TournamentRow tournament={tournament("running")} variant="running" you /></ul>);
    expect(container.querySelector(".sv-mono")).toBeNull();
    rerender(<ul><TournamentRow tournament={tournament("running")} variant="running" you showYou /></ul>);
    expect(container.querySelectorAll(".sv-mono")).toHaveLength(1);
  });
});
