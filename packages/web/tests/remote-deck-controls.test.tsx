// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { normalizeRemoteFormat, ygoModule, type RemoteRoom } from "@yugidraft/shared/remote";
import { RemoteDeckAssistant, RemoteSetupControls } from "../src/components/remote/remote-deck-controls";

afterEach(cleanup);
function room(): RemoteRoom {
  return { slug: "test", guildId: "g", gameId: "ygo", solo: false, seatCount: 2, createdBy: 1, status: "lobby", mySeat: 0,
    createdAt: 1, startedAt: null, endedAt: null, lastEventAt: 1, lastSeq: 4, endReason: null, idleWarningAt: null, events: [],
    format: normalizeRemoteFormat("domain"),
    seats: [{ seat: 0, userId: 1, bot: false, displayName: "Sulman", ready: false, deck: null }],
    state: ygoModule.initialState({ seatCount: 2 }) };
}
it("selects an existing saved deck and applies host format settings", () => {
  const data = room(); const operation = vi.fn();
  render(<RemoteSetupControls room={data} decks={[{ id: 8, name: "My deck" }]} busy={false} onOperation={operation} />);
  fireEvent.change(screen.getByLabelText("Deck for Sulman"), { target: { value: "8" } });
  expect(operation).toHaveBeenCalledWith("deck", { savedDeckId: 8, seat: 0 });
  fireEvent.change(screen.getByLabelText("Duel format"), { target: { value: "genesys-domain" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply rules" }));
  expect(operation).toHaveBeenCalledWith("format", expect.objectContaining({ format: "genesys-domain" }));
});
it("shows the full validator issues beside the selected deck", () => {
  const data = room();
  data.seats[0].deck = { savedDeckId: 8, name: "Invalid", deck: { main: [], extra: [], side: [] },
    validation: { issues: [{ message: "Deck Master is required for Domain Format", cards: [] }] } };
  render(<RemoteSetupControls room={data} decks={[{ id: 8, name: "Invalid" }]} busy={false} onOperation={vi.fn()} />);
  expect(screen.getByText("Deck Master is required for Domain Format")).toBeTruthy();
});
it("shows recognition, a decklist badge, and one add action; explains invalid additions", () => {
  const data = room(); data.status = "active";
  data.state.identified = { seat: 0, cardId: 14558127, name: "Ash Blossom", source: "click", notInDecklist: true, addErrors: [] };
  const onAction = vi.fn();
  const { rerender } = render(<RemoteDeckAssistant room={data} busy={false} onAction={onAction} />);
  expect(screen.getByText("Not in decklist")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Add to decklist" }));
  expect(onAction).toHaveBeenCalledWith({ type: "deck.add", actorSeat: 0, seat: 0, cardId: 14558127 });
  data.state.identified.addErrors = ["Main Deck must have exactly 60 cards"];
  rerender(<RemoteDeckAssistant room={data} busy={false} onAction={onAction} />);
  expect(screen.getByRole("button", { name: "Add to decklist" })).toBeDisabled();
  expect(screen.getByText("Main Deck must have exactly 60 cards")).toBeTruthy();
});
it("shows proof to the other player and allows a logged dismissal", () => {
  const data = room(); data.status = "active"; data.mySeat = 1;
  data.state.deckChecks.flags = [{ id: "flag", seat: 0, copyKey: 1, count: 2, limit: 1, instanceIds: ["a","b"],
    proof: ["field zone 2", "GY"], message: "Deck no longer valid: 2 copies seen at the same time: field zone 2 and GY", dismissed: false }];
  const onAction = vi.fn();
  render(<RemoteDeckAssistant room={data} busy={false} onAction={onAction} />);
  expect(screen.getByText(/Deck no longer valid/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Dismiss as wrong" }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ type: "deck.flag.dismiss", actorSeat: 1, flagId: "flag" }));
});
it("keeps solo dismissal available through a living bot after the owner is eliminated", () => {
  const data = room(); data.status = "active"; data.solo = true; data.state.seats[0].eliminated = true;
  data.seats.push({seat:1,userId:null,bot:true,displayName:"Test Bot 1",ready:true});
  data.state.deckChecks.flags = [{id:"flag",seat:1,copyKey:1,count:2,limit:1,instanceIds:["a","b"],proof:[],message:"Deck no longer valid",dismissed:false}];
  const onAction = vi.fn();
  render(<RemoteDeckAssistant room={data} busy={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole("button",{name:"Dismiss as wrong"}));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({type:"deck.flag.dismiss",actorSeat:1,flagId:"flag"}));
});
