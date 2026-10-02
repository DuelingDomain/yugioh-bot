// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));

const api = vi.hoisted(() => ({ createDuel: vi.fn(), searchPlayers: vi.fn() }));
vi.mock("../../src/components/duel/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/duel/api")>()),
  ...api,
}));

import { DuelCreator } from "../../src/components/duel/creator";

beforeEach(() => {
  push.mockReset();
  api.createDuel.mockReset().mockResolvedValue({ session: { slug: "table-1" }, notified: true });
  api.searchPlayers.mockReset().mockResolvedValue({ players: [{ id: 9, displayName: "Imran" }, { id: 12, displayName: "Imra" }] });
});
afterEach(cleanup);

const create = () => fireEvent.click(screen.getByRole("button", { name: /Create game|Send challenge/ }));

describe("DuelCreator match options", () => {
  it("defaults to an open Best of 1 unranked table, sent as today", async () => {
    render(<DuelCreator multiplayerTables />);
    expect((screen.getByRole("radio", { name: "Best of 1" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /Ranked/ }) as HTMLInputElement).checked).toBe(false);
    create();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/duels/table-1"));
    expect(api.createDuel.mock.calls[0][4]).toEqual({ opponentPlayerId: null, bestOf: 1, ranked: false });
  });

  it("sends Best of 3 and Ranked for an open table", async () => {
    render(<DuelCreator multiplayerTables />);
    fireEvent.click(screen.getByRole("radio", { name: "Best of 3" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Ranked/ }));
    create();
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(api.createDuel.mock.calls[0][4]).toEqual({ opponentPlayerId: null, bestOf: 3, ranked: true });
  });

  it("waits for a pause in typing, then searches once", async () => {
    render(<DuelCreator multiplayerTables />);
    const input = screen.getByRole("searchbox");
    fireEvent.change(input, { target: { value: "i" } });
    fireEvent.change(input, { target: { value: "im" } });
    fireEvent.change(input, { target: { value: "imr" } });
    await screen.findByRole("button", { name: "Imran" });
    expect(api.searchPlayers).toHaveBeenCalledTimes(1);
    expect(api.searchPlayers.mock.calls[0][0]).toBe("imr");
  });

  it("says when no player matches", async () => {
    api.searchPlayers.mockResolvedValue({ players: [] });
    render(<DuelCreator multiplayerTables />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(await screen.findByText("No players found.")).toBeTruthy();
  });

  it("challenges the picked player, shows the DM note and a copy link, and waits for the click into the room", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DuelCreator multiplayerTables />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    expect(screen.getByTestId("opponent-chip").textContent).toBe("Imran");
    create();
    expect(await screen.findByText("Challenge sent — the bot sent Imran a DM")).toBeTruthy();
    expect(api.createDuel.mock.calls[0][4]).toEqual({ opponentPlayerId: 9, bestOf: 1, ranked: false });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/duels/table-1`));
    expect(screen.getByRole("link", { name: /Open the table/ }).getAttribute("href")).toBe("/duels/table-1");
  });

  it("shows a challenge as private and cannot be made public", async () => {
    render(<DuelCreator multiplayerTables />);
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "Public" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    expect((screen.getByRole("radio", { name: "Private" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Challenge tables are always private/)).toBeTruthy();
    create();
    await screen.findByRole("status");
    expect(api.createDuel.mock.calls[0][3].visibility).toBe("private");
    cleanup();
  });

  it("restores the chosen visibility after the opponent is cleared", async () => {
    render(<DuelCreator multiplayerTables />);
    fireEvent.click(screen.getByRole("radio", { name: "Public" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear opponent/ }));
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Public" }) as HTMLInputElement).disabled).toBe(false);
  });

  it("tells the challenger to share the link when the bot could not send the DM", async () => {
    api.createDuel.mockResolvedValue({ session: { slug: "table-1" }, notified: false });
    render(<DuelCreator multiplayerTables />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    create();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("could not DM Imran");
    expect(status.textContent).toContain("Copy the link");
    expect(screen.queryByText(/the bot sent Imran a DM/)).toBeNull();
  });

  it("says the DM was sent only when the server reports it", async () => {
    api.createDuel.mockResolvedValue({ session: { slug: "table-1" }, notified: true });
    render(<DuelCreator multiplayerTables />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    create();
    expect(await screen.findByText("Challenge sent — the bot sent Imran a DM")).toBeTruthy();
  });

  it("says on an open table that Best of 3 works against the practice bot and Ranked does not count", () => {
    render(<DuelCreator multiplayerTables />);
    expect(screen.queryByTestId("practice-note")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Best of 3" }));
    expect(screen.getByTestId("practice-note").textContent).toMatch(/Best of 3 works against the practice bot, with side decking/);
    fireEvent.click(screen.getByRole("radio", { name: "Best of 1" }));
    expect(screen.queryByTestId("practice-note")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Ranked/ }));
    expect(screen.getByTestId("practice-note").textContent).toMatch(/practice bot never counts/);
  });

  it("clears the picked opponent", async () => {
    render(<DuelCreator multiplayerTables />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "imr" } });
    fireEvent.click(await screen.findByRole("button", { name: "Imran" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear opponent/ }));
    expect(screen.getByRole("searchbox")).toBeTruthy();
    expect(screen.queryByTestId("opponent-chip")).toBeNull();
  });

  it("focuses the opponent search for the Challenge a player entry", () => {
    render(<DuelCreator focusOpponent />);
    expect(document.activeElement).toBe(screen.getByRole("searchbox"));
  });
});
