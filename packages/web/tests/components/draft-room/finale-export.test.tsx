// @vitest-environment jsdom
import { fixtureUserId, fixtureDiscordId } from "../../fixtures/identity";
import React, { type ComponentPropsWithRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../../src/lib/stores/draft-store";
import DraftDetailPage from "../../../app/(app)/draft/[slug]/page";

const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "finale-draft" }),
  useRouter: () => router,
}));
vi.mock("next/font/google", () => {
  const font = () => ({ variable: "--mock-font" });
  return {
    Newsreader: font,
    Oxanium: font,
    Sofia_Sans_Extra_Condensed: font,
    Sofia_Sans_Semi_Condensed: font,
  };
});
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentPropsWithRef<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/lib/hooks/use-draft-websocket", () => ({ useDraftWebsocket: () => {} }));
vi.mock("@/lib/hooks/use-draft-countdown", () => ({ useDraftCountdown: () => {} }));
vi.mock("@/lib/hooks/use-draft-expiry-resync", () => ({ useDraftExpiryResync: () => {} }));
vi.mock("@/lib/hooks/use-pool-image-prefetch", () => ({ usePoolImagePrefetch: () => {} }));
vi.mock("@/components/draft/room/draft-room", () => ({ DraftRoom: () => null }));
vi.mock("@/components/draft/draft-summary-view", () => ({ DraftSummaryView: () => null }));
vi.mock("@/components/draft/draft-manage-view", () => ({ DraftManageView: () => null }));
vi.mock("@/components/cubes/cube-lobby-panel", () => ({ CubeLobbyPanel: () => null }));
vi.mock("@/components/cubes/cube-draft-builder", () => ({ CubeDraftBuilder: () => null }));

const pool = [{
  id: 1,
  passcode: 100001,
  name: "Card 1",
  type: "Effect Monster",
  frameType: "effect",
  level: 4,
  effectText: "Does a thing.",
  imageUrl: "/c/1.jpg",
  imageUrlSmall: "/c/1s.jpg",
}];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function openFinale(exportResponse: () => Promise<Response>) {
  let completed = false;
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/auth/session") return Promise.resolve(Response.json({ user: { id: String(fixtureUserId("user-1")), discordUserId: fixtureDiscordId("user-1") } }));
    if (url === "/api/drafts/finale-draft/export") return exportResponse();
    if (url === "/api/drafts/finale-draft") {
      return Promise.resolve(Response.json({
        id: 1,
        name: "Friday Draft",
        status: completed ? "completed" : "active",
        createdByUserId: fixtureUserId("user-1"),
        createdAt: "2026-10-02T00:00:00Z",
        config: { packSize: 1, packsPerPlayer: 1, cardsPerPlayer: 1, pickSeconds: 60 },
        players: [],
        playerCount: 1,
        isParticipant: true,
        myPool: pool,
        completed,
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  }));

  render(<DraftDetailPage />);
  await waitFor(() => expect(useDraftStore.getState().slug).toBe("finale-draft"));
  completed = true;
  act(() => useDraftStore.setState({ completed: true }));
  return within(await screen.findByRole("dialog", { name: "Draft complete" }));
}

beforeEach(() => {
  useDraftStore.setState(useDraftStore.getInitialState());
});

afterEach(() => {
  cleanup();
  useDraftStore.setState(useDraftStore.getInitialState());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("finale export", () => {
  it("disables the export button and shows Exporting while the request is pending", async () => {
    const request = deferred<Response>();
    const finale = await openFinale(() => request.promise);
    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));

    expect(finale.getByRole("button", { name: "Exporting…" })).toBeDisabled();
    expect(finale.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => {
      request.resolve(Response.json({ error: "Deck is not complete yet" }, { status: 400 }));
    });
    expect((await finale.findByRole("alert")).textContent).toBe("Couldn't export the YDK file. Deck is not complete yet.");
    expect(finale.getByRole("button", { name: "Export YDK" })).toBeEnabled();
  });

  it.each([
    ["Deck is not complete yet", "Couldn't export the YDK file. Deck is not complete yet."],
    ["Deck is not complete yet.", "Couldn't export the YDK file. Deck is not complete yet."],
    ["  Deck is not complete yet  ", "Couldn't export the YDK file. Deck is not complete yet."],
    ["", "Couldn't export the YDK file."],
  ])("shows an export alert for the server message %j and re-enables the button", async (error, expected) => {
    const finale = await openFinale(async () => Response.json({ error }, { status: 400 }));
    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));

    expect((await finale.findByRole("alert")).textContent).toBe(expected);
    expect(finale.getByRole("button", { name: "Export YDK" })).toBeEnabled();
  });

  it("shows the fallback alert when a failed response has no JSON error message", async () => {
    const finale = await openFinale(async () => new Response("Unavailable", { status: 503 }));
    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));

    expect((await finale.findByRole("alert")).textContent).toBe("Couldn't export the YDK file.");
    expect(finale.getByRole("button", { name: "Export YDK" })).toBeEnabled();
  });

  it("shows the fallback alert on a network failure", async () => {
    const finale = await openFinale(async () => { throw new TypeError("Failed to fetch"); });
    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));

    expect((await finale.findByRole("alert")).textContent).toBe("Couldn't export the YDK file.");
    expect(finale.getByRole("button", { name: "Export YDK" })).toBeEnabled();
  });

  it("clears the previous export error as soon as a retry starts", async () => {
    const retry = deferred<Response>();
    const exportResponse = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Deck is not complete yet" }, { status: 400 }))
      .mockReturnValueOnce(retry.promise);
    const finale = await openFinale(exportResponse);
    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));
    await finale.findByRole("alert");

    fireEvent.click(finale.getByRole("button", { name: "Export YDK" }));
    expect(finale.queryByRole("alert")).not.toBeInTheDocument();
    expect(finale.getByRole("button", { name: "Exporting…" })).toBeDisabled();

    await act(async () => {
      retry.resolve(Response.json({ error: "Try again later" }, { status: 503 }));
    });
    expect((await finale.findByRole("alert")).textContent).toBe("Couldn't export the YDK file. Try again later.");
    expect(finale.getByRole("button", { name: "Export YDK" })).toBeEnabled();
  });
});

const FIXTURE_KEYS = ["user-1"] as const;
