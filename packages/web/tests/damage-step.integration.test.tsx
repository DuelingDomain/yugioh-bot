// Node owns the real engine workers; jsdom renders their public views and prompts.
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { populateGlobal } from "vitest/runtime";
import type { DuelAnswer, DuelBattleStep, DuelEngineView } from "@yugidraft/shared/duels";
import { seatCountFor } from "@yugidraft/shared/duels";
import { GameWorker } from "../../duel-server/src/worker-client";
import { compileBoard, type BoardSpec } from "../../duel-server/src/presets/board";
import { choosePracticeBotAnswer } from "../../duel-server/src/practice-bot";
import { describeWithCores, needs } from "../../duel-server/tests/support/cores";
import { engineDataDirectory } from "../../duel-server/tests/engine-data-dir";

let dom: typeof import("@testing-library/react");
let PromptCenter: typeof import("../src/components/duel/prompt-center").PromptCenter;
let usePromptDraft: typeof import("../src/components/duel/prompts").usePromptDraft;
let StationTrack: typeof import("../src/components/duel/station-track").StationTrack;
beforeAll(async () => {
  const jsdom = "jsdom";
  const { JSDOM } = await import(jsdom);
  const window = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/", pretendToBeVisual: true }).window;
  const realUrl = globalThis.URL;
  populateGlobal(globalThis, window, { bindFunctions: true });
  globalThis.URL = realUrl;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  dom = await import("@testing-library/react");
  ({ PromptCenter } = await import("../src/components/duel/prompt-center"));
  ({ usePromptDraft } = await import("../src/components/duel/prompts"));
  ({ StationTrack } = await import("../src/components/duel/station-track"));
});
afterEach(() => dom?.cleanup());
vi.mock("@/components/duel/api", () => ({ getDuelCards: vi.fn(async () => ({ cards: [] })) }));

const cases: Array<{ code: number; step: DuelBattleStep; label: string }> = [
  { code: 37742478, step: "damage", label: "Start of Damage Step" },
  { code: 27243130, step: "before-damage-calculation", label: "Before Damage Calculation" },
  { code: 79575620, step: "damage-calculation", label: "Damage Calculation" },
  { code: 7572887, step: "after-damage-calculation", label: "After Damage Calculation" },
  { code: 97017120, step: "damage-end", label: "End of Damage Step" },
];

describeWithCores("Damage Step indicator and activation prompt, real engines", [needs.cards(), needs.standard(), needs.domain(), needs.installedMulti()], () => {
  for (const mode of ["normal", "domain"] as const) for (const format of ["1v1", "tag", "ffa3", "ffa4"] as const) {
    it.each(cases)(`${mode} ${format}: $label is visible and its effect can activate`, async ({ code, step, label }) => {
      const count = seatCountFor(format);
      const holder = code === 27243130 ? count - 1 : code === 79575620 ? 0 : 1;
      const board: BoardSpec = { mode, format, attackFirstTurn: true, skipOpeningDraw: true,
        p0: { monsters: [code === 79575620 ? code : 89631139] },
        p1: { monsters: [code === 7572887 || code === 97017120 ? code : 43096270], deck: ["Beaver Warrior"] } };
      const ids = ["p0", "p1", "p2", "p3"] as const;
      for (let seat = 0; seat < count; seat++) {
        board[ids[seat]!] ??= {};
        if (mode === "domain") board[ids[seat]!]!.deckMaster = "Mystical Elf";
      }
      if (code === 37742478) board.p1!.hand = [code];
      if (code === 27243130) board[ids[holder]!]!.spells = [{ card: code, pos: "set" }];
      const compiled = compileBoard(board, engineDataDirectory);
      const game = new GameWorker();
      try {
        await game.create({ ...compiled.options, dataDirectory: engineDataDirectory, seed: ["1", "2", "3", "4"],
          settings: { ...compiled.options.settings!, stopAtEveryWindow: false } });
        let found: DuelEngineView | undefined, attacked = false;
        for (let guard = 0; guard < 100; guard++) {
          const views = await Promise.all(Array.from({ length: count }, (_, seat) => game.view(seat)));
          const view = views.find(v => v.prompt)!;
          const prompt = view.prompt!;
          if (prompt.seat === holder && view.battleStep === step
            && (prompt.source?.code === code || prompt.options.some(o => o.card?.code === code))) {
            found = view;
            break;
          }
          let answer: DuelAnswer;
          const action = prompt.options.find(o => o.id === "to_bp" || !attacked && o.id.startsWith("attack:"));
          if (action) {
            attacked ||= action.id.startsWith("attack:");
            answer = { choice: action.id };
          } else if (/attack target/i.test(prompt.title) && prompt.kind === "choice") {
            answer = { choice: prompt.options.find(o => o.controller === 1 && o.location === 4)!.id };
          } else if (prompt.context?.type === "chain" && prompt.cancelable) answer = { cancel: true };
          else if (prompt.options.some(o => o.id === "no")) answer = { choice: "no" };
          else if (attacked && prompt.options.some(o => o.id === "to_m2")) break;
          else answer = choosePracticeBotAnswer(prompt);
          await game.answer(prompt.seat, prompt.id, answer);
        }
        expect(found, "An eligible effect must reach its owner under Auto").toBeDefined();
        const view = found!, prompt = view.prompt!;
        let sent: DuelAnswer | undefined;
        function Host() {
          const draft = usePromptDraft(prompt);
          return <>
            <StationTrack phase={view.phase} battleStep={view.battleStep} turn={view.turn} turnSeat={view.turnSeat} mySeat={holder}
              playerName={seat => `Player ${seat + 1}`} actionOptions={[]} canAct noLegalMoves={false} onChoose={() => {}} reducedMotion />
            <PromptCenter prompt={prompt} mySeat={holder} active slug="damage-step" busy={false} draft={draft}
              onSubmit={answer => { sent = answer; }} menuOpen={false} chain={view.chain} aimLocked={false} reducedMotion
              revision={view.revision} battleStep={view.battleStep} />
          </>;
        }
        dom.render(<Host />);
        expect(document.querySelector('[aria-label="Battle Phase steps"] [aria-current="step"]')).toHaveAttribute("title", label);
        expect(dom.screen.getByRole("button", { name: "Yes" }).closest('[role="group"]')).toHaveTextContent(label);
        dom.fireEvent.click(dom.screen.getByRole("button", { name: "Yes" }));
        expect(sent).toBeDefined();
        await game.answer(holder, prompt.id, sent!);
        expect((await game.view(holder)).prompt?.id).not.toBe(prompt.id);
      } finally { dom.cleanup(); await game.close(); }
    }, 15_000);
  }
});
