// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { GridMasterToken } from "@/components/duel/table/grid-master";
import { LOCATION_DMZONE } from "@/components/duel/constants";

afterEach(cleanup);

const info: DuelCardInfo = { code: 9, name: "Dark Magician", description: "A mage.", type: 1, attack: 2500, defense: 2100, level: 7, attribute: 1, race: "Spellcaster" };
const view = { seat: 0, deckMaster: { card: info, inZone: true, returns: 0, nextCost: 0 } } as unknown as DuelSeatView;
const zone = `0:${LOCATION_DMZONE}:0`;

function plate(opts: { legal: boolean; canAct?: boolean; local?: boolean; onActivate?: () => void }) {
  const onToggle = vi.fn();
  render(
    <GridMasterToken view={view} local={opts.local ?? true} legalKeys={new Set(opts.legal ? [zone] : [])} selectedKeys={new Set()}
      canAct={opts.canAct ?? true} legalActionsFor={() => []} open={false} title="Your Master" onToggle={onToggle} onClose={vi.fn()}
      onChooseAction={vi.fn()} onActivate={opts.onActivate} onInspect={vi.fn()} />,
  );
  return { onToggle };
}

describe("the Deck Master plate token", () => {
  it("picks the card when a prompt asks for it", () => {
    const onActivate = vi.fn();
    const { onToggle } = plate({ legal: true, onActivate });
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(onActivate).toHaveBeenCalledWith([zone], expect.objectContaining({ code: 9 }), expect.anything());
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("opens the details when the card is not legal, or the seat cannot act", () => {
    const onActivate = vi.fn();
    const first = plate({ legal: false, onActivate });
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(first.onToggle).toHaveBeenCalledTimes(1);
    cleanup();
    const second = plate({ legal: true, canAct: false, onActivate });
    fireEvent.click(screen.getByTestId("hud-master-token"));
    expect(second.onToggle).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("shows Inspect and the short title on the plate of a spectator", () => {
    plate({ legal: false, local: false });
    expect(screen.getByTestId("hud-master-inspect")).toBeTruthy();
  });
});
