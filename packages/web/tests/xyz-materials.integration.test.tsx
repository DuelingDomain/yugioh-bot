// The engine helpers read import.meta.url, which the jsdom environment replaces with a http URL. So this file runs in node and
// builds its own jsdom window for the React components (after the engine modules loaded).
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { populateGlobal } from "vitest/runtime";
import type { DuelCard } from "@yugidraft/shared/duels";
import { livePileCards, livePileTitle, type PileHost } from "../src/components/duel/pile-focus";
import { describeWithCores, needs } from "../../duel-server/tests/support/cores";
import { XYZ_MATERIALS, XYZ_NAME, xyzMaterialsGame } from "../../duel-server/tests/support/xyz-materials";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/api", () => ({ getDuelCards: vi.fn(async () => []) }));

type Dom = {
  cleanup: () => void;
  fireEvent: typeof import("@testing-library/react").fireEvent;
  render: typeof import("@testing-library/react").render;
  screen: typeof import("@testing-library/react").screen;
  CardActionMenu: typeof import("../src/components/duel/card-interactions").CardActionMenu;
  materialsMenu: typeof import("../src/components/duel/card-interactions").materialsMenu;
  ZoneSlot: typeof import("../src/components/duel/field").ZoneSlot;
  CardInspector: typeof import("../src/components/duel/inspector").CardInspector;
  PileViewer: typeof import("../src/components/duel/pile-viewer").PileViewer;
};
let dom: Dom;
beforeAll(async () => {
  // jsdom has no type declarations in this package: load it by a variable name.
  const jsdom = "jsdom";
  const { JSDOM } = await import(jsdom);
  const window = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true }).window;
  const realUrl = globalThis.URL;
  populateGlobal(globalThis, window, { bindFunctions: true });
  globalThis.URL = realUrl;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const rtl = await import("@testing-library/react");
  dom = {
    cleanup: rtl.cleanup, fireEvent: rtl.fireEvent, render: rtl.render, screen: rtl.screen,
    ...(await import("../src/components/duel/card-interactions")),
    ...(await import("../src/components/duel/field")),
    ...(await import("../src/components/duel/inspector")),
    ...(await import("../src/components/duel/pile-viewer")),
  } as Dom;
});
afterEach(() => dom?.cleanup());

type Case = { name: string; format: "1v1" | "ffa3"; mode: "normal" | "domain"; legacy: boolean };
const cases: Case[] = [
  { name: "Standard 1v1 (pinned engine)", format: "1v1", mode: "normal", legacy: false },
  { name: "Standard 1v1 (legacy engine)", format: "1v1", mode: "normal", legacy: true },
  { name: "Domain 1v1 (merged engine)", format: "1v1", mode: "domain", legacy: false },
  { name: "Domain 1v1 (legacy engine)", format: "1v1", mode: "domain", legacy: true },
  { name: "Domain ffa3", format: "ffa3", mode: "domain", legacy: false },
];

function coreNeeds(item: Case) {
  const base = [needs.cards(), needs.scripts()];
  if (item.format !== "1v1") return [...base, ...needs.domainMulti()];
  if (item.mode === "normal") return [...base, needs.standard()];
  return [...base, needs.domain(), ...(item.legacy ? [needs.file("legacy Domain core", `${needs.domain().where.replace("ocgcore.domain.wasm", "ocgcore.domain.legacy.wasm")}`)] : [])];
}

