// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ActiveDuel, ActiveGameChecker } from "@/lib/active-game";
const nav = vi.hoisted(() => ({ pathname: "/decks", replace: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ replace: nav.replace }) }));
import { ActiveGameGuard } from "@/components/duel/active-game-guard";

const playing: ActiveDuel = { slug: "g1", state: "playing", role: "host", format: "ffa3" };
function checker(value: ActiveDuel | null) {
  const get = vi.fn<ActiveGameChecker["get"]>(() => Promise.resolve(value));
  const invalidate = vi.fn();
  return { get, invalidate } satisfies ActiveGameChecker;
}
beforeEach(() => { vi.clearAllMocks(); nav.pathname = "/decks"; });
afterEach(cleanup);

it("sends the player back to the game with a notice", async () => {
  const source = checker(playing);
  render(<ActiveGameGuard checkerOverride={source} />);
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/duels/g1"));
  expect(screen.getByRole("status")).toHaveTextContent("You have an active game. Returning you to it.");
});

it("does nothing in the game's own room, in a lobby or without a game", async () => {
  nav.pathname = "/duels/g1";
  const room = checker(playing);
  const view = render(<ActiveGameGuard checkerOverride={room} />);
  await waitFor(() => expect(room.get).toHaveBeenCalled());
  view.unmount();
  nav.pathname = "/decks";
  for (const value of [{ ...playing, state: "lobby" as const }, null]) {
    const source = checker(value);
    const mounted = render(<ActiveGameGuard checkerOverride={source} />);
    await waitFor(() => expect(source.get).toHaveBeenCalled());
    mounted.unmount();
  }
  expect(nav.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});

it("reads fresh when the player leaves a room and uses the cache on other pages", async () => {
  nav.pathname = "/duels/g1";
  const source = checker(null);
  const view = render(<ActiveGameGuard checkerOverride={source} />);
  await waitFor(() => expect(source.get).toHaveBeenCalledWith({ fresh: false }));
  nav.pathname = "/duels";
  view.rerender(<ActiveGameGuard checkerOverride={source} />);
  await waitFor(() => expect(source.get).toHaveBeenLastCalledWith({ fresh: true }));
  nav.pathname = "/decks";
  view.rerender(<ActiveGameGuard checkerOverride={source} />);
  await waitFor(() => expect(source.get).toHaveBeenLastCalledWith({ fresh: false }));
});

it("checks again when the tab becomes visible", async () => {
  const source = checker(null);
  render(<ActiveGameGuard checkerOverride={source} />);
  await waitFor(() => expect(source.get).toHaveBeenCalledTimes(1));
  source.get.mockResolvedValue(playing);
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/duels/g1"));
  expect(source.invalidate).toHaveBeenCalled();
});
