// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TALK_COOLDOWN_MS, TALK_LINES, TALK_SHOW_MS } from "@yugidraft/shared/ws/talk";
import { useTalkStore } from "../../../src/lib/stores/talk-store";
import { SeatStrip, Seats, type FriendView } from "../../../src/components/draft/room/seats";
import { SayMenu } from "../../../src/components/draft/room/say-menu";
import { Tray } from "../../../src/components/draft/room/tray";
import { TalkBubble } from "../../../src/components/draft/room/talk-bubble";
import { RoomBar } from "../../../src/components/draft/room/room-bar";
import { setCurrentMotion } from "../../../src/components/draft/room/motion";

const friend = (index: number, playerId: number, displayName: string): FriendView => ({
  index,
  seat: { seatIndex: index, playerId, displayName, hasPicked: false, isCurrentPlayer: false },
  packN: 8,
  state: "picking",
});
const friends = [friend(1, 11, "Kestrel"), friend(2, 12, "Marik_Mains")];

beforeEach(() => {
  vi.useFakeTimers();
  setCurrentMotion("full");
  useTalkStore.getState().clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  useTalkStore.getState().clear();
});

describe("talk store", () => {
  it("keeps a line up for a few seconds, then drops it", () => {
    useTalkStore.getState().hear(11, "lol");
    expect(useTalkStore.getState().heard[11]?.line).toBe("lol");
    act(() => void vi.advanceTimersByTime(TALK_SHOW_MS - 1));
    expect(useTalkStore.getState().heard[11]).toBeDefined();
    act(() => void vi.advanceTimersByTime(2));
    expect(useTalkStore.getState().heard[11]).toBeUndefined();
  });

  it("a newer line from the same seat replaces the old one and restarts the clock", () => {
    useTalkStore.getState().hear(11, "gg");
    act(() => void vi.advanceTimersByTime(2000));
    useTalkStore.getState().hear(11, "gl");
    act(() => void vi.advanceTimersByTime(2000));
    expect(useTalkStore.getState().heard[11]?.line).toBe("gl");
    act(() => void vi.advanceTimersByTime(700));
    expect(useTalkStore.getState().heard[11]).toBeUndefined();
  });

  it("counts a repeat of the same words as a new line", () => {
    useTalkStore.getState().hear(11, "gg");
    const first = useTalkStore.getState().heard[11].seq;
    useTalkStore.getState().hear(11, "gg");
    expect(useTalkStore.getState().heard[11].seq).toBeGreaterThan(first);
  });

  it("ignores anything that is not one of the fixed ids", () => {
    const { hear } = useTalkStore.getState();
    hear(11, "hello everyone");
    hear(11, "hurry up");
    hear(11, undefined);
    hear(11, { text: "gg" });
    hear(Number.NaN, "gg");
    hear(1.5, "gg");
    expect(useTalkStore.getState().heard).toEqual({});
  });

  it("clear drops every line", () => {
    useTalkStore.getState().hear(11, "gg");
    useTalkStore.getState().hear(12, "lol");
    useTalkStore.getState().clear();
    expect(useTalkStore.getState().heard).toEqual({});
  });
});

describe("table talk on the seats", () => {
  const positions = { 1: { x: 200, y: 300 }, 2: { x: 700, y: 300 } };

  it("shows a friend's line over their seat with their name, and nothing about picks", () => {
    const heard = { 11: { line: "hurry" as const, seq: 1 } };
    const { container } = render(<Seats friends={friends} positions={positions} theme={false} heard={heard} stageWidth={1000} />);
    const seat = container.querySelector('.seat[data-seat="1"]')!;
    expect(seat).toHaveAttribute("data-talk");
    const bubble = within(seat as HTMLElement).getByRole("status");
    expect(bubble).toHaveTextContent("Kestrelhurry up");
    expect(bubble.className).toBe("bubble");
    expect(bubble).not.toHaveAttribute("data-flip");
    expect(container.querySelector('.seat[data-seat="2"]')).not.toHaveAttribute("data-talk");
    expect(container.querySelectorAll(".bubble")).toHaveLength(1);
  });

  it("opens the line leftwards for a seat near the right edge", () => {
    const heard = { 12: { line: "gg" as const, seq: 1 } };
    const { container } = render(<Seats friends={friends} positions={positions} theme={false} heard={heard} stageWidth={800} />);
    expect(container.querySelector('.seat[data-seat="2"] .bubble')).toHaveAttribute("data-flip");
  });

  it("shows nothing when nobody has spoken", () => {
    const { container } = render(<Seats friends={friends} positions={positions} theme={false} heard={{}} stageWidth={1000} />);
    expect(container.querySelector(".bubble")).toBeNull();
    expect(container.querySelector("[data-talk]")).toBeNull();
  });
});

