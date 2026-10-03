import React from "react";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { makeDeck, makeSeries, makeSeriesRoom } from "../helpers/duel-series";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { BetweenGamesScreen } from "@/components/duel/between-games";
import styles from "@/components/duel/between-games.module.css";
import ui from "@/components/duel/sheet-ui.module.css";
import editor from "@/components/decks/editor.module.css";
import series from "@/components/duel/series.module.css";
import result from "@/components/duel/duel-result.module.css";
import preview from "@/components/duel/deck-card-preview.module.css";

const root = fileURLToPath(new URL("../../src/components/", import.meta.url));
const css = readFileSync(`${root}duel/between-games.module.css`, "utf8");

describe("between-games grid sizing", () => {
  it("keeps desktop tiles at least 40 px wide without fixing the column count", () => {
    const cards = css.match(/^\.cards\s*\{([^}]+)\}/m)![1]!;
    expect(cards).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(40px,\s*1fr\)\)/);
    // Give auto-fill a definite available width; max-width alone can create clipped tracks.
    expect(cards).toMatch(/width:\s*100%/);
    expect(cards).toMatch(/min-width:\s*0/);
    expect(cards).toMatch(/max-width:\s*calc\(20 \* clamp\(44px, 8\.5dvh, 76px\) \+ 19 \* 4px\)/);
  });

  it.each([40, 60])("renders all three full sections for a %i-card Main Deck", (count) => {
    const deck = makeDeck({ main: Array(count).fill(1), extra: Array(15).fill(100), side: Array(15).fill(10) });
    const room = makeSeriesRoom({ series: makeSeries({ status: "between_games" }), mySide: { baseDeck: deck, currentDeck: deck } });
    const html = renderToStaticMarkup(<BetweenGamesScreen room={room} slug="layout" onChanged={() => {}} onNavigate={() => {}}
      knownCards={new Map([[1, { name: "Main card", type: 1 }], [100, { name: "Extra card", type: 0x40 }], [10, { name: "Side card", type: 1 }]])}
      initialMarks={{ out: [{ section: "main", index: 0 }], inn: [0] }} />);
    expect(html.match(/aria-label="Main card, Main Deck/g)).toHaveLength(count);
    expect(html.match(/aria-label="Extra card, Extra Deck/g)).toHaveLength(15);
    expect(html.match(/aria-label="Side card, Side Deck/g)).toHaveLength(15);
    // Optional real-browser fixtures use the rendered component and its actual scoped styles.
    const dir = process.env.DUEL_LAYOUT_PREVIEW_DIR;
    if (dir) {
      const sheets: Array<[string, Record<string, string>]> = [["duel/sheet-ui", ui], ["decks/editor", editor], ["duel/series", series], ["duel/duel-result", result], ["duel/deck-card-preview", preview], ["duel/between-games", styles]];
      const scoped = sheets.map(([file, names]) => readFileSync(`${root}${file}.module.css`, "utf8").replace(/\.([a-zA-Z_][\w-]*)/g, (selector, name: string) => names[name] ? `.${names[name]}` : selector)).join("\n");
      mkdirSync(dir, { recursive: true });
      writeFileSync(`${dir}/side-${count}.html`, `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0} :root{--font-duel-ui:Arial;--font-duel-num:Arial} ${scoped}</style>${html}`);
    }
  });
});
