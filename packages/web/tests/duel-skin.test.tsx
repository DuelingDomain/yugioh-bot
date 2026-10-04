// @vitest-environment jsdom
import React from "react";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DuelSkinProvider, useSkinStyles, type DuelSkin } from "@/components/duel/skin";

const base = { zone: "b-zone", plate: "b-plate", frame: "b-frame" } as const;
const skin: DuelSkin = { field: { zone: "s-zone", extra: "s-extra" } };
const wrap = (value: DuelSkin | null) => ({ children }: { children: React.ReactNode }) =>
  <DuelSkinProvider value={value}>{children}</DuelSkinProvider>;

describe("duel skin", () => {
  it("returns the base styles untouched without a provider", () => {
    const { result } = renderHook(() => useSkinStyles(base, "field"));
    expect(result.current).toBe(base);
  });

  it("returns the base styles when the skin has no such slot", () => {
    const { result } = renderHook(() => useSkinStyles(base, "lp"), { wrapper: wrap(skin) });
    expect(result.current).toBe(base);
  });

  it("adds the skin classes after the base classes and leaves other keys alone", () => {
    const { result } = renderHook(() => useSkinStyles(base, "field"), { wrapper: wrap(skin) });
    expect(result.current).toEqual({ zone: "b-zone s-zone", plate: "b-plate", frame: "b-frame" });
  });

  it("keeps the same object between renders and between components", () => {
    const wrapper = wrap(skin);
    const first = renderHook(() => useSkinStyles(base, "field"), { wrapper });
    first.rerender();
    const again = renderHook(() => useSkinStyles(base, "field"), { wrapper });
    expect(first.result.current).toBe(again.result.current);
  });

  it("makes a new object for another skin", () => {
    const other: DuelSkin = { field: { zone: "o-zone" } };
    const a = renderHook(() => useSkinStyles(base, "field"), { wrapper: wrap(skin) });
    const b = renderHook(() => useSkinStyles(base, "field"), { wrapper: wrap(other) });
    expect(b.result.current.zone).toBe("b-zone o-zone");
    expect(a.result.current).not.toBe(b.result.current);
  });
});
