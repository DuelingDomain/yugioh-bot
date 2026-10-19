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

// Fixture prompts below: the engine shape of a detach (overlay options with their Xyz), for cases a duel does not reach cheaply.
type Host = { controller: number; location: number; sequence: number; name: string };
function material(id: string, name: string, code: number, sequence: number, host: Host) {
  return {
    id, label: name, location: 0x80, sequence, controller: host.controller, host,
    card: { code, name, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "x" },
  };
}
const detach = (options: ReturnType<typeof material>[], extra: Record<string, unknown> = {}) =>
  ({ id: "p", seat: 0, kind: "cards", title: "Select the Xyz Material(s) to detach", min: 1, max: 1, cancelable: false, options, ...extra }) as unknown as DuelPrompt;
const notes = () => [...document.querySelectorAll("[data-pile-card]")].map((el) => ({
  name: el.getAttribute("aria-label")!.split(",")[0],
  note: el.querySelector("[data-pick-note]")?.textContent ?? null,
  id: el.getAttribute("data-pick-id"),
}));

it("tells the materials of two Xyz with one name apart, and a click sends the id of that tile", () => {
  const { fireEvent } = dom;
  const left: Host = { controller: 0, location: 4, sequence: 1, name: "Number 39: Utopia" };
  const right: Host = { controller: 0, location: 4, sequence: 3, name: "Number 39: Utopia" };
  // The ids do not follow the order of the zones, so a tile that answers its position would send the wrong card.
  const prompt = detach([
    material("card:2", "Celtic Guardian", 91152256, 0, right),
    material("card:0", "Mystical Elf", 15025844, 0, left),
    material("card:1", "Axe Raider", 48305365, 1, left),
  ]);
  const sent: DuelAnswer[] = [];
  mount(prompt, (answer) => sent.push(answer));
  expect(notes()).toEqual([
    { name: "Celtic Guardian", note: "2 of 2 · Under Number 39: Utopia", id: "card:2" },
    { name: "Mystical Elf", note: "1 of 2 · Under Number 39: Utopia", id: "card:0" },
    { name: "Axe Raider", note: "1 of 2 · Under Number 39: Utopia", id: "card:1" },
  ]);
  for (const name of ["Celtic Guardian", "Mystical Elf", "Axe Raider"]) fireEvent.click(tile(name));
  expect(sent).toEqual([{ selected: ["card:2"] }, { selected: ["card:0"] }, { selected: ["card:1"] }]);
});

it("names the owner when the two Xyz have different controllers", () => {
  const { fireEvent } = dom;
  const mine: Host = { controller: 0, location: 4, sequence: 0, name: "Number 39: Utopia" };
  const theirs: Host = { controller: 1, location: 4, sequence: 2, name: "Gaia Dragon, the Thunder Charger" };
  const prompt = detach([
    material("card:5", "Mystical Elf", 15025844, 0, mine),
    material("card:6", "Axe Raider", 48305365, 0, theirs),
  ]);
  const sent: DuelAnswer[] = [];
  mount(prompt, (answer) => sent.push(answer));
  expect(notes().map((entry) => entry.note)).toEqual([
    "Under your Number 39: Utopia",
    "Under opponent's Gaia Dragon, the Thunder Charger",
  ]);
  fireEvent.click(tile("Axe Raider"));
  fireEvent.click(tile("Mystical Elf"));
  expect(sent).toEqual([{ selected: ["card:6"] }, { selected: ["card:5"] }]);
});

it("says what ends a pick that needs Confirm, and offers none only when the engine does", () => {
  const host: Host = { controller: 0, location: 4, sequence: 0, name: "X" };
  const options = [material("card:0", "Mystical Elf", 15025844, 0, host), material("card:1", "Celtic Guardian", 91152256, 1, host)];
  const status = () => document.querySelector("[data-testid='pile-pick-bar'] span")?.textContent;
  const cases: Array<[Record<string, unknown>, string, boolean]> = [
    [{ min: 1, max: 1 }, "Click a material to choose it", false],
    [{ min: 0, max: 1 }, "Choose a material or none, then Confirm", true],
    [{ min: 2, max: 2 }, "Choose 2 materials · 0 of 2 chosen", true],
    [{ min: 1, max: 2 }, "Choose 1 to 2 materials · 0 chosen", true],
  ];
  for (const [bounds, text, confirm] of cases) {
    dom.cleanup();
    mount(detach(options, bounds), () => {});
    expect(status()).toBe(text);
    expect(document.querySelector("[data-pick-confirm]") != null).toBe(confirm);
  }
});

it("chooses a material with the number keys while the window has focus", () => {
  const { fireEvent } = dom;
  const host: Host = { controller: 0, location: 4, sequence: 0, name: "X" };
  const options = [
    material("card:4", "Mystical Elf", 15025844, 0, host),
    material("card:7", "Axe Raider", 48305365, 1, host),
    material("card:9", "Celtic Guardian", 91152256, 2, host),
  ];
  // One needed: a key answers at once, with the id of the option of that number (the same as the generic list).
  const sent: DuelAnswer[] = [];
  mount(detach(options), (answer) => sent.push(answer));
  const dialog = document.querySelector<HTMLElement>("[role='dialog']")!;
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!, { key: "2" });
  fireEvent.keyDown(document.activeElement!, { key: "Numpad3", code: "Numpad3" });
  fireEvent.keyDown(document.activeElement!, { key: "9" });
  expect(sent).toEqual([{ selected: ["card:7"] }, { selected: ["card:9"] }]);
  // Two needed: the keys pick and unpick, and only Confirm answers.
  dom.cleanup();
  const sentTwo: DuelAnswer[] = [];
  mount(detach(options, { min: 2, max: 2 }), (answer) => sentTwo.push(answer));
  fireEvent.keyDown(document.activeElement!, { key: "1" });
  fireEvent.keyDown(document.activeElement!, { key: "3" });
  expect(tile("Mystical Elf").getAttribute("data-selected")).toBe("true");
  expect(tile("Celtic Guardian").getAttribute("data-selected")).toBe("true");
  fireEvent.keyDown(document.activeElement!, { key: "1" });
  expect(tile("Mystical Elf").getAttribute("data-selected")).toBe("false");
  fireEvent.keyDown(document.activeElement!, { key: "2" });
  expect(sentTwo).toEqual([]);
  fireEvent.click(document.querySelector("[data-pick-confirm]")!);
  expect([...(sentTwo[0]?.selected ?? [])].sort()).toEqual(["card:7", "card:9"]);
});
