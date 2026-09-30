// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { DEFAULT_SOUND_VOLUME, normalizeVolume, useDuelPreferences } from "@/components/duel/preferences";
import { DuelSoundControls } from "@/components/duel/room-settings";

const KEY = "yugidraft.duelPreferences.v1";

function stubMatchMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  stubMatchMedia();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("normalizeVolume", () => {
  it("clamps to 0..1 and drops non-numbers", () => {
    expect(normalizeVolume(0.4)).toBe(0.4);
    expect(normalizeVolume(3)).toBe(1);
    expect(normalizeVolume(-1)).toBe(0);
    expect(normalizeVolume("0.5")).toBeUndefined();
    expect(normalizeVolume(Number.NaN)).toBeUndefined();
  });
});

describe("useDuelPreferences sound volume", () => {
  it("defaults to 0.7 when the saved record has no volume (old save)", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, soundEnabled: true, motion: "full" }));
    const { result } = renderHook(() => useDuelPreferences());
    expect(result.current.soundEnabled).toBe(true);
    expect(result.current.soundVolume).toBe(DEFAULT_SOUND_VOLUME);
  });

  it("loads a stored volume and clamps out-of-range values", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, soundEnabled: false, motion: "system", volume: 0.25 }));
    expect(renderHook(() => useDuelPreferences()).result.current.soundVolume).toBe(0.25);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, soundEnabled: false, motion: "system", volume: 9 }));
    expect(renderHook(() => useDuelPreferences()).result.current.soundVolume).toBe(1);
  });

  it("saves the volume in the same v1 record", () => {
    const { result } = renderHook(() => useDuelPreferences());
    act(() => result.current.setSoundVolume(0.3));
    expect(result.current.soundVolume).toBe(0.3);
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    expect(saved).toMatchObject({ v: 1, volume: 0.3 });
  });

  it("ignores invalid volumes", () => {
    const { result } = renderHook(() => useDuelPreferences());
    act(() => result.current.setSoundVolume(Number.NaN));
    expect(result.current.soundVolume).toBe(DEFAULT_SOUND_VOLUME);
  });
});

describe("DuelSoundControls", () => {
  it("toggles sound and reports volume changes as 0..1", () => {
    const onEnabledChange = vi.fn();
    const onVolumeChange = vi.fn();
    render(<DuelSoundControls enabled={false} volume={0.7} onEnabledChange={onEnabledChange} onVolumeChange={onVolumeChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Sound effects" }));
    expect(onEnabledChange).toHaveBeenCalledWith(true);
    const slider = screen.getByLabelText("Volume") as HTMLInputElement;
    expect(slider.type).toBe("range");
    expect(slider.value).toBe("70");
    expect(slider).toHaveProperty("min", "0");
    expect(slider).toHaveProperty("max", "100");
    fireEvent.change(slider, { target: { value: "40" } });
    expect(onVolumeChange).toHaveBeenCalledWith(0.4);
    expect(screen.getByText("70%")).toBeTruthy();
  });
});
