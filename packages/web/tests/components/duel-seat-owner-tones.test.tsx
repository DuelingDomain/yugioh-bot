// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DeckMasterRail } from "@/components/duel/field";
import { CardInspector } from "@/components/duel/inspector";
import { PileViewer } from "@/components/duel/pile-viewer";
import { FFA3_FIXTURES } from "@/components/duel/table/fixtures/ffa3";

afterEach(cleanup);

const engine = FFA3_FIXTURES.states.main.room.engine!;
const tone = { main: "#5cb8f5", ink: "#a9dcfb" };

describe("owner in the seat colour", () => {
  it("the inspector adds an owner line only when it is asked to", () => {
    const card = engine.seats[0].monsters[0]!;
    const { rerender } = render(<CardInspector target={{ type: "card", card }} />);
    expect(screen.queryByTestId("inspector-owner")).toBeNull();
    rerender(<CardInspector target={{ type: "card", card }} ownerOf={() => ({ name: "Ryo Sato", tone })} />);
    const line = screen.getByTestId("inspector-owner");
    expect(line).toHaveTextContent("Owner Ryo Sato");
    expect((line as HTMLElement).style.getPropertyValue("--seat-main")).toBe(tone.main);
  });

  it("the pile viewer names the owner and takes the seat colour", () => {
    const cards = [engine.seats[1].monsters[1]!];
    const { container, rerender } = render(
      <PileViewer title="Graveyard" cards={cards} owner="opp" open onClose={vi.fn()} onInspectCard={vi.fn()} reducedMotion />,
    );
    expect(screen.queryByTestId("pile-owner")).toBeNull();
    rerender(<PileViewer title="Graveyard" cards={cards} owner="opp" ownerTag={{ name: "Ryo Sato", tone }} open onClose={vi.fn()} onInspectCard={vi.fn()} reducedMotion />);
    expect(screen.getByTestId("pile-owner")).toHaveTextContent("Ryo Sato");
    expect(container.querySelector("[data-toned='true']")).not.toBeNull();
  });

  it("the Deck Master rail shows one dock per rival above your own", () => {
    const seats = engine.seats.map((seat) => ({
      ...seat,
      deckMaster: { card: { ...engine.seats[0].monsters[0]!, description: "", type: 0, attack: 0, defense: 0, level: 0, attribute: 0, race: "", code: 46986414, name: `Master ${seat.seat}` }, inZone: false, returns: 0, nextCost: 0 },
    }));
    const { container } = render(
      <DeckMasterRail
        engine={{ ...engine, seats }}
        mySeat={0}
        legalKeys={new Set()}
        selectedKeys={new Set()}
        canAct={false}
        legalActionsFor={() => []}
        onActivate={vi.fn()}
        onChooseAction={vi.fn()}
        onInspect={vi.fn()}
        rivals={[{ seat: 1, title: "Ryo's Master" }, { seat: 2, title: "Mika's Master" }]}
      />,
    );
    const titles = [...container.querySelectorAll("section h2")].map((node) => node.textContent);
    expect(titles).toEqual(["Ryo's Master", "Mika's Master", "Your Master"]);
    expect(container.querySelector("[data-docks='3']")).not.toBeNull();
  });

  it("titles the bottom dock for a spectator and leaves data-docks off the 1v1 rail", () => {
    const seats = engine.seats.map((seat) => ({
      ...seat,
      deckMaster: { card: { ...engine.seats[0].monsters[0]!, description: "", type: 0, attack: 0, defense: 0, level: 0, attribute: 0, race: "", code: 46986414, name: `Master ${seat.seat}` }, inZone: false, returns: 0, nextCost: 0 },
    }));
    const props = {
      engine: { ...engine, seats }, legalKeys: new Set<string>(), selectedKeys: new Set<string>(), canAct: false,
      legalActionsFor: () => [], onActivate: vi.fn(), onChooseAction: vi.fn(), onInspect: vi.fn(),
    };
    const watch = render(<DeckMasterRail {...props} mySeat={null} rivals={[]} selfTitle="Mika's Master" />);
    expect([...watch.container.querySelectorAll("section h2")].map((node) => node.textContent)).toEqual(["Mika's Master"]);
    cleanup();
    const oneVOne = render(<DeckMasterRail {...props} mySeat={0} />);
    expect(oneVOne.container.querySelector("[data-docks]")).toBeNull();
  });
});
