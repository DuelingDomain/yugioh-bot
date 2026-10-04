// @vitest-environment jsdom
import React from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelChainMode } from "@yugidraft/shared/duels";
import { CHAIN_MODE_STORAGE_KEY, hotkeyTarget, isChainHotkey, loadRememberedChainMode, rememberChainMode } from "@/components/duel/chain-mode";
import { useChainModeControl } from "@/components/duel/use-chain-mode";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

type Props = Parameters<typeof useChainModeControl>[0];

function setup(overrides: Partial<Props> = {}) {
  const send = vi.fn<(mode: DuelChainMode) => Promise<void>>().mockResolvedValue(undefined);
  const onError = vi.fn();
  const initial: Props = { slug: "t", serverMode: "auto", enabled: true, send, onError, ...overrides };
  const view = renderHook((props: Props) => useChainModeControl(props), { initialProps: initial });
  return { ...view, send, onError, initial };
}

const press = (key: string, init: KeyboardEventInit = {}) => act(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
});

describe("chain mode model", () => {
  it("R goes Off, and back to the state you left", () => {
    expect(hotkeyTarget("auto", "auto")).toBe("off");
    expect(hotkeyTarget("always", "always")).toBe("off");
    expect(hotkeyTarget("off", "always")).toBe("always");
  });

  it("remembers Auto and Always, never Off, and survives blocked storage", () => {
    rememberChainMode("always");
    expect(loadRememberedChainMode()).toBe("always");
    rememberChainMode("off");
    expect(loadRememberedChainMode()).toBe("always");
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, "off");
    expect(loadRememberedChainMode()).toBeNull();
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(loadRememberedChainMode()).toBeNull();
    spy.mockRestore();
  });

  it("does not take R while typing, with a modifier, held down, or under a dialog", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(isChainHotkey({ key: "r", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(true);
    expect(isChainHotkey({ key: "R", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(true);
    expect(isChainHotkey({ key: "r", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: input })).toBe(false);
    expect(isChainHotkey({ key: "r", ctrlKey: true, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(false);
    expect(isChainHotkey({ key: "r", ctrlKey: false, metaKey: true, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(false);
    expect(isChainHotkey({ key: "r", ctrlKey: false, metaKey: false, altKey: false, repeat: true, defaultPrevented: false, target: document.body })).toBe(false);
    expect(isChainHotkey({ key: "x", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(false);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.body.append(dialog);
    expect(isChainHotkey({ key: "r", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: document.body })).toBe(false);
  });
});

describe("useChainModeControl", () => {
  it("returns no control when the server reports no mode (spectator, replay, scenario table)", () => {
    expect(setup({ serverMode: undefined }).result.current).toBeNull();
  });

  it("returns no control when the viewer is not in a live duel", () => {
    expect(setup({ enabled: false }).result.current).toBeNull();
  });

  it("shows the new position at once and sends it", async () => {
    const { result, send } = setup();
    act(() => result.current!.onChange("off"));
    expect(result.current!.mode).toBe("off");
    await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith("off"));
  });

  it("snaps back and reports when the server refuses", async () => {
    const { result, send, onError } = setup();
    send.mockRejectedValueOnce(new Error("This duel has reached its limit"));
    act(() => result.current!.onChange("off"));
    await waitFor(() => expect(onError).toHaveBeenCalledWith("This duel has reached its limit"));
    await waitFor(() => expect(result.current!.mode).toBe("auto"));
    expect(loadRememberedChainMode()).toBeNull();
  });

  it("sends one request at a time and the newest wish wins", async () => {
    let release: () => void = () => undefined;
    const { result, send } = setup();
    send.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    act(() => result.current!.onChange("off"));
    act(() => result.current!.onChange("always"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current!.mode).toBe("always");
    await act(async () => release());
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith("always");
  });

  it("R flips to Off and back to the state before", async () => {
    const { result, rerender, send, initial } = setup({ serverMode: "always" });
    press("r");
    await waitFor(() => expect(send).toHaveBeenLastCalledWith("off"));
    rerender({ ...initial, serverMode: "off" });
    press("R");
    await waitFor(() => expect(send).toHaveBeenLastCalledWith("always"));
    expect(result.current).not.toBeNull();
  });

  it("R does nothing while typing, under a modal, or without a control", async () => {
    const { send, rerender, initial } = setup();
    const input = document.createElement("input");
    document.body.append(input);
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true })); });
    rerender({ ...initial, suspended: true });
    press("r");
    rerender({ ...initial, enabled: false });
    press("r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(send).not.toHaveBeenCalled();
  });

  it("remembers Auto and Always from a click, but not Off", async () => {
    const { result, send, rerender, initial } = setup();
    act(() => result.current!.onChange("always"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loadRememberedChainMode()).toBe("always"));
    rerender({ ...initial, serverMode: "always" });
    act(() => result.current!.onChange("off"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(loadRememberedChainMode()).toBe("always");
  });

  it("applies this browser's remembered choice once when a duel starts, and not when the server already matches", async () => {
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, "auto");
    const first = setup({ serverMode: "always" });
    await waitFor(() => expect(first.send).toHaveBeenCalledExactlyOnceWith("auto"));
    // The remembered choice is not written back by the automatic apply, and a rerender does not send it again.
    first.rerender({ ...first.initial, serverMode: "always" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(first.send).toHaveBeenCalledTimes(1);
    cleanup();
    const second = setup({ serverMode: "auto" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(second.send).not.toHaveBeenCalled();
  });

  it("remembers a choice made while the remembered one is still being applied", async () => {
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, "auto");
    let release: () => void = () => undefined;
    // The automatic apply of "auto" is in flight and not remembered again.
    const send = vi.fn<(mode: DuelChainMode) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
      .mockResolvedValue(undefined);
    const { result } = setup({ serverMode: "always", send });
    await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith("auto"));
    act(() => result.current!.onChange("always"));
    await act(async () => release());
    await waitFor(() => expect(send).toHaveBeenLastCalledWith("always"));
    await waitFor(() => expect(loadRememberedChainMode()).toBe("always"));
  });

  it("never overrides an Off the player already set, and waits for a live duel", async () => {
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, "always");
    const off = setup({ serverMode: "off" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(off.send).not.toHaveBeenCalled();
    cleanup();
    const lobby = setup({ serverMode: "auto", enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lobby.send).not.toHaveBeenCalled();
    lobby.rerender({ ...lobby.initial, enabled: true });
    await waitFor(() => expect(lobby.send).toHaveBeenCalledExactlyOnceWith("always"));
  });

  it("applies the remembered choice again for the next game of a series", async () => {
    window.localStorage.setItem(CHAIN_MODE_STORAGE_KEY, "auto");
    const { send, rerender, initial } = setup({ serverMode: "auto" });
    rerender({ ...initial, slug: "game-2", serverMode: "always" });
    await waitFor(() => expect(send).toHaveBeenCalledExactlyOnceWith("auto"));
  });
});
