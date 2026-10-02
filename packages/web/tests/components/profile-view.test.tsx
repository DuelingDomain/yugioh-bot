// @vitest-environment jsdom
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { ProfileView } from "@/components/player/profile-view";
import type { Profile } from "@/components/player/profile-model";

const profile = {
  playerId: 5, displayName: "Imran", rating: 1184, rank: { name: "Gold", min: 1100, nextAt: 1350 },
  winnings: 176, careerWinnings: 540, wins: 15, losses: 9, currentStreak: 1, bestStreak: 4,
  achievements: [
    { achievement_key: "giant_slayer", unlocked_at: "2026-08-21 10:00:00" },
    { achievement_key: "first_tournament_win", unlocked_at: "2026-06-12 10:00:00" },
  ],
  recent: [
    { kind: "placement", points: 15, created_at: "2020-09-24 10:00:00", tournament_id: 11, tournament_name: "Friday Night Duels #11" },
    { kind: "match", points: 5, created_at: "2020-09-19 10:00:00", tournament_id: 11, tournament_name: "Friday Night Duels #11" },
    { kind: "match", points: 7, created_at: "2020-09-05 10:00:00", tournament_id: null, tournament_name: null },
  ],
} as unknown as Profile;

beforeEach(() => window.localStorage.clear());

describe("profile view", () => {
  it("shows the four season readouts with the tier, Elo and place", () => {
    const { container } = render(<ProfileView profile={profile} leaderboardRank={5} isMe />);
    expect(screen.getByRole("heading", { level: 1, name: "Imran" })).toBeInTheDocument();
    expect(screen.getByText("you")).toBeInTheDocument();
    expect(container.querySelector(".pf-tier")!.textContent).toContain("1184 Elo");
    expect(container.querySelector(".pf-tier")!.textContent).toContain("#5 this season");
    const lps = container.querySelector(".pf-lps")!;
    expect(lps.textContent).toContain("176");
    expect(lps.textContent).toContain("15–9");
    expect(lps.textContent).toContain("63% won");
    expect(lps.textContent).toContain("best 4 this season");
    expect(lps.textContent).toContain("540");
    expect(screen.getByRole("img", { name: "84 of 250 Elo through Gold" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "all tiers" })).toHaveAttribute("href", "/leaderboard#tiers");
  });

  it("drops record and streak in the all-time view and without a season", () => {
    const { container } = render(<ProfileView profile={profile} leaderboardRank={4} hasSeason={false} />);
    expect(screen.queryByRole("group", { name: "Profile scope" })).toBeNull();
    const lps = container.querySelector(".lps")!.textContent!;
    expect(lps).not.toContain("Record");
    expect(lps).not.toContain("Streak");
    expect(lps).not.toContain("0–0");
    expect(lps).toContain("Career winnings");
    expect(screen.queryByText("you")).toBeNull();
  });

  it("calls the list Winnings earned and reads placings as Placing", () => {
    render(<ProfileView profile={profile} leaderboardRank={5} />);
    const log = screen.getByRole("region", { name: "Winnings earned" });
    expect(within(log).getByText("Placing")).toBeInTheDocument();
    expect(within(log).getByText("+15")).toBeInTheDocument();
    expect(within(log).getByText("Ranked matches")).toBeInTheDocument();
    expect(screen.queryByText("Recent Activity")).toBeNull();
  });

  it("writes out every achievement with criteria, dates and countable progress", () => {
    render(<ProfileView profile={profile} leaderboardRank={5} isMe />);
    expect(screen.getByText("2 of 6 unlocked")).toBeInTheDocument();
    expect(screen.getByText("Beat the server's highest-rated player while rated below them.")).toBeInTheDocument();
    expect(screen.getByText("Fri, Aug 21")).toBeInTheDocument();
    expect(screen.getByText("540 of 1,000")).toBeInTheDocument();
    expect(screen.getByText("540 of 5,000")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "54 percent" })).toBeInTheDocument();
    expect(screen.getByText("Win 10 matches in a row inside one season.")).toBeInTheDocument();
    expect(screen.getAllByText("Not yet")).toHaveLength(2);
    expect(screen.getAllByRole("img", { name: /percent/ })).toHaveLength(2);
  });

  it("shows no progress on someone else's profile", () => {
    render(<ProfileView profile={profile} leaderboardRank={5} />);
    expect(screen.queryByText("540 of 1,000")).toBeNull();
    expect(screen.queryByText("Not yet")).toBeNull();
    expect(screen.getByText("Earn 1,000 winnings across all seasons.")).toBeInTheDocument();
  });

  it("lights new unlocks once, after the first visit has recorded the list", async () => {
    window.localStorage.setItem("achievements:seen:5", JSON.stringify(["first_tournament_win"]));
    render(<ProfileView profile={profile} leaderboardRank={5} isMe />);
    await waitFor(() => expect(screen.getByText("1 new")).toBeInTheDocument());
    expect(document.querySelectorAll('li[data-a="new"]')).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem("achievements:seen:5")!)).toContain("giant_slayer");
  });
});

describe("rank-up pop", () => {
  it("pops the gem, shows the chip and records the tier when the tier rose", async () => {
    window.localStorage.setItem("rank:lastSeen:5", "Silver");
    render(<ProfileView profile={profile} leaderboardRank={5} />);
    await waitFor(() => expect(screen.getByTestId("profile-gem").className).toContain("rank-pop"));
    expect(screen.getByText("Up to Gold")).toBeInTheDocument();
    expect(window.localStorage.getItem("rank:lastSeen:5")).toBe("Gold");
  });

  it("does not pop on a first-ever view but still records the tier", async () => {
    render(<ProfileView profile={profile} leaderboardRank={5} />);
    await waitFor(() => expect(window.localStorage.getItem("rank:lastSeen:5")).toBe("Gold"));
    expect(screen.getByTestId("profile-gem").className).not.toContain("rank-pop");
    expect(screen.queryByText(/Up to/)).toBeNull();
  });

  it("does not pop when the tier is unchanged", async () => {
    window.localStorage.setItem("rank:lastSeen:5", "Gold");
    render(<ProfileView profile={profile} leaderboardRank={5} />);
    expect(screen.getByTestId("profile-gem").className).not.toContain("rank-pop");
  });
});
