// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ygoModule, type RemoteRoom } from "@yugidraft/shared/remote";
import { RemoteSeatPanel } from "../src/components/remote/remote-seat-panel";
import { RemoteCommands } from "../src/components/remote/remote-commands";
import { LocalCamera } from "../src/components/remote/local-camera";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function room(): RemoteRoom {
  return { slug: "solo", guildId: "g", gameId: "ygo", solo: true, seatCount: 2, createdBy: 1, status: "active", mySeat: 0,
    createdAt: 1, startedAt: 1, endedAt: null, lastEventAt: 1, lastSeq: 4, endReason: null, idleWarningAt: null, events: [],
    seats: [{ seat: 0, userId: 1, bot: false, displayName: "Owner", ready: true }, { seat: 1, userId: null, bot: true, displayName: "Test Bot 1", ready: true }],
    state: ygoModule.initialState({ seatCount: 2 }) };
}

it("edits a bot twin and LP with a bot actor and renders a static feed", () => {
  const onAction = vi.fn(); const data = room();
  const { container } = render(<RemoteSeatPanel seat={data.seats[1]} state={data.state.seats[1]} editable busy={false} onAction={onAction} />);
  expect(container.querySelector("video")).toBeNull();
  expect(screen.getByText("No camera · owner controlled")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Public card name"), { target: { value: "Dark Magician" } });
  fireEvent.click(screen.getByRole("button", { name: "Place card" }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: "twin.place", actorSeat: 1, seat: 1, card: expect.objectContaining({ name: "Dark Magician" }) }));
  fireEvent.click(screen.getByRole("button", { name: "Subtract LP" }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: "lp.change", actorSeat: 1, seat: 1, delta: -500 }));
});

it("omits hidden card metadata when placing a face-down twin", () => {
  const onAction = vi.fn(); const data = room();
  render(<RemoteSeatPanel seat={data.seats[1]} state={data.state.seats[1]} editable busy={false} onAction={onAction} />);
  fireEvent.change(screen.getByLabelText("Public card name"), { target: { value: "Secret card" } });
  fireEvent.click(screen.getByLabelText("Face down"));
  fireEvent.click(screen.getByRole("button", { name: "Place card" }));
  const card = onAction.mock.calls[0][0].card;
  expect(card.faceUp).toBe(false); expect(card.name).toBeUndefined(); expect(card.cardId).toBeUndefined(); expect(card.race).toBeUndefined();
});

it("requires confirmation for a typed voice command and rejects stale confirmation", () => {
  const onAction = vi.fn(); const data = room();
  const { rerender } = render(<RemoteCommands room={data} actorSeat={1} busy={false} onAction={onAction} />);
  fireEvent.change(screen.getByLabelText("Command"), { target: { value: "lose 500 LP" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview command" }));
  expect(onAction).not.toHaveBeenCalled();
  rerender(<RemoteCommands room={{ ...data, lastSeq: 5 }} actorSeat={1} busy={false} onAction={onAction} />);
  expect(screen.getByRole("button", { name: /Confirm/ }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Preview command" }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: "lp.change", actorSeat: 1, seat: 1, delta: -500 }));
});

it("captures speech for a selected bot and requires preview and confirmation", () => {
  const onAction = vi.fn(); const data = room(); const stop = vi.fn();
  class Capture {
    onresult: ((event: unknown) => void) | null = null;
    onerror = null; onend = null; stop = stop;
    start() { this.onresult?.({ results: [[{ transcript: "gain 500 LP" }]] }); }
  }
  vi.stubGlobal("SpeechRecognition", Capture);
  const { unmount } = render(<RemoteCommands room={data} actorSeat={1} busy={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole("button", { name: "Use microphone" }));
  expect(screen.getByLabelText("Command")).toHaveValue("gain 500 LP");
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Preview command" }));
  fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ actorSeat: 1, seat: 1, delta: 500 }));
  unmount(); expect(stop).toHaveBeenCalled();
});

it("offers a confirmed attack against the bot's twin", () => {
  const onAction = vi.fn(); const data = room();
  data.state.seats[0].twin = [{ ref: "blue", name: "Blue-Eyes White Dragon", zone: "monster", faceUp: true, position: "attack" }];
  data.state.seats[1].twin = [{ ref: "dark", name: "Dark Magician", zone: "monster", faceUp: true, position: "attack" }];
  render(<RemoteCommands room={data} actorSeat={0} busy={false} onAction={onAction} />);
  fireEvent.change(screen.getByLabelText("Command"), { target: { value: "Blue Eyes attacks the magician" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview command" }));
  expect(onAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: "attack.declare", actorSeat: 0, targetSeat: 1, targetCardRef: "dark" }));
});

it("starts only a local video stream on request and stops it on unmount", async () => {
  const stop = vi.fn(); const stream = { getTracks: () => [{ stop }] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  const { unmount } = render(<LocalCamera disabled={false} onIdentify={vi.fn()} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Enable camera" }));
  await screen.findByRole("button", { name: "Stop camera" });
  expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
  expect(screen.getByLabelText("Your local camera")).toBeTruthy();
  unmount(); expect(stop).toHaveBeenCalled();
});
