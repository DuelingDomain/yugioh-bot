// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defaultDuelSettings } from "@yugidraft/shared/duels";
import { makeSeriesRoom } from "../helpers/duel-series";
const state = vi.hoisted(() => ({ push: vi.fn(), cancelWaitingDuel: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next/link", () => ({ default: ({ children, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} onClick={event => { onClick?.(event); event.preventDefault(); }}>{children}</a> }));
vi.mock("@/components/duel/deck-editor", () => ({ DeckEditor: () => <div>Deck import</div> }));
vi.mock("@/components/duel/api", async original => ({ ...await original<object>(), cancelWaitingDuel: state.cancelWaitingDuel }));
import { RoomLobby } from "@/components/duel/room-lobby";
beforeEach(() => { vi.clearAllMocks(); state.cancelWaitingDuel.mockResolvedValue({}); });
afterEach(cleanup);
function mount(extra: "empty" | "bot" | "human" | "spectator" | "opening" | "sandbox" | "replay-fork" = "empty") {
  const room = makeSeriesRoom({ series: null, status: "lobby", mySeat: extra === "spectator" ? null : 0 });
  room.session.settings = defaultDuelSettings("normal");
  if (extra === "sandbox") Object.assign(room.session, { sandbox: true });
  if (extra === "replay-fork") room.session.kind = "replay-fork";
  if (extra !== "human") room.session.seats = room.session.seats.slice(0, 1);
  if (extra === "bot") room.session.seats.push({ seat: 1, playerId: null, isBot: true, ready: true, displayName: "Practice Bot" });
  if (extra === "opening") room.opening = { phase: "rps" } as never;
  return render(<RoomLobby room={room} slug="game-1" busy={false} actionError={null}
    onTakeSeat={vi.fn()} onAddBot={vi.fn()} onRemoveBot={vi.fn()} onReady={vi.fn()}
    onStart={vi.fn()} onCancel={vi.fn()} onLeave={vi.fn()} />);
}
it.each(["empty", "bot"] as const)("offers Cancel table and Keep table open when the host leaves a %s room", async kind => {
  mount(kind);
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  const dialog = screen.getByRole("dialog", { name: "Leave waiting table" });
  expect(dialog).toHaveTextContent("No result is recorded.");
  expect(state.cancelWaitingDuel).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel table" }));
  await waitFor(() => expect(state.push).toHaveBeenCalledWith("/duels"));
  expect(state.cancelWaitingDuel).toHaveBeenCalledWith("game-1");
});
it("keeps the table when the host chooses Keep table open", () => {
  mount(); fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep table open" }));
  expect(state.push).toHaveBeenCalledWith("/duels");
  expect(state.cancelWaitingDuel).not.toHaveBeenCalled();
});
it.each(["human", "spectator", "opening"] as const)("does not offer empty-room cancellation for %s", kind => {
  mount(kind); fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.cancelWaitingDuel).not.toHaveBeenCalled();
});
it("does not cancel on refresh, tab close, or unmount", () => {
  const view = mount();
  fireEvent(window, new Event("beforeunload"));
  fireEvent(window, new Event("pagehide"));
  view.unmount();
  expect(state.cancelWaitingDuel).not.toHaveBeenCalled();
});
it("keeps the user in the room when conditional cancellation fails", async () => {
  state.cancelWaitingDuel.mockRejectedValueOnce(new Error("Another player joined"));
  mount(); fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel table" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent("Another player joined");
  expect(state.push).not.toHaveBeenCalled();
});

it.each(["sandbox", "replay-fork"] as const)("does not offer waiting cancellation for a %s", kind => {
  mount(kind);
  fireEvent.click(screen.getByRole("link", { name: "All tables" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(state.cancelWaitingDuel).not.toHaveBeenCalled();
});
