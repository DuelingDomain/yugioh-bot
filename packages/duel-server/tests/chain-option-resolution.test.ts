import { beforeAll, describe, expect, it } from "vitest";
import { OcgHintType, OcgMessageType } from "ocgcore-wasm";
import { loadCardDatabase } from "../src/cards.js";
import { ChainOptions } from "../src/chain-options.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";
import { mapPrompt } from "../src/prompts.js";
import { mapPrompt as mapLegacyPrompt } from "../src/legacy/prompts.js";
import { engineDataDirectory } from "./engine-data-dir.js";
import { describeWithCores, needs } from "./support/cores.js";
import { chainResolutionBatches, ENEMY_CONTROLLER, UNI_ZOMBIE, type EngineBatch } from "./helpers/chain-resolution.js";

describeWithCores("real chain option resolution", [
  needs.cards(engineDataDirectory), needs.scripts(engineDataDirectory, "official/c98045062.lua"),
  needs.scripts(engineDataDirectory, "official/c49959355.lua"),
], () => {
  let cards: ReturnType<typeof loadCardDatabase>;
  beforeAll(() => { cards = loadCardDatabase(engineDataDirectory); });

  describe.each([
    ["merged", merged, mapPrompt], ["legacy", legacy, mapLegacyPrompt],
  ] as const)("%s event pipeline", (_name, views, promptMapper) => {
    function eventsOf(batches: readonly EngineBatch[]) {
      const ctx = views.createEventContext() as never;
      const chain: merged.StoredChainLink[] = [];
      const events: merged.StoredDuelEvent[] = [];
      const choices = new ChainOptions(cards);
      for (const batch of batches) {
        views.resetEventBatch(ctx);
        for (const note of batch.notes) views.noteDestroyLog(ctx, note) || views.noteChainTargetLog(ctx, note);
        for (const message of batch.messages) {
          const event = views.observeDuelEvent(message, cards, chain, events.length + 1, ctx);
          choices.observe(message, chain, event);
          if (event) events.push(event);
        }
        if (batch.response) {
          const prompt = promptMapper(batch.messages.at(-1)!, cards, "real-choice");
          choices.recordPrompt(prompt);
          choices.recordResponse(prompt, batch.response);
        }
      }
      return events;
    }

    it("records the real Enemy Controller choice once through resolution", async () => {
      const batches = await chainResolutionBatches("select-effect");
      const messages = batches.flatMap((batch) => batch.messages);
      const option = messages.find((message) => message.type === OcgMessageType.SELECT_OPTION);
      expect(option?.type).toBe(OcgMessageType.SELECT_OPTION);
      if (option?.type !== OcgMessageType.SELECT_OPTION) throw new Error("Enemy Controller did not offer its effects");
      expect(option.options).toHaveLength(2);
      expect(messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.HINT, hint_type: OcgHintType.OPSELECTED, hint: option.options[0],
      }));
      const expected = [{ index: 0, text: promptMapper(option, cards, "choice").prompt.options[0].label }];
      expect(expected[0].text).toMatch(/battle position/i);
      const events = eventsOf(batches);
      // The stock core sends CHAINING before SelectEffect, so activation cannot contain a future choice.
      expect(events.find((entry) => entry.kind === "activate")).not.toHaveProperty("chosenOptions");
      for (const kind of ["chain-resolving", "chain-resolved"]) {
        const event = events.find((entry) => entry.kind === kind);
        expect(event?.card?.code).toBe(ENEMY_CONTROLLER);
        expect(event?.chosenOptions).toEqual(expected);
      }
    });

    it("omits Uni-Zombie's effect-description hint from chosen options", async () => {
      const batches = await chainResolutionBatches("effect-hint");
      const messages = batches.flatMap((batch) => batch.messages);
      const activation = messages.find((message) => message.type === OcgMessageType.CHAINING);
      expect(activation?.type).toBe(OcgMessageType.CHAINING);
      if (activation?.type !== OcgMessageType.CHAINING) throw new Error("Uni-Zombie did not activate");
      expect(activation.code).toBe(UNI_ZOMBIE);
      expect(messages).toContainEqual(expect.objectContaining({
        type: OcgMessageType.HINT, hint_type: OcgHintType.OPSELECTED, hint: activation.description,
      }));
      expect(messages.some((message) => message.type === OcgMessageType.SELECT_OPTION)).toBe(false);
      const events = eventsOf(batches);
      for (const kind of ["activate", "chain-resolving", "chain-resolved"]) {
        const event = events.find((entry) => entry.kind === kind);
        expect(event?.card?.code).toBe(UNI_ZOMBIE);
        expect(event).not.toHaveProperty("chosenOptions");
      }
    });
  });
});
