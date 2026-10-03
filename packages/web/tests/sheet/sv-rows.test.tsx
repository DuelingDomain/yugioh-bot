// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FloorList, FloorRow } from "@/components/sheet/sv-rows";

describe("FloorList and FloorRow", () => {
  it("renders a ul of li rows with an inner line", () => {
    const { container } = render(<FloorList aria-label="Players"><FloorRow>One</FloorRow><FloorRow>Two</FloorRow></FloorList>);
    expect(screen.getByRole("list", { name: "Players" })).toHaveClass("sv-rows");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(container.querySelectorAll("li.sv-row > div.sv-row-in")).toHaveLength(2);
  });

  it("can be an ordered list", () => {
    const { container } = render(<FloorList as="ol"><FloorRow>One</FloorRow></FloorList>);
    expect(container.querySelector("ol.sv-rows")).not.toBeNull();
  });

  it("marks you rows and leaves non-link rows without data-link", () => {
    const { container } = render(<ul><FloorRow you>Imran</FloorRow></ul>);
    const li = container.querySelector("li") as HTMLElement;
    expect(li.getAttribute("data-you")).toBe("true");
    expect(li.getAttribute("data-link")).toBeNull();
  });

  it("makes the whole row a link with href", () => {
    const { container } = render(<ul><FloorRow href="/player/ke" aria-label="Kestrel">Kestrel</FloorRow></ul>);
    const link = screen.getByRole("link", { name: "Kestrel" });
    expect(link).toHaveAttribute("href", "/player/ke");
    expect(link).toHaveClass("sv-row-in");
    expect(container.querySelector("li")?.getAttribute("data-link")).toBe("true");
  });

  it("passes grid columns and phone areas as custom properties", () => {
    const { container } = render(<ul><FloorRow cols="34px 1fr auto" phoneCols="30px 1fr" phoneAreas={'"a b" "a c"'}>x</FloorRow></ul>);
    const inner = container.querySelector(".sv-row-in") as HTMLElement;
    expect(inner.style.getPropertyValue("--cols")).toBe("34px 1fr auto");
    expect(inner.style.getPropertyValue("--cols-ph")).toBe("30px 1fr");
    expect(inner.style.getPropertyValue("--areas-ph")).toBe('"a b" "a c"');
    expect(inner.getAttribute("data-cols")).toBe("true");
    expect(inner.getAttribute("data-phgrid")).toBe("true");
    const plain = render(<ul><FloorRow>y</FloorRow></ul>).container.querySelector(".sv-row-in") as HTMLElement;
    expect(plain.getAttribute("data-cols")).toBeNull();
    expect(plain.getAttribute("data-phgrid")).toBeNull();
  });
});
