// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DuelHistoryRail } from "@/components/duel/history-rail";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";

afterEach(cleanup);

const info = (code: number, name: string) =>
  ({ code, name, description: "", type: 1, attack: 1000, defense: 1000, level: 4, attribute: 1, race: "" });
const events: DuelEvent[] = [
  { id: 1, kind: "summon", seat: 1, card: info(11, "Ice Dragon"), summonKind: "normal", text: "" } as DuelEvent,
  { id: 2, kind: "summon", seat: 2, card: info(12, "Leaf Imp"), summonKind: "normal", text: "" } as DuelEvent,
];
const engine = FFA3_FIXTURES.states.main.room.engine!;
const tones = new Map([
  [0, { main: "#9b7eff", ink: "#c6b6ff" }],
  [1, { main: "#5cb8f5", ink: "#a9dcfb" }],
  [2, { main: "#8fd36b", ink: "#c4ecad" }],
]);
const props = { events, engine, mySeat: 0, playerName: (seat: number) => `P${seat}`, onInspectCard: vi.fn(), reducedMotion: true };

describe("DuelHistoryRail seat tones", () => {
  it("colours each row and its thumb with the tone of its seat", () => {
    const { container } = render(<DuelHistoryRail {...props} seatTones={tones} />);
    const rows = [...container.querySelectorAll<HTMLElement>("li[data-toned]")];
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.style.getPropertyValue("--seat-main"))).toEqual(["#8fd36b", "#5cb8f5"]);
    expect(rows[0].querySelector("[data-toned]")).not.toBeNull();
  });

  it("keeps the 1v1 look when no tones are given", () => {
    const { container } = render(<DuelHistoryRail {...props} />);
    expect(container.querySelectorAll("[data-toned]")).toHaveLength(0);
  });
});
