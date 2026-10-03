import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(join(__dirname, "../../src/components/duel", name), "utf8");
const field = read("field.module.css");
const opponent = read("opponent-board.module.css");

/** The body of the first rule whose selector line is exactly `selector`. */
function rule(css: string, selector: string): string {
  const start = css.search(new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{`, "m"));
  expect(start, `rule ${selector}`).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

/** Every duration in a transition declaration, in ms. */
function durations(declaration: string): number[] {
  return [...declaration.matchAll(/\s(\d*\.?\d+)(ms|s)\b/g)].map((m) => Number(m[1]) * (m[2] === "s" ? 1000 : 1));
}

describe("usable zone highlight", () => {
  it("shows at once: the legal frame has no border or fill fade and a lift of at most 80 ms", () => {
    const body = rule(field, '.zone[data-legal="true"]:not(:hover) .frame');
    const transition = body.slice(body.indexOf("transition:"));
    expect(Math.max(...durations(transition))).toBeLessThanOrEqual(80);
    expect(transition).toMatch(/border-color 0s/);
    expect(transition).toMatch(/background-color 0s/);
  });

  it("the plain frame keeps its slower fades, so only the highlight changed", () => {
    const body = rule(field, ".frame");
    expect(Math.max(...durations(body.slice(body.indexOf("transition:"))))).toBeGreaterThan(80);
  });

  it("an empty legal zone has no dashed outline", () => {
    expect(rule(field, '.zone[data-legal="true"][data-occupied="false"] .frame')).not.toMatch(/dashed/);
    expect(field).not.toMatch(/^\.ring \{/m);
  });

  it("the rival board marks zones and piles with a glow, not a dashed outline", () => {
    expect(rule(opponent, ".ring")).toMatch(/box-shadow/);
    expect(rule(opponent, ".ring")).not.toMatch(/dashed/);
    expect(rule(opponent, '.count[data-legal="true"]')).not.toMatch(/dashed/);
  });

  it("the glow itself has no fade-in: it only breathes", () => {
    const body = rule(field, ".glow");
    expect(body).not.toMatch(/transition/);
  });
});
