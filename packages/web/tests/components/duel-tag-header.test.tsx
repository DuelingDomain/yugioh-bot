// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelRoom } from "@yugidraft/shared/duels";
import { TAG_FIXTURES, TAG_NAMES, TAG_TEAM_NAMES } from "@/components/duel/tag/fixtures";
import { tagTurnText } from "@/components/duel/tag/live-tag";
import { TagHeader } from "@/components/duel/tag/tag-header";
import { TagTrack } from "@/components/duel/tag/tag-track";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

afterEach(cleanup);

const baseRoom = TAG_FIXTURES.states.main.room;
const nameOf = (seat: number) => TAG_NAMES[seat] ?? `Seat ${seat}`;
const prefs = (soundEnabled = true) => ({ soundEnabled, setSoundEnabled: vi.fn() });

function withTurn(room: DuelRoom, turn: number, turnSeat = room.engine!.turnSeat): DuelRoom {
  return { ...room, engine: { ...room.engine!, turn, turnSeat } };
}

function header(room: DuelRoom, extra: Partial<React.ComponentProps<typeof TagHeader>> = {}) {
  return render(
    <TagHeader
      session={room.session}
      engine={room.engine!}
      viewerSeat={room.mySeat}
      nameOf={nameOf}
      teamNames={[...TAG_TEAM_NAMES]}
      preferences={prefs()}
      {...extra}
    />,
  );
}

function track(room: DuelRoom, extra: Partial<React.ComponentProps<typeof TagTrack>> = {}) {
  return render(
    <TagTrack session={room.session} engine={room.engine!} clock={room.clock} nameOf={nameOf} {...extra} />,
  );
}

describe("TagHeader", () => {
  it("shows Turn N as its own text through tagTurnText", () => {
    header(withTurn(baseRoom, 7));
    const turn = screen.getByText(tagTurnText(7));
    expect(turn.textContent).toBe("Turn 7");
    // The phase text sits in another node, so an exact "Turn N" match finds only the count.
    expect(turn.textContent).not.toMatch(/Phase/);
  });

  it("takes the mode label from the session, not a fixed word", () => {
    const domain = { ...baseRoom, session: { ...baseRoom.session, mode: "domain" as const } };
    const view = header(domain);
    expect(screen.getByText(/Domain/)).toBeTruthy();
    view.unmount();
    const standard = { ...baseRoom, session: { ...baseRoom.session, mode: "normal" as const, masterRule: 5 as const } };
    header(standard);
    expect(screen.queryByText(/Domain/)).toBeNull();
    expect(screen.getByText(/MR5/)).toBeTruthy();
  });

  it("shows the session name as the title", () => {
    header({ ...baseRoom, session: { ...baseRoom.session, name: "Friday Tag Night" } });
    expect(screen.getByText("Friday Tag Night")).toBeTruthy();
  });

  it("names the brand link Duelists Kingdom and points it at the duel list", () => {
    header(baseRoom);
    const brand = screen.getByRole("link", { name: "Duelists Kingdom" });
    expect(brand.getAttribute("href")).toBe("/duels");
  });

  it("renders the header tools slot", () => {
    header(baseRoom, { headerTools: <button type="button">Surrender</button> });
    expect(screen.getByRole("button", { name: "Surrender" })).toBeTruthy();
  });

  it("labels the connection", () => {
    header(baseRoom, { connection: { connected: false, syncing: false, recovering: false, presence: { onlineSeats: [], spectatorCount: 0 }, resync: async () => {} } });
    expect(screen.getByRole("status").textContent).toMatch(/Polling/);
  });

  it("binds the sound switch to the user preference", () => {
    const preferences = prefs(true);
    const view = header(baseRoom, { preferences });
    const button = screen.getByRole("button", { name: /Sound effects on/i });
    fireEvent.click(button);
    expect(preferences.setSoundEnabled).toHaveBeenCalledWith(false);
    view.unmount();
    header(baseRoom, { preferences: prefs(false) });
    expect(screen.getByRole("button", { name: /Sound effects off/i })).toBeTruthy();
  });

  it("names the team of the turn player", () => {
    header(withTurn(baseRoom, 5, 3), { viewerSeat: 0 });
    expect(screen.getByText(/Juniper Rook's turn/)).toBeTruthy();
    expect(screen.getByText(new RegExp(TAG_TEAM_NAMES[1]))).toBeTruthy();
  });

  it("says Your turn on your own turn and marks a spectator", () => {
    header(withTurn(baseRoom, 5, 0), { viewerSeat: 0 });
    expect(screen.getByText(/Your turn/)).toBeTruthy();
    cleanup();
    header(withTurn(baseRoom, 5, 2), { viewerSeat: null });
    expect(screen.getByText(/Corvin Hale to play/)).toBeTruthy();
    expect(screen.getByText(/spectating/i)).toBeTruthy();
  });
});

describe("TagTrack", () => {
  it("lists the baton 1A, 2A, 1B, 2B and marks the turn player", () => {
    track(withTurn(baseRoom, 5, 2));
    const list = screen.getByRole("list", { name: "Turn order" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.querySelector("b")?.textContent)).toEqual(["1A", "2A", "1B", "2B"]);
    const now = items.filter((item) => item.getAttribute("data-now") === "true");
    expect(now).toHaveLength(1);
    expect(now[0].querySelector("b")?.textContent).toBe("1B");
    expect(now[0].getAttribute("aria-current")).toBe("step");
  });

  it("renders the decision clock", () => {
    track(baseRoom);
    expect(screen.getByRole("timer", { name: "Decision clocks" })).toBeTruthy();
  });

  it("renders nothing for the clock when the duel has none", () => {
    track(baseRoom, { clock: null });
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it.each([1, 2, 3])("shows the attack lock on turn %i", (turn) => {
    track(withTurn(baseRoom, turn));
    const lock = screen.getByTestId("tag-attack-lock");
    expect(lock.textContent).toMatch(/Attacks locked/);
    expect(lock.textContent).toMatch(/Battle Phase opens on turn 4/);
  });

  it("drops the attack lock on turn 4", () => {
    track(withTurn(baseRoom, 4));
    expect(screen.queryByTestId("tag-attack-lock")).toBeNull();
  });

  it("drops the attack lock when the engine offers the Battle Phase", () => {
    const room = withTurn(baseRoom, 2);
    const prompt = {
      id: "a", seat: 0, kind: "choice" as const, title: "Main", context: { type: "action" as const, phase: "main" },
      options: [{ id: "to_bp", label: "Battle Phase" }],
    };
    track(room, { prompt: prompt as never });
    expect(screen.queryByTestId("tag-attack-lock")).toBeNull();
  });

  it("mounts children (the station track) under the baton", () => {
    track(baseRoom, { children: <div data-testid="station">station</div> });
    expect(screen.getByTestId("station")).toBeTruthy();
  });
});
