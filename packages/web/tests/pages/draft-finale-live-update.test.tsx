// @vitest-environment jsdom
import { fixtureUserId, fixtureDiscordId } from "../fixtures/identity";
import React, { type ComponentPropsWithRef } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../src/lib/stores/draft-store";

// The real finale on the real page: a draft:seats refetch brings the tournament in while a
// non-host player is looking at the finale.
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "test-draft" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "--mock-font" });
  return { Newsreader: font, Oxanium: font, Sofia_Sans_Extra_Condensed: font, Sofia_Sans_Semi_Condensed: font };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentPropsWithRef<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("../../src/lib/hooks/use-draft-websocket", () => ({ useDraftWebsocket: vi.fn() }));
vi.mock("../../src/lib/hooks/use-draft-countdown", () => ({ useDraftCountdown: vi.fn() }));
vi.mock("../../src/lib/hooks/use-draft-expiry-resync", () => ({ useDraftExpiryResync: vi.fn() }));
vi.mock("../../src/components/draft/draft-summary-view", () => ({ DraftSummaryView: () => <div>Summary</div> }));
vi.mock("../../src/components/draft/room/draft-room", () => ({ DraftRoom: () => <div data-testid="draft-room">Room</div> }));

import DraftDetailPage from "../../app/(app)/draft/[slug]/page";
import { useDraftWebsocket } from "../../src/lib/hooks/use-draft-websocket";

const card = { id: 1, passcode: 100001, name: "A", type: "Effect Monster", frameType: "effect", effectText: "", imageUrl: "", imageUrlSmall: "" };
const active = {
  id: 1,
  name: "Test Draft",
  status: "active",
  createdByUserId: fixtureUserId("host-1"),
  createdAt: "2026-05-06T12:00:00.000Z",
  config: { packSize: 5, packsPerPlayer: 3, pickSeconds: 60, setNames: [] },
  players: [],
  playerCount: 2,
  isParticipant: true,
  myPool: [card],
  seats: [],
  completed: false,
  pickSeconds: 60,
};
const completed = { ...active, status: "completed", completed: true, endedAt: "2026-05-06T12:30:00.000Z", canCreateTournament: false };

describe("DraftDetailPage finale — live tournament update", () => {
  let draftBody: Record<string, unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.setState({ slug: "test-draft", myPool: [], seats: [], completed: false });
    draftBody = active;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      const body = url === "/api/auth/session" ? { user: { id: String(fixtureUserId("player-2")), discordUserId: fixtureDiscordId("player-2") } } : url.endsWith("/pool") ? { cards: [] } : draftBody;
      return Promise.resolve({ ok: true, json: async () => body } as Response);
    });
  });
  afterEach(() => useDraftStore.setState({ myPool: [], seats: [], completed: false }));

  it("turns the non-host finale into Go to tournament without moving focus", async () => {
    render(<DraftDetailPage />);
    await waitFor(() => expect(screen.getByTestId("draft-room")).toBeTruthy());

    draftBody = completed;
    act(() => vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onResync?.());

    const deck = await screen.findByRole("link", { name: "View your deck" });
    await waitFor(() => expect(document.activeElement).toBe(deck));
    expect(screen.getByText("The host will start the tournament.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create tournament" })).toBeNull();

    draftBody = { ...completed, tournamentId: 4, tournamentName: "Cup", tournamentSlug: "cup" };
    act(() => vi.mocked(useDraftWebsocket).mock.calls.at(-1)?.[1]?.onSeatsChange?.());

    const go = await screen.findByRole("link", { name: "Go to tournament" });
    expect(go.getAttribute("href")).toBe("/tournament/cup");
    expect(screen.getByText("The tournament is ready. Saved draft decks are registered for it.")).toBeTruthy();
    expect(document.activeElement).toBe(deck);
  });
});

const FIXTURE_KEYS = ["host-1", "player-2"] as const;
