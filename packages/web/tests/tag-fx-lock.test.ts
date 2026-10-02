import { describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { lockForEvents } from "@/components/duel/tag/fx-lock";

const ev = (id: number, kind: DuelEvent["kind"], extra: Partial<DuelEvent> = {}): DuelEvent => ({ id, kind, text: kind, ...extra });

describe("lockForEvents", () => {
  it("returns null without new events", () => {
    expect(lockForEvents([], 0)).toBeNull();
    expect(lockForEvents([ev(3, "attack")], 3)).toBeNull();
  });

  it("an attack on a monster locks for battle", () => {
    const lock = lockForEvents([ev(1, "attack", { target: { controller: 3, location: 4, sequence: 0 } as never })], 0);
    expect(lock?.reason).toBe("battle");
    expect(lock?.ms).toBeGreaterThan(1000);
  });

  it("an attack with no target is a direct attack", () => {
    expect(lockForEvents([ev(1, "attack")], 0)?.reason).toBe("direct");
  });

  it("a chain resolving locks for the chain", () => {
    expect(lockForEvents([ev(1, "chain-resolving", { chainIndex: 2 })], 0)?.reason).toBe("chain");
  });

  it("a destroy locks for destroy", () => {
    expect(lockForEvents([ev(1, "destroy")], 0)?.reason).toBe("destroy");
  });

  it("picks the strongest reason and the longest time of the new events only", () => {
    const events = [ev(1, "destroy"), ev(2, "attack"), ev(3, "chain-resolving")];
    expect(lockForEvents(events, 1)?.reason).toBe("direct");
    expect(lockForEvents(events, 2)?.reason).toBe("chain");
  });

  it("quiet events do not lock", () => {
    expect(lockForEvents([ev(1, "phase"), ev(2, "summon"), ev(3, "move")], 0)).toBeNull();
  });
});
