// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SheetRoot } from "@/components/sheet";
import { MetaLine } from "@/components/draft/meta-line";
import styles from "@/components/draft/meta-line.module.css";

describe("MetaLine", () => {
  it.each(["t-meta", "tl-meta"])("keeps the %s foundation class and renders items in order", (className) => {
    render(<SheetRoot><MetaLine className={className} items={[
      { content: "Waiting to start" },
      { content: "3 joined" },
      { content: "Theme draft" },
    ]} /></SheetRoot>);

    const line = screen.getByRole("paragraph");
    expect(line).toHaveClass(className, styles.line);
    expect(line.firstElementChild).toHaveClass(styles.run);
    expect(Array.from(line.firstElementChild!.children, (item) => item.textContent)).toEqual([
      "Waiting to start", "3 joined", "Theme draft",
    ]);
  });

  it("attaches one decorative dot to every item, including the first", () => {
    const { container } = render(<SheetRoot><MetaLine className="tl-meta" items={[
      { content: "Drafting" }, { content: "Cube draft" }, { content: "2 players" },
    ]} /></SheetRoot>);

    expect(container.querySelectorAll(".dot")).toHaveLength(3);
    for (const item of container.querySelectorAll(`.${styles.item}`)) {
      expect(item.querySelectorAll(".dot")).toHaveLength(1);
      expect(item.firstElementChild).toHaveClass("dot");
      expect(item.firstElementChild).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("passes the item class to the flex item and preserves its content's aria attributes", () => {
    render(<SheetRoot><MetaLine className="tl-meta" items={[
      { content: "Waiting to start" },
      { className: "joined", content: <span aria-label="3 players joined">3 joined</span> },
    ]} /></SheetRoot>);

    const joined = screen.getByLabelText("3 players joined");
    expect(joined).toHaveTextContent("3 joined");
    expect(joined.parentElement).toHaveClass(styles.item, "joined");
    expect(joined.parentElement?.parentElement).toHaveClass(styles.run);
  });
});
