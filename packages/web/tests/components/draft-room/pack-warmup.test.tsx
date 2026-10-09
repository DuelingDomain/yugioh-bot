// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftStore } from "../../../src/lib/stores/draft-store";

vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `--mock-${name}`, className: name });
  return {
    Newsreader: font("newsreader"),
    Oxanium: font("oxanium"),
    Sofia_Sans_Extra_Condensed: font("sofia-c"),
    Sofia_Sans_Semi_Condensed: font("sofia-sc"),
  };
});
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a> }));

import { DraftRoom } from "../../../src/components/draft/room/draft-room";

const makeCard = (id: number) => ({
  id, passcode: id + 100000, name: `Card ${id}`, type: "Effect Monster", frameType: "effect", attribute: "DARK",
  level: 4, atk: 1000, def: 1000, effectText: "Does a thing.",
  imageUrl: `/c/${id}.jpg`, imageUrlSmall: `/c/${id}s.jpg`,
});
const cards = Array.from({ length: 60 }, (_, i) => makeCard(i + 1));
const config = { packSize: 8, packsPerPlayer: 5, cardsPerPlayer: 40, pickSeconds: 60 };

let phone = false;
let stageWidth = 1440;
let stageHeight = 900;

beforeEach(() => {
  phone = false;
  stageWidth = 1440;
  stageHeight = 900;
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(max-width: 900px)" ? phone : false,
    media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("stage")
      ? new DOMRect(0, 0, phone ? 390 : stageWidth, phone ? 844 : stageHeight)
      : new DOMRect();
  });
  vi.stubGlobal("ResizeObserver", undefined);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  useDraftStore.setState({
    slug: "d", packRound: 1, pickStep: 1, currentPack: cards.slice(0, 8), myPool: [],
    seats: [
      { seatIndex: 0, playerId: 1, displayName: "Ann", hasPicked: false, isCurrentPlayer: true },
      { seatIndex: 1, playerId: 2, displayName: "Bo", hasPicked: false, isCurrentPlayer: false },
    ],
    timerSeconds: 40, isMyTurn: true, completed: false, pickSeconds: 60,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


/** An Image that records every src and settles only when the test says so. */
const made: FakeImage[] = [];
class FakeImage extends EventTarget {
  complete = false;
  private url = "";
  get src() { return this.url; }
  set src(value: string) { this.url = value; }
  constructor() {
    super();
    made.push(this);
  }
  settle() {
    this.complete = true;
    this.dispatchEvent(new Event("load"));
  }
}
const variantOf = (img: FakeImage) => /variant=(\w+)/.exec(img.src)?.[1];

describe("pack picture warm-up", () => {
  beforeEach(() => {
    made.length = 0;
    vi.stubGlobal("Image", FakeImage);
  });

  it("asks for every small picture before any large one", async () => {
    render(<DraftRoom slug="d" name="Friday" config={config} isParticipant />);
    await waitFor(() => expect(made.length).toBeGreaterThan(0));
    expect(made.length).toBe(8);
    expect(made.every((img) => variantOf(img) === "small")).toBe(true);

    // seven of eight small pictures are done: the large ones still wait
    act(() => made.slice(0, 7).forEach((img) => img.settle()));
    expect(made.length).toBe(8);

    act(() => made[7].settle());
    expect(made.length).toBe(16);
    expect(made.slice(8).every((img) => variantOf(img) === "full")).toBe(true);
  });

  it("stops the old pack's unfinished large pictures when the pack changes", async () => {
    render(<DraftRoom slug="d" name="Friday" config={config} isParticipant />);
    await waitFor(() => expect(made.length).toBe(8));
    act(() => made.forEach((img) => img.settle()));
    const full = made.slice(8);
    expect(full).toHaveLength(8);
    full[0].complete = true;

    act(() => useDraftStore.setState({ currentPack: cards.slice(8, 16) }));
    await waitFor(() => expect(made.length).toBe(24));
    expect(full[0].src).not.toBe("");
    expect(full.slice(1).every((img) => img.src === "")).toBe(true);
    expect(made.slice(16).every((img) => variantOf(img) === "small")).toBe(true);
  });
});
