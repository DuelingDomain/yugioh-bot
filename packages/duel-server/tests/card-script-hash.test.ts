import { expect, it } from "vitest";
import { cardScriptHash } from "../src/card-script-hash.js";
import type { CardDatabase } from "../src/cards.js";
import type { ScriptOverlay } from "../src/multi-scripts.js";

it("includes shared helper changes even when the card script stays identical", () => {
  let helper = "old helper";
  const cards = { deckCard: () => ({ alias: 0 }), scriptNames: () => ["c10.lua", "proc_x.lua"],
    readScript: (name: string) => name === "c10.lua" ? "card" : helper } as unknown as CardDatabase;
  const before = cardScriptHash(cards, 10);
  helper = "fixed helper";
  expect(cardScriptHash(cards, 10)).not.toBe(before);
});
it("includes multiplayer overlays and the legacy transform in separate engine revisions", () => {
  const cards = { deckCard: () => ({ alias: 0 }), readScript: (_name: string, overlay?: ScriptOverlay) => overlay ? overlay.apply("c10.lua", "card") : "card" } as unknown as CardDatabase;
  const overlay = { apply: (_name: string, text: string | null) => text + "suffix", utility: "helper" } as ScriptOverlay;
  expect(cardScriptHash(cards, 10, "multi-normal", overlay)).not.toBe(cardScriptHash(cards, 10, "pinned-normal"));
  expect(cardScriptHash(cards, 10, "legacy-normal")).not.toBe(cardScriptHash(cards, 10, "pinned-normal"));
  const fixed = { ...overlay, utility: "fixed", apply: () => "fixed suffix" };
  expect(cardScriptHash(cards, 10, "multi-normal", fixed)).not.toBe(cardScriptHash(cards, 10, "multi-normal", overlay));
});
