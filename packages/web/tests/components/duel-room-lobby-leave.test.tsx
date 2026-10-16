// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
const state = vi.hoisted(() => ({ push: vi.fn(), leaveLobbyRoom: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({ default: ({ children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={event => { onClick?.(event); event.preventDefault(); }}>{children}</a> }));
vi.mock("@/components/duel/deck-editor", () => ({ DeckEditor: () => <div>Deck import</div> }));
vi.mock("@/components/duel/api", async original => ({ ...await original<object>(), leaveLobbyRoom: state.leaveLobbyRoom }));
import { RoomLobby } from "@/components/duel/room-lobby";

beforeEach(() => { vi.clearAllMocks(); state.leaveLobbyRoom.mockResolvedValue(undefined); });
afterEach(() => { cleanup(); delete (window as { navigation?: unknown }).navigation; });

type Kind = "host" | "guest" | "spectator" | "series" | "playing" | "sandbox" | "replay-fork";
function mount(kind: Kind = "host") {
  const room = makeSeriesRoom({ series: null, status: kind === "playing" ? "active" : "lobby", mySeat: kind === "spectator" ? null : kind === "guest" ? 1 : 0 });
  room.session.settings = defaultDuelSettings("normal");
  if (kind === "sandbox") Object.assign(room.session, { sandbox: true });
  if (kind === "replay-fork") room.session.kind = "replay-fork";
  // The helper room has two seats and Sulman (seat 0) as organizer: seat 1 is the guest.
  if (kind !== "guest") room.session.seats = room.session.seats.slice(0, 1);
  if (kind === "series") room.session.seriesId = 7;
  return render(<RoomLobby room={room} slug="game-1" busy={false} actionError={null}
    onTakeSeat={vi.fn()} onAddBot={vi.fn()} onRemoveBot={vi.fn()} onReady={vi.fn()}
    onStart={vi.fn()} onCancel={vi.fn()} onLeave={vi.fn()} />);
}

it("asks the host before a link leaves the lobby and closes the room on Leave", async () => {
  mount("host");
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  const dialog = screen.getByRole("dialog", { name: "Leave and close this room?" });
  expect(state.leaveLobbyRoom).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave and close room" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/duels"));
  expect(state.leaveLobbyRoom).toHaveBeenCalledWith("game-1");
});

it("stays in the room when the player cancels", () => {
  mount("host");
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  fireEvent.click(screen.getByRole("button", { name: "Stay in room" }));
  expect(state.leaveLobbyRoom).not.toHaveBeenCalled();
  expect(state.push).not.toHaveBeenCalled();
  // The next link click asks again.
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  expect(screen.getByRole("dialog", { name: "Leave and close this room?" })).toBeTruthy();
});

it("uses the guest wording for a seated guest", async () => {
  mount("guest");
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  const dialog = screen.getByRole("dialog", { name: "Leave this room?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave room" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/duels"));
});

it("keeps the dialog and the player in the room when leaving fails", async () => {
  state.leaveLobbyRoom.mockRejectedValueOnce(new Error("The game already started"));
  mount("host");
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Leave and close room" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("The game already started");
  expect(state.push).not.toHaveBeenCalled();
});

it.each(["spectator", "series", "playing", "sandbox", "replay-fork"] as const)("does not warn for %s", kind => {
  mount(kind);
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.leaveLobbyRoom).not.toHaveBeenCalled();
});

it("does not close the room on refresh, tab close or unmount", () => {
  const view = mount("host");
  const unload = new Event("beforeunload", { cancelable: true });
  fireEvent(window, unload);
  expect(unload.defaultPrevented).toBe(true);
  fireEvent(window, new Event("pagehide"));
  view.unmount();
  expect(state.leaveLobbyRoom).not.toHaveBeenCalled();
});

function installNavigation() {
  const target = new EventTarget();
  const navigation = Object.assign(target, { traverseTo: vi.fn(), currentEntry: { index: 3 } });
  (window as { navigation?: unknown }).navigation = navigation;
  const back = () => {
    const event = Object.assign(new Event("navigate", { cancelable: true }), {
      destination: { url: "http://localhost:3000/duels", sameDocument: true, key: "k-prev", index: 2 },
      navigationType: "traverse", hashChange: false, downloadRequest: null,
    });
    act(() => { navigation.dispatchEvent(event); });
    return event;
  };
  return { navigation, back };
}

it("holds the Back button until the player decides", async () => {
  const { navigation, back } = installNavigation();
  mount("host");
  const event = back();
  expect(event.defaultPrevented).toBe(true);
  const dialog = screen.getByRole("dialog", { name: "Leave and close this room?" });
  expect(navigation.traverseTo).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Leave and close room" }));
  await waitFor(() => expect(navigation.traverseTo).toHaveBeenCalledWith("k-prev"));
  expect(state.leaveLobbyRoom).toHaveBeenCalledWith("game-1");
  // The approved traversal passes the guard once.
  expect(back().defaultPrevented).toBe(false);
});

it("Back then Stay changes nothing", () => {
  const { navigation, back } = installNavigation();
  mount("host");
  back();
  fireEvent.click(screen.getByRole("button", { name: "Stay in room" }));
  expect(navigation.traverseTo).not.toHaveBeenCalled();
  expect(state.leaveLobbyRoom).not.toHaveBeenCalled();
});
