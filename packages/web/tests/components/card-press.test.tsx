// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent, PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardPress } from "../../src/components/decks/card-press";

function setup() {
  const actions = { remove: vi.fn(), moveSide: vi.fn(), select: vi.fn(), menu: vi.fn() };
  const { result } = renderHook(() => useCardPress());
  const press = result.current(actions);
  const tile = document.createElement("button");
  document.body.append(tile);
  const pointer = (pointerType: string, init: Partial<PointerEvent<HTMLElement>> = {}) => ({ pointerType, button: 0, clientX: 0, clientY: 0, currentTarget: tile, ...init }) as unknown as PointerEvent<HTMLElement>;
  const click = (init: Partial<MouseEvent<HTMLElement>> = {}) => ({ detail: 1, ctrlKey: false, metaKey: false, currentTarget: tile, ...init }) as unknown as MouseEvent<HTMLElement>;
  const contextMenu = () => ({ preventDefault: vi.fn(), currentTarget: tile }) as unknown as MouseEvent<HTMLElement>;
  return { actions, press, tile, pointer, click, contextMenu };
}

describe("useCardPress", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

  it("opens the menu once for a long press, even when the browser also sends contextmenu", () => {
    const { actions, press, pointer, click, contextMenu } = setup();
    press.onPointerDown(pointer("touch"));
    act(() => { vi.advanceTimersByTime(500); });
    press.onContextMenu(contextMenu());
    press.onPointerUp();
    press.onClick(click());
    expect(actions.menu).toHaveBeenCalledTimes(1);
    expect(actions.select).not.toHaveBeenCalled();
    expect(actions.remove).not.toHaveBeenCalled();
  });

  it("forgets a long press whose click never came, so the next tap selects", () => {
    const { actions, press, pointer, click } = setup();
    press.onPointerDown(pointer("pen"));
    act(() => { vi.advanceTimersByTime(500); });
    expect(actions.menu).toHaveBeenCalledTimes(1);
    press.onPointerUp();
    act(() => { vi.advanceTimersByTime(500); });
    press.onClick(click({ detail: 0 }));
    expect(actions.select).toHaveBeenCalledTimes(1);
  });

  it("removes only after a primary mouse press on the same tile, once", () => {
    const { actions, press, pointer, click } = setup();
    press.onClick(click());
    expect(actions.remove).not.toHaveBeenCalled();
    press.onPointerDown(pointer("mouse", { button: 2 }));
    press.onClick(click());
    expect(actions.remove).not.toHaveBeenCalled();
    press.onPointerDown(pointer("mouse"));
    press.onClick(click());
    press.onClick(click({ detail: 2 }));
    expect(actions.remove).toHaveBeenCalledTimes(1);
    expect(actions.select).toHaveBeenCalledTimes(2);
  });

  it("never removes on a keyboard click, even after a press that left the tile armed", () => {
    const { actions, press, pointer, click, contextMenu } = setup();
    // Ctrl+click on a Mac: a press and a contextmenu, no click.
    press.onPointerDown(pointer("mouse", { ctrlKey: true }));
    press.onContextMenu(contextMenu());
    press.onClick(click({ detail: 0 }));
    expect(actions.remove).not.toHaveBeenCalled();
    expect(actions.select).toHaveBeenCalledTimes(1);
    // A press that never clicked (dragged off) and then a keyboard click.
    press.onPointerDown(pointer("mouse"));
    press.onClick(click({ detail: 0 }));
    expect(actions.remove).not.toHaveBeenCalled();
  });
});
