// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font, Russo_One: font, Chakra_Petch: font, Barlow_Semi_Condensed: font, Barlow_Condensed: font };
});
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: vi.fn() }) }));

import DashboardLoading from "../../app/(app)/dashboard/loading";
import TournamentsLoading from "../../app/(app)/tournaments/loading";
import DraftsLoading from "../../app/(app)/drafts/loading";
import LeaderboardLoading from "../../app/(app)/leaderboard/loading";
import { TournamentGate } from "@/components/tournament/sheet/tournament-gate";

afterEach(cleanup);

describe("loading skeletons", () => {
  it.each([
    ["dashboard", DashboardLoading, "Dashboard", "Loading your dashboard"],
    ["tournaments", TournamentsLoading, "Tournaments", "Loading tournaments"],
    ["drafts", DraftsLoading, "Drafts", "Loading drafts"],
    ["leaderboard", LeaderboardLoading, "Leaderboard", "Loading the leaderboard"],
  ] as const)("%s: a real heading from the first frame and one status over still blocks", (_name, Page, heading, label) => {
    const { container } = render(<Page />);
    expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    const status = screen.getByRole("status", { name: label });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status.querySelectorAll(".sk").length).toBeGreaterThan(4);
    expect(container.closest("body")?.querySelector(".ms")).not.toBeNull();
    // The blocks are hidden from assistive tech: the status is the only announcement.
    for (const section of Array.from(status.querySelectorAll("section"))) expect(section).toHaveAttribute("aria-hidden", "true");
  });

  it("the tournaments and drafts skeletons keep their primary action live", () => {
    render(<TournamentsLoading />);
    expect(screen.getByRole("link", { name: "New tournament" })).toHaveAttribute("href", "/tournaments/new");
    cleanup();
    render(<DraftsLoading />);
    expect(screen.getByRole("link", { name: "New draft" })).toHaveAttribute("href", "/drafts/new");
  });

  it("the tournament gate shows blocks, still named 'Loading tournament'", () => {
    render(<TournamentGate kind="loading" slug="x" />);
    const status = screen.getByRole("status", { name: "Loading tournament" });
    expect(within(status).queryByText(/loading/i)).toBeNull();
    expect(status.querySelectorAll(".sk")).toHaveLength(3);
  });
});
