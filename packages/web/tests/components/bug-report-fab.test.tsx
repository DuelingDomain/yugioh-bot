// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BugReportFab } from "@/components/bug-report/bug-report-fab";
import { BugReportHeaderButton } from "@/components/bug-report/bug-report-header-button";
import { getBugReportRoom, useBugReportRoom } from "@/components/bug-report/room-store";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) => String(url).endsWith("/precheck") ? new Response(JSON.stringify({ knownLimits: [], duplicates: [] })) : new Response(JSON.stringify({ id: 4, issue: { number: 77, url: "https://github.com/imran443/yugioh-bot/issues/77" } }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  window.history.replaceState(null, "", "/leaderboard");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Room({ room }: { room: typeof FFA3_FIXTURES.states.main.room }) {
  useBugReportRoom(room);
  return <p>room</p>;
}

describe("floating Report bug button", () => {
  it("is a red button fixed at the bottom-left, using the design tokens", () => {
    render(<BugReportFab />);
    const button = screen.getByRole("button", { name: "Report bug" });
    expect(button.className).toContain("fixed");
    expect(button.className).toContain("bottom-3 left-3");
    expect(button.className).toContain("bg-accent-cta");
    expect(button.className).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("sends a page report with the path only outside a duel", async () => {
    render(<BugReportFab />);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "Page is slow for everyone today" } });
    fireEvent.change(screen.getByLabelText(/What did you expect\?/), { target: { value: "It should load quickly" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    expect(await screen.findByRole("link", { name: "#77" })).toBeTruthy();
    const body = JSON.parse(fetchMock.mock.calls.filter(([url]) => url === "/api/bug-reports")[0]![1].body as string);
    expect(body).toMatchObject({ description: "Page is slow for everyone today", path: "/leaderboard" });
    expect(body.duelSlug).toBeUndefined();
    expect(body.context.format).toBeUndefined();
  });

  it("takes the place its caller gives it", () => {
    render(<BugReportFab className="fixed bottom-3 z-40 shell-offset" />);
    const button = screen.getByRole("button", { name: "Report bug" });
    expect(button.className).toContain("shell-offset");
    expect(button.className).not.toContain("left-3");
    expect(button.className).toContain("bg-accent-cta");
  });

  it("steps aside while a duel header has its own Report bug button, and comes back after", () => {
    const room = FFA3_FIXTURES.states.main.room;
    const view = render(<><BugReportFab /><BugReportHeaderButton room={room} /></>);
    expect(screen.getAllByRole("button", { name: "Report bug" })).toHaveLength(1);
    expect(document.querySelector("[data-bug-fab]")).toBeNull();
    expect(document.querySelector("[data-bug-header-button]")).not.toBeNull();
    view.rerender(<BugReportFab />);
    expect(document.querySelector("[data-bug-fab]")).not.toBeNull();
  });

  it("keeps the header button red with important classes, because the Rooftop resets every button", () => {
    render(<BugReportHeaderButton room={FFA3_FIXTURES.states.main.room} />);
    const button = screen.getByRole("button", { name: "Report bug" });
    expect(button.className).toContain("bg-accent-cta!");
    expect(button.className).toContain("text-white!");
    expect(button.className).toContain("text-xs!");
  });

  it("sends the duel on screen, and forgets it when the room goes away", async () => {
    const room = FFA3_FIXTURES.states.main.room;
    const view = render(<><Room room={room} /><BugReportFab /></>);
    expect(getBugReportRoom()).toBe(room);
    fireEvent.click(screen.getByRole("button", { name: "Report bug" }));
    fireEvent.change(screen.getByLabelText(/What went wrong\?/), { target: { value: "Chain froze and nothing happened" } });
    fireEvent.change(screen.getByLabelText(/What did you expect\?/), { target: { value: "The chain should resolve" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Send report" })); });
    await screen.findByTestId("bug-report-done");
    const body = JSON.parse(fetchMock.mock.calls.filter(([url]) => url === "/api/bug-reports")[0]![1].body as string);
    expect(body.duelSlug).toBe(room.session.slug);
    expect(body.context).toMatchObject({ format: "ffa3", seat: room.mySeat });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.rerender(<BugReportFab />);
    expect(getBugReportRoom()).toBeNull();
  });
});
