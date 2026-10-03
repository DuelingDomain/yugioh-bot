// Main b1e20054 regression, using the legacy 1v1 engine.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { DuelChainLink, DuelZoneRef } from "@yugidraft/shared/duels";
import { OcgMessageType, type OcgCoreSync, type OcgMessage } from "ocgcore-wasm";
import { firstTarget, MIRROR_FORCE, MST, secondTarget, targetingResponseGame } from "./helpers/target-response.js";

// Observe the actual decoded WASM output, without replacing any engine behavior.
const observed = vi.hoisted(() => ({ messages: [] as OcgMessage[] }));
vi.mock("ocgcore-wasm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ocgcore-wasm")>();
  return {
    ...actual,
    default: async (options: { sync: true }) => {
      const core = await actual.default(options);
      const read = core.duelGetMessage;
      core.duelGetMessage = ((handle) => {
        const messages = read(handle);
        observed.messages.push(...messages);
        return messages;
      }) as OcgCoreSync["duelGetMessage"];
      return core;
    },
  };
});

// Proposed public contract; intentionally local until a production fix adds it to shared.
type TargetedLink = DuelChainLink & { targets?: DuelZoneRef[] };
beforeEach(() => { observed.messages.length = 0; });

describe("pending effect targets at the response window (real stock-core duel)", () => {
  it("publishes a target event before the opponent answers", async () => {
    const game = await targetingResponseGame();
    try {
      const view = game.view(1);
      expect(view.prompt?.context?.type).toBe("chain");
      expect(observed.messages.find((message) => message.type === OcgMessageType.BECOME_TARGET))
        .toMatchObject({ cards: [firstTarget] });
      if (process.env.TARGET_RESPONSE_TRACE) {
        writeFileSync(process.env.TARGET_RESPONSE_TRACE,
          JSON.stringify(observed.messages, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2));
      }
      // Proposed target-event contract, complementing the reconnect-safe chain snapshot below.
      expect(view.events.filter((event) => String(event.kind) === "target"),
        "BECOME_TARGET must reach the public event stream before the response")
        .toContainEqual(expect.objectContaining({ kind: "target", chainIndex: 1, targets: [firstTarget] }));
    } finally { game.close(); }
  });

  it.each([0, 1, null])("exposes MST's face-down target to viewer %s while seat 1 can respond", async (viewer) => {
    const game = await targetingResponseGame();
    try {
      const responder = game.view(1);
      expect(responder.prompt?.context?.type).toBe("chain");
      expect(responder.prompt?.options.some((option) => option.card?.code === MST)).toBe(true);
      expect(responder.chain).toHaveLength(1);
      expect(responder.chain[0]?.code).toBe(MST);
      expect(responder.seats[1]?.spells[0]?.code).toBe(MIRROR_FORCE);
      expect(game.view(0).seats[1]?.spells[0]?.code).toBeUndefined();
      expect(game.view(null).seats[1]?.spells[0]?.code).toBeUndefined();
      const targetMessage = observed.messages.find((message) => message.type === OcgMessageType.BECOME_TARGET);
      expect(targetMessage, "the real core must announce the selected target").toMatchObject({ cards: [firstTarget] });
      const responseMessage = [...observed.messages].reverse().find((message) => message.type === OcgMessageType.SELECT_CHAIN);
      expect(responseMessage).toMatchObject({ player: 1 });
      expect(observed.messages.indexOf(targetMessage!)).toBeLessThan(observed.messages.indexOf(responseMessage!));
      // Fails today: the decoded target is lost before the viewer snapshot.
      expect((game.view(viewer).chain[0] as TargetedLink).targets,
        "pending Chain Link 1 must expose its target zone without revealing the set card").toEqual([firstTarget]);
    } finally { game.close(); }
  });

  it("keeps both links' targets when the activating player gets the next response prompt", async () => {
    const game = await targetingResponseGame(true);
    try {
      const view = game.view(0);
      expect(view.prompt?.context?.type).toBe("chain");
      expect(view.prompt?.options.some((option) => option.card?.code === MST)).toBe(true);
      expect(view.chain.map((link) => [link.index, link.seat, link.code])).toEqual([[1, 0, MST], [2, 1, MST]]);
      expect(observed.messages.filter((message) => message.type === OcgMessageType.BECOME_TARGET))
        .toMatchObject([{ cards: [firstTarget] }, { cards: [secondTarget] }]);
      expect(view.chain.map((link) => (link as TargetedLink).targets),
        "the original activator must see the targets of each pending link").toEqual([[firstTarget], [secondTarget]]);
    } finally { game.close(); }
  });
});
