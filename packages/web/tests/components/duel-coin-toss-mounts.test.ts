import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (file: string) => readFileSync(join(__dirname, "../../src/components/duel", file), "utf8");

// The coin is one screen-level layer: every duel shell mounts it, none of them places it in a seat or board.
describe("coin toss mounts", () => {
  it.each([
    ["room.tsx", "1v1 room, 3D Solid Vision (renderBoard)"],
    ["table/table-shell.tsx", "3-way and 4-way table"],
    ["tag/tag-fx.tsx", "Tag 2v2"],
    ["replay.tsx", "replay viewer"],
  ])("%s mounts CoinTossFx (%s)", (file) => {
    expect(src(file)).toMatch(/<CoinTossFx\b/);
  });

  it("the replay mount is passive (no input lock)", () => {
    expect(src("replay.tsx")).toMatch(/<CoinTossFx[^>]*\bpassive\b/);
  });

  it("the overlay covers the whole screen and centres the coin, in a portal above every layer", () => {
    const css = src("coin-toss-fx.module.css");
    const root = /\.root\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(root).toMatch(/position:\s*fixed/);
    expect(root).toMatch(/inset:\s*0/);
    expect(root).toMatch(/z-index:\s*var\(--duel-z-coin\)/);
    // The stage fills the cover and the coin hangs at its horizontal centre, whatever sits under it.
    expect(/\.stage\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/inset:\s*0/);
    expect(/\.lift\s*\{[^}]*\}/.exec(css)?.[0]).toMatch(/left:\s*50%/);
    expect(src("coin-toss-fx.tsx")).toMatch(/createPortal\([\s\S]*document\.body/);
  });

  it("the room guards every send path with the lock", () => {
    const room = src("room.tsx");
    expect(room).toMatch(/const run = useCallback\(\s*async \(work[^\n]*\n\s*\/\/[^\n]*\n\s*if \(isCoinTossActive\(\)\) return;/);
    expect(room).toMatch(/\(answer: DuelAnswer\) => \{\s*if \(isCoinTossActive\(\)\) return;/);
    expect(room).toMatch(/if \(!canSurrender \|\| isCoinTossActive\(\)\) return;/);
  });
});
