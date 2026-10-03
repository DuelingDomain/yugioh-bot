// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font-class", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { SheetPortal } from "@/components/sheet/sheet-portal";
import { SheetRoot } from "@/components/sheet/sheet-root";

describe("SheetPortal", () => {
  it("renders nothing on the server", () => {
    expect(renderToString(<SheetPortal><p>modal</p></SheetPortal>)).toBe("");
  });

  it("mounts its content under document.body inside an .ms element, outside the caller", () => {
    const { container } = render(
      <SheetRoot>
        <SheetPortal><p>modal</p></SheetPortal>
      </SheetRoot>,
    );
    const p = screen.getByText("modal");
    expect(container.contains(p)).toBe(false);
    const root = p.closest(".ms") as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.parentElement).toBe(document.body);
    expect(root.classList.contains("ms-flow")).toBe(true);
  });
});

describe("SheetRoot", () => {
  it("adds ms, font classes and optional flow / element", () => {
    const { container } = render(<SheetRoot as="main" flow className="x" id="r">hi</SheetRoot>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe("MAIN");
    expect(el.id).toBe("r");
    expect(el.classList.contains("ms")).toBe(true);
    expect(el.classList.contains("ms-flow")).toBe(true);
    expect(el.classList.contains("x")).toBe(true);
    expect(el.className).toContain("font-var");
  });
});
