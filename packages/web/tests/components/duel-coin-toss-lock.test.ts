// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireCoinLock,
  heldTossLogIds,
  holdTossLog,
  isCoinTossActive,
  resetCoinTossState,
  withoutHeldTossLines,
} from "../../src/components/duel/coin-toss-lock";

afterEach(() => resetCoinTossState());

function fire(target: EventTarget, event: Event): Event {
  target.dispatchEvent(event);
  return event;
}

describe("coin toss input lock", () => {
  it("blocks clicks, pointer and keys on the duel screen while it is held, and not after", () => {
    const button = document.createElement("button");
    document.body.append(button);
    const onClick = vi.fn();
    const onKey = vi.fn();
    button.addEventListener("click", onClick);
    window.addEventListener("keydown", onKey); // a bubble listener, like the prompt keys
    const release = acquireCoinLock();
    expect(isCoinTossActive()).toBe(true);
    fire(button, new MouseEvent("click", { bubbles: true, cancelable: true }));
    fire(button, new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    const key = fire(document.body, new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true }));
    expect(onClick).not.toHaveBeenCalled();
    expect(onKey).not.toHaveBeenCalled();
    expect(key.defaultPrevented).toBe(true);
    release();
    expect(isCoinTossActive()).toBe(false);
    fire(button, new MouseEvent("click", { bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "1", bubbles: true, cancelable: true }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onKey).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onKey);
    button.remove();
  });

  it("lets the browser keep its own keys", () => {
    const onKey = vi.fn();
    window.addEventListener("keydown", onKey);
    acquireCoinLock();
    fire(document.body, new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "F5", bubbles: true, cancelable: true }));
    fire(document.body, new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(onKey).toHaveBeenCalledTimes(3);
    window.removeEventListener("keydown", onKey);
  });

  it("stays locked until every holder gave it back, and gives back twice safely", () => {
    const a = acquireCoinLock();
    const b = acquireCoinLock();
    a();
    a();
    expect(isCoinTossActive()).toBe(true);
    b();
    expect(isCoinTossActive()).toBe(false);
  });
});

describe("coin toss log hold", () => {
  it("hides a toss line until its hold is released, and keeps other lines", () => {
    const entries = [{ id: 1, text: "a" }, { id: 2, text: "Coin toss", eventId: 9 }, { id: 3, text: "b" }];
    expect(withoutHeldTossLines(entries, heldTossLogIds())).toBe(entries);
    const release = holdTossLog(9);
    expect(withoutHeldTossLines(entries, heldTossLogIds()).map((entry) => entry.id)).toEqual([1, 3]);
    release();
    release();
    expect(withoutHeldTossLines(entries, heldTossLogIds())).toBe(entries);
  });
});
