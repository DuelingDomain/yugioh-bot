// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelPromptOption, DuelSeatView } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { GridMasterToken } from "@/components/duel/table/grid-master";
import { LOCATION_DMZONE } from "@/components/duel/constants";
import { hudMasterProps } from "@/components/duel/table/hud-shared";
import type { DuelPrompt } from "@yugidraft/shared/duels";

afterEach(cleanup);

const info: DuelCardInfo = { code: 9, name: "Dark Magician", description: "A mage.", type: 1, attack: 2500, defense: 2100, level: 7, attribute: 1, race: "Spellcaster" };
const view = { seat: 0, deckMaster: { card: info, inZone: true, returns: 0, nextCost: 0 } } as unknown as DuelSeatView;
const zone = `0:${LOCATION_DMZONE}:0`;

function plate(opts: { legal: boolean; canAct?: boolean; local?: boolean; onActivate?: () => void; wide?: boolean; actions?: DuelPromptOption[] }) {
  const onToggle = vi.fn();
  render(
    <GridMasterToken view={view} local={opts.local ?? true} legalKeys={new Set(opts.legal ? [zone] : [])} selectedKeys={new Set()}
      canAct={opts.canAct ?? true} legalActionsFor={() => opts.actions ?? []} wide={opts.wide} open={false} title="Your Master" onToggle={onToggle} onClose={vi.fn()}
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
    expect(screen.getByTestId("hud-master")).toHaveTextContent("Deck Master");
  });

  it("has no aria-expanded while a click picks, and has it when a click opens the details", () => {
    plate({ legal: true, onActivate: vi.fn() });
    expect(screen.getByTestId("hud-master-token").hasAttribute("aria-expanded")).toBe(false);
    cleanup();
    plate({ legal: false, onActivate: vi.fn() });
    expect(screen.getByTestId("hud-master-token").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the wide Deck Master plate of the 3-way plaza", () => {
  const summon = { id: "s1", label: "Normal Summon Dark Magician" } as DuelPromptOption;

  it("shows the name, the facts and the ability text, and keeps the actions", () => {
    plate({ legal: false, wide: true, actions: [summon] });
    expect(screen.getByTestId("hud-master").getAttribute("data-form")).toBe("wide");
    expect(screen.getByTestId("hud-master-token")).toHaveTextContent("Dark Magician");
    const facts = screen.getByTestId("hud-master-facts");
    expect(facts).toHaveTextContent("Level 7");
    expect(facts).toHaveTextContent("In Deck Master Zone");
    expect(screen.getByTestId("hud-master-ability")).toHaveTextContent("A mage.");
    expect(screen.getByTestId("hud-master-action")).toHaveTextContent("Summon");
    expect(screen.getByTestId("hud-master-inspect")).toBeTruthy();
  });

  it("is the Deck Master Zone anchor of the seat for the summon and the return flights", () => {
    plate({ legal: false, wide: true });
    const art = document.querySelector("[data-master-dock]");
    expect(art?.getAttribute("data-master-dock")).toBe("0");
    expect(art?.getAttribute("data-master-source")).toBe("0");
  });

  it("says so when the Deck Master has no effect text", () => {
    cleanup();
    const blank = { seat: 0, deckMaster: { card: { ...info, description: "" }, inZone: true, returns: 0, nextCost: 0 } } as unknown as DuelSeatView;
    render(<GridMasterToken view={blank} local legalKeys={new Set()} selectedKeys={new Set()} canAct legalActionsFor={() => []} wide open={false}
      title="Your Master" onToggle={vi.fn()} onClose={vi.fn()} onChooseAction={vi.fn()} onInspect={vi.fn()} />);
    expect(screen.getByTestId("hud-master-ability")).toHaveTextContent("no effect text");
  });

  it("leaves the other plates as they are: no ability box, no anchors", () => {
    plate({ legal: false });
    expect(screen.getByTestId("hud-master").getAttribute("data-form")).not.toBe("wide");
    expect(screen.queryByTestId("hud-master-ability")).toBeNull();
    expect(document.querySelector("[data-master-dock], [data-master-source]")).toBeNull();
  });
});

describe("hudMasterProps", () => {
  const source = { legalKeys: new Set([zone]), selectedKeys: new Set<string>(), canAct: true, onAnswer: vi.fn(), onActivate: vi.fn(), onHoverCard: vi.fn() };
  const prompt = (p: Partial<DuelPrompt>) => ({ id: "p", seat: 0, title: "t", cancelable: false, ...p }) as DuelPrompt;

  it("lets a select prompt pick from the plate", () => {
    const props = hudMasterProps({ ...source, prompt: prompt({ kind: "cards", min: 1, max: 1, options: [] } as Partial<DuelPrompt>) }, view, true, "Your Master");
    expect(props.onActivate).toBe(source.onActivate);
  });

  it("does not let an action prompt pick from the plate: its actions stay on the plate", () => {
    const action = prompt({ kind: "choice", context: { type: "action", phase: "main" }, options: [] } as Partial<DuelPrompt>);
    expect(hudMasterProps({ ...source, prompt: action }, view, true, "Your Master").onActivate).toBeUndefined();
    expect(hudMasterProps({ ...source, prompt: null }, view, true, "Your Master").onActivate).toBeUndefined();
  });
});
