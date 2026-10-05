// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginWall } from "../../../app/(auth)/login/login-wall";
import { RING_CARD_IDS } from "../../../app/(auth)/login/login-wall-model";

type FakeAnimation = { playbackRate: number; pause: ReturnType<typeof vi.fn>; play: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> };

let animations: FakeAnimation[];
let reduced: boolean;
const originalAnimate = Element.prototype.animate;

function installMatchMedia() {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes("prefers-reduced-motion") ? reduced : false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

beforeEach(() => {
  animations = [];
  reduced = false;
  installMatchMedia();
  setViewport(1440, 900);
  Element.prototype.animate = vi.fn(() => {
    const animation: FakeAnimation = { playbackRate: 1, pause: vi.fn(), play: vi.fn(), cancel: vi.fn() };
    animations.push(animation);
    return animation as unknown as Animation;
  }) as unknown as typeof Element.prototype.animate;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Element.prototype.animate = originalAnimate;
  // @ts-expect-error restoring the jsdom default, which has no matchMedia
  delete window.matchMedia;
});

const wallRoots = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-login-wall]"));

function renderWall(props: { hasMessage?: boolean } = {}) {
  return render(
    <LoginWall {...props}>
      <main data-testid="stack"><button type="submit">Sign in with Discord</button></main>
    </LoginWall>,
  );
}

describe("LoginWall", () => {
  it("renders the stack untouched and every wall part aria-hidden", () => {
    const { container } = renderWall();
    screen.getByRole("button", { name: "Sign in with Discord" });
    const roots = wallRoots(container);
    expect(roots.length).toBeGreaterThanOrEqual(3);
    for (const root of roots) expect(root).toHaveAttribute("aria-hidden", "true");
  });

  it("renders no focusable elements in the wall", () => {
    const { container } = renderWall();
    for (const root of wallRoots(container)) {
      expect(root.querySelectorAll("a[href], button, input, select, textarea, [tabindex], [contenteditable]")).toHaveLength(0);
    }
  });

  it("builds two walls of decorative cards after mount, and none are ring cards", () => {
    const { container } = renderWall();
    const sides = container.querySelector("[data-login-wall='sides']")!;
    const images = Array.from(sides.querySelectorAll("img"));
    expect(images.length).toBeGreaterThan(30);
    for (const image of images) {
      expect(image).toHaveAttribute("alt", "");
      expect(image).toHaveAttribute("loading", "lazy");
      expect(image).toHaveAttribute("width");
      expect(image).toHaveAttribute("height");
      const source = new URL(image.getAttribute("src")!, "http://localhost");
      expect(source.pathname).toBe("/_next/image");
      expect(source.searchParams.get("url")).toMatch(/^https:\/\/images.ygoprodeck.com\/images\/cards_small\/\d+\.jpg$/);
      for (const id of RING_CARD_IDS) expect(source.searchParams.get("url")).not.toContain(`/${id}.jpg`);
    }
    // Phone bands stay empty at desktop width.
    expect(container.querySelector("[data-login-wall='top']")!.querySelectorAll("img")).toHaveLength(0);
  });

  it("drifts each rail with a transform animation that starts at rate 0", () => {
    renderWall();
    // 2 walls x 2 columns at 1440
    expect(animations).toHaveLength(4);
    expect(Element.prototype.animate).toHaveBeenCalledWith(
      [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(0, -50%, 0)" }],
      expect.objectContaining({ iterations: Infinity, easing: "linear" }),
    );
  });

  it("cancels every animation on unmount", () => {
    const { unmount } = renderWall();
    unmount();
    expect(animations.length).toBeGreaterThan(0);
    for (const animation of animations) expect(animation.cancel).toHaveBeenCalled();
  });

  it("builds bands on a phone, and only the top one on a short phone", () => {
    setViewport(390, 844);
    const tall = renderWall();
    expect(tall.container.querySelector("[data-login-wall='top']")!.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(tall.container.querySelector("[data-login-wall='bottom']")!.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(tall.container.querySelector("[data-login-wall='sides']")!.querySelectorAll("img")).toHaveLength(0);
    tall.unmount();

    setViewport(360, 740);
    const short = renderWall();
    expect(short.container.querySelector("[data-login-wall='top']")!.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(short.container.querySelector("[data-login-wall='bottom']")!.querySelectorAll("img")).toHaveLength(0);
  });

  it("leaves the bottom band empty when an error message shows", () => {
    setViewport(390, 844);
    const { container } = renderWall({ hasMessage: true });
    expect(container.querySelector("[data-login-wall='bottom']")!.querySelectorAll("img")).toHaveLength(0);
    expect(container.querySelector("[data-login-wall='top']")!.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("shows a still frame under reduced motion: cards built, nothing animated", () => {
    reduced = true;
    const { container, unmount } = renderWall();
    expect(container.querySelector("[data-login-wall='sides']")!.querySelectorAll("img").length).toBeGreaterThan(0);
    expect(Element.prototype.animate).not.toHaveBeenCalled();
    expect(() => unmount()).not.toThrow();
  });

  it("does not throw when matchMedia reports reduced motion and animate is missing", () => {
    reduced = true;
    // @ts-expect-error simulating a browser without the Web Animations API
    delete Element.prototype.animate;
    expect(() => renderWall()).not.toThrow();
  });

  it("builds nothing where there is no matchMedia", () => {
    // @ts-expect-error simulating an environment with no matchMedia
    delete window.matchMedia;
    const { container } = renderWall();
    expect(container.querySelectorAll("img")).toHaveLength(0);
    screen.getByRole("button", { name: "Sign in with Discord" });
  });

  it("picks a card near the middle, lights it, and puts it back", () => {
    vi.useFakeTimers();
    const rect = (top: number) => ({ top, left: 100, width: 100, height: 100, bottom: top + 100, right: 200, x: 100, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      // Every card sits in the middle of the viewport.
      return rect(400) as DOMRect;
    });
    const { container, unmount } = renderWall();
    act(() => { vi.advanceTimersByTime(4000); });
    const picked = container.querySelectorAll("[data-card][class*='pick']");
    expect(picked).toHaveLength(1);
    expect(picked[0].querySelector("i")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2200); });
    expect(container.querySelectorAll("[data-card][class*='pick']")).toHaveLength(0);
    expect(container.querySelector("i")).toBeNull();
    unmount();
    spy.mockRestore();
  });

  it("stops the pick timer on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderWall();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
