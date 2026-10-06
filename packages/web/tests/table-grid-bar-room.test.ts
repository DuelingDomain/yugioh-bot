import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dockBarRoom, pickBarRoom, promptUnit } from "../src/components/duel/table/grid-stage";

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const room = (value: string | undefined) => value?.split(",").map(Number);
const hits = (box: number[], target: ReturnType<typeof rect>) =>
  box[0] < target.x + target.width && target.x < box[0] + box[2] && box[1] < target.y + target.height && target.y < box[1] + box[3];

// The pick bar of the 4-way grid sits in YOUR pair, as near its middle as it can be, and never over a legal target.
describe("pickBarRoom", () => {
  const left = rect(0, 100, 780, 746); // the left pair at 1920x1080 (board px)
  const right = rect(800, 100, 740, 746); // a right pair (spectator focus)

  it("centres the bar on the pair when the middle is clear", () => {
    expect(room(pickBarRoom(left, [rect(100, 600, 90, 120)]))).toEqual([180, 427, 420, 92]);
  });

  it("moves the bar off targets in the middle band (Extra Monster zones), up first, and stays in the pair", () => {
    const emz = [rect(280, 430, 90, 130), rect(410, 430, 90, 130)];
    const box = room(pickBarRoom(left, emz))!;
    for (const target of emz) expect(hits(box, target)).toBe(false);
    expect(box[1] + box[3]).toBeLessThanOrEqual(430 - 6);
    expect(box[0]).toBeGreaterThanOrEqual(left.x + 12);
    expect(box[0] + box[2]).toBeLessThanOrEqual(left.x + left.width - 12);
  });

  it("works the same on a pair in the right column", () => {
    const [x, y, width, height] = room(pickBarRoom(right, []))!;
    expect(x + width / 2).toBe(right.x + right.width / 2);
    expect(y + height / 2).toBe(right.y + right.height / 2);
  });

  it("stacks the bar (taller) when the pair is narrow", () => {
    const [, , width, height] = room(pickBarRoom(rect(0, 0, 380, 600), []))!;
    expect(width).toBe(356);
    expect(height).toBe(136);
  });

  it("takes the place that covers the least when targets fill the pair", () => {
    const pair = rect(0, 0, 600, 400);
    const targets = [rect(0, 0, 600, 180), rect(0, 220, 600, 180)]; // only a 40px gap in the middle
    const [, y, , height] = room(pickBarRoom(pair, targets))!;
    expect(y + height / 2).toBe(200);
  });

  it("gives no room in a pair too narrow for a bar", () => {
    expect(pickBarRoom(rect(0, 0, 200, 400), [])).toBeUndefined();
  });
});

// Panels, the yes/no bar and the collapsed pill sit in the middle of YOUR pair (the vars grid-stage.tsx sets), not in a
// top lane.
describe("grid prompt placement", () => {
  const css = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.module.css"), "utf8");
  const rule = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    expect(start).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf("}", start));
  };

  it.each([
    ".slot[data-slot=\"prompt\"] :global([data-prompt-panel][data-precheck])",
    ".slot[data-slot=\"prompt\"] :global([data-prompt-panel]:not([data-precheck]))",
    ".slot[data-slot=\"prompt\"] :global([data-prompt-surface]:not([data-prompt-panel], [data-place]))",
  ])("centres %s on the pair", (selector) => {
    const body = rule(selector);
    expect(body).toMatch(/inset:\s*var\(--pr-cy, 50%\) auto auto var\(--pr-cx, 50%\)/);
    expect(body).toMatch(/translate:\s*-50% -50%/);
  });

  it("sets the pair vars on the prompt slot", () => {
    const source = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.tsx"), "utf8");
    expect(source).toMatch(/"--pr-cx"/);
    expect(source).toMatch(/data-slot="prompt"[^>]*style=\{promptStyle\}/);
  });
});

// The modal prompts take a unit from the pair height, so they stay small on a small screen and on the finale board.
describe("promptUnit", () => {
  it("follows the pair height between the floor and the cap", () => {
    expect(promptUnit(746, false)).toBe(1.1); // 1920x1080 pair
    expect(promptUnit(520, false)).toBe(0.76); // 1280x800 pair
    expect(promptUnit(300, false)).toBe(0.72);
    expect(promptUnit(2000, false)).toBe(1.15);
  });

  it("is smaller on the finale board than on a pair of the same height", () => {
    expect(promptUnit(746, true)).toBeLessThan(promptUnit(746, false));
  });

  it("is set on the slot, and the dense rules keep rows and buttons 32px or more and text 12px or more", () => {
    const grid = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.module.css"), "utf8");
    expect(grid).toMatch(/\[data-prompt-dense\] :global\(\[data-prompt-panel\]\) \{\s*--duel-unit: var\(--pr-unit, 1px\)/);
    for (const step of grid.match(/--duel-t-\w+: max\((\d+)px/g) ?? []) expect(Number(step.match(/(\d+)px/)![1])).toBeGreaterThanOrEqual(12);
    const prompts = readFileSync(join(__dirname, "../src/components/duel/prompt-center.module.css"), "utf8");
    expect(prompts).toMatch(/\[data-prompt-dense\]\) \.rowMain \{\s*min-height: max\(34px/);
    expect(prompts).toMatch(/\[data-prompt-dense\]\) \.btn \{ min-height: max\(32px/);
    const source = readFileSync(join(__dirname, "../src/components/duel/table/grid-stage.tsx"), "utf8");
    expect(source).toMatch(/"--pr-unit" as string\]: `\$\{promptUnit\(/);
  });
});

describe("dockBarRoom", () => {
  it("docks the bar of a zoomed board at the bottom middle of the box, in the middle half", () => {
    expect(room(dockBarRoom({ width: 1230, height: 815 }))).toEqual([405, 711, 420, 92]);
    // A narrow box: the bar is half the box wide and stacks.
    expect(room(dockBarRoom({ width: 760, height: 600 }))).toEqual([190, 452, 380, 136]);
    expect(dockBarRoom({ width: 300, height: 600 })).toBeUndefined();
  });
});