for (const item of cases) {
  describeWithCores(`Xyz materials, real engine: ${item.name}`, coreNeeds(item), () => {
    it("carries both materials to every viewer and lets the player open the Materials view", async () => {
      const { cleanup, fireEvent, render, screen, ZoneSlot, PileViewer, CardInspector, CardActionMenu, materialsMenu } = dom;
      const game = await xyzMaterialsGame(item);
      try {
        const seatCount = item.format === "ffa3" ? 3 : 2;
        for (let viewer = 0; viewer < seatCount; viewer += 1) {
          const card = game.view(viewer).seats[0].monsters.find((entry) => entry?.code != null)!;
          expect(card.name).toBe(XYZ_NAME);
          expect(card.materials?.map((material) => material.name)).toEqual(XYZ_MATERIALS);
          cleanup();
          const onActivate = vi.fn();
          const onInspect = vi.fn();
          render(
            <ZoneSlot card={card} label="Monster zone 1" kind="mz" keys={["0:4:0"]} legalKeys={new Set()} selectedKeys={new Set()}
              showStats onActivate={onActivate} onInspect={onInspect} />,
          );
          // The field card shows the count in the badge, and its name says it too.
          const badge = document.querySelector("[data-materials-badge]")!;
          expect(badge.getAttribute("data-materials-badge")).toBe("2");
          expect(badge.textContent).toBe("2");
          expect(screen.getByRole("button", { name: /2 materials/ })).toBeTruthy();
          // A click on the badge opens the Materials view and does not act on the card.
          fireEvent.click(badge);
          expect(onActivate).not.toHaveBeenCalled();
          expect(onInspect).toHaveBeenCalledTimes(1);
          const target = onInspect.mock.calls[0][0] as { type: string; title: string; cards: DuelCard[]; host?: PileHost };
          expect(target.type).toBe("pile");
          expect(target.host).toEqual({ controller: card.controller, location: card.location, sequence: card.sequence });
          expect(document.querySelector("[data-materials-open]")).toBeTruthy();
          expect(target.title).toBe("Materials (2)");
          expect(target.cards.map((material) => material.name)).toEqual(XYZ_MATERIALS);
          // A legal target (an attack target, a card pick): a tap on the badge picks the card; no Materials view opens.
          cleanup();
          const onPick = vi.fn();
          const onInspectLegal = vi.fn();
          render(
            <ZoneSlot card={card} label="Monster zone 1" kind="mz" keys={["0:4:0"]} legalKeys={new Set(["0:4:0"])} selectedKeys={new Set()}
              showStats onActivate={onPick} onInspect={onInspectLegal} />,
          );
          expect(document.querySelector("[data-materials-open]")).toBeNull();
          fireEvent.click(document.querySelector("[data-materials-badge]")!);
          expect(onPick).toHaveBeenCalledTimes(1);
          expect(onInspectLegal).not.toHaveBeenCalled();
          cleanup();
          render(
            <ZoneSlot card={card} label="Monster zone 1" kind="mz" keys={["0:4:0"]} legalKeys={new Set()} selectedKeys={new Set()}
              showStats onActivate={onActivate} onInspect={onInspect} />,
          );

          // The open view follows the board: one material less shows 1; a face-down Xyz or an empty zone shows none.
          const pileView = { title: target.title, owner: "you" as const, cards: target.cards, open: true, host: target.host };
          const engineView = game.view(viewer);
          expect(livePileCards(pileView, engineView, 0).map((material) => material.name)).toEqual(XYZ_MATERIALS);
          const withXyz = (change: (xyz: DuelCard) => DuelCard | null) => ({
            ...engineView,
            seats: engineView.seats.map((seatView) => ({
              ...seatView,
              monsters: seatView.monsters.map((entry) => (entry && entry.sequence === card.sequence && entry.controller === card.controller ? change(entry) : entry)),
            })),
          });
          const fewer = withXyz((xyz) => ({ ...xyz, materials: xyz.materials?.slice(1) }));
          expect(livePileCards(pileView, fewer, 0).map((material) => material.name)).toEqual(XYZ_MATERIALS.slice(1));
          expect(livePileTitle(pileView, livePileCards(pileView, fewer, 0))).toBe("Materials (1)");
          expect(livePileCards(pileView, withXyz((xyz) => ({ ...xyz, position: 0x8 })), 0)).toEqual([]);
          expect(livePileCards(pileView, withXyz(() => null), 0)).toEqual([]);
          cleanup();
          const shown = livePileCards(pileView, fewer, 0);
          const viewer1 = render(<PileViewer title={livePileTitle(pileView, target.cards)} cards={target.cards} owner="you" open onClose={vi.fn()} onInspectCard={vi.fn()} reducedMotion />);
          expect(screen.getByText("Materials (2)")).toBeTruthy();
          viewer1.rerender(<PileViewer title={livePileTitle(pileView, shown)} cards={shown} owner="you" open onClose={vi.fn()} onInspectCard={vi.fn()} reducedMotion />);
          expect(screen.getByText("Materials (1)")).toBeTruthy();
          cleanup();
          render(
            <ZoneSlot card={card} label="Monster zone 1" kind="mz" keys={["0:4:0"]} legalKeys={new Set()} selectedKeys={new Set()}
              showStats onActivate={onActivate} onInspect={onInspect} />,
          );

          // A click on the card itself still acts on it.
          fireEvent.click(screen.getByRole("button", { name: /2 materials/ }));
          expect(onActivate).toHaveBeenCalledTimes(1);
          expect(onInspect).toHaveBeenCalledTimes(1);
          cleanup();

          // The Materials view lists each attached card, and each one can be inspected.
          const onInspectCard = vi.fn();
          render(<PileViewer title={target.title} cards={target.cards} owner="you" open onClose={vi.fn()} onInspectCard={onInspectCard} reducedMotion />);
          for (const name of XYZ_MATERIALS) fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }));
          expect(onInspectCard.mock.calls.map(([material]) => (material as DuelCard).name)).toEqual(XYZ_MATERIALS);
          cleanup();

          // The inspector names the materials and offers the view.
          const onViewMaterials = vi.fn();
          render(<CardInspector target={{ type: "card", card }} onViewMaterials={onViewMaterials} />);
          expect(screen.getByText(`Materials (2): ${XYZ_MATERIALS.join(", ")}`)).toBeTruthy();
          fireEvent.click(screen.getByTestId("inspector-view-materials"));
          expect(onViewMaterials).toHaveBeenCalledWith({ type: "pile", title: "Materials (2)", cards: card.materials, host: target.host });
          cleanup();

          // The card action menu adds "View materials" after the engine options; it answers nothing.
          const onView = vi.fn();
          const anchor = document.body.appendChild(document.createElement("button"));
          render(<CardActionMenu anchor={anchor} title={XYZ_NAME} options={[]} busy={false} onChoose={vi.fn()} onClose={vi.fn()}
            materials={materialsMenu(card, onView)} />);
          fireEvent.click(screen.getByRole("menuitem", { name: "View materials (2)" }));
          expect(onView).toHaveBeenCalledWith(expect.objectContaining({ type: "pile", title: "Materials (2)" }));
          anchor.remove();
        }
      } finally {
        game.close();
      }
    }, 120000);
  });
}
