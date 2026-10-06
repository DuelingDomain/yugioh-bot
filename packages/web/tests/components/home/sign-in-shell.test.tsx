// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: ({ variable }: { variable: string }) => ({ variable, className: "font-class" }),
}));

import { SignInShell } from "@/components/auth/sign-in-shell";
import { PackTilt } from "@/components/auth/pack-tilt";
import styles from "@/components/auth/sign-in-shell.module.css";

let matches = false;
let mediaChange: (() => void) | undefined;
beforeEach(() => {
  matches = false;
  mediaChange = undefined;
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    get matches() { return matches; },
    addEventListener: (_event: string, listener: () => void) => { mediaChange = listener; },
    removeEventListener: vi.fn(),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("SignInShell", () => {
  it("renders deterministic decoration on the server with local card backs and inline definitions", () => {
    const shell = <SignInShell><h1>Sign in</h1></SignInShell>;
    const first = renderToString(shell);
    expect(renderToString(shell)).toBe(first);
    const doc = new DOMParser().parseFromString(first, "text/html");
    expect(doc.querySelectorAll(`.${styles.dust} i`)).toHaveLength(14);
    const images = Array.from(doc.querySelectorAll("img"));
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/^\/sign-in\/card-back-(main|extra)-hd\.webp$/);
      expect(image.getAttribute("alt")).toBe("");
      expect(image.closest('[aria-hidden="true"]')).not.toBeNull();
    }
    for (const id of ["dd-lockup", "dd-clip", "dd-glint"]) expect(doc.getElementById(id)).not.toBeNull();
  });

  it("exposes the open-pack frame while leaving the default sealed", () => {
    const { container, rerender } = render(<SignInShell><h1>Sign in</h1></SignInShell>);
    expect(container.querySelector("[data-pack-state]")).toHaveAttribute("data-pack-state", "sealed");
    expect(container.querySelector(`.${styles.pack}`)).not.toHaveClass(styles["is-open"], styles["mark-play"]);
    rerender(<SignInShell packState="open"><h1>Welcome</h1></SignInShell>);
    expect(container.querySelector("[data-pack-state]")).toHaveAttribute("data-pack-state", "open");
    expect(container.querySelector(`.${styles.pack}`)).toHaveClass(styles["is-open"], styles["mark-play"]);
    expect(container.querySelector(`.${styles.t2}`)).toHaveTextContent("Pack’s open");
  });
});

describe("PackTilt", () => {
  it("gates movement on fine hover pointers and motion preference, and resets when disabled", () => {
    const { container } = render(<PackTilt><div>Pack</div></PackTilt>);
    const hit = container.firstElementChild as HTMLDivElement;
    const tilt = hit.firstElementChild as HTMLDivElement;
    vi.spyOn(hit, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 300));
    const move = () => fireEvent(hit, new MouseEvent("pointermove", { clientX: 175, clientY: 50 }));
    move();
    expect(tilt.style.transform).toBe("");
    expect(window.matchMedia).toHaveBeenCalledWith("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    matches = true;
    move();
    expect(tilt.style.transform).toContain("rotateX");
    expect(tilt.style.getPropertyValue("--sx")).not.toBe("");
    fireEvent.pointerLeave(hit);
    expect(tilt.style.transform).toBe("");
    move();
    matches = false;
    act(() => mediaChange?.());
    expect(tilt.style.transform).toBe("");
    expect(tilt.style.getPropertyValue("--sx")).toBe("");
    expect(tilt.style.getPropertyValue("--sy")).toBe("");
  });
});
