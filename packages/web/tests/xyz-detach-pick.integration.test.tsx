// Runs in node with its own jsdom window, like xyz-materials.integration.test.tsx (the engine helpers read import.meta.url).
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { populateGlobal } from "vitest/runtime";
import type { DuelAnswer, DuelPrompt } from "@yugidraft/shared/duels";
import { describeWithCores, needs } from "../../duel-server/tests/support/cores";
import { liveNseat } from "../../duel-server/tests/support/live-nseat";
import { FIRST, openDetachGame, openDuoDrive, reachDetach, SECOND, XYZ } from "../../duel-server/tests/support/xyz-detach";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});
vi.mock("@/components/duel/api", () => ({ getDuelCards: vi.fn(async () => ({ cards: [] })) }));

type Dom = {
  cleanup: () => void;
  fireEvent: typeof import("@testing-library/react").fireEvent;
  render: typeof import("@testing-library/react").render;
  screen: typeof import("@testing-library/react").screen;
  PromptCenter: typeof import("../src/components/duel/prompt-center").PromptCenter;
  usePromptDraft: typeof import("../src/components/duel/prompts").usePromptDraft;
  isMaterialPickPrompt: typeof import("../src/components/duel/prompt-center").isMaterialPickPrompt;
};
let dom: Dom;
beforeAll(async () => {
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
    ...(await import("../src/components/duel/prompt-center")),
    ...(await import("../src/components/duel/prompts")),
  } as Dom;
});
afterEach(() => dom?.cleanup());

/** The real PromptCenter over the engine's own prompt; a submitted answer goes to the real engine. */
function mount(prompt: DuelPrompt, onSubmit: (answer: DuelAnswer) => void) {
  const { PromptCenter, usePromptDraft, render } = dom;
  function Host() {
    const draft = usePromptDraft(prompt);
    return (
      <div style={{ position: "relative", width: 1000, height: 700 }}>
        <PromptCenter prompt={prompt} mySeat={0} active slug="t" busy={false} draft={draft} onSubmit={onSubmit} menuOpen={false}
          chain={[]} aimLocked={false} reducedMotion revision={0} />
      </div>
    );
  }
  return render(<Host />);
}

const tile = (name: string) => document.querySelector<HTMLElement>(`[data-pile-card][aria-label^="${name},"]`)!;

const cases = [
  { name: "Standard 1v1", mode: "normal", format: "1v1", needs: [needs.cards(), needs.scripts(), needs.standard()] },
  { name: "Domain 1v1", mode: "domain", format: "1v1", needs: [needs.cards(), needs.scripts(), needs.domain(), needs.domainScript()] },
  { name: "Standard table of three", mode: "normal", format: "ffa3", needs: [needs.cards(), needs.scripts(), liveNseat] },
  { name: "Domain table of three", mode: "domain", format: "ffa3", needs: [needs.cards(), needs.scripts(), liveNseat, ...needs.domainMulti()] },
] as const;

for (const item of cases) {
  describeWithCores(`Xyz detach pick in the Materials window, real engine: ${item.name}`, [...item.needs], () => {
    it("shows the materials in the centred window and detaches the one that is clicked", async () => {
      const { fireEvent, screen } = dom;
      const game = await openDetachGame(item.mode, item.format);
      try {
        const prompt = reachDetach(game, item.format === "1v1" ? 2 : 3);
        expect(dom.isMaterialPickPrompt(prompt)).toBe(true);
        let sent: DuelAnswer | null = null;
        mount(prompt, (answer) => { sent = answer; });
        // The centred Materials window (the pile dialog), with both cards as art tiles. No generic strip, no confirm for a single pick.
        const dialog = screen.getByRole("dialog");
        expect(dialog.hasAttribute("data-pile-viewer")).toBe(true);
        expect(dialog.querySelectorAll("[data-pile-card]")).toHaveLength(2);
        expect(dialog.querySelectorAll("img").length).toBeGreaterThanOrEqual(2);
        expect(document.querySelector("[data-pick-confirm]")).toBeNull();
        expect(document.querySelector("[data-pick-cancel]")).toBeNull();
        // A click on the second material is the answer; the real engine takes it and that card, only, goes to the Graveyard.
        fireEvent.click(tile(SECOND));
        expect(sent).toEqual({ selected: [prompt.options.find((option) => option.card?.name === SECOND)!.id] });
        game.answer(0, prompt.id, sent!);
        const seat = game.view(0).seats[0];
        expect(seat.graveyard.map((card) => card.name)).toEqual([SECOND]);
        expect(seat.monsters.find((card) => card?.name === XYZ)?.materials?.map((card) => card.name)).toEqual([FIRST]);
      } finally {
        game.close();
      }
    });
  });
}

