// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetHeader } from "@/components/tournament/sheet/sheet-header";
import styles from "@/components/tournament/sheet/sheet-header.module.css";
import type { TournamentProgress } from "@/components/tournament/sheet/sheet-model";
import type { TournamentDetail } from "@/components/tournament/types";

const tournament: TournamentDetail = {
  id: 70,
  name: "Friday Night Duels",
  format: "round_robin",
  status: "active",
  createdByUserId: "host",
  participants: Array.from({ length: 5 }, (_, index) => ({ playerId: index + 1, displayName: `Player ${index + 1}` })),
  matches: [],
  isParticipant: false,
  currentUserPlayerId: null,
  startedAt: "2026-10-02T19:55:00Z",
  createdAt: "2026-10-01T19:55:00Z",
  bestOf: 3,
};

const progress: TournamentProgress = {
  done: 0, total: 10, live: 0, toConfirm: 0, yours: 0, notStarted: 10,
  currentRound: null, totalRounds: null,
};

describe("SheetHeader meta facts", () => {
  it.each([
    {
      name: "an active round robin tournament",
      tournament,
      progress,
      facts: ["In progress", "Round robin", "5 players", expect.stringMatching(/^Started /)],
      statusSelector: ".live-pill",
    },
    {
      name: "a pending elimination tournament",
      tournament: { ...tournament, status: "pending", format: "single_elim" },
      progress,
      facts: ["Open to join", "Single elimination", "Best of 3", "5 players"],
      statusSelector: '.status .lamp[data-s="open"]',
    },
    {
      name: "an active elimination tournament with rounds",
      tournament: { ...tournament, format: "single_elim" },
      progress: { ...progress, currentRound: 1, totalRounds: 3 },
      facts: ["In progress", "Single elimination", "5 players", expect.stringMatching(/^Started /), "Round 1 of 3"],
      statusSelector: ".live-pill",
    },
    {
      name: "an active tournament without a start date",
      tournament: { ...tournament, startedAt: null },
      progress,
      facts: ["In progress", "Round robin", "5 players"],
      statusSelector: ".live-pill",
    },
    {
      name: "a pending tournament without rules",
      tournament: { ...tournament, status: "pending", bestOf: undefined },
      progress,
      facts: ["Open to join", "Round robin", "5 players"],
      statusSelector: '.status .lamp[data-s="open"]',
    },
  ])("keeps the status first and each fact with its dot for $name", ({ tournament, progress, facts, statusSelector }) => {
    const { container } = render(<SheetHeader tournament={tournament} progress={progress} mine={false} ending={null} />);
    const meta = container.querySelector("p.t-meta")!;
    expect(meta.children).toHaveLength(1);
    const items = Array.from(meta.firstElementChild!.children);

    expect(items.map((item) => item.textContent)).toEqual(facts);
    expect(meta.querySelectorAll(".dot")).toHaveLength(facts.length);
    expect(items[0].querySelector(statusSelector)).not.toBeNull();
    for (const item of items) {
      expect(item.tagName).toBe("SPAN");
      expect(item.querySelectorAll(".dot")).toHaveLength(1);
      expect(item.firstElementChild).toHaveClass("dot");
      expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("attaches the responsive module class to the tournament track", () => {
    const { container } = render(<SheetHeader tournament={tournament} progress={progress} mine={false} ending={null} />);
    expect(container.querySelector(".trk")).toHaveClass(styles.track);
  });
});
