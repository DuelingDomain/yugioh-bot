// @vitest-environment jsdom
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { planGlide, useNavGlide } from "../../../src/components/layout/use-nav-glide";

describe("planGlide", () => {
  const a = { href: "/a", x: 12, y: 80 };
  it("starts from the old place", () => {
    expect(planGlide(a, { href: "/b", x: 12, y: 200 })).toEqual({ dx: 0, dy: -120 });
  });
  it("plays nothing for a first mark, the same item or a sub-pixel move", () => {
    expect(planGlide(null, a)).toBeNull();
    expect(planGlide(a, { ...a, y: 300 })).toBeNull();
    expect(planGlide(a, { href: "/b", x: 12.2, y: 80.2 })).toBeNull();
  });
});

function Rail({ href }: { href: string }) {
  const ref = useRef<HTMLElement>(null);
  useNavGlide(ref, href);
  return (
    <aside ref={ref}>
      <a href="/a">{href === "/a" ? <span data-glide="/a" /> : null}A</a>
      <a href="/b">{href === "/b" ? <span data-glide="/b" /> : null}B</a>
    </aside>
  );
}

describe("useNavGlide", () => {
  const realAnimate = Element.prototype.animate;
  const realRect = Element.prototype.getBoundingClientRect;
  afterEach(() => {
    Element.prototype.animate = realAnimate;
    Element.prototype.getBoundingClientRect = realRect;
    vi.restoreAllMocks();
  });

  function place() {
    // The mark sits at y 80 under /a and y 200 under /b.
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const glide = this.getAttribute("data-glide");
      const y = glide === "/b" ? 200 : glide === "/a" ? 80 : 0;
      return { left: 12, top: y, x: 12, y, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    };
  }

  it("glides the new mark from the old place, transform only", () => {
    place();
    const animate = vi.fn(() => ({}) as Animation);
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    const { rerender } = render(<Rail href="/a" />);
    expect(animate).not.toHaveBeenCalled();
    rerender(<Rail href="/b" />);
    expect(animate).toHaveBeenCalledOnce();
    const [frames, options] = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames).toEqual([{ transform: "translate(0px, -120px)" }, { transform: "none" }]);
    expect(options.duration).toBe(200);
    expect(Object.keys(frames[0])).toEqual(["transform"]);
  });

  it("refreshes from a pointerdown anywhere on the page, so a click in the page glides from where the mark is", () => {
    let top = 80;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const y = this.getAttribute("data-glide") === "/b" ? 200 : this.getAttribute("data-glide") === "/a" ? top : 0;
      return { left: 12, top: y, x: 12, y, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
    };
    const animate = vi.fn(() => ({}) as Animation);
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    const { rerender, unmount } = render(<Rail href="/a" />);
    // A row appeared above and pushed the mark down while nothing re-rendered the rail.
    top = 100;
    const outside = document.createElement("main");
    document.body.append(outside);
    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    rerender(<Rail href="/b" />);
    const [frames] = animate.mock.calls[0] as unknown as [Keyframe[]];
    expect(frames[0]).toEqual({ transform: "translate(0px, -100px)" });
    unmount();
    // Cleaned up: a later pointerdown reads nothing and throws nothing.
    expect(() => outside.dispatchEvent(new Event("pointerdown", { bubbles: true }))).not.toThrow();
    outside.remove();
  });

  it("only measures when the active item changes, not on every render", () => {
    place();
    const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
    const { rerender } = render(<Rail href="/a" />);
    const after = rect.mock.calls.length;
    rerender(<Rail href="/a" />);
    rerender(<Rail href="/a" />);
    expect(rect.mock.calls.length).toBe(after);
    rerender(<Rail href="/b" />);
    expect(rect.mock.calls.length).toBeGreaterThan(after);
  });

  it("stays still after a keyboard choice", () => {
    place();
    const animate = vi.fn(() => ({}) as Animation);
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    const { rerender } = render(<Rail href="/a" />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    rerender(<Rail href="/b" />);
    expect(animate).not.toHaveBeenCalled();
    document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });

  it("stays still under reduced motion", () => {
    place();
    window.matchMedia = vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    const animate = vi.fn(() => ({}) as Animation);
    Element.prototype.animate = animate as unknown as typeof Element.prototype.animate;
    const { rerender } = render(<Rail href="/a" />);
    rerender(<Rail href="/b" />);
    expect(animate).not.toHaveBeenCalled();
  });
});
