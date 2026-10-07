import { fixtureUserId, fixtureDiscordId } from "./fixtures/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { referenceRows } from "./fixtures/leaderboard";

vi.mock("next/font/google", () => {
  // ./fonts loads every duel family; the LP digits use Oxanium.
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const { getActive } = vi.hoisted(() => ({ getActive: vi.fn() }));
vi.mock("@/lib/session-identity", async () => {
  const { sessionFixture } = await import("./fixtures/session");
  return sessionFixture((() => ({ auth: async () => ({ user: { id: String(fixtureUserId("imran")), discordUserId: fixtureDiscordId("imran") } }) }))().auth);
});
vi.mock("@/lib/env", () => ({ env: { discordGuildId: "guild-1" } }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ prepare: () => ({ get: () => ({ id: 5 }) }) }) }));
vi.mock("@yugidraft/shared/services", () => ({
  createScoringService: () => ({ getLeaderboard: () => referenceRows }),
  createSeasonService: () => ({ getActive }),
  createDuelService: () => ({ list: () => [] }),
}));

import LeaderboardPage from "../app/(app)/leaderboard/page";

afterEach(() => vi.unstubAllEnvs());

describe("leaderboard server composition", () => {
  it("passes only the season fields the view needs and a finished UTC date", async () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    getActive.mockReturnValue({ id: 3, guildId: "guild-1", number: 3, name: null, startedAt: "2026-08-04 18:02:11", status: "active", endedAt: null });
    const page = await LeaderboardPage();
    expect(page.props.activeSeason).toEqual({ number: 3, name: null, startedAt: "2026-08-04 18:02:11" });
    expect(page.props.seasonStartedOn).toBe("Tue, Aug 4");
    expect(page.props.currentPlayerId).toBe(5);
  });

  it("keeps a UTC midnight date from becoming the previous local day", async () => {
    vi.stubEnv("TZ", "Pacific/Honolulu");
    getActive.mockReturnValue({ number: 3, name: "Autumn League", startedAt: "2026-08-05 00:02:11" });
    expect((await LeaderboardPage()).props.seasonStartedOn).toBe("Wed, Aug 5");
  });

  it("passes null season metadata when the service has no active season", async () => {
    getActive.mockReturnValue(undefined);
    const page = await LeaderboardPage();
    expect(page.props.activeSeason).toBeNull();
    expect(page.props.seasonStartedOn).toBeNull();
  });
});

const FIXTURE_KEYS = ["imran"] as const;

// Session resolution is mocked; authorization still runs through the real web boundary.
