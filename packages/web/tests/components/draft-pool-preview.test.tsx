// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PoolPreview } from "../../src/components/draft/create/pool-preview";
import type { CardSummary } from "../../src/lib/card-types";
import { installVirtualizerJsdomEnv } from "../helpers/virtualizer-jsdom";

const make = (id: number, type: string, qty = 1) =>
  ({ id, name: `Card ${id}`, type, frameType: "normal", effectText: "", imageUrl: "u", imageUrlSmall: `/s/${id}.jpg`, qty }) as CardSummary;

describe("PoolPreview", () => {
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

  it("asks for a pool when there are no cards", () => {
    render(<PoolPreview cards={[]} unknownIds={[]} loading={false} />);
    expect(screen.getByText(/add sets or card ids to preview the pool/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /see all/i })).toBeNull();
  });
});
