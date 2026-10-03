// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import postcss from "postcss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HistoryRow } from "@/components/sheet/history-rail";
import { TierMeter } from "@/components/sheet/marks";

const stylesheet = postcss.parse(readFileSync(path.resolve(__dirname, "../../src/styles/match-sheet.css"), "utf8"));
const baseRules: string[] = [];
// These defaults are outside media/container queries. jsdom cannot parse the
// stylesheet's @layer and @container blocks, so load its unconditional rules.
stylesheet.walkRules((rule) => {
  if (rule.parent?.type === "root") baseRules.push(rule.toString());
});
let style: HTMLStyleElement;
beforeAll(() => {
  style = document.createElement("style");
  style.textContent = baseRules.join("\n");
  document.head.append(style);
});
afterAll(() => style.remove());

describe("Match Sheet layout defaults", () => {
  it("TierMeter has a full-width block box in ordinary flow", () => {
    render(<div className="ms"><div><TierMeter tier="Gold" value={0.62} /></div></div>);
    const meter = screen.getByRole("img", { name: "Gold meter" });
    const computed = getComputedStyle(meter);
    expect(computed.display).toBe("block");
    expect(computed.width).toBe("100%");
    expect(computed.height).toBe("4px");
    expect(getComputedStyle(meter.firstElementChild!).width).toBe("62%");
  });

  it("HistoryRow keeps thumbnails, scores, text and metadata on separate tracks", () => {
    render(
      <div className="ms"><ol>
        <HistoryRow thumb={<img alt="Deck" />} score="2–1" meta="+11">Imran beat Marik</HistoryRow>
      </ol></div>,
    );
    const row = screen.getByRole("listitem");
    expect(row.children).toHaveLength(4);
    expect(getComputedStyle(row).gridTemplateColumns).toBe("auto auto minmax(0, 1fr) auto");
    expect(screen.getByRole("img", { name: "Deck" })).toBeInTheDocument();
    expect(screen.getByText("2–1")).toBeInTheDocument();
    expect(screen.getByText("Imran beat Marik")).toBeInTheDocument();
    expect(screen.getByText("+11")).toBeInTheDocument();
  });

  it.each(["thumbnail", "score"])("HistoryRow retains three columns with only a %s", (leading) => {
    render(
      <div className="ms"><ol>
        <HistoryRow thumb={leading === "thumbnail" ? <img alt="Deck" /> : undefined} score={leading === "score" ? "2–1" : undefined} meta="+11">Imran beat Marik</HistoryRow>
      </ol></div>,
    );
    expect(getComputedStyle(screen.getByRole("listitem")).gridTemplateColumns).toBe("auto minmax(0, 1fr) auto");
  });
});
