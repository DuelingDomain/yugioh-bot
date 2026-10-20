// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DuelCard, DuelPrompt } from "@yugidraft/shared/duels";
import { createEngineGame } from "../../../duel-server/src/engine";
import { compileBoard } from "../../../duel-server/tests/support/board";
import { describeWithCores, needs } from "../../../duel-server/tests/support/cores";
import { engineDataDirectory as DATA } from "../../../duel-server/tests/engine-data-dir";
import { HandStrip } from "@/components/duel/field";
import { OwnHand } from "@/components/duel/tag/tag-hand";
import { CardActionMenu } from "@/components/duel/card-interactions";
import { optionsForCard, promptLegalKeys } from "@/components/duel/prompts";

// Vite treats the server helper's static new URL as a browser asset in jsdom.
// Resolve that test-only path with Node; engine data and engine code stay real.
vi.mock("../../../duel-server/tests/engine-data-dir", async () => {
  const { dirname, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const DEFAULT_TEST_DATA_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.resolve("../../../duel-server/tests/engine-data-dir"))), "../../../data/duel-engine-next");
  const currentEngineDataDirectory = () => resolve(process.env.DUEL_DATA_DIR ?? DEFAULT_TEST_DATA_DIRECTORY);
  return { DEFAULT_TEST_DATA_DIRECTORY, currentEngineDataDirectory, engineDataDirectory: currentEngineDataDirectory() };
});

afterEach(cleanup);

function Hand({ card, prompt, hud, answer }: {
  card: DuelCard; prompt: DuelPrompt; hud: boolean; answer: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const onActivate = (_keys: string[], _card: DuelCard | null, element: HTMLElement) => setAnchor(element);
  const props = { seat: 0, cards: [card], legalKeys: promptLegalKeys(prompt), selectedKeys: new Set<string>(), onActivate };
  return <>
    {hud ? <OwnHand {...props} reducedMotion onInspect={() => {}} />
      : <HandStrip {...props} mine ownerLabel="Your" />}
    {anchor ? <CardActionMenu anchor={anchor} title={card.name!} busy={false}
      options={optionsForCard(prompt, card, [])} onChoose={option => answer(option.id)} onClose={() => setAnchor(null)} /> : null}
  </>;
}

// These are integration checks: all card data, scripts, prompts and answers come
// from the real engine. No engine or prompt is replaced with a test double.
for (const format of ["1v1", "ffa3", "ffa4"] as const) {
  describeWithCores(`Issue 380 client from real ${format} engine`, [needs.cards(DATA),
    format === "1v1" ? needs.standard(DATA) : needs.installedMulti(DATA)], () => {
    it.each([false, true])("offers the hand effect in the client (HUD: %s)", async hud => {
      const compiled = compileBoard({ format, skipOpeningDraw: true,
        p0: { hand: [62368221], deck: [37279096, 90728287] } }, DATA);
      const game = await createEngineGame({ ...compiled.options, dataDirectory: DATA, seed: ["1", "2", "3", "4"] });
      try {
        const view = game.view(0);
        expect(view.phase).toBe("main1");
        const card = view.seats[0]!.hand.find(card => card.code === 62368221)!;
        const option = view.prompt!.options.find(option => option.id.startsWith("activate:") && option.card?.code === 62368221)!;
        expect(option).toBeDefined();
        let answered: string | undefined;
        const screen = render(<Hand card={card} prompt={view.prompt!} hud={hud} answer={id => {
          answered = id;
          game.answer(0, view.prompt!.id, { choice: id });
        }} />);
        const button = screen.getByRole("button", { name: card.name! });
        if (hud) {
          expect(button).toHaveAttribute("data-usable", "true");
          expect(button).toHaveTextContent("Use");
        } else {
          expect(button.closest("[data-zones]")).toHaveAttribute("data-legal", "true");
          expect(button.querySelector('[data-state="usable"]')).not.toBeNull();
        }
        fireEvent.click(button);
        fireEvent.click(screen.getByRole("menuitem", { name: option.label }));
        expect(answered).toBe(option.id);
        // The client choice reaches the engine and pays the hand-banish cost.
        expect(game.view(0).seats[0]!.banished.map(card => card.code)).toContain(62368221);
      } finally { game.close(); }
    });
  });
}
