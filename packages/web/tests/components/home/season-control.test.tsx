// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeasonControl, seasonDay } from "@/components/settings/season-control";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const active = { id: 3, number: 3, name: null, status: "active", startedAt: "2026-08-04T10:00:00.000Z", endedAt: null };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("SeasonControl", () => {
  it("offers no Start while loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<SeasonControl />);
    screen.getByLabelText("Loading season");
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("offers Retry and no Start after a failed load", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({}, { status: 500 })));
    render(<SeasonControl />);
    await screen.findByText("Couldn't load the season.");
    screen.getByRole("button", { name: "Retry" });
    expect(screen.queryByRole("button", { name: /start/i })).toBeNull();
  });

  it("offers Start when no season runs and posts the optional name", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ season: active }) : Response.json({ season: null }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SeasonControl />);
    fireEvent.change(await screen.findByLabelText(/Name for the next season/), { target: { value: " Autumn " } });
    fireEvent.click(screen.getByRole("button", { name: "Start season" }));
    await screen.findByRole("heading", { name: "Season 3" });
    const post = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(post[1]!.body))).toEqual({ action: "start", name: "Autumn" });
  });

  it("confirms ending in place, spells out the next season, and posts end", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ season: { ...active, status: "ended" } }) : Response.json({ season: active }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SeasonControl />);
    fireEvent.click(await screen.findByRole("button", { name: "End season" }));
    screen.getByText("End Season 3?");
    screen.getByText(/starts by itself/);
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "End Season 3" }));
    await screen.findByText("No season running");
    expect(JSON.parse(String(fetchMock.mock.calls.find(([, i]) => i?.method === "POST")![1]!.body))).toEqual({ action: "end" });
  });

  it("keeps the confirm open with the reason when ending fails, and cancel returns", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "POST" ? Response.json({ error: "nope" }, { status: 400 }) : Response.json({ season: active })));
    render(<SeasonControl />);
    fireEvent.click(await screen.findByRole("button", { name: "End season" }));
    fireEvent.click(screen.getByRole("button", { name: "End Season 3" }));
    await screen.findByText("Couldn't end Season 3. It's still running. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Keep it running" }));
    await waitFor(() => screen.getByRole("button", { name: "End season" }));
  });

  it("never reads the all-time leaderboard", async () => {
    const fetchMock = vi.fn(async (_u?: RequestInfo | URL) => Response.json({ season: active }));
    vi.stubGlobal("fetch", fetchMock);
    render(<SeasonControl />);
    await screen.findByRole("heading", { name: "Season 3" });
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual(["/api/admin/season"]);
    expect(screen.queryByText(/champion/i)).toBeNull();
  });
});

describe("seasonDay", () => {
  it("counts the start day as day 1", () => {
    expect(seasonDay("2026-08-04T10:00:00.000Z", Date.parse("2026-08-04T12:00:00.000Z"))).toBe(1);
    expect(seasonDay("2026-08-04T10:00:00.000Z", Date.parse("2026-08-06T10:00:00.000Z"))).toBe(3);
  });
});
