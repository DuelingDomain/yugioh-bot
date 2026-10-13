// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TournamentRow } from "../../../src/components/tournament/tournament-row";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

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

  describe("organizer cancel control", () => {
    const withSlug = (variant: "running" | "open") => ({ ...tournament(variant), webSlug: "friday" });

    it("shows no Cancel control unless the caller passes canCancel", () => {
      render(<ul><TournamentRow tournament={withSlug("open")} variant="open" /></ul>);
      expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    });

    it("shows no Cancel control for a row with no web slug, which has no cancel endpoint", () => {
      render(<ul><TournamentRow tournament={tournament("open")} variant="open" canCancel /></ul>);
      expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    });

    it("opens the dialog on Cancel, asks first, then deletes by slug and reports the row", async () => {
      const fetchMock = vi.fn(async () => Response.json({ id: 7, status: "cancelled" }));
      vi.stubGlobal("fetch", fetchMock);
      const onCancelled = vi.fn();
      render(<ul><TournamentRow tournament={withSlug("running")} variant="running" canCancel onCancelled={onCancelled} /></ul>);
      fireEvent.click(screen.getByRole("button", { name: "Cancel Friday tournament" }));
      const dialog = await screen.findByRole("dialog", { name: "Cancel Friday tournament?" });
      expect(dialog).toHaveTextContent("Live games in progress keep running");
      expect(fetchMock).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Yes, cancel" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/tournaments/friday", { method: "DELETE" }));
      await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(expect.objectContaining({ id: 7 })));
    });

    it("tells an open row's organizer that nothing was played", async () => {
      render(<ul><TournamentRow tournament={withSlug("open")} variant="open" canCancel /></ul>);
      fireEvent.click(screen.getByRole("button", { name: "Cancel Friday tournament" }));
      expect(await screen.findByRole("dialog", { name: "Cancel Friday tournament?" })).toHaveTextContent("5 players who joined");
    });
  });
});