describe("table talk in the phone seat strip", () => {
  const props = { canSay: false, sayOpen: false, onSay: () => {} };

  it("puts a friend's line in the place of their name", () => {
    render(<SeatStrip friends={friends} heard={{ 12: { line: "noway", seq: 3 } }} {...props} />);
    const chip = screen.getByTitle("Marik_Mains");
    expect(chip).toHaveAttribute("data-talk");
    expect(within(chip).getByRole("status")).toHaveTextContent("no way");
    expect(within(chip).getByRole("status").className).toBe("say");
    expect(screen.getByTitle("Kestrel")).not.toHaveAttribute("data-talk");
  });

  it("has a Say button only for seated players, and passes its element up", () => {
    const onSay = vi.fn();
    const { rerender } = render(<SeatStrip friends={friends} heard={{}} canSay={false} sayOpen={false} onSay={onSay} />);
    expect(screen.queryByRole("button", { name: "Say something to the table" })).toBeNull();
    rerender(<SeatStrip friends={friends} heard={{}} canSay sayOpen={false} onSay={onSay} />);
    const button = screen.getByRole("button", { name: "Say something to the table" });
    expect(button).toHaveAttribute("aria-controls", "sayPop");
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(onSay).toHaveBeenCalledWith(button);
  });
});

describe("table talk on the duel disk", () => {
  it("shows what you said over the dial", () => {
    const counts = { monster: 0, spell: 0, trap: 0, extra: 0 };
    const { container } = render(
      <Tray
        done={0}
        of={40}
        label="of 40"
        phaseCounts={counts}
        poolCounts={counts}
        last={{}}
        active={new Set()}
        landed={null}
        said={{ line: "lol", seq: 1 }}
        onDial={() => {}}
        onKind={() => {}}
      />,
    );
    expect(container.querySelector(".disk > .bubble")).toHaveTextContent("lol");
  });
});

describe("Say button in the room bar", () => {
  const base = {
    name: "Friday cube night",
    sub: "6 at the table",
    motion: "full" as const,
    motionOpen: false,
    onMotion: () => {},
    progress: 0,
    where: { theme: false, extra: false, packRound: 1, packsPerPlayer: 3, pickStep: 1, packSize: 15, direction: 1 as const, phaseDone: 0, phaseOf: 0 },
  };

  it("is there for seated players, labelled and wired to the popover", () => {
    const onSay = vi.fn();
    render(<RoomBar {...base} canSay sayOpen={false} onSay={onSay} />);
    const button = screen.getByRole("button", { name: "Say something to the table" });
    expect(button).toHaveTextContent("Say");
    expect(button).toHaveAttribute("aria-controls", "sayPop");
    fireEvent.click(button);
    expect(onSay).toHaveBeenCalledWith(button);
  });

  it("is missing for someone who is not at the table", () => {
    render(<RoomBar {...base} canSay={false} sayOpen={false} onSay={() => {}} />);
    expect(screen.queryByRole("button", { name: "Say something to the table" })).toBeNull();
  });
});

describe("say menu", () => {
  it("offers exactly the fixed lines, in the design's words", () => {
    render(<SayMenu anchor={null} waiting={false} onSay={() => {}} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Say something to the table" });
    expect(within(dialog).getAllByRole("button").map((b) => b.textContent)).toEqual(["gg", "lol", "nice", "hurry up", "no way", "gl"]);
  });

  it("sends the line id, not the words", () => {
    const onSay = vi.fn();
    render(<SayMenu anchor={null} waiting={false} onSay={onSay} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "hurry up" }));
    expect(onSay).toHaveBeenCalledWith("hurry");
  });

  it("holds the lines back right after you spoke, and says why", () => {
    const onSay = vi.fn();
    render(<SayMenu anchor={null} waiting onSay={onSay} onClose={() => {}} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "gg" }));
    expect(onSay).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("One line at a time");
  });

  it("closes on Escape and gives focus back to its button", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(<SayMenu anchor={anchor} waiting={false} onSay={() => {}} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(anchor);
    anchor.remove();
  });

  it("closes on a press outside, not on a press inside or on its button", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const onClose = vi.fn();
    render(<SayMenu anchor={anchor} waiting={false} onSay={() => {}} onClose={onClose} />);
    fireEvent.pointerDown(screen.getByRole("dialog"));
    fireEvent.pointerDown(anchor);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    anchor.remove();
  });

  it("matches the cooldown the server enforces", () => {
    expect(TALK_COOLDOWN_MS).toBe(3500);
    expect(TALK_LINES).toHaveLength(6);
  });
});

describe("talk bubble motion", () => {
  const animateSpy = () => {
    const spy = vi.fn(() => ({ finished: Promise.resolve() }));
    Object.defineProperty(HTMLElement.prototype, "animate", { value: spy, configurable: true, writable: true });
    return spy;
  };
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  });

  it("pops in and fades out with only opacity and transform", () => {
    const spy = animateSpy();
    render(<TalkBubble heard={{ line: "gg", seq: 1 }} className="bubble" />);
    expect(spy).toHaveBeenCalledTimes(2);
    const [popIn, fadeOut] = spy.mock.calls as unknown as Array<[Keyframe[], KeyframeAnimationOptions]>;
    const props = new Set([...popIn[0], ...fadeOut[0]].flatMap((f) => Object.keys(f)));
    expect([...props].sort()).toEqual(["opacity", "transform"]);
    expect(fadeOut[1].delay).toBe(TALK_SHOW_MS - 260);
  });

  it("does not animate when animations are Off", () => {
    setCurrentMotion("off");
    const spy = animateSpy();
    render(<TalkBubble heard={{ line: "gg", seq: 1 }} className="bubble" />);
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("gg");
  });
});
