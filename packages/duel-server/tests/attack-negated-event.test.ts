import { describe, expect, it } from "vitest";
import { OcgMessageType } from "ocgcore-wasm";
import type { CardDatabase } from "../src/cards.js";
import * as merged from "../src/views.js";
import * as legacy from "../src/legacy/views.js";

const cards = { get: () => undefined, resolveLabel: () => "" } as unknown as CardDatabase;

describe.each([["merged", merged], ["legacy", legacy]] as const)("%s attack-negated view", (_name, views) => {
  it("turns MSG_ATTACK_DISABLED into a public attack-negated event for every viewer", () => {
    const stored = views.observeDuelEvent({ type: OcgMessageType.ATTACK_DISABLED }, cards, [], 9, views.createEventContext() as never)!;
    expect(stored).toMatchObject({ id: 9, kind: "attack-negated", text: "Attack negated", revealCardTo: "all" });
    for (const viewer of [0, 1, null]) expect(views.projectStoredEvent(stored, viewer)).toMatchObject({ id: 9, kind: "attack-negated" });
  });
});