describeWithCores("Xyz detach pick in the Materials window: two materials needed", [needs.cards(), needs.scripts(), needs.standard()], () => {
  it("needs Confirm, enables it at the engine count and detaches the picked pair", async () => {
    const { fireEvent } = dom;
    const { game, prompt } = await openDuoDrive();
    try {
      expect([prompt.min, prompt.max]).toEqual([2, 2]);
      let sent: DuelAnswer | null = null;
      mount(prompt, (answer) => { sent = answer; });
      const confirm = document.querySelector<HTMLButtonElement>("[data-pick-confirm]")!;
      expect(confirm.disabled).toBe(true);
      fireEvent.click(tile("Mystical Elf"));
      expect(sent).toBeNull();
      expect(confirm.disabled).toBe(true);
      fireEvent.click(tile("Axe Raider"));
      expect(tile("Axe Raider").getAttribute("data-selected")).toBe("true");
      expect(confirm.disabled).toBe(false);
      // A third pick is refused (the engine allows 2); a click on a picked card undoes it.
      fireEvent.click(tile("Celtic Guardian"));
      expect(confirm.disabled).toBe(false);
      expect(tile("Celtic Guardian").getAttribute("data-selected")).toBe("false");
      fireEvent.click(confirm);
      const ids = prompt.options.filter((option) => ["Mystical Elf", "Axe Raider"].includes(option.card?.name ?? "")).map((option) => option.id);
      expect([...(sent as DuelAnswer | null)?.selected ?? []].sort()).toEqual(ids.sort());
      game.answer(0, prompt.id, sent!);
      const seat = game.view(0).seats[0];
      expect(seat.graveyard.map((card) => card.name).sort()).toEqual(["Axe Raider", "Mystical Elf"]);
      expect(seat.monsters.find((card) => card?.name === "Ryzeal Duo Drive")?.materials?.map((card) => card.name)).toEqual(["Celtic Guardian"]);
    } finally {
      game.close();
    }
  });
});

it("sends Cancel only when the engine allows it", async () => {
  const { fireEvent } = dom;
  const options = [
    { id: "card:0", label: "A", location: 0x80, sequence: 0, controller: 0, host: { controller: 0, location: 4, sequence: 0, name: "X" }, card: { code: 15025844, name: "Mystical Elf", description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "x" } },
    { id: "card:1", label: "B", location: 0x80, sequence: 1, controller: 0, host: { controller: 0, location: 4, sequence: 0, name: "X" }, card: { code: 91152256, name: "Celtic Guardian", description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "x" } },
  ];
  for (const cancelable of [false, true]) {
    dom.cleanup();
    const sent: DuelAnswer[] = [];
    mount({ id: "p", seat: 0, kind: "cards", title: "Select the Xyz Material(s) to detach", min: 1, max: 1, cancelable, options } as unknown as DuelPrompt, (answer) => sent.push(answer));
    const cancel = document.querySelector<HTMLButtonElement>("[data-pick-cancel]");
    expect(cancel != null).toBe(cancelable);
    if (cancel) {
      fireEvent.click(cancel);
      expect(sent).toEqual([{ cancel: true }]);
    }
  }
});
