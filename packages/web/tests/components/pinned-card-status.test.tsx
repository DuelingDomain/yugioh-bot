import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { DuelCard } from "@yugidraft/shared/duels";
import { pinnedExtraLines } from "../../src/components/duel/inspector";
import { staleCopy, staleLine } from "../../src/components/duel/stale-pin";
import { GridHoverPreview } from "../../src/components/duel/table/grid-preview";

const card: DuelCard = {
  controller: 0, location: 4, sequence: 0, position: 1,
  code: 11, name: "Pinned monster", description: "Printed effect text", type: 0x21,
  attack: 2000, defense: 1500, baseAttack: 2500, baseDefense: 1500,
  negated: true,
  hints: [{ descriptionId: "1", text: "Cannot be destroyed by battle", categories: ["cannot-be-destroyed-by-battle"] }],
  counters: [{ type: 1, count: 3 }],
  materials: [{ controller: 0, location: 4, sequence: 0, position: 1, code: 12, name: "Attached card" }],
};

function preview(current: DuelCard) {
  return renderToStaticMarkup(<GridHoverPreview card={current} owner={null} reducedMotion pinned extras={pinnedExtraLines(current)} />);
}

it("keeps a live pin's status list, printed stats and materials without duplicate negation", () => {
  const markup = preview(card);
  expect(markup).toContain('data-testid="card-status-list"');
  expect(markup).toContain("Cannot be destroyed by battle");
  expect(markup).toContain('data-status-counter="1"');
  expect(markup).toContain("Base ATK 2500 / DEF 1500");
  expect(markup).toContain("Materials (1): Attached card");
  expect(markup.match(/data-testid="inspector-negated"/g)).toHaveLength(1);
});

it.each(["gone", "set"] as const)("shows only printed information when a pinned card is %s", why => {
  const stale = staleCopy(card, why);
  const markup = preview(stale);
  expect(markup).toContain("Pinned monster");
  expect(markup).toContain("Printed effect text");
  expect(markup).toContain(staleLine(stale));
  expect(markup).not.toContain('data-testid="card-status-list"');
  expect(markup).not.toContain('data-testid="hover-preview-base-stats"');
  expect(markup).not.toContain("ATK 2000");
  expect(markup).not.toContain("Materials (1)");
});
