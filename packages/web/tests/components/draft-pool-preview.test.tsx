// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PoolPreview } from "../../src/components/draft/create/pool-preview";
import createStyles from "../../src/components/draft/create/create.module.css";
import type { CardSummary } from "../../src/lib/card-types";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";

const make = (id: number, type: string, qty = 1) =>
  ({ id, name: `Card ${id}`, type, frameType: "normal", effectText: "", imageUrl: "u", imageUrlSmall: `/s/${id}.jpg`, qty }) as CardSummary;

describe("PoolPreview", () => {
  it("provides an inline-size container for the portal's phone pool layouts", () => {
    installVirtualizerJsdomEnv({ width: 390, height: 600 });
    // Vitest stubs CSS modules; apply the real wrapper rule to its generated class.
    const css = postcss.parse(readFileSync(resolve(import.meta.dirname, "../../src/components/draft/create/create.module.css"), "utf8"));
    const stylesheet = document.createElement("style");
    css.walkRules(".poolSheet", (rule) => {
      if (rule.parent?.type === "root") {
        stylesheet.textContent += rule.clone({ selector: `.${createStyles.poolSheet}` }).toString();
      }
    });
    document.head.append(stylesheet);
    try {
      render(<PoolPreview cards={[make(1, "Effect Monster")]} unknownIds={[]} loading={false} />);
      fireEvent.click(screen.getByRole("button", { name: /see all 1 cards/i }));
      const wrapper = screen.getByTestId("card-pool-grid").closest(`.${createStyles.poolSheet}`);
      expect(wrapper).not.toBeNull();
      expect(wrapper!.closest(".ms-flow")?.parentElement).toBe(document.body);
      expect(getComputedStyle(wrapper!).getPropertyValue("container-type")).toBe("inline-size");
    } finally {
      stylesheet.remove();
    }
  });

  it("tallies the pool, shows six thumbnails and opens the full pool in a side sheet", () => {
    installVirtualizerJsdomEnv();
    const cards = [
      ...Array.from({ length: 6 }, (_, i) => make(i + 1, "Effect Monster", 2)),
      make(20, "Spell Card"),
      make(21, "Trap Card", 3),
    ];
    const { container } = render(<PoolPreview cards={cards} unknownIds={[]} loading={false} />);

    expect(screen.getByText("16 cards")).toBeInTheDocument();
    expect(screen.getByText("Monsters").closest("span")).toHaveTextContent("12");
    expect(container.querySelectorAll("img")).toHaveLength(6);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /see all 16 cards/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.closest(".ms")?.parentElement).toBe(document.body);
  });

  it("moves focus into the sheet and back to the button when it closes", async () => {
    installVirtualizerJsdomEnv();
    render(<PoolPreview cards={[make(1, "Effect Monster")]} unknownIds={[]} loading={false} />);
    const seeAll = screen.getByRole("button", { name: /see all 1 cards/i });
    seeAll.focus();
    fireEvent.click(seeAll);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    // Focus returns after the sheet's exit, which can land a tick after the dialog leaves the DOM.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(seeAll);
    });
  });

  it("names card IDs that aren't in the card list instead of asking for a pool", () => {
    installVirtualizerJsdomEnv();
    render(<PoolPreview cards={[]} unknownIds={[46986414, 89631139]} loading={false} />);
    expect(screen.queryByText(/add sets or card ids/i)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("2 card IDs aren't in the card list yet: 46986414, 89631139.");
    fireEvent.click(screen.getByRole("button", { name: /see the pool/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("asks for a pool when there are no cards", () => {
    render(<PoolPreview cards={[]} unknownIds={[]} loading={false} />);
    expect(screen.getByText(/add cards to preview the pool/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see all/i })).toBeNull();
  });
});
