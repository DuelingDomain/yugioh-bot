// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetPanel } from "@/components/sheet/sheet-panel";

describe("SheetPanel", () => {
  it("renders an h2 caption, body and labels the section by it", () => {
    const { container } = render(<SheetPanel title="Rules" id="rules"><p>Body</p></SheetPanel>);
    const section = container.querySelector("section") as HTMLElement;
    expect(section.className).toBe("panel msheet");
    const h = screen.getByRole("heading", { level: 2, name: "Rules" });
    expect(section.getAttribute("aria-labelledby")).toBe(h.id);
    expect(container.querySelector(".sheet-cap > h2")).not.toBeNull();
    expect(container.querySelector(".sheet-body")?.textContent).toBe("Body");
    expect(container.querySelector("small")).toBeNull();
    expect(container.querySelector(".sheet-foot")).toBeNull();
  });

  it("supports h3, live, string aside, node aside and footer", () => {
    const { container, rerender } = render(
      <SheetPanel title="Start" headingLevel={3} live aside="only you see this" footer="Open until the first duel" className="x" bodyClassName="b">
        x
      </SheetPanel>,
    );
    expect(screen.getByRole("heading", { level: 3 })).toBeTruthy();
    expect(container.querySelector("section")?.className).toBe("panel msheet lv x");
    expect(container.querySelector(".sheet-cap small")?.textContent).toBe("only you see this");
    expect(container.querySelector(".sheet-body")?.className).toBe("sheet-body b");
    expect(container.querySelector("footer.sheet-foot")?.textContent).toBe("Open until the first duel");
    rerender(<SheetPanel title="Start" aside={<a href="/all">Show all</a>}>x</SheetPanel>);
    expect(container.querySelector(".sheet-cap small")).toBeNull();
    expect(container.querySelector(".sheet-cap > a")?.getAttribute("href")).toBe("/all");
  });
});
